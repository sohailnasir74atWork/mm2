/**
 * Trade Match: index rules (functions/tradeMatchCore.js), the index and alert
 * functions (functions/tradeMatch.js, against an in-memory RTDB/Firestore
 * fake) and the app's matching rules (Code/TradeMatch/matchCore.js).
 * No emulator, no network. From functions/:
 *
 *   node --test test/tradeMatch.test.js
 */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const core = require('../tradeMatchCore');
const app = require('../../Code/TradeMatch/matchCore');
const { _internal: tm } = require('../tradeMatch');

const DAY = 86400000;
const item = (name, extra) => ({ name, imageUrl: 'x', value: 1, ...(extra || {}) });

// ── A tiny in-memory RTDB + Firestore, enough for the code under test ──────

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function fakeRtdb(initial) {
  const root = { v: clone(initial) || {} };
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root.v);
  const setAt = (p, val) => {
    const ks = parts(p);
    const chain = [root.v];
    let o = root.v;
    for (const k of ks.slice(0, -1)) {
      if (!o[k] || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
      chain.push(o);
    }
    const last = ks[ks.length - 1];
    if (val === null || val === undefined) delete o[last];
    else o[last] = clone(val);
    // RTDB drops empty parents.
    for (let i = ks.length - 2; i >= 0; i--) {
      const parent = chain[i];
      const k = ks[i];
      if (parent[k] && typeof parent[k] === 'object' && !Object.keys(parent[k]).length) delete parent[k];
    }
  };
  const snap = (key, val) => ({
    key,
    val: () => (val === undefined ? null : clone(val)),
    exists: () => val !== undefined && val !== null,
    forEach: (fn) => { for (const [k, v] of Object.entries(val || {})) fn(snap(k, v)); },
  });
  const ref = (p) => {
    const r = {
      once: async () => snap(parts(p).pop(), getAt(p)),
      set: async (v) => setAt(p, v),
      update: async (obj) => { for (const [k, v] of Object.entries(obj)) setAt(`${p}/${k}`, v); },
      child: (c) => ref(`${p}/${c}`),
      transaction: async (fn) => setAt(p, fn(clone(getAt(p)))),
      orderByValue: () => {
        const q = { start: -Infinity, last: Infinity };
        const api = {
          startAt: (v) => { q.start = v; return api; },
          limitToLast: (n) => { q.last = n; return api; },
          once: async () => {
            const rows = Object.entries(getAt(p) || {})
              .filter(([, v]) => Number(v) >= q.start)
              .sort((a, b) => a[1] - b[1])
              .slice(-q.last);
            return snap(parts(p).pop(), Object.fromEntries(rows));
          },
        };
        return api;
      },
    };
    return r;
  };
  return { ref, dump: () => clone(root.v), get: getAt, set: setAt };
}

function fakeFirestore(docs) {
  return {
    docs,
    collection: () => ({
      doc: (id) => ({
        get: async () => ({
          exists: !!docs[id],
          data: () => clone(docs[id] && docs[id].data),
          updateTime: { toMillis: () => (docs[id] ? docs[id].v : 0) },
        }),
      }),
    }),
  };
}

// ── Keys ────────────────────────────────────────────────────────────────

test('item keys: the app, the function and valueSources agree', () => {
  for (const n of ["Nik's Scythe", 'C. Elderwood Blade', "Gold Vamp's Edge", 'Gold Travelers Axe', 'Curse Knife', 'Harvester', '']) {
    assert.strictEqual(core.normalizeName(n), app.normalizeName(n), n);
  }
  assert.strictEqual(core.normalizeName('C. Elderwood Blade'), 'chromaelderwoodblade');
  assert.strictEqual(core.normalizeName('Curse Knife'), 'cursedknife');
  assert.strictEqual(core.itemKey({ name: '!!!' }), null);
  assert.strictEqual(core.itemKey({ Name: 'Icebreaker' }), 'icebreaker');

  // Every alias valueSources.js declares is in both copies, and no more.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'Code', 'Helper', 'valueSources.js'), 'utf8');
  const block = src.slice(src.indexOf('const NAME_ALIASES = new Map(['), src.indexOf('].map(([from, to])'));
  const pairs = [...block.matchAll(/\[\s*(['"])(.+?)\1\s*,\s*(['"])(.+?)\3\s*\]/g)].map((m) => [m[2], m[4]]);
  assert.ok(pairs.length >= 10, 'aliases parsed from valueSources.js');
  for (const [from, to] of pairs) {
    assert.strictEqual(core.normalizeName(from), core.normalizeName(to), `${from} -> ${to}`);
    assert.strictEqual(app.normalizeName(from), core.normalizeName(to), `app ${from} -> ${to}`);
  }
  assert.strictEqual(core._NAME_ALIASES.size, pairs.length);
  assert.strictEqual(app._NAME_ALIASES.size, pairs.length);
  assert.ok(src.includes(".replace(/^c\\.\\s*/i, 'Chroma ')") && src.includes(".replace(/vamp'?s\\b/i, 'Vampires')"),
    'valueSources name rules unchanged (update both copies if this fails)');

  // Whole catalogues, when the pipeline output is on this machine.
  const dist = '/Volumes/Sohail/DataFetching/MM2VALUES/dist';
  for (const f of ['data.json', 'supreme.json']) {
    const p = path.join(dist, f);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8')).data;
    for (const tiers of Object.values(data)) {
      for (const items of Object.values(tiers)) {
        for (const it of items) {
          assert.strictEqual(core.itemKey(it), app.itemKey(it));
          assert.ok(core.itemKey(it) === null || /^[a-z0-9]{1,60}$/.test(core.itemKey(it)));
        }
      }
    }
  }
});

test('For Trade default: a missing flag is listed, false is Private', () => {
  assert.strictEqual(core.isListed(item('A')), true);
  assert.strictEqual(core.isListed(item('A', { availableForTrade: true })), true);
  assert.strictEqual(core.isListed(item('A', { availableForTrade: false })), false);
  assert.strictEqual(core.isListed(null), false);
  assert.strictEqual(app.isListed(item('A')), true);
  assert.strictEqual(app.isListed(item('A', { availableForTrade: false })), false);
});

// ── Lists ───────────────────────────────────────────────────────────────

test('buildLists: Private out, dream in even when Private, dedupe, cap', () => {
  const doc = {
    ownedPets: [item('Harvester'), item('Harvester'), item('Icebreaker', { availableForTrade: false }), item('Corrupt')],
    wishlistPets: [item('Elderwood Scythe'), item('Batwing', { availableForTrade: false }), item('Lugercane', { availableForTrade: false })],
    dreamItemKey: 'batwing',
  };
  const l = core.buildLists(doc);
  assert.deepStrictEqual(l, { have: ['harvester', 'corrupt'], want: ['elderwoodscythe', 'batwing'], dream: 'batwing' });
  // The app computes the same lists from the same document.
  assert.deepStrictEqual(app.buildLists(doc.ownedPets, doc.wishlistPets, doc.dreamItemKey), l);

  // A dream that is not on the wishlist does not count.
  assert.strictEqual(core.buildLists({ ...doc, dreamItemKey: 'harvester' }).dream, null);
  assert.strictEqual(core.buildLists({ ...doc, dreamItemKey: 'Bad Key!' }).dream, null);
  // Old documents: no flags, no dream -> everything listed.
  assert.deepStrictEqual(core.buildLists({ ownedPets: [item('A')], wishlistPets: [item('B')] }), { have: ['a'], want: ['b'], dream: null });
  assert.deepStrictEqual(core.buildLists(null), { have: [], want: [], dream: null });
  const many = Array.from({ length: 200 }, (_, i) => item(`Item ${i}`));
  assert.strictEqual(core.buildLists({ ownedPets: many }).have.length, core.MAX_ITEMS);
});

test('signature: bio edits and ratings do not reindex, list changes do', () => {
  const base = { ownedPets: [item('A')], wishlistPets: [item('B')], bio: 'hi' };
  assert.strictEqual(core.signature(base), core.signature({ ...base, bio: 'changed', averageRating: 5 }));
  assert.strictEqual(core.signature(null), core.signature({ toUserId: 'x', rating: 4 }));
  assert.notStrictEqual(core.signature(base), core.signature({ ...base, ownedPets: [item('A', { availableForTrade: false })] }));
  assert.notStrictEqual(core.signature(base), core.signature({ ...base, tradeMatchSeenAt: { toMillis: () => 5 } }));
  // Re-ordering or re-adding the same item changes nothing indexed.
  assert.strictEqual(
    core.signature({ ownedPets: [item('A'), item('A')] }),
    core.signature({ ownedPets: [item('A')] }),
  );
});

test('buildIndexUpdate + summary round trip', () => {
  const lists = { have: ['a', 'b'], want: ['c'], dream: 'c' };
  const up = core.buildIndexUpdate('u1', null, lists, { t: 100, v: 7, l: 'ru' });
  assert.deepStrictEqual(up, {
    'have/a/u1': 100, 'have/b/u1': 100, 'want/c/u1': 100, 'dream/c/u1': 100,
    'user/u1': { h: 'a,b', w: 'c', d: 'c', t: 100, v: 7, l: 'ru' },
  });
  const old = core.decodeSummary(up['user/u1']);
  assert.deepStrictEqual(old, { have: ['a', 'b'], want: ['c'], dream: 'c', t: 100, v: 7, l: 'ru' });

  const next = { have: ['b', 'd'], want: [], dream: null };
  const up2 = core.buildIndexUpdate('u1', old, next, { t: 200, v: 8, l: 'xx' });
  assert.deepStrictEqual(up2, {
    'have/a/u1': null, 'want/c/u1': null, 'dream/c/u1': null,
    'have/b/u1': 200, 'have/d/u1': 200,
    'user/u1': { h: 'b,d', w: '', d: null, t: 200, v: 8, l: 'en' },
  });
  const gone = core.buildIndexUpdate('u1', core.decodeSummary(up2['user/u1']), { have: [], want: [], dream: null }, { t: 300 });
  assert.deepStrictEqual(gone, { 'have/b/u1': null, 'have/d/u1': null, 'user/u1': null });

  assert.strictEqual(core.traderDelta(null, lists), 1);
  assert.strictEqual(core.traderDelta(old, next), 0);
  assert.strictEqual(core.traderDelta(old, { have: [], want: ['x'], dream: null }), -1);
  assert.deepStrictEqual(core.newHaveKeys(old, core.decodeSummary(up2['user/u1'])), ['d']);
  assert.deepStrictEqual(core.newHaveKeys(null, old), ['a', 'b']);
  assert.strictEqual(core.decodeSummary(null), null);
  assert.deepStrictEqual(core.decodeSummary({ h: 'ok,BAD KEY,', w: 5 }).have, ['ok']);
});

// ── reindexUser (trigger + backfill path) ─────────────────────────────────

test('reindexUser: create, edit, stale version, removal; traders count', async () => {
  const db = fakeRtdb({});
  tm.io.db = () => db;
  const uid = 'uidAAAAAAAAAAAAAAAAAAAAAAAAA';

  const doc1 = {
    ownedPets: [item('Harvester'), item('Icebreaker', { availableForTrade: false })],
    wishlistPets: [item('Batwing')],
    dreamItemKey: 'batwing',
    tradeMatchLang: 'es-ES',
  };
  let r = await tm.reindexUser(uid, doc1, { ts: 1000, v: 10 });
  assert.strictEqual(r.created, true);
  assert.strictEqual(db.get(`trade_index/have/harvester/${uid}`), 1000);
  assert.strictEqual(db.get(`trade_index/have/icebreaker/${uid}`), undefined);
  assert.strictEqual(db.get(`trade_index/want/batwing/${uid}`), 1000);
  assert.strictEqual(db.get(`trade_index/dream/batwing/${uid}`), 1000);
  assert.strictEqual(db.get(`trade_index/user/${uid}/l`), 'es-ES');
  assert.strictEqual(db.get('trade_index/stats/traders'), 1);

  // Older document version arrives late: ignored.
  r = await tm.reindexUser(uid, { ownedPets: [] }, { ts: 1100, v: 9 });
  assert.strictEqual(r.skipped, 'version');
  assert.strictEqual(db.get(`trade_index/have/harvester/${uid}`), 1000);

  // Backfill re-run on the same version: skipped.
  r = await tm.reindexUser(uid, doc1, { ts: 1, v: 10, skipSameVersion: true });
  assert.strictEqual(r.skipped, 'version');

  // Edit: Harvester goes Private, Corrupt listed, dream cleared.
  const doc2 = { ownedPets: [item('Harvester', { availableForTrade: false }), item('Corrupt')], wishlistPets: [item('Batwing')] };
  await tm.reindexUser(uid, doc2, { ts: 2000, v: 11 });
  assert.strictEqual(db.get(`trade_index/have/harvester/${uid}`), undefined);
  assert.strictEqual(db.get(`trade_index/have/corrupt/${uid}`), 2000);
  assert.strictEqual(db.get(`trade_index/want/batwing/${uid}`), 2000);
  assert.strictEqual(db.get(`trade_index/dream/batwing/${uid}`), undefined);
  assert.strictEqual(db.get('trade_index/stats/traders'), 1);

  // Document deleted: everything goes, the count drops.
  await tm.reindexUser(uid, null, { ts: 3000, v: 12 });
  assert.strictEqual(db.get(`trade_index/user/${uid}`), undefined);
  assert.strictEqual(db.get('trade_index/have'), undefined);
  assert.strictEqual(db.get('trade_index/want'), undefined);
  assert.strictEqual(db.get('trade_index/stats/traders'), 0);

  // Nothing listed and nothing indexed: no writes at all.
  r = await tm.reindexUser(uid, { ownedPets: [item('X', { availableForTrade: false })] }, { ts: 4000, v: 13 });
  assert.strictEqual(r.skipped, 'empty');
  // Review documents ("{to}_{from}") are never indexed.
  r = await tm.reindexUser('to_from', doc1, { ts: 1, v: 1 });
  assert.strictEqual(r.skipped, 'uid');
});

test('countDreamFound: once per player per item, old days pruned', async () => {
  const now = Date.UTC(2026, 9, 13, 12);
  const db = fakeRtdb({ trade_index: { stats: { found: { 20260901: 4, 20261012: 2 } } } });
  tm.io.db = () => db;
  assert.strictEqual(await tm.countDreamFound('uidBBBBBBBBBBBBBBBB', 'batwing', now), true);
  assert.strictEqual(await tm.countDreamFound('uidBBBBBBBBBBBBBBBB', 'batwing', now + DAY), false);
  assert.strictEqual(await tm.countDreamFound('uidBBBBBBBBBBBBBBBB', 'bad key', now), false);
  assert.deepStrictEqual(db.get('trade_index/stats/found'), { 20261012: 2, 20261013: 1 });
  assert.deepStrictEqual(app.readStats(db.get('trade_index/stats'), now), { traders: 0, found7d: 3 });
});

// ── Dream alerts ────────────────────────────────────────────────────────

test('sendDreamAlerts: recipients, opt-out, stale dreams and every rate limit', async () => {
  let now = Date.UTC(2026, 9, 13, 12);
  const L = 'listerAAAAAAAAAAAAAAAAAAAAA';
  const R1 = 'recipOneAAAAAAAAAAAAAAAAAA';
  const R2 = 'recipTwoAAAAAAAAAAAAAAAAAA';
  const R3 = 'recipThreeAAAAAAAAAAAAAAAA';
  const db = fakeRtdb({
    users: {
      [L]: { displayName: 'Lister\nName' },
      [R1]: { fcmToken: 't1' },
      [R2]: { fcmToken: 't2' },
      [R3]: { fcmToken: 't3', notificationSettings: { tradeMatchAlerts: false } },
    },
    trade_index: {
      dream: { batwing: { [R1]: now - DAY, [R2]: now - 40 * DAY, [R3]: now - DAY, [L]: now } },
      user: { [R1]: { l: 'ru' } },
    },
  });
  const sent = [];
  tm.io.db = () => db;
  tm.io.fs = () => fakeFirestore({ [L]: { v: 1, data: { ownedPets: [item('Batwing')] } } });
  tm.io.now = () => now;
  tm.io.send = async (m) => { sent.push(m); };
  tm.io.isBanned = async () => false;

  let r = await tm.sendDreamAlerts(L, ['batwing']);
  assert.deepStrictEqual(r, { sent: 1, recipients: 2 }); // R2's dream is stale; R3 opted out
  assert.strictEqual(sent[0].token, 't1');
  assert.strictEqual(sent[0].notification.title, '🎯 Твой предмет мечты выставили на трейд!');
  assert.ok(sent[0].notification.body.includes('Lister Name') && sent[0].notification.body.includes('Batwing'));
  assert.deepStrictEqual(sent[0].data, { type: 'trade_match', route: 'TradeMatch', itemKey: 'batwing', fromUid: L });

  // Same lister again within the hour: nothing.
  r = await tm.sendDreamAlerts(L, ['batwing']);
  assert.strictEqual(r.skipped, 'lister_rate');

  // Two hours later, the same item again (For Trade toggled off and on): nothing.
  now += 2 * 60 * 60 * 1000;
  r = await tm.sendDreamAlerts(L, ['batwing']);
  assert.strictEqual(r.skipped, 'pairs');

  // Another lister, same recipient, within 20 hours: no second push. (The
  // first lister dreams of it too, but has no token.)
  const L2 = 'listerBBBBBBBBBBBBBBBBBBBBB';
  r = await tm.sendDreamAlerts(L2, ['batwing']);
  assert.deepStrictEqual(r, { sent: 0, recipients: 3 });
  assert.strictEqual(sent.length, 1);

  // A banned lister alerts nobody (and still spends the pair).
  const L3 = 'listerCCCCCCCCCCCCCCCCCCCCC';
  now += DAY;
  tm.io.isBanned = async (uid) => uid === L3;
  r = await tm.sendDreamAlerts(L3, ['batwing']);
  assert.strictEqual(r.sent, 0);
  assert.ok(db.get(`trade_alerts/${L3}/pairs/batwing`));

  assert.deepStrictEqual(tm.buildMessage('es-ES', '', ''), {
    title: '🎯 ¡Tu ítem soñado está en tradeo!',
    body: 'Alguien tiene 🔪 para tradear. Toca para ver tu match.',
  });
  assert.strictEqual(tm.buildMessage('zz', 'A', 'B').title, '🎯 Your dream item is up for trade!');
});

// ── App-side matching ─────────────────────────────────────────────────────

test('queryKeys: dream first, then by value, capped', () => {
  const rank = (k) => ({ a: 1, b: 5, c: 3 }[k] || 0);
  assert.deepStrictEqual(app.queryKeys(['a', 'b', 'c'], 2, null, rank), ['b', 'c']);
  assert.deepStrictEqual(app.queryKeys(['a', 'b', 'c'], 2, 'a', rank), ['a', 'b']);
  assert.deepStrictEqual(app.queryKeys(['a', 'b'], 5, 'zz'), ['a', 'b']);
});

test('rankMatches: dream, then perfect, then overlap, then freshness; me and blocked skipped', () => {
  const me = 'meAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const skip = new Set([me, 'blocked1']);
  const haveHits = app.collectHits([
    ['batwing', { p1: 10, p2: 50, [me]: 99, blocked1: 99 }],
    ['harvester', { p3: 30, p4: 40, p2: 60 }],
  ], skip);
  const wantHits = app.collectHits([['corrupt', { p3: 5, p9: 1 }]], skip);
  const list = app.rankMatches({ dream: 'batwing', haveHits, wantHits, limit: 10 });
  assert.deepStrictEqual(list.map((m) => m.uid), ['p2', 'p1', 'p3', 'p4']);
  assert.deepStrictEqual(list[0], { uid: 'p2', gives: ['batwing', 'harvester'], wants: [], dream: 1, full: 0, ts: 60 });
  assert.strictEqual(list[2].full, 1);
  assert.deepStrictEqual(list[2].wants, ['corrupt']);
  // p9 wants mine but has nothing I want: not a match on this tab.
  assert.ok(!list.some((m) => m.uid === 'p9'));
});

test('rankWanters: their dream first, then perfect; could-give list', () => {
  const wantHits = app.collectHits([['corrupt', { w1: 10, w2: 20, w3: 30 }], ['icebreaker', { w1: 15 }]]);
  const dreamHits = app.collectHits([['icebreaker', { w1: 15 }]]);
  const haveHits = app.collectHits([['batwing', { w3: 7 }]]);
  const list = app.rankWanters({ wantHits, dreamHits, haveHits, limit: 10 });
  assert.deepStrictEqual(list.map((m) => m.uid), ['w1', 'w3', 'w2']);
  assert.deepStrictEqual(list[0].wants, ['icebreaker', 'corrupt']);
  assert.strictEqual(list[0].dreamKey, 'icebreaker');
  assert.strictEqual(list[1].full, 1);

  const g = app.wanterGives(['x', 'batwing', 'y', 'BAD KEY'], new Set(['batwing']), 2);
  assert.deepStrictEqual(g, { gives: [{ k: 'batwing', w: true }, { k: 'x', w: false }], count: 3 });
});

test('applyActivity: idle players dropped, ties ordered by last activity', () => {
  const now = 100 * DAY;
  const list = [
    { uid: 'a', dream: 0, full: 1, gives: ['k'], wants: ['j'], ts: 9 },
    { uid: 'b', dream: 0, full: 1, gives: ['k'], wants: ['j'], ts: 1 },
    { uid: 'c', dream: 1, full: 0, gives: ['k'], wants: [], ts: 1 },
    { uid: 'idle', dream: 1, full: 1, gives: ['k'], wants: ['j'], ts: 99 },
    { uid: 'unknown', dream: 0, full: 0, gives: ['k'], wants: [], ts: 1 },
  ];
  const meta = new Map([
    ['a', { lastActiveMs: now - 5 * DAY }],
    ['b', { lastActiveMs: now - DAY }],
    ['c', { lastActiveMs: now - 10 * DAY }],
    ['idle', { lastActiveMs: now - 60 * DAY }],
  ]);
  const out = app.applyActivity(list, meta, now, 45 * DAY, 10);
  assert.deepStrictEqual(out.map((m) => m.uid), ['c', 'b', 'a', 'unknown']);
  assert.strictEqual(app.applyActivity(list, meta, now, 45 * DAY, 2).length, 2);
});

// ── The trigger wrappers (firebase-functions-test, offline) ──────────────────

test('tradeMatchIndex trigger: skips bio edits and review docs, indexes list edits', async () => {
  const fft = require('firebase-functions-test')();
  const fn = require('../tradeMatch');
  const wrapped = fft.wrap(fn.tradeMatchIndex);
  const uid = 'trigUidAAAAAAAAAAAAAAAAAAAA';
  const db = fakeRtdb({});
  let reads = 0;
  const docs = {};
  tm.io.db = () => db;
  tm.io.now = () => 5000;
  tm.io.fs = () => { reads += 1; return fakeFirestore(docs); };
  const snap = (data, p) => fft.firestore.makeDocumentSnapshot(data, p || `reviews/${uid}`);

  // Bio edit: no reads at all.
  await wrapped(fft.makeChange(snap({ ownedPets: [item('A')], bio: 'a' }), snap({ ownedPets: [item('A')], bio: 'b' })), { params: { uid } });
  assert.strictEqual(reads, 0);
  // A review document: never indexed.
  await wrapped(fft.makeChange(snap({}, `reviews/x_${uid}`), snap({ ownedPets: [item('A')] }, `reviews/x_${uid}`)), { params: { uid: `x_${uid}` } });
  assert.strictEqual(reads, 0);

  // A list edit: the CURRENT document is what gets indexed.
  docs[uid] = { v: 77, data: { ownedPets: [item('Harvester')], wishlistPets: [], dreamFoundAt: 1, dreamFoundKey: 'batwing' } };
  await wrapped(fft.makeChange(snap({ ownedPets: [] }), snap({ ownedPets: [item('Harvester')], dreamFoundAt: new Date(1), dreamFoundKey: 'batwing' })), { params: { uid } });
  assert.ok(reads >= 1);
  assert.strictEqual(db.get(`trade_index/have/harvester/${uid}`), 5000);
  assert.strictEqual(db.get(`trade_index/user/${uid}/v`), 77);
  assert.strictEqual(db.get(`trade_alerts/${uid}/found/batwing`), 5000);
  fft.cleanup();
});
