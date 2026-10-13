/**
 * Report auto-bans (functions/reportAutoBan.js) and the report ledger
 * (functions/reportLedgerCore.js + its app copy Code/Helper/reportLedger.js),
 * against an in-memory RTDB/Firestore. No emulator, no network. From
 * functions/:
 *
 *   node --test test/reportAutoBan.test.js
 */
const test = require('node:test');
const assert = require('assert');

const core = require('../reportLedgerCore');
const appCore = require('../../Code/Helper/reportLedger');
const { _internal: rab } = require('../reportAutoBan');

// ── A tiny in-memory RTDB + Firestore, enough for the code under test ──────

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function fakeRtdb(initial) {
  const root = { v: clone(initial) || {} };
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root.v);
  const setAt = (p, val) => {
    const ks = parts(p);
    if (!ks.length) { root.v = clone(val) || {}; return; }
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
    for (let i = ks.length - 2; i >= 0; i--) {
      const parent = chain[i];
      const k = ks[i];
      if (parent[k] && typeof parent[k] === 'object' && !Object.keys(parent[k]).length) delete parent[k];
    }
  };
  const ref = (p) => ({
    once: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : clone(v); } }),
    set: async (v) => setAt(p, v),
    remove: async () => setAt(p, null),
    update: async (obj) => { for (const [k, v] of Object.entries(obj)) setAt(p ? `${p}/${k}` : k, v); },
  });
  return { ref, get: getAt };
}

function fakeFirestore(docs) {
  const deleted = [];
  return {
    deleted,
    collection: () => ({
      where: (field, op, value) => ({
        orderBy: () => ({
          limit: (n) => ({
            get: async () => {
              const rows = Object.entries(docs).filter(([, d]) => d[field] === value).slice(0, n)
                .map(([id]) => ({ ref: { id } }));
              return { empty: rows.length === 0, size: rows.length, docs: rows };
            },
          }),
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        delete: (r) => ops.push(r.id),
        commit: async () => { for (const id of ops) { delete docs[id]; deleted.push(id); } },
      };
    },
  };
}

const realDeps = { ...rab.deps };
function install(rtdbData, posts) {
  const rtdb = fakeRtdb(rtdbData);
  const fs = fakeFirestore(posts || {});
  const modLog = [];
  Object.assign(rab.deps, {
    db: () => rtdb,
    firestore: () => fs,
    banEmailFor: async (uid) => (uid ? `${uid}@mail.test` : null),
    logModAction: async (row) => { modLog.push(row); },
  });
  return { rtdb, fs, modLog };
}
test.after(() => Object.assign(rab.deps, realDeps));

const quiet = (fn) => async (t) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try { await fn(t); } finally { console.log = log; console.error = error; }
};

const ROOM = 'chat_new';
const msg = (extra) => ({ senderId: 'bad', sender: 'Bad Guy', text: 'hi', reportCount: 2, ...(extra || {}) });
const banKey = 'banned_users_by_email/bad@mail(dot)test';

// ── The ledger maths: app copy and server copy agree ────────────────────

test('ledger core: app and server copies are the same code', () => {
  const strip = (src) => src.replace(/\/\*\*[\s\S]*?\*\/\n/, '');
  const fsx = require('fs');
  const path = require('path');
  const a = strip(fsx.readFileSync(path.join(__dirname, '..', 'reportLedgerCore.js'), 'utf8'));
  const b = strip(fsx.readFileSync(path.join(__dirname, '..', '..', 'Code', 'Helper', 'reportLedger.js'), 'utf8'));
  assert.strictEqual(a, b, 'functions/reportLedgerCore.js and Code/Helper/reportLedger.js differ below the header');
});

test('distinctReporters: map or array, author excluded, null = no ledger', () => {
  for (const c of [core, appCore]) {
    assert.strictEqual(c.distinctReporters(null, 'x'), null);
    assert.strictEqual(c.distinctReporters(undefined, 'x'), null);
    assert.strictEqual(c.distinctReporters('junk', 'x'), null);
    assert.strictEqual(c.distinctReporters({}, 'x'), null);
    assert.strictEqual(c.distinctReporters({ a: true }, 'x'), 1);
    assert.strictEqual(c.distinctReporters({ a: true, b: true }, 'x'), 2);
    assert.strictEqual(c.distinctReporters({ a: true, b: 'yes' }, 'x'), 1, 'only true markers count');
    assert.strictEqual(c.distinctReporters({ x: true }, 'x'), null, "the author's own marker is not a ledger");
    assert.strictEqual(c.distinctReporters({ x: true, a: true }, 'x'), 1);
    assert.strictEqual(c.distinctReporters(['a', 'a'], 'x'), 1, 'duplicates count once');
    assert.strictEqual(c.distinctReporters(['a', 'b', 'x', '', null, 3], 'x'), 2);
    assert.strictEqual(c.distinctReporters([], 'x'), null);
  }
});

test('postReportCrossesBan: old builds unchanged, ledger needs 2 distinct, fires once', () => {
  for (const c of [core, appCore]) {
    const P = (o) => ({ userId: 'author', reportCount: 0, ...o });
    // Old build: no ledger, banned flips at 2 → fires, exactly as before.
    assert.strictEqual(c.postReportCrossesBan(P({ reportCount: 1 }), P({ reportCount: 2, banned: true })), true);
    // A bare banned flag without 2 reports is not a report.
    assert.strictEqual(c.postReportCrossesBan(P({}), P({ reportCount: 1, banned: true })), false);
    // Already banned (old path) → never again, even when a ledger appears.
    assert.strictEqual(c.postReportCrossesBan(P({ reportCount: 2, banned: true }), P({ reportCount: 3, banned: true })), false);
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 2, banned: true }),
      P({ reportCount: 4, banned: true, reportedBy: ['a', 'b'] }),
    ), false);
    // Ledger: same account twice (crafted client) → no.
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 1, reportedBy: ['a'] }),
      P({ reportCount: 2, banned: true, reportedBy: ['a'] }),
    ), false);
    // Ledger: two accounts → yes.
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 1, reportedBy: ['a'] }),
      P({ reportCount: 2, banned: true, reportedBy: ['a', 'b'] }),
    ), true);
    // Banned already set with 1 in the ledger (an old build was the 2nd
    // reporter); the next distinct reporter fires it.
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 2, banned: true, reportedBy: ['a'] }),
      P({ reportCount: 3, banned: true, reportedBy: ['a', 'c'] }),
    ), true);
    // …and a third does not fire again.
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 3, banned: true, reportedBy: ['a', 'c'] }),
      P({ reportCount: 4, banned: true, reportedBy: ['a', 'c', 'd'] }),
    ), false);
    // The author's own marker is ignored.
    assert.strictEqual(c.postReportCrossesBan(
      P({ reportCount: 1, reportedBy: ['a'] }),
      P({ reportCount: 2, banned: true, reportedBy: ['a', 'author'] }),
    ), false);
  }
});

// ── autoBanOnMessageReports ─────────────────────────────────────────────

test('chat: no ledger (old builds) → reportCount alone still bans', quiet(async () => {
  const { rtdb, modLog } = install({ [ROOM]: { m1: msg() } });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'banned');
  assert.strictEqual(rtdb.get(`${ROOM}/m1`), undefined, 'message removed');
  const ban = rtdb.get(banKey);
  assert.strictEqual(ban.strikeCount, 1);
  assert.strictEqual(ban.userId, 'bad');
  assert.strictEqual(ban.bannedBy, 'system');
  assert.strictEqual(modLog.length, 1);
}));

test('chat: ledger with ONE reporter (same account twice) → no ban, message kept', quiet(async () => {
  const { rtdb, modLog } = install({
    [ROOM]: { m1: msg() },
    chat_reports: { [ROOM]: { m1: { alice: true } } },
  });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'single-reporter');
  assert.ok(rtdb.get(`${ROOM}/m1`), 'message kept');
  assert.strictEqual(rtdb.get(banKey), undefined);
  assert.strictEqual(modLog.length, 0);
}));

test('chat: ledger with two distinct reporters → ban, message and ledger removed', quiet(async () => {
  const { rtdb } = install({
    [ROOM]: { m1: msg({ reportCount: 3 }) },
    chat_reports: { [ROOM]: { m1: { alice: true, bob: true } } },
  });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 2, 3), 'banned');
  assert.strictEqual(rtdb.get(`${ROOM}/m1`), undefined);
  assert.strictEqual(rtdb.get(`chat_reports/${ROOM}/m1`), undefined);
  assert.ok(rtdb.get(banKey));
}));

test("chat: the sender's own marker does not count and does not make a ledger", quiet(async () => {
  const { rtdb } = install({
    [ROOM]: { m1: msg() },
    chat_reports: { [ROOM]: { m1: { bad: true, alice: true } } },
  });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'single-reporter');
  assert.ok(rtdb.get(`${ROOM}/m1`));

  const second = install({ [ROOM]: { m1: msg() }, chat_reports: { [ROOM]: { m1: { bad: true } } } });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'banned', 'self-marker only = no ledger');
  assert.ok(second.rtdb.get(banKey));
}));

test('chat: ledgers are per room', quiet(async () => {
  const { rtdb } = install({
    chat_es: { m1: msg() },
    chat_reports: { chat_es: { m1: { alice: true } }, [ROOM]: { m1: { bob: true, carol: true } } },
  });
  assert.strictEqual(await rab.handleMessageReport('chat_es', 'm1', 1, 2), 'single-reporter');
  assert.ok(rtdb.get('chat_es/m1'));
}));

test('chat: below threshold, non-increase, staff, missing message', quiet(async () => {
  install({ [ROOM]: { m1: msg() } });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 0, 1), 'below-threshold');
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 2, 2), 'below-threshold');
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 3, 2), 'below-threshold');
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'gone', 1, 2), 'missing');

  const { rtdb } = install({ [ROOM]: { m1: msg() }, users: { bad: { isModerator: true } } });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'staff');
  assert.ok(rtdb.get(`${ROOM}/m1`), 'staff message kept');
}));

test('chat: existing ban keeps its strikeCount (non-admin path)', quiet(async () => {
  const { rtdb } = install({
    [ROOM]: { m1: msg() },
    banned_users_by_email: { 'bad@mail(dot)test': { strikeCount: 2, bannedUntil: 1 } },
  });
  assert.strictEqual(await rab.handleMessageReport(ROOM, 'm1', 1, 2), 'banned');
  const ban = rtdb.get(banKey);
  assert.strictEqual(ban.strikeCount, 2);
  assert.ok(ban.bannedUntil > Date.now() + 71 * 3600 * 1000, '2nd strike = 3 days');
}));

// ── autoBanOnPostReports ────────────────────────────────────────────────

const post = (o) => ({ userId: 'bad', reportCount: 0, ...o });

test('post: no ledger (old builds) → unchanged behaviour', quiet(async () => {
  const docs = { p1: post({}), p2: post({}), other: post({ userId: 'someone' }) };
  const { rtdb, fs } = install({}, docs);
  const r = await rab.handlePostReport('p1', post({ reportCount: 1 }), post({ reportCount: 2, banned: true }));
  assert.strictEqual(r, 'banned');
  assert.deepStrictEqual(rtdb.get('banned_users_by_email_post/bad@mail(dot)test').strikeCount, 1);
  assert.deepStrictEqual(fs.deleted.sort(), ['p1', 'p2']);
  assert.ok(docs.other, "another author's post survives");
}));

test('post: ledger with one reporter → no ban; second distinct reporter → ban', quiet(async () => {
  const { rtdb } = install({}, { p1: post({}) });
  assert.strictEqual(await rab.handlePostReport('p1',
    post({ reportCount: 1, reportedBy: ['alice'] }),
    post({ reportCount: 2, banned: true, reportedBy: ['alice'] })), 'not-crossing');
  assert.strictEqual(rtdb.get('banned_users_by_email_post/bad@mail(dot)test'), undefined);

  assert.strictEqual(await rab.handlePostReport('p1',
    post({ reportCount: 2, banned: true, reportedBy: ['alice'] }),
    post({ reportCount: 3, banned: true, reportedBy: ['alice', 'bob'] })), 'banned');
  assert.ok(rtdb.get('banned_users_by_email_post/bad@mail(dot)test'));
}));

test('post: guards kept — email posts, anonymous, already banned, staff', quiet(async () => {
  install({ users: { boss: { admin: true } } }, {});
  const to2 = (o) => [post({ reportCount: 1, ...o }), post({ reportCount: 2, banned: true, ...o })];
  assert.strictEqual(await rab.handlePostReport('p', ...to2({ email: 'x@y.z' })), 'client-handles');
  assert.strictEqual(await rab.handlePostReport('p', ...to2({ userId: 'Anonymous' })), 'no-author');
  assert.strictEqual(await rab.handlePostReport('p', ...to2({ userId: 'boss' })), 'staff');
  assert.strictEqual(await rab.handlePostReport('p', post({ reportCount: 2, banned: true }), post({ reportCount: 3, banned: true })), 'not-crossing');
  assert.strictEqual(await rab.handlePostReport('p', null, post({})), 'missing');
}));
