/**
 * Lights Out Manor crates (functions/manor/*, firestore.rules) against the
 * emulators — database + firestore + auth, project demo-mm2. From functions/:
 *
 *   export JAVA_HOME=/opt/homebrew/opt/openjdk@24
 *   npm run test:manor
 */
const test = require('node:test');
const assert = require('assert');
const { Buffer } = require('buffer');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!DB_HOST || !FS_HOST) throw new Error('Run under the emulators: npm run test:manor');
if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${PROJECT}-default-rtdb` });

const manor = require('../manor');
const { core, handleRequest } = manor._internal;
const { io } = core;
const L = require('../manor/logic');

const db = admin.database();
const fsdb = admin.firestore();
let NOW = Date.UTC(2026, 10, 2, 12);
io.now = () => NOW;
io.log = () => {};
let rolls = [];
io.random = () => (rolls.length ? rolls.shift() : 0.5);

const doc = async (uid) => (await fsdb.doc(`manor_players/${uid}`).get()).data();
const val = async (p) => (await db.ref(p).once('value')).val();
const expectErr = (p, code) => assert.rejects(p, (e) => { assert.strictEqual(e.code, code); return true; });
async function reset() {
  await db.ref('/').set(null);
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  NOW = Date.UTC(2026, 10, 2, 12); rolls = [];
}
// Round start + finish `secs` later. rolls: rarity draw, then skin pick.
async function play(uid, win, secs = 40, r = []) {
  rolls = Array.from({ length: 16 }, () => Math.random());
  const { roundId } = await core.startRound({ uid, body: { role: 'seeker' } });
  rolls = [...r];
  NOW += secs * 1000;
  return { roundId, res: await core.finishRound({ uid, body: { roundId, win } }) };
}

test('crates: win, duplicate, cosmetics frame, single-use tickets, too fast', async () => {
  await reset();
  // Win → Ember (legendary): new skin, frame lands in My Cosmetics.
  const a = await play('u1', true, 40, [0.97, 0]);
  assert.deepStrictEqual(a.res.crate, { skin: 'ember', rarity: 'legendary', isNew: true });
  assert.strictEqual(a.res.left, 5);
  const d1 = await doc('u1');
  assert.deepStrictEqual(d1.owned, ['classic', 'ember']);
  assert.strictEqual(d1.played, 1); assert.strictEqual(d1.wins, 1); assert.strictEqual(d1.round, null);
  const frames = Object.values(await val('users/u1/shop/ownedItems/profileFrame'));
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].id, 'manor_ember'); assert.strictEqual(frames[0].expiresAt, -1);
  assert.strictEqual(Object.values(await val('users/u1/shop/inventory'))[0].eggSource, 'manor');

  // The same ticket cannot pay again.
  await expectErr(core.finishRound({ uid: 'u1', body: { roundId: a.roundId, win: true } }), 'no_round');

  // Duplicate skin: no second frame.
  const b = await play('u1', true, 40, [0.97, 0]);
  assert.strictEqual(b.res.crate.isNew, false);
  assert.strictEqual(Object.keys(await val('users/u1/shop/ownedItems/profileFrame')).length, 1);

  // A loss counts as played, pays nothing.
  const c = await play('u1', false, 40);
  assert.strictEqual(c.res.crate, null);
  assert.strictEqual((await doc('u1')).played, 3);

  // Too fast: refused and the ticket is gone.
  rolls = Array.from({ length: 16 }, () => Math.random());
  const { roundId } = await core.startRound({ uid: 'u1', body: { role: 'runner' } });
  NOW += 5000;
  await expectErr(core.finishRound({ uid: 'u1', body: { roundId, win: true } }), 'too_fast');
  NOW += 30000;
  await expectErr(core.finishRound({ uid: 'u1', body: { roundId, win: true } }), 'no_round');
  await expectErr(core.startRound({ uid: 'u1', body: { role: 'boss' } }), 'bad_role');
});

test('daily caps: 6 crates, 3 doubles, reset next UTC day', async () => {
  await reset();
  let last;
  for (let i = 0; i < 6; i++) last = await play('u2', true, 25, [0.1, 0]);
  assert.strictEqual(last.res.left, 0);
  const capped = await play('u2', true, 25, [0.1, 0]);
  assert.deepStrictEqual(capped.res, { crate: null, left: 0, capped: true });

  // Doubles: only for the last win, once, within 15 min, 3 a day.
  await expectErr(core.doubleCrate({ uid: 'u2', body: { roundId: capped.roundId } }), 'no_round');
  rolls = [0.995, 0];
  const dbl = await core.doubleCrate({ uid: 'u2', body: { roundId: last.roundId } });
  assert.deepStrictEqual(dbl.crate, { skin: 'void', rarity: 'exclusive', isNew: true });
  await expectErr(core.doubleCrate({ uid: 'u2', body: { roundId: last.roundId } }), 'no_round');
  assert.ok((await doc('u2')).owned.includes('void'));
  assert.ok(Object.values(await val('users/u2/shop/ownedItems/profileFrame')).some((f) => f.id === 'manor_void'));

  // Next day: crates again.
  NOW = Date.UTC(2026, 10, 3, 0, 5);
  const fresh = await play('u2', true, 25, [0.1, 0]);
  assert.ok(fresh.res.crate);
  assert.strictEqual(fresh.res.left, 5);
  for (let i = 0; i < 3; i++) {
    const w = await play('u2', true, 25, [0.1, 0]);
    rolls = [0.1, 0];
    await core.doubleCrate({ uid: 'u2', body: { roundId: w.roundId } });
  }
  const w4 = await play('u2', true, 25, [0.1, 0]);
  await expectErr(core.doubleCrate({ uid: 'u2', body: { roundId: w4.roundId } }), 'capped');
  // An old win can't be doubled later.
  NOW += 16 * 60 * 1000;
  const w5 = await play('u2', true, 25, [0.1, 0]);
  NOW += 16 * 60 * 1000;
  await expectErr(core.doubleCrate({ uid: 'u2', body: { roundId: w5.roundId } }), 'expired');
});

test('endpoints need a signed-in player', async () => {
  await reset();
  const call = async (headers) => {
    let status = 0, json = null;
    const res = { status: (s) => { status = s; return res; }, json: (j) => { json = j; } };
    await handleRequest(core.startRound, { method: 'POST', headers, body: { role: 'seeker' } }, res);
    return { status, json };
  };
  assert.deepStrictEqual(await call({}), { status: 401, json: { error: 'sign_in' } });
  const keep = io.verifyIdToken;
  io.verifyIdToken = async () => ({ uid: 'u3' });
  try {
    const ok = await call({ authorization: 'Bearer t' });
    assert.strictEqual(ok.status, 200);
    assert.match(ok.json.roundId, /^[a-z2-9]{16}$/);
  } finally { io.verifyIdToken = keep; }
});

const clientToken = (uid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } })}.`;
};

test('rules: players read their crate record but never write it', async () => {
  await reset();
  await play('u4', true, 30, [0.1, 0]);
  const url = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/manor_players/u4`;
  const auth = { Authorization: `Bearer ${clientToken('u4')}`, 'Content-Type': 'application/json' };
  const w = await fetch(url, { method: 'PATCH', headers: auth, body: JSON.stringify({ fields: { owned: { arrayValue: { values: [{ stringValue: 'void' }] } } } }) });
  assert.strictEqual(w.status, 403);
  const r = await fetch(url, { headers: auth });
  assert.strictEqual(r.status, 200);
  assert.ok(L.SKIN_IDS.length === 8);
});
