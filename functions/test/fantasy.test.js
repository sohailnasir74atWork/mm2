/**
 * Fantasy League (functions/fantasy/*, firestore.rules) against the Firebase
 * emulators — database + firestore + auth, project demo-mm2, so nothing can
 * reach production. The feed fetch and FCM are stubbed. From functions/:
 *
 *   export JAVA_HOME=/opt/homebrew/opt/openjdk@24
 *   npm run test:fantasy
 *
 * The clock is pinned (core.io.now). One story, top to bottom: a round is
 * created, players join, values move, a player swaps, a new item opens a
 * Guess the Value challenge, the week ends and pays out, the guess settles.
 */
const test = require('node:test');
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!DB_HOST || !FS_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run under the emulators: npm run test:fantasy (see the header).');
}
if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);

const { Buffer } = require('buffer');
const admin = require('firebase-admin');
const NS = `${PROJECT}-default-rtdb`;
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${NS}` });

const fantasy = require('../fantasy');
const { core, handleRequest } = fantasy._internal;
const { io } = core;
const L = require('../fantasy/logic');

const db = admin.database();
const fsdb = admin.firestore();

const HOUR = 3600000;

// ── clock, feed, FCM ────────────────────────────────────────────────────────
let NOW = Date.UTC(2026, 10, 3, 12); // Tue 2026-11-03 12:00 UTC → 2026-W45
io.now = () => NOW;
io.log = () => {};

let values = {};
let generatedAt = 'g1';
const baseValues = () => {
  const v = {};
  for (let i = 0; i < 120; i++) v[`Item${i}`] = 100;
  return v;
};
io.fetchFeed = async () => L.parseFeed({
  meta: { generatedAt },
  data: { Godly: { 'TIER 1': Object.entries(values).map(([name, value]) => ({ name, value, valueType: 'exact', image: `img/${name}.png`, demand: '5' })) } },
});

let pushes = [];
io.messaging = () => ({
  sendEach: async (msgs) => {
    pushes.push(...msgs);
    return { responses: msgs.map(() => ({ success: true })) };
  },
});

const val = async (p) => (await db.ref(p).once('value')).val();
const doc = async (p) => (await fsdb.doc(p).get()).data();

async function resetAll() {
  await db.ref('/').set(null);
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  pushes = [];
  values = baseValues();
  generatedAt = 'g1';
  NOW = Date.UTC(2026, 10, 3, 12);
}

async function seedPlayers() {
  const users = {};
  for (const u of ['u1', 'u2', 'u3']) users[u] = { displayName: `Player ${u}`, fcmToken: `tok-${u}` };
  users.u3.notificationSettings = { fantasyAlerts: false };
  await db.ref('users').set(users);
  // Items 1..10 moved recently → they head the hot list (item10 newest).
  const changes = {};
  for (let i = 1; i <= 10; i++) {
    changes[`c${i}`] = { item_slug: `item${i}`, old_value: 90, new_value: 100, changed_at: NOW - (11 - i) * HOUR };
  }
  await db.ref('value_alerts/changes').set(changes);
}

const expectErr = async (p, code) => {
  await assert.rejects(p, (e) => {
    assert.strictEqual(e.code, code);
    return true;
  });
};

const picksOf = (keys, dir) => keys.map((k) => ({ k, dir }));

test('Fantasy League: one week, start to finish', async () => {
  await resetAll();
  await seedPlayers();

  // ── The first tick seeds known items and creates the round ──
  const t1 = await core.runTick();
  assert.strictEqual(t1.seeded, 120);
  assert.ok(t1.created);
  const r = await doc('fantasy_rounds/2026-W45');
  assert.strictEqual(r.status, 'live');
  assert.strictEqual(r.startsAt, Date.UTC(2026, 10, 2));
  assert.strictEqual(r.season.id, 'halloween-2026');
  assert.strictEqual(r.pool[0].k, 'item10');
  assert.strictEqual(r.pool.length, 40);
  assert.ok(await doc('fantasy_seasons/halloween-2026'));
  assert.deepStrictEqual(t1.newItems, undefined);

  // ── Joining ──
  const five = ['item1', 'item2', 'item3', 'item4', 'item5'];
  const j1 = await core.joinRound({ uid: 'u1', body: { round: '2026-W45', picks: picksOf(five, 'up'), captain: 'item1' } });
  assert.strictEqual(j1.entry.picks.length, 5);
  assert.strictEqual(j1.entry.picks[0].base, 100);
  assert.strictEqual(j1.entry.name, 'Player u1');
  await core.joinRound({ uid: 'u2', body: { round: '2026-W45', picks: picksOf(five, 'down'), captain: 'item2' } });
  await core.joinRound({ uid: 'u3', body: { round: '2026-W45', picks: picksOf(five, 'up'), captain: 'item1' } });
  await expectErr(core.joinRound({ uid: 'u1', body: { round: '2026-W45', picks: picksOf(five, 'up'), captain: 'item1' } }), 'already_joined');
  await expectErr(core.joinRound({ uid: 'u9', body: { round: '2026-W45', picks: picksOf(['item1', 'item2', 'item3', 'item4', 'item99'], 'up'), captain: 'item1' } }), 'bad_picks');
  await expectErr(core.joinRound({ uid: 'u9', body: { round: '2026-W40', picks: picksOf(five, 'up'), captain: 'item1' } }), 'no_round');

  // A value already in the feed when you join is your base: no free points.
  values.Item6 = 200;
  const late = await core.joinRound({ uid: 'u4', body: { round: '2026-W45', picks: picksOf(['item6', 'item7', 'item8', 'item9', 'item10'], 'up'), captain: 'item6' } });
  assert.strictEqual(late.entry.picks[0].base, 200);

  // ── Values move, a new item appears ──
  values.Item1 = 120; // +20%: up callers win
  values.Item2 = 80; // −20%: down callers win
  values.Emberbow = 1300;
  generatedAt = 'g2';
  NOW += HOUR;
  const t2 = await core.runTick();
  assert.strictEqual(t2.rescore.entries, 4);
  assert.strictEqual(t2.newItems, 1);
  assert.strictEqual(t2.guessesOpened, 1);

  const e1 = await doc('fantasy_rounds/2026-W45/entries/u1');
  // item1 up, captain: (10 + 20) × 2 = 60; item2 up but fell: 2.
  assert.strictEqual(e1.points, 62);
  const e2 = await doc('fantasy_rounds/2026-W45/entries/u2');
  // item1 down but rose: 2; item2 down, captain: (10 + 20) × 2 = 60.
  assert.strictEqual(e2.points, 62);
  assert.strictEqual(e1.rank, 1); // tie → earlier joiner
  assert.strictEqual(e2.rank, 2);
  const round = await doc('fantasy_rounds/2026-W45');
  assert.strictEqual(round.top[0].uid, 'u1');
  assert.strictEqual(round.players, 4);
  assert.strictEqual(round.pool.find((p) => p.k === 'item1').v, 120);
  // u1 and u2 gained and get one push each; u3 gained but opted out; u4 did not gain.
  const moveTokens = pushes.filter((m) => m.data.type === 'fantasy_move').map((m) => m.token).sort();
  assert.deepStrictEqual(moveTokens, ['tok-u1', 'tok-u2']);
  assert.match(pushes.find((m) => m.token === 'tok-u1').notification.title, /Item1 moved \+20%/);

  // Same feed an hour later: no re-score, no pushes.
  pushes = [];
  NOW += HOUR;
  const t3 = await core.runTick();
  assert.strictEqual(t3.rescore, undefined);
  assert.strictEqual(pushes.length, 0);

  // ── Swaps: one free, one more with `extra` ──
  const s1 = await core.swapPick({ uid: 'u1', body: { round: '2026-W45', out: 'item2', in: 'item11', dir: 'down' } });
  assert.strictEqual(s1.entry.banked, 2);
  assert.strictEqual(s1.entry.swaps, 1);
  assert.strictEqual(s1.entry.points, 62);
  assert.strictEqual(s1.entry.picks.find((p) => p.k === 'item11').base, 100);
  await expectErr(core.swapPick({ uid: 'u1', body: { round: '2026-W45', out: 'item3', in: 'item12', dir: 'up' } }), 'no_swaps');
  await core.swapPick({ uid: 'u1', body: { round: '2026-W45', out: 'item3', in: 'item12', dir: 'up', extra: true } });
  await expectErr(core.swapPick({ uid: 'u1', body: { round: '2026-W45', out: 'item4', in: 'item13', dir: 'up', extra: true } }), 'no_swaps');
  await expectErr(core.swapPick({ uid: 'u1', body: { round: '2026-W45', out: 'item1', in: 'item12', dir: 'up', extra: true } }), 'no_swaps');
  await expectErr(core.swapPick({ uid: 'u9', body: { round: '2026-W45', out: 'item1', in: 'item12', dir: 'up' } }), 'not_joined');

  // ── Guess the Value ──
  const gid = L.guessId('emberbow', Date.UTC(2026, 10, 3, 13));
  assert.strictEqual((await doc(`fantasy_guess/${gid}`)).valueAtOpen, 1300);
  await core.submitGuess({ uid: 'u1', body: { id: gid, guess: 900 } });
  await core.submitGuess({ uid: 'u2', body: { id: gid, guess: 1300 } });
  await expectErr(core.submitGuess({ uid: 'u1', body: { id: gid, guess: 800 } }), 'already_guessed');
  await expectErr(core.submitGuess({ uid: 'u3', body: { id: gid, guess: 'lots' } }), 'bad_guess');

  // ── Hype: three other players post item11 this week ──
  for (const u of ['h1', 'h2', 'h3']) {
    await fsdb.collection('trades_new').add({
      userId: u,
      hasItems: [{ name: 'Item11' }],
      wantsItems: [],
      timestamp: admin.firestore.Timestamp.fromMillis(NOW - HOUR),
    });
  }

  // ── The week ends ──
  pushes = [];
  NOW = Date.UTC(2026, 10, 9, 1); // Mon 01:00 → W46
  const t4 = await core.runTick();
  assert.ok(t4['final_2026-W45']);
  assert.ok(t4.created);
  const fin = await doc('fantasy_rounds/2026-W45');
  assert.strictEqual(fin.status, 'final');
  const f1 = await doc('fantasy_rounds/2026-W45/entries/u1');
  // 62 (item1 60 + banked 2) + item11 hype 3 (3 posters, 0 last week).
  assert.strictEqual(f1.points, 65);
  assert.strictEqual(f1.settled, true);
  assert.strictEqual(f1.rank, 1);
  assert.strictEqual(f1.stars, 25);
  assert.strictEqual((await val('users/u1/dailyStars')).starBalance, 25);
  assert.strictEqual((await val('users/u2/dailyStars')).starBalance, 15);
  const sp = await doc('fantasy_seasons/halloween-2026/players/u1');
  assert.strictEqual(sp.points, 65);
  assert.strictEqual(sp.rounds, 1);
  const season = await doc('fantasy_seasons/halloween-2026');
  assert.strictEqual(season.top[0].uid, 'u1');
  assert.strictEqual(season.players, 4);
  const results = pushes.filter((m) => m.data.type === 'fantasy_results');
  assert.deepStrictEqual(results.map((m) => m.token).sort(), ['tok-u1', 'tok-u2']); // u3 opted out, u4 has no token
  assert.match(results.find((m) => m.token === 'tok-u1').notification.title, /#1 of 4/);
  assert.ok(await doc('fantasy_rounds/2026-W46'));

  // Re-running the end of the round pays nothing twice.
  pushes = [];
  await fsdb.doc('fantasy_rounds/2026-W45').update({ status: 'live' });
  NOW += HOUR;
  await core.runTick();
  assert.strictEqual((await val('users/u1/dailyStars')).starBalance, 25);
  assert.strictEqual((await doc('fantasy_seasons/halloween-2026/players/u1')).points, 65);
  assert.strictEqual(pushes.filter((m) => m.data.type === 'fantasy_results').length, 0);

  // Joining an ended round is refused.
  await expectErr(core.joinRound({ uid: 'u5', body: { round: '2026-W45', picks: picksOf(five, 'up'), captain: 'item1' } }), 'closed');

  // ── The guess settles on day 7 ──
  values.Emberbow = 750;
  generatedAt = 'g3';
  pushes = [];
  NOW = Date.UTC(2026, 10, 10, 14); // past resolveAt (opened Nov 3 13:00 + 7 d)
  const t5 = await core.runTick();
  assert.strictEqual(t5[`guess_${gid}`].final, 750);
  const g = await doc(`fantasy_guess/${gid}`);
  assert.strictEqual(g.status, 'final');
  assert.strictEqual(g.top[0].uid, 'u1'); // 900 vs 750 = 20% off → 15 pts
  assert.strictEqual(g.top[0].pts, 15);
  assert.strictEqual(g.top[1].pts, 0); // 1300 = 73% off
  assert.strictEqual((await doc('fantasy_seasons/halloween-2026/players/u1')).points, 80);
  assert.strictEqual(pushes.filter((m) => m.data.type === 'fantasy_guess').length, 2);
  await expectErr(core.submitGuess({ uid: 'u3', body: { id: gid, guess: 700 } }), 'closed');
});

test('a feed failure skips the tick without writing', async () => {
  await resetAll();
  const keep = io.fetchFeed;
  io.fetchFeed = async () => { throw new Error('reset'); };
  try {
    assert.deepStrictEqual(await core.runTick(), { skipped: 'feed' });
    assert.strictEqual((await fsdb.collection('fantasy_rounds').get()).size, 0);
    await core.runTick().catch(() => {});
  } finally {
    io.fetchFeed = keep;
  }
});

test('endpoints: sign-in required, errors mapped', async () => {
  await resetAll();
  await seedPlayers();
  await core.runTick();
  const call = async (headers, body) => {
    let status = 0;
    let json = null;
    const res = { status: (s) => { status = s; return res; }, json: (j) => { json = j; } };
    await handleRequest(core.joinRound, { method: 'POST', headers, body }, res);
    return { status, json };
  };
  const keep = io.verifyIdToken;
  io.verifyIdToken = async (t) => {
    if (t !== 'good') throw new Error('bad');
    return { uid: 'u1' };
  };
  try {
    assert.deepStrictEqual(await call({}, {}), { status: 401, json: { error: 'sign_in' } });
    assert.deepStrictEqual(await call({ authorization: 'Bearer nope' }, {}), { status: 401, json: { error: 'sign_in' } });
    assert.deepStrictEqual(await call({ authorization: 'Bearer good' }, { round: '2026-W45', picks: [] }), { status: 400, json: { error: 'bad_picks' } });
    const ok = await call({ authorization: 'Bearer good' }, { round: '2026-W45', picks: picksOf(['item1', 'item2', 'item3', 'item4', 'item5'], 'up'), captain: 'item3' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.entry.uid, 'u1');
  } finally {
    io.verifyIdToken = keep;
  }
});

// The emulator accepts unsigned tokens, so this is a real client request
// checked by firestore.rules (firebase.test.json loads them).
const clientToken = (uid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' },
  })}.`;
};

test('rules: players can read the league but never write it', async () => {
  await resetAll();
  await seedPlayers();
  await core.runTick();
  const base = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${clientToken('u1')}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ fields: { points: { integerValue: '9999' } } });
  for (const path of [
    'fantasy_rounds/2026-W45',
    'fantasy_rounds/2026-W45/entries/u1',
    'fantasy_seasons/halloween-2026/players/u1',
    'fantasy_guess/x-2026-11-03/entries/u1',
    'fantasy_state/main',
  ]) {
    const res = await fetch(`${base}/${path}`, { method: 'PATCH', headers: auth, body });
    assert.strictEqual(res.status, 403, `${path} must refuse client writes`);
  }
  const read = await fetch(`${base}/fantasy_rounds/2026-W45`, { headers: auth });
  assert.strictEqual(read.status, 200);
  // Sanity: the token itself works for a collection players may write.
  const own = await fetch(`${base}/trade_journal/u1/trades/t1`, { method: 'PATCH', headers: auth, body });
  assert.strictEqual(own.status, 200);
});
