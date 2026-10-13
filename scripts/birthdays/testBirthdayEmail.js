// Fake-backed test of functions/notifyBirthdayEmails.js, birthdayEmail.js and
// emailUnsubscribe.js (ported from Adopt Me's scripts/birthdays/testBirthdayEmail.js).
// No network: Brevo is a stubbed fetch, RTDB and Auth are in memory.
//   node scripts/birthdays/testBirthdayEmail.js
// Also writes an HTML preview per language to $PREVIEW_DIR when set.

const path = require('path');
const fs = require('fs');

const FN = path.join(__dirname, '..', '..', 'functions');
const be = require(path.join(FN, 'birthdayEmail'));
const { _internals: { run, MAX_SENDS } } = require(path.join(FN, 'notifyBirthdayEmails'));
const { _internals: { handle } } = require(path.join(FN, 'emailUnsubscribe'));
const core = require(path.join(FN, 'birthdays', 'core'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

// ── Rendering ────────────────────────────────────────────────────────────
const SECRET = 'test-secret';
ok(be.GIFT_STARS === core.constants.GIFT_STARS, 'gift stars match the Birthdays gift');
ok(be.LANGS.length === 9 && ['en', 'es', 'es-ES', 'pt', 'fr', 'de', 'ru', 'ja', 'ar'].every((l) => be.COPY[l] && be.PAGE[l]), 'all 9 app languages have copy and a page');
const keys = Object.keys(be.COPY.en).sort().join();
for (const lang of be.LANGS) {
  ok(Object.keys(be.COPY[lang]).sort().join() === keys, `${lang}: same copy keys as en`);
  ok(Object.keys(be.PAGE[lang]).sort().join() === Object.keys(be.PAGE.en).sort().join(), `${lang}: same page keys as en`);
  const url = be.unsubUrl('uid123abcdef', lang, SECRET);
  const g = be.renderBirthdayEmail({ name: 'Alice', gift: true, lang, unsubscribeUrl: url });
  const n = be.renderBirthdayEmail({ name: '', gift: false, lang, unsubscribeUrl: url });
  const p = be.renderBirthdayEmail({ name: 'Alice', gift: true, lang, unsubscribeUrl: url, plain: true });
  ok(g.subject.includes('Alice') && !n.subject.includes('{{'), `${lang}: name in subject only when given`);
  ok(g.html.includes(be.POSTAL_ADDRESS) && g.text.includes(be.POSTAL_ADDRESS) && p.html.includes(be.POSTAL_ADDRESS), `${lang}: postal address`);
  ok(g.html.includes(be.escapeHtml(url)) && g.text.includes(url) && p.text.includes(url), `${lang}: unsubscribe link`);
  ok(g.html.includes(be.escapeHtml(be.COPY[lang].buttonGift)) && n.html.includes(be.escapeHtml(be.COPY[lang].button)), `${lang}: gift vs plain button`);
  ok(g.text.includes(`${be.GIFT_STARS} ⭐`) && !n.text.includes('⭐'), `${lang}: stars only in the gift email`);
  ok(![g.html, g.text, g.subject, n.html, n.text, p.html, p.subject].some((s) => s.includes('{{')), `${lang}: no unfilled placeholders`);
  ok((lang === 'ar') === g.html.includes('dir="rtl"') && (lang === 'ar') === p.html.includes('dir="rtl"'), `${lang}: direction`);
  ok(g.html.includes(`lang="${lang}"`), `${lang}: html lang`);
  ok(g.html.includes('MM2 Values') && !/adopt ?me|uplift/i.test(g.html + n.html), `${lang}: MM2 brand only`);
  ok(g.html.includes(be.escapeHtml(be.PLAY_URL)) && g.html.includes(be.IOS_URL), `${lang}: store links`);
  ok(!/\p{Extended_Pictographic}/u.test(p.subject), `${lang}: plain subject has no emoji`);
  if (process.env.PREVIEW_DIR) {
    fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PREVIEW_DIR, `birthday-${lang}.html`), g.html);
    fs.writeFileSync(path.join(process.env.PREVIEW_DIR, `birthday-${lang}-nogift.html`), n.html);
  }
}
ok(/knife, gun and pet/.test(be.COPY.en.gift) && /Messern, Guns und Pets/.test(be.COPY.de.gift), 'copy is about knives, guns and pets');
const evil = be.renderBirthdayEmail({ name: '<script>x</script>', gift: true, lang: 'en', unsubscribeUrl: 'u' });
ok(!evil.html.includes('<script>x') && evil.html.includes('&lt;script&gt;'), 'names are HTML-escaped');
ok(be.cleanName('visit www.scam.com') === '' && be.cleanName('a@b.co') === '', 'link-like names dropped');
ok(be.cleanName('  Knife   King ') === 'Knife King', 'names trimmed');
ok(be.pickLang('pt-BR') === 'pt' && be.pickLang('es-ES') === 'es-ES' && be.pickLang('es-es') === 'es-ES'
  && be.pickLang('es-419') === 'es' && be.pickLang('ja') === 'ja' && be.pickLang('ko') === 'en' && be.pickLang(null) === 'en', 'language choice');
ok(be.SENDER.email === 'hello@mm2values.app' && be.SENDER.name === 'MM2 Values', 'sender');
ok(be.unsubUrl('uidA1234567', 'es-ES', SECRET).startsWith('https://us-central1-mm2vlaues-ed80c.cloudfunctions.net/emailUnsubscribe?u=uidA1234567&t=')
  && be.unsubUrl('uidA1234567', 'es-ES', SECRET).endsWith('&l=es-ES'), 'unsubscribe URL is MM2\'s function');

// ── Unsubscribe tokens ──────────────────────────────────────────────────
const tok = be.unsubToken('uidA', SECRET);
ok(be.verifyUnsubToken('uidA', tok, SECRET), 'token verifies');
ok(!be.verifyUnsubToken('uidB', tok, SECRET), 'token is per player');
ok(!be.verifyUnsubToken('uidA', tok, 'other-secret'), 'token needs the secret');
ok(!be.verifyUnsubToken('uidA', '', SECRET) && !be.verifyUnsubToken('uidA', 'x', SECRET) && !be.verifyUnsubToken('uidA', tok, ''), 'junk rejected');

// ── In-memory RTDB (once/transaction/update/remove; enough for these modules) ──
function makeDb(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  const parts = (p) => String(p).split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), root);
  const prune = (o) => {
    if (!o || typeof o !== 'object') return o;
    for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] == null) delete o[k]; }
    return Object.keys(o).length ? o : null;
  };
  const set = (p, v) => {
    const ks = parts(p);
    if (!ks.length) { root = v; return; }
    if (!root || typeof root !== 'object') root = {};
    let n = root;
    ks.slice(0, -1).forEach((k) => { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; });
    n[ks[ks.length - 1]] = v === undefined ? null : JSON.parse(JSON.stringify(v));
    root = prune(root) || {};
  };
  const TIMESTAMP = { '.sv': 'timestamp' };
  const resolve = (v) => (v && v['.sv'] === 'timestamp' ? 1234 : v);
  return {
    dump: () => JSON.parse(JSON.stringify(root)),
    get,
    ref: (p) => ({
      once: async () => { const v = get(p); return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v != null }; },
      transaction: async (fn) => {
        const cur = get(p);
        const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
        if (next === undefined) return { committed: false };
        set(p, next);
        return { committed: true };
      },
      update: async (obj) => { for (const [k, v] of Object.entries(obj)) set(`${p}/${k}`, resolve(v)); },
      set: async (v) => set(p, v),
      remove: async () => set(p, null),
    }),
    TIMESTAMP,
  };
}

// ── The daily run ───────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 9, 13, 8, 0, 0); // 2026-10-13 08:00 UTC
const DAY = 86400000;

function makeWorld({ players, extra = {}, emails = {}, disabled = [] }) {
  const tree = { users: {}, users_private: {}, email_prefs: {}, birthday_index: {}, birthday_server: { hidden13: {} }, trade_index: { user: {} }, ...extra };
  for (const [uid, p] of Object.entries(players)) {
    tree.users[uid] = { displayName: p.name ?? uid, createdAt: NOW - (p.ageDays ?? 400) * DAY };
    if (p.dob) tree.users_private[uid] = { dateOfBirth: p.dob, ...(p.privEmail ? { email: p.privEmail } : {}) };
    if (p.emailDob || p.optIn !== undefined) tree.email_prefs[uid] = { optIn: p.optIn ?? true, source: 'signin', updatedAt: 1, ...(p.emailDob ? { dob: p.emailDob } : {}) };
    const key = p.key || '1013';
    const node = p.hidden ? tree.birthday_server.hidden13 : tree.birthday_index;
    node[key] = { ...(node[key] || {}), [uid]: true };
    if (p.lang) tree.trade_index.user[uid] = { l: p.lang };
  }
  const db = makeDb(tree);
  const sent = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.to[0].email === 'fail@x.com') return { ok: false, status: 400, json: async () => ({ code: 'invalid_parameter', message: 'bad' }) };
    sent.push({ url, headers: opts.headers, body });
    return { ok: true, status: 201, json: async () => ({ messageId: `<m${sent.length}>` }) };
  };
  let getUsersCalls = 0;
  const auth = {
    getUsers: async (ids) => {
      getUsersCalls++;
      if (ids.length > 100) throw new Error('getUsers over 100');
      return { users: ids.filter(({ uid }) => uid in emails).map(({ uid }) => ({ uid, email: emails[uid] || undefined, disabled: disabled.includes(uid) })) };
    },
  };
  const logs = [];
  return { db, sent, auth, calls: () => getUsersCalls, args: { db, auth, apiKey: 'k', unsubSecret: SECRET, now: NOW, log: (...a) => logs.push(a.join(' ')) } };
}

(async () => {
  const w = makeWorld({
    players: {
      alice00001: { dob: '2000-10-13', name: 'Alice', lang: 'ru' },
      bob0000001: { dob: '1999-10-13', name: 'Bob', lang: 'xx', ageDays: 3 },            // new account: no-gift copy
      hidden0001: { dob: '2001-10-13', name: 'Hidden', hidden: true, lang: 'es-ES' },    // hid birthday: still emailed
      emaildob01: { emailDob: '2002-10-13', name: 'EmailDob', optIn: true },             // DOB only in email_prefs
      noemail001: { dob: '2000-10-13' },
      optedout01: { dob: '2000-10-13', optIn: false },
      apple00001: { dob: '2000-10-13' },
      fails00001: { dob: '2000-10-13' },
      kid0000001: { dob: '2014-10-13' },                                                  // turns 12: never
      turns13x01: { dob: '2013-10-13', name: 'Thirteen' },                                // turns 13 today: yes
      stale00001: { dob: '2000-03-05' },                                                  // index is stale: not today
      privmail01: { dob: '2000-10-13', privEmail: 'priv@x.com' },                         // no Auth email → users_private
      disabled01: { dob: '2000-10-13', privEmail: 'dis@x.com' },
      deleted001: { dob: '2000-10-13', privEmail: 'del@x.com' },                          // no Auth record
      already001: { dob: '2000-10-13' },
    },
    extra: { },
    emails: {
      alice00001: 'a@x.com', bob0000001: 'b@x.com', hidden0001: 'h@x.com', emaildob01: 'e@x.com',
      noemail001: '', optedout01: 'o@x.com', apple00001: 'x@privaterelay.appleid.com', fails00001: 'fail@x.com',
      kid0000001: 'k@x.com', turns13x01: 't@x.com', stale00001: 's@x.com', privmail01: '', disabled01: 'dis@x.com',
      already001: 'al@x.com',
    },
    disabled: ['disabled01'],
  });
  await w.db.ref('birthday_server/email_sent/2026/already001').set(1);
  await w.db.ref('birthday_server/email_sent/2024/old').set(1);
  await w.db.ref('birthday_server/email_sent/2025/last').set(1);
  const s = await run(w.args);
  const to = w.sent.map((m) => m.body.to[0].email).sort();
  ok(JSON.stringify(to) === JSON.stringify(['a@x.com', 'b@x.com', 'e@x.com', 'h@x.com', 'priv@x.com', 't@x.com']), `recipients ${JSON.stringify(to)}`);
  ok(s.candidates === 15, `candidates 15 (got ${s.candidates})`);
  ok(s.sent === 6 && s.claimed === 7 && s.failed === 1, `sent/claimed/failed ${JSON.stringify(s)}`);
  ok(s.under13 === 1 && s.notToday === 1 && s.optedOut === 1 && s.alreadySent === 1 && s.appleRelay === 1, `skip counts ${JSON.stringify(s)}`);
  ok(s.noEmail === 3, `no email: empty, disabled, deleted (got ${s.noEmail})`);
  const a = w.sent.find((m) => m.body.to[0].email === 'a@x.com');
  ok(a.body.subject.startsWith('С днём рождения, Alice') && a.body.subject.includes('звёзды'), 'Alice in Russian, gift subject');
  ok(a.body.sender.email === 'hello@mm2values.app' && a.body.sender.name === 'MM2 Values', 'sender');
  ok(a.headers['api-key'] === 'k', 'api key header');
  ok(/^<https:\/\/us-central1-mm2vlaues-ed80c\.cloudfunctions\.net\/emailUnsubscribe\?u=alice00001&t=[^&]+&l=ru>$/.test(a.body.headers['List-Unsubscribe']), 'List-Unsubscribe header');
  ok(a.body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'one-click header');
  const b = w.sent.find((m) => m.body.to[0].email === 'b@x.com');
  ok(b.body.subject === 'Happy birthday, Bob! 🎂', 'Bob: unknown language -> English, new account -> no gift');
  const h = w.sent.find((m) => m.body.to[0].email === 'h@x.com');
  ok(h.body.subject.includes('Tienes estrellas de regalo') && h.body.headers['List-Unsubscribe'].endsWith('&l=es-ES>'), 'hidden player in Spain Spanish');
  const st = w.db.get('birthday_server/email_sent');
  ok(st['2026'] && st['2026'].alice00001 === NOW && st['2026'].fails00001 === NOW && !st['2026'].kid0000001 && !st['2026'].optedout01, 'claims: sent + failed, not skipped');
  ok(!st['2024'] && st['2025'] && st['2025'].last, 'retention keeps this and last year only');
  ok(JSON.stringify(w.db.get('birthday_server/email_day')) === JSON.stringify({ '2026-10-13': 7 }), `daily count = claimed sends ${JSON.stringify(w.db.get('birthday_server/email_day'))}`);

  // A retry the same day sends nothing new.
  const before = w.sent.length;
  const s2 = await run(w.args);
  ok(w.sent.length === before && s2.sent === 0 && s2.claimed === 0, `retry sends nothing ${JSON.stringify(s2)}`);

  // Two runs at once: the claim is the only gate, nobody gets two.
  const w2 = makeWorld({ players: { p000000001: { dob: '2000-10-13' }, p000000002: { dob: '2000-10-13' } }, emails: { p000000001: 'p1@x.com', p000000002: 'p2@x.com' } });
  await Promise.all([run(w2.args), run(w2.args)]);
  ok(w2.sent.length === 2, `parallel runs: each player once (sent ${w2.sent.length})`);

  // Daily cap: never more than MAX_SENDS a UTC day, across runs.
  const many = {};
  const manyEmails = {};
  for (let i = 0; i < MAX_SENDS + 40; i++) {
    const uid = `user${String(i).padStart(6, '0')}`;
    many[uid] = { dob: '2000-10-13' };
    manyEmails[uid] = `${uid}@x.com`;
  }
  const w3 = makeWorld({ players: many, emails: manyEmails });
  const s3 = await run(w3.args);
  ok(s3.sent === MAX_SENDS && s3.overCap === 40, `capped at ${MAX_SENDS} (sent ${s3.sent}, over ${s3.overCap})`);
  ok(w3.calls() === 2, `getUsers in chunks of 100 (calls ${w3.calls()})`);
  const s3b = await run(w3.args);
  ok(s3b.sent === 0 && s3b.overCap === 40, `second run the same day stays under the cap (${JSON.stringify(s3b)})`);
  const s3c = await run({ ...w3.args, now: NOW + DAY });
  ok(s3c.sent === 0 && s3c.candidates === 0, 'past-cap players get no late email the next day');

  // 29 Feb birthdays on 28 Feb of a non-leap year.
  const w4 = makeWorld({ players: { leap000001: { dob: '2000-02-29', key: '0229' } }, emails: { leap000001: 'l@x.com' } });
  const s4 = await run({ ...w4.args, now: Date.UTC(2027, 1, 28, 8) });
  ok(s4.sent === 1, '29 Feb celebrated on 28 Feb 2027');

  // Nobody today.
  const w5 = makeWorld({ players: {} });
  const s5 = await run(w5.args);
  ok(s5.candidates === 0 && w5.sent.length === 0, 'empty day');

  // Missing secrets fail loudly, before anything is claimed.
  let threw = false;
  try { await run({ ...w5.args, apiKey: '' }); } catch (_) { threw = true; }
  ok(threw, 'missing secret throws');

  // ── emailUnsubscribe ─────────────────────────────────────────────────
  const res = () => {
    const r = { code: 0, body: '', headers: {} };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
  };
  const uid = 'abcdefghij0123456789';
  const t = be.unsubToken(uid, SECRET);
  const udb = makeDb({ email_prefs: { [uid]: { optIn: true, source: 'signin', updatedAt: 1, dob: '2000-10-13' } } });
  const g1 = res();
  await handle({ method: 'GET', query: { u: uid, t, l: 'ar' } }, g1, { db: udb, secret: SECRET });
  ok(g1.code === 200 && g1.body.includes('method="post"') && g1.body.includes('dir="rtl"'), 'GET shows the confirm page');
  ok(udb.get(`email_prefs/${uid}/optIn`) === true, 'GET changes nothing');
  const p1 = res();
  await handle({ method: 'POST', query: { u: uid, t, l: 'ja' } }, p1, { db: udb, secret: SECRET });
  const prefs = udb.get(`email_prefs/${uid}`);
  ok(p1.code === 200 && p1.body.includes(be.escapeHtml(be.PAGE.ja.doneTitle)), 'POST unsubscribes');
  ok(prefs.optIn === false && prefs.source === 'settings' && prefs.updatedAt === 1234 && prefs.dob === '2000-10-13', `prefs written in the app's shape ${JSON.stringify(prefs)}`);
  ok(Object.keys(prefs).every((k) => ['optIn', 'source', 'updatedAt', 'dob'].includes(k)), 'no field the rules would reject ($other: false)');
  const p2 = res();
  await handle({ method: 'POST', query: { u: 'zzzzzzzzzz0123456789', t, l: 'en' } }, p2, { db: udb, secret: SECRET });
  ok(p2.code === 400 && udb.get('email_prefs/zzzzzzzzzz0123456789') === undefined, 'a token for another player is refused');
  const p3 = res();
  await handle({ method: 'POST', query: { u: '../users', t: be.unsubToken('../users', SECRET) } }, p3, { db: udb, secret: SECRET });
  ok(p3.code === 400, 'path-like uid refused');
  const p4 = res();
  await handle({ method: 'PUT', query: { u: uid, t } }, p4, { db: udb, secret: SECRET });
  ok(p4.code === 405, 'other methods refused');
  const fresh = 'newuser000000000000a';
  const p5 = res();
  await handle({ method: 'POST', query: { u: fresh, t: be.unsubToken(fresh, SECRET), l: 'es-ES' } }, p5, { db: udb, secret: SECRET });
  ok(JSON.stringify(udb.get(`email_prefs/${fresh}`)) === JSON.stringify({ optIn: false, source: 'settings', updatedAt: 1234 }) && p5.body.includes('lang="es-ES"'), 'a player with no prefs yet gets a valid node');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
