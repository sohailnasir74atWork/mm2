/**
 * Birthdays (functions/birthdays/*, database.rules.json, the backfill) against
 * the Firebase emulators — database + firestore + auth, project demo-mm2, so
 * nothing can reach production. FCM is stubbed. From functions/:
 *
 *   export JAVA_HOME=/opt/homebrew/opt/openjdk@24
 *   npm run test:birthdays
 *
 * (= firebase emulators:exec --config test/firebase.json --project demo-mm2
 *    --only database,firestore,auth "node --test test/birthdays.test.js")
 *
 * The clock is pinned (core.io.now) so dates are deterministic.
 */
const test = require('node:test');
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!DB_HOST || !FS_HOST || !AUTH_HOST) {
  throw new Error('Run under the emulators: npm run test:birthdays (see the header).');
}
if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);

const admin = require('firebase-admin');
const NS = `${PROJECT}-default-rtdb`;
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${NS}` });

const birthdays = require('../birthdays');
const { core, handleRequest } = birthdays._internal;
const { io } = core;
const D = require('../birthdays/dates');
const { backfill } = require('../../scripts/birthdays/backfillIndex');

const db = admin.database();
const fsdb = admin.firestore();
const DAY = 86400000;

// ── clock + FCM stub ────────────────────────────────────────────────────────
let NOW = Date.UTC(2026, 9, 13, 12, 0, 0); // 2026-10-13 12:00 UTC
io.now = () => NOW;
io.log = () => {};
let pushes = [];
let sendEachCalls = 0;
io.messaging = () => ({
  sendEach: async (msgs) => {
    sendEachCalls += 1;
    assert.ok(msgs.length <= 500, 'sendEach chunk over 500');
    pushes.push(...msgs);
    return {
      responses: msgs.map((m) => (m.token === 'dead-token'
        ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
        : { success: true })),
    };
  },
});

const iso = (ms) => new Date(ms).toISOString();
const val = async (p) => (await db.ref(p).once('value')).val();

async function resetAll() {
  await db.ref('/').set(null);
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  pushes = [];
  sendEachCalls = 0;
  NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
}

/** A player. dob → users_private; emailDob → email_prefs; activeDaysAgo → users/lastActivity. */
async function player(uid, {
  dob, emailDob, show, activeDaysAgo = 1, legacyActivity = false, createdDaysAgo = 400,
  name = uid, avatar = `https://cdn.example/${uid}.png`, token = `tok-${uid}`, reindex = true,
} = {}) {
  const u = { displayName: name, avatar, fcmToken: token };
  if (activeDaysAgo != null) u[legacyActivity ? 'lastactivity' : 'lastActivity'] = iso(NOW - activeDaysAgo * DAY);
  if (createdDaysAgo != null) u.createdAt = NOW - createdDaysAgo * DAY;
  const updates = { [`users/${uid}`]: u };
  if (dob) updates[`users_private/${uid}/dateOfBirth`] = dob;
  if (emailDob) updates[`email_prefs/${uid}`] = { optIn: true, updatedAt: NOW, source: 'settings', dob: emailDob };
  if (show !== undefined) updates[`birthday_prefs/${uid}`] = { show };
  await db.ref('/').update(updates);
  if (reindex) return core.reindexBirthday(uid);
  return null;
}

async function expectError(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.strictEqual(e.code, code);
    return true;
  });
}

test.beforeEach(resetAll);
test.after(async () => {
  await Promise.all(admin.apps.map((a) => a.delete()));
});

// ═══ dates ══════════════════════════════════════════════════════════════════

test('dates: keys, 29 Feb, near window, local clamp, age', () => {
  assert.deepStrictEqual(D.keysForDate({ y: 2027, m: 2, d: 28 }), ['0228', '0229']);
  assert.deepStrictEqual(D.keysForDate({ y: 2028, m: 2, d: 28 }), ['0228']);
  assert.deepStrictEqual(D.keysForDate({ y: 2028, m: 2, d: 29 }), ['0229']);
  // New Year: a 1 Jan birthday seen from UTC 31 Dec belongs to next year.
  assert.deepStrictEqual(D.nearDate(1, 1, { y: 2026, m: 12, d: 31 }), { y: 2027, m: 1, d: 1 });
  assert.deepStrictEqual(D.nearDate(12, 31, { y: 2027, m: 1, d: 1 }), { y: 2026, m: 12, d: 31 });
  assert.strictEqual(D.nearDate(10, 16, { y: 2026, m: 10, d: 13 }), null);
  assert.deepStrictEqual(D.nearDate(2, 29, { y: 2027, m: 2, d: 28 }), { y: 2027, m: 2, d: 28 });
  const now = Date.UTC(2026, 9, 13, 12);
  assert.deepStrictEqual(D.clampLocalDate('2026-10-14', now), { y: 2026, m: 10, d: 14 });
  assert.deepStrictEqual(D.clampLocalDate('2026-10-12', now), { y: 2026, m: 10, d: 12 });
  assert.deepStrictEqual(D.clampLocalDate('2026-10-16', now), { y: 2026, m: 10, d: 13 });
  assert.deepStrictEqual(D.clampLocalDate('garbage', now), { y: 2026, m: 10, d: 13 });
  assert.strictEqual(D.ageOn(D.parseDate('2013-10-13'), { y: 2026, m: 10, d: 13 }), 13);
  assert.strictEqual(D.ageOn(D.parseDate('2013-10-14'), { y: 2026, m: 10, d: 13 }), 12);
  assert.strictEqual(D.parseDate('2023-02-30'), null);
});

// ═══ reindex ════════════════════════════════════════════════════════════════

test('reindex: a shown 13+ player is added under MMDD and counted once (idempotent)', async () => {
  const r = await player('ann', { dob: '2000-10-13' });
  assert.deepStrictEqual(r, { key: '1013', pending: null });
  assert.strictEqual(await val('birthday_index/1013/ann'), true);
  assert.strictEqual(await val('birthday_counts/1013'), 1);
  assert.strictEqual(await val('birthday_server/index_key/ann'), '1013');
  await core.reindexBirthday('ann');
  await core.reindexBirthday('ann');
  assert.strictEqual(await val('birthday_counts/1013'), 1);
});

test('reindex: a changed DOB moves the entry and both counts', async () => {
  await player('ann', { dob: '2000-10-13' });
  await player('bob', { dob: '1999-10-13' });
  assert.strictEqual(await val('birthday_counts/1013'), 2);
  // The server path (admin) can overwrite; the client could only set it once.
  await db.ref('users_private/ann/dateOfBirth').set('2000-03-05');
  await core.reindexBirthday('ann');
  assert.strictEqual(await val('birthday_index/1013/ann'), null);
  assert.strictEqual(await val('birthday_index/0305/ann'), true);
  assert.strictEqual(await val('birthday_counts/1013'), 1);
  assert.strictEqual(await val('birthday_counts/0305'), 1);
});

test('reindex: hide removes, show (or absent) restores', async () => {
  await player('ann', { dob: '2000-10-13' });
  await db.ref('birthday_prefs/ann').set({ show: false });
  assert.deepStrictEqual(await core.reindexBirthday('ann'), { key: null, pending: null });
  assert.strictEqual(await val('birthday_index/1013/ann'), null);
  assert.strictEqual(await val('birthday_counts/1013'), 0);
  await db.ref('birthday_prefs/ann').set({ show: true });
  await core.reindexBirthday('ann');
  assert.strictEqual(await val('birthday_counts/1013'), 1);
});

test('reindex: under 13 is never indexed; refreshBirthdayAges adds them the day they turn 13', async () => {
  // Turns 13 on 2026-10-14.
  const r = await player('kid', { dob: '2013-10-14' });
  assert.deepStrictEqual(r, { key: null, pending: '1014' });
  assert.strictEqual(await val('birthday_index/1014/kid'), null);
  assert.strictEqual(await val('birthday_server/pending13/1014/kid'), true);
  // A younger kid with the same day stays pending.
  await player('tiny', { dob: '2016-10-14' });

  NOW = Date.UTC(2026, 9, 14, 3, 30);
  const out = await core.runRefreshBirthdayAges();
  assert.deepStrictEqual(out, { checked: 2, indexed: 1 });
  assert.strictEqual(await val('birthday_index/1014/kid'), true);
  assert.strictEqual(await val('birthday_counts/1014'), 1);
  assert.strictEqual(await val('birthday_server/pending13/1014/kid'), null);
  assert.strictEqual(await val('birthday_server/pending13/1014/tiny'), true);
});

test('reindex: 29 Feb is keyed 0229 and celebrated on 28 Feb in non-leap years', async () => {
  NOW = Date.UTC(2027, 1, 28, 12); // 2027 is not a leap year
  await player('me', {});
  const r = await player('leap', { dob: '2000-02-29' });
  assert.strictEqual(r.key, '0229');
  let top = await core.birthdayTop({ uid: 'me', body: { localDate: '2027-02-28' } });
  assert.deepStrictEqual(top.rows.map((x) => [x.uid, x.month, x.day]), [['leap', 2, 29]]);
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'leap', template: 'hbd' } });
  assert.ok(await val('birthday_wishes/2027/leap/me'));

  NOW = Date.UTC(2028, 1, 28, 12); // leap year: not on the 28th...
  top = await core.birthdayTop({ uid: 'me', body: { localDate: '2028-02-28' } });
  assert.strictEqual(top.total, 0);
  NOW = Date.UTC(2028, 1, 29, 12); // ...but on the 29th
  await db.ref('users/leap/lastActivity').set(iso(NOW - DAY)); // still active a year on
  top = await core.birthdayTop({ uid: 'me', body: { localDate: '2028-02-29' } });
  assert.strictEqual(top.total, 1);
});

test('reindex: users_private wins over email_prefs; email_prefs is the fallback', async () => {
  await player('a', { emailDob: '2001-10-13' });
  assert.strictEqual(await val('birthday_index/1013/a'), true);
  await db.ref('users_private/a/dateOfBirth').set('2001-05-06');
  await core.reindexBirthday('a');
  assert.strictEqual(await val('birthday_index/0506/a'), true);
  assert.strictEqual(await val('birthday_index/1013/a'), null);
});

test('reindex trigger: birthdayIndexOnShow reindexes params.uid', async () => {
  const fft = require('firebase-functions-test')();
  try {
    await player('ann', { dob: '2000-10-13' });
    await db.ref('birthday_prefs/ann').set({ show: false });
    const wrapped = fft.wrap(birthdays.birthdayIndexOnShow);
    const before = fft.database.makeDataSnapshot(null, 'birthday_prefs/ann/show');
    const after = fft.database.makeDataSnapshot(false, 'birthday_prefs/ann/show');
    await wrapped(fft.makeChange(before, after), { params: { uid: 'ann' } });
    assert.strictEqual(await val('birthday_index/1013/ann'), null);
  } finally {
    fft.cleanup();
  }
});

test('backfill: dry run writes nothing, --apply builds the index, a re-run changes nothing', async () => {
  await player('a', { dob: '2000-10-13', reindex: false });
  await player('b', { emailDob: '1990-10-13', reindex: false });
  await player('c', { dob: '2015-01-02', reindex: false }); // under 13
  await player('d', { dob: '2000-10-13', show: false, reindex: false });
  await player('e', { reindex: false }); // no DOB
  await db.ref('users_private/e').set({ email: 'e@example.com' });
  const log = () => {};

  const dry = await backfill({ page: 2, log });
  assert.strictEqual(dry.uids, 4);
  assert.strictEqual(await val('birthday_index'), null);

  const run = await backfill({ apply: true, page: 2, log });
  assert.deepStrictEqual({ i: run.indexed, p: run.pending, h: run.hidden }, { i: 2, p: 1, h: 1 });
  assert.strictEqual(await val('birthday_counts/1013'), 2);
  await backfill({ apply: true, page: 2, log });
  assert.strictEqual(await val('birthday_counts/1013'), 2);
});

// ═══ birthdayTop ════════════════════════════════════════════════════════════

async function rankedWorld() {
  await player('me', { dob: '1995-06-01' });
  await player('dmPal', { dob: '2000-10-13', activeDaysAgo: 20 });
  await player('followPal', { dob: '2000-10-13', activeDaysAgo: 20 });
  await player('groupPal', { dob: '2000-10-13', activeDaysAgo: 20 });
  await player('wisher', { dob: '2000-10-13', activeDaysAgo: 20 });
  await player('stranger1', { dob: '2000-10-13', activeDaysAgo: 1 });
  await player('stranger2', { dob: '2000-10-13', activeDaysAgo: 5, legacyActivity: true });
  await db.ref('chat_meta_data/me/dmPal').set({ timestamp: NOW });
  await fsdb.collection('following').add({ followerId: 'me', followingId: 'followPal' });
  await fsdb.collection('following').add({ followerId: 'someoneElse', followingId: 'stranger1' });
  await db.ref('group_meta_data/me/g1').set({ unreadCount: 0 });
  await fsdb.collection('groups').doc('g1').set({ memberIds: ['me', 'groupPal'] });
  await fsdb.collection('groups').doc('g2').set({ memberIds: ['stranger2', 'x'] }); // not my group
  await db.ref('birthday_wished_by/me/wisher').set(true);
}

test('birthdayTop: people you know first (dm > follow > group > wished you), then activity', async () => {
  await rankedWorld();
  const top = await core.birthdayTop({ uid: 'me', body: { localDate: '2026-10-13', limit: 10 } });
  assert.deepStrictEqual(top.rows.map((r) => [r.uid, r.reason]), [
    ['dmPal', 'dm'], ['followPal', 'follow'], ['groupPal', 'group'], ['wisher', 'wished_you'],
    ['stranger1', null], ['stranger2', null],
  ]);
  assert.strictEqual(top.total, 6);
  assert.strictEqual(top.unwished, 6);
  const row = top.rows[0];
  assert.deepStrictEqual(Object.keys(row).sort(), ['avatar', 'day', 'month', 'name', 'reason', 'uid', 'wished', 'wishes']);
  assert.deepStrictEqual([row.month, row.day, row.wishes, row.wished, row.name], [10, 13, 0, false, 'dmPal']);
});

test('birthdayTop: filters (self, blocks both ways, body.blocked, inactive, hidden, under 13)', async () => {
  await player('me', { dob: '1995-10-13' }); // my own birthday today too
  await player('ok', { dob: '2000-10-13' });
  await player('blocksMe', { dob: '2000-10-13' });
  await player('iBlocked', { dob: '2000-10-13' });
  await player('localBlock', { dob: '2000-10-13' });
  await player('localBlockObj', { dob: '2000-10-13' });
  await player('asleep', { dob: '2000-10-13', activeDaysAgo: 31 });
  await player('noActivity', { dob: '2000-10-13', activeDaysAgo: null });
  await player('hidden', { dob: '2000-10-13', show: false });
  await player('kid', { dob: '2015-10-13' });
  await db.ref('bannedUsers/blocksMe/me').set({ at: NOW });
  await db.ref('bannedUsers/me/iBlocked').set({ at: NOW });
  const top = await core.birthdayTop({
    uid: 'me',
    body: { localDate: '2026-10-13', limit: 50, blocked: ['localBlock', { id: 'localBlockObj' }, 'bad/path', 42] },
  });
  assert.deepStrictEqual(top.rows.map((r) => r.uid), ['ok']);
  assert.strictEqual(top.total, 1);
});

test('birthdayTop: limit default 6, clamped to 1..200; tomorrow count; local date clamp', async () => {
  await player('me', { dob: '1995-10-14' }); // my birthday is tomorrow: not counted in "tomorrow"
  for (let i = 0; i < 9; i++) await player(`p${i}`, { dob: '2000-10-13', activeDaysAgo: i });
  await player('t1', { dob: '2000-10-14' });
  await player('t2', { dob: '2000-10-14' });

  let top = await core.birthdayTop({ uid: 'me', body: { localDate: '2026-10-13' } });
  assert.strictEqual(top.rows.length, 6);
  assert.strictEqual(top.total, 9);
  assert.strictEqual(top.tomorrow, 2);
  assert.deepStrictEqual(top.rows.map((r) => r.uid), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  top = await core.birthdayTop({ uid: 'me', body: { limit: 0 } });
  assert.strictEqual(top.rows.length, 1);
  top = await core.birthdayTop({ uid: 'me', body: { limit: 999 } });
  assert.strictEqual(top.rows.length, 9);
  // A phone already on the 14th sees the 14th's list.
  top = await core.birthdayTop({ uid: 'me', body: { localDate: '2026-10-14' } });
  assert.deepStrictEqual(top.rows.map((r) => r.uid).sort(), ['t1', 't2']);
  // A clock far off falls back to UTC today.
  top = await core.birthdayTop({ uid: 'me', body: { localDate: '2020-01-01' } });
  assert.strictEqual(top.total, 9);
});

test('birthdayTop: wishes and wished reflect sent wishes; unwished counts all of today', async () => {
  await rankedWorld();
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'stranger2', template: 'hbd' } });
  await core.sendBirthdayWish({ uid: 'dmPal', body: { to: 'stranger2', template: 'cake' } });
  const top = await core.birthdayTop({ uid: 'me', body: { limit: 2 } });
  assert.strictEqual(top.unwished, 5);
  const all = await core.birthdayTop({ uid: 'me', body: { limit: 10 } });
  const s2 = all.rows.find((r) => r.uid === 'stranger2');
  assert.deepStrictEqual([s2.wishes, s2.wished], [2, true]);
});

// ═══ sendBirthdayWish ═══════════════════════════════════════════════════════

test('sendBirthdayWish: writes the wish, counts it, and pushes only the first wish', async () => {
  await player('me', { name: 'Sender One' });
  await player('you', { name: 'Sender Two' });
  await player('bday', { dob: '2000-10-13' });
  const r1 = await core.sendBirthdayWish({ uid: 'me', body: { to: 'bday', template: 'hbd', localDate: '2026-10-13' } });
  assert.deepStrictEqual(r1, { wishes: 1 });
  const wish = await val('birthday_wishes/2026/bday/me');
  assert.deepStrictEqual({ ...wish, at: 0 }, { t: 'hbd', at: 0, n: 'Sender One', a: 'https://cdn.example/me.png' });
  assert.strictEqual(await val('birthday_sent/me/2026/bday'), true);
  assert.strictEqual(await val('birthday_wished_by/bday/me'), true);
  assert.strictEqual(await val('birthday_wish_counts/2026/bday'), 1);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].token, 'tok-bday');
  assert.strictEqual(pushes[0].notification.title, '🎂 Sender One wished you a happy birthday!');
  assert.deepStrictEqual(pushes[0].data, { type: 'birthday_wish', route: 'Birthdays' });

  const r2 = await core.sendBirthdayWish({ uid: 'you', body: { to: 'bday', template: 'party' } });
  assert.deepStrictEqual(r2, { wishes: 2 });
  assert.strictEqual(pushes.length, 1, 'second wish must not push');
});

test('sendBirthdayWish: duplicate, not today, self, hidden, under 13, unknown, blocked, bad template', async () => {
  await player('me', {});
  await player('bday', { dob: '2000-10-13' });
  await player('later', { dob: '2000-10-20' });
  await player('hidden', { dob: '2000-10-13', show: false });
  await player('kid', { dob: '2015-10-13' });
  await player('blocksMe', { dob: '2000-10-13' });
  await player('iBlocked', { dob: '2000-10-13' });
  await db.ref('bannedUsers/blocksMe/me').set(true);
  await db.ref('bannedUsers/me/iBlocked').set(true);

  await core.sendBirthdayWish({ uid: 'me', body: { to: 'bday', template: 'hbd' } });
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'bday', template: 'party' } }), 'already_wished');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'later', template: 'hbd' } }), 'not_today');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'me', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'hidden', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'kid', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'nobody', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'blocksMe', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'iBlocked', template: 'hbd' } }), 'cannot_wish');
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'bday', template: 'pets' } }), 'generic');
  assert.strictEqual(await val('birthday_wish_counts/2026/bday'), 1);
});

test('sendBirthdayWish: a birthday yesterday or tomorrow (UTC) is still today somewhere', async () => {
  await player('me', {});
  await player('y', { dob: '2000-10-12' });
  await player('t', { dob: '2000-10-14' });
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'y', template: 'hbd' } });
  await core.sendBirthdayWish({ uid: 'me', body: { to: 't', template: 'hbd' } });
  assert.strictEqual(await val('birthday_wish_counts/2026/y'), 1);
  assert.strictEqual(await val('birthday_wish_counts/2026/t'), 1);
});

test('sendBirthdayWish: 100 wishes per sender per UTC day', async () => {
  await player('me', {});
  await player('a', { dob: '2000-10-13' });
  await player('b', { dob: '2000-10-13' });
  await db.ref('birthday_server/sent_day/me').set({ '2026-10-12': 100, '2026-10-13': 99 });
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'a', template: 'hbd' } });
  assert.deepStrictEqual(await val('birthday_server/sent_day/me'), { '2026-10-13': 100 });
  await expectError(core.sendBirthdayWish({ uid: 'me', body: { to: 'b', template: 'hbd' } }), 'limit');
  assert.strictEqual(await val('birthday_sent/me/2026/b'), null, 'a refused wish leaves no sent marker');
  NOW += DAY; // next UTC day: allowed again (b's birthday was yesterday: still wishable)
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'b', template: 'hbd' } });
  assert.deepStrictEqual(await val('birthday_server/sent_day/me'), { '2026-10-14': 1 });
});

test('sendBirthdayWish: a dead FCM token is cleared', async () => {
  await player('me', {});
  await player('bday', { dob: '2000-10-13', token: 'dead-token' });
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'bday', template: 'hbd' } });
  assert.strictEqual(await val('users/bday/fcmToken'), null);
  assert.strictEqual(await val('users/bday/isTokenInvalid'), true);
});

// ═══ wishAllBirthdays ═══════════════════════════════════════════════════════

test('wishAllBirthdays: every unwished player, people you know first, one push each', async () => {
  await rankedWorld();
  await core.sendBirthdayWish({ uid: 'me', body: { to: 'stranger1', template: 'hbd' } });
  await core.sendBirthdayWish({ uid: 'stranger2', body: { to: 'wisher', template: 'hbd' } }); // wisher's first push used
  pushes = [];
  sendEachCalls = 0;
  const r = await core.wishAllBirthdays({ uid: 'me', body: { localDate: '2026-10-13' } });
  assert.deepStrictEqual(r, { sent: 5, left: 0, limited: false });
  assert.strictEqual((await val('birthday_wishes/2026/dmPal/me')).t, 'party');
  assert.strictEqual(await val('birthday_wish_counts/2026/wisher'), 2);
  assert.deepStrictEqual(pushes.map((p) => p.token).sort(), ['tok-dmPal', 'tok-followPal', 'tok-groupPal', 'tok-stranger2']);
  assert.strictEqual(sendEachCalls, 1);
  assert.deepStrictEqual(await core.wishAllBirthdays({ uid: 'me', body: {} }), { sent: 0, left: 0, limited: false });
});

test('wishAllBirthdays: stops at the daily limit, best-known first', async () => {
  await rankedWorld();
  await db.ref('birthday_server/sent_day/me').set({ '2026-10-13': 98 });
  const r = await core.wishAllBirthdays({ uid: 'me', body: { template: 'cake' } });
  assert.deepStrictEqual(r, { sent: 2, left: 4, limited: true });
  assert.ok(await val('birthday_wishes/2026/dmPal/me'));
  assert.ok(await val('birthday_wishes/2026/followPal/me'));
  assert.strictEqual(await val('birthday_wishes/2026/groupPal/me'), null);
  assert.strictEqual(await val('birthday_server/sent_day/me/2026-10-13'), 100);
  await expectError(core.wishAllBirthdays({ uid: 'me', body: { template: 'nope' } }), 'generic');
});

// ═══ thankBirthdayWishers ═══════════════════════════════════════════════════

test('thankBirthdayWishers: only on your birthday; marks wishes; one push per wisher per day', async () => {
  await player('w1', {});
  await player('w2', {});
  await player('b1', { dob: '2000-10-13', name: 'BirthdayOne' });
  await player('b2', { dob: '1990-10-13', name: 'BirthdayTwo' });
  await player('notToday', { dob: '2000-05-05' });
  await expectError(core.thankBirthdayWishers({ uid: 'notToday' }), 'not_today');

  for (const from of ['w1', 'w2']) {
    for (const to of ['b1', 'b2']) await core.sendBirthdayWish({ uid: from, body: { to, template: 'hbd' } });
  }
  pushes = [];
  assert.deepStrictEqual(await core.thankBirthdayWishers({ uid: 'b1' }), { thanked: 2 });
  assert.strictEqual(typeof (await val('birthday_wishes/2026/b1/w1')).th, 'number');
  assert.deepStrictEqual(pushes.map((p) => [p.token, p.notification.title]).sort(), [
    ['tok-w1', '💖 BirthdayOne thanked you for the birthday wish!'],
    ['tok-w2', '💖 BirthdayOne thanked you for the birthday wish!'],
  ]);
  assert.deepStrictEqual(pushes[0].data, { type: 'birthday_thanks', route: 'Birthdays' });
  assert.deepStrictEqual(await core.thankBirthdayWishers({ uid: 'b1' }), { thanked: 0 });
  // b2 thanks the same two wishers today: marked, but no second push.
  assert.deepStrictEqual(await core.thankBirthdayWishers({ uid: 'b2' }), { thanked: 2 });
  assert.strictEqual(pushes.length, 2);
  // A new wish after thanking is pending again.
  await player('w3', {});
  await core.sendBirthdayWish({ uid: 'w3', body: { to: 'b1', template: 'gift' } });
  assert.strictEqual((await core.myBirthday({ uid: 'b1' })).thankPending, 1);
});

// ═══ claimBirthdayGift ══════════════════════════════════════════════════════

test('claimBirthdayGift: 15 stars once per birthday year', async () => {
  await player('b', { dob: '2000-10-13' });
  await db.ref('users/b/dailyStars').set({ starBalance: 10, totalStarsEarned: 30, streak: 3 });
  assert.deepStrictEqual(await core.claimBirthdayGift({ uid: 'b' }), { stars: 15 });
  assert.deepStrictEqual(await val('users/b/dailyStars'), { starBalance: 25, totalStarsEarned: 45, streak: 3 });
  assert.strictEqual((await val('birthday_gifts/b/2026')).stars, 15);
  await expectError(core.claimBirthdayGift({ uid: 'b' }), 'gift_unavailable');
  assert.strictEqual((await val('users/b/dailyStars')).starBalance, 25);
});

test('claimBirthdayGift: seeds an old balance; no createdAt is fine; birthday tomorrow (UTC) counts', async () => {
  await player('old', { dob: '2000-10-14', createdDaysAgo: null });
  await db.ref('users/old/dailyStars').set({ totalStarsEarned: 40 });
  await core.claimBirthdayGift({ uid: 'old' });
  assert.deepStrictEqual(await val('users/old/dailyStars'), { starBalance: 55, totalStarsEarned: 55 });
  await player('fresh', { dob: '2000-10-13' });
  await db.ref('users/fresh/dailyStars').remove();
  await core.claimBirthdayGift({ uid: 'fresh' });
  assert.deepStrictEqual(await val('users/fresh/dailyStars'), { starBalance: 15, totalStarsEarned: 15 });
});

test('claimBirthdayGift: refused under 13, for new accounts, off the birthday, without a DOB', async () => {
  await player('kid', { dob: '2015-10-13' });
  await player('newbie', { dob: '2000-10-13', createdDaysAgo: 10 });
  await player('later', { dob: '2000-11-13' });
  await player('nodob', {});
  for (const uid of ['kid', 'newbie', 'later', 'nodob']) {
    await expectError(core.claimBirthdayGift({ uid }), 'gift_unavailable');
  }
  assert.strictEqual(await val('birthday_gifts'), null);
});

// ═══ updateMyBirthday ═══════════════════════════════════════════════════════

test('updateMyBirthday: once ever; moves the index; returns month and day only', async () => {
  await player('ann', { dob: '2000-10-13' });
  const r = await core.updateMyBirthday({ uid: 'ann', body: { year: 2000, month: 3, day: 5 } });
  assert.deepStrictEqual(r, { month: 3, day: 5 });
  assert.strictEqual(await val('users_private/ann/dateOfBirth'), '2000-03-05');
  assert.strictEqual(await val('birthday_index/0305/ann'), true);
  assert.strictEqual(await val('birthday_counts/1013'), 0);
  await expectError(core.updateMyBirthday({ uid: 'ann', body: { year: 2000, month: 3, day: 6 } }), 'already_edited');
  assert.strictEqual((await core.myBirthday({ uid: 'ann' })).canEdit, false);
});

test('updateMyBirthday: same date is a no-op that keeps the edit', async () => {
  await player('ann', { emailDob: '2000-10-13' });
  assert.deepStrictEqual(await core.updateMyBirthday({ uid: 'ann', body: { year: 2000, month: 10, day: 13 } }), { month: 10, day: 13 });
  assert.strictEqual(await val('birthday_server/edits/ann'), null);
});

test('updateMyBirthday: age_change across 13 either way; bad dates; no DOB on file', async () => {
  await player('adult', { dob: '2000-10-13' });
  await player('kid', { dob: '2015-10-13' });
  await player('nodob', {});
  await expectError(core.updateMyBirthday({ uid: 'adult', body: { year: 2014, month: 1, day: 1 } }), 'age_change');
  await expectError(core.updateMyBirthday({ uid: 'kid', body: { year: 2010, month: 1, day: 1 } }), 'age_change');
  await expectError(core.updateMyBirthday({ uid: 'adult', body: { year: 2001, month: 2, day: 29 } }), 'bad_date');
  await expectError(core.updateMyBirthday({ uid: 'adult', body: { year: 2030, month: 1, day: 1 } }), 'bad_date');
  await expectError(core.updateMyBirthday({ uid: 'adult', body: { year: 2024, month: 1, day: 1 } }), 'bad_date');
  await expectError(core.updateMyBirthday({ uid: 'adult', body: { year: '2000', month: 'x', day: 1 } }), 'bad_date');
  await expectError(core.updateMyBirthday({ uid: 'nodob', body: { year: 2000, month: 1, day: 1 } }), 'bad_date');
  // A kid may correct within under-13; still not indexed.
  await core.updateMyBirthday({ uid: 'kid', body: { year: 2016, month: 10, day: 13 } });
  assert.strictEqual(await val('birthday_index/1013/kid'), null);
  assert.strictEqual(await val('birthday_server/edits/adult'), null, 'refused edits are not used up');
});

// ═══ myBirthday ═════════════════════════════════════════════════════════════

test('myBirthday: no DOB, a normal day, the birthday itself, a minor; never a year', async () => {
  await player('nodob', {});
  assert.deepStrictEqual(await core.myBirthday({ uid: 'nodob' }), {
    month: null, day: null, show: true, minor: false, canEdit: false,
    wishes: [], wishCount: 0, thankPending: 0, giftReady: false, giftOpened: false,
  });

  await player('later', { dob: '2000-12-01', show: false });
  const later = await core.myBirthday({ uid: 'later' });
  assert.deepStrictEqual([later.month, later.day, later.show, later.canEdit, later.giftReady], [12, 1, false, true, false]);

  await player('b', { dob: '2000-10-13' });
  await player('w1', { name: 'First' });
  await player('w2', { name: 'Second' });
  await core.sendBirthdayWish({ uid: 'w1', body: { to: 'b', template: 'cake' } });
  NOW += 1000;
  await core.sendBirthdayWish({ uid: 'w2', body: { to: 'b', template: 'gift' } });
  let me = await core.myBirthday({ uid: 'b' });
  assert.deepStrictEqual(me.wishes, [
    { name: 'Second', avatar: 'https://cdn.example/w2.png', template: 'gift' },
    { name: 'First', avatar: 'https://cdn.example/w1.png', template: 'cake' },
  ]);
  assert.deepStrictEqual([me.wishCount, me.thankPending, me.giftReady, me.giftOpened, me.show], [2, 2, true, false, true]);
  await core.claimBirthdayGift({ uid: 'b' });
  me = await core.myBirthday({ uid: 'b' });
  assert.deepStrictEqual([me.giftReady, me.giftOpened], [false, true]);
  assert.ok(!JSON.stringify(me).includes('2000'), 'no birth year anywhere in the answer');

  await player('kid', { dob: '2015-10-13' });
  const kid = await core.myBirthday({ uid: 'kid' });
  assert.deepStrictEqual([kid.minor, kid.show, kid.giftReady, kid.month, kid.day], [true, false, false, 10, 13]);
});

// ═══ notifyBirthdays ════════════════════════════════════════════════════════

test('notifyBirthdays: today\'s indexed players, 30+ day accounts, once per year', async () => {
  await player('b1', { dob: '2000-10-13', name: 'Ann' });
  await player('b2', { dob: '1999-10-13', createdDaysAgo: 5 });
  await player('b3', { dob: '2000-10-13', show: false });
  await player('b4', { dob: '2000-10-14' });
  const r = await core.runNotifyBirthdays();
  assert.deepStrictEqual(r, { today: 2, claimed: 1, sent: 1 });
  assert.deepStrictEqual(pushes.map((p) => [p.token, p.notification.title, p.data.route]), [
    ['tok-b1', '🎉 Happy birthday, Ann!', 'Birthdays'],
  ]);
  assert.deepStrictEqual(await core.runNotifyBirthdays(), { today: 2, claimed: 0, sent: 0 });
});

// ═══ HTTPS wrapper (real ID tokens from the Auth emulator) ═════════════════

async function signUp() {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const json = await res.json();
  assert.ok(json.idToken, `signUp failed: ${JSON.stringify(json)}`);
  return { uid: json.localId, token: json.idToken };
}

function fakeRes() {
  const res = { code: 0, body: undefined };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const callHttp = async (handler, { token, method = 'POST', body = {} } = {}) => {
  const res = fakeRes();
  await handleRequest(handler, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
};

test('HTTPS: token required, POST only, JSON errors with the app\'s codes', async () => {
  const me = await signUp();
  await player(me.uid, { dob: '2000-10-13' });
  let res = await callHttp(core.myBirthday, {});
  assert.deepStrictEqual([res.code, res.body], [401, { error: 'sign_in' }]);
  res = await callHttp(core.myBirthday, { token: 'not-a-token' });
  assert.deepStrictEqual([res.code, res.body], [401, { error: 'sign_in' }]);
  res = await callHttp(core.myBirthday, { token: me.token, method: 'GET' });
  assert.strictEqual(res.code, 405);
  res = await callHttp(core.myBirthday, { token: me.token });
  assert.deepStrictEqual([res.code, res.body.month, res.body.day], [200, 10, 13]);
  res = await callHttp(core.sendBirthdayWish, { token: me.token, body: { to: 'nobody', template: 'hbd' } });
  assert.deepStrictEqual([res.code, res.body], [400, { error: 'cannot_wish' }]);
  res = await callHttp(core.updateMyBirthday, { token: me.token, body: { year: 2000, month: 1, day: 2 } });
  assert.strictEqual(res.code, 200);
  res = await callHttp(core.updateMyBirthday, { token: me.token, body: { year: 2000, month: 1, day: 3 } });
  assert.deepStrictEqual([res.code, res.body], [409, { error: 'already_edited' }]);
});

// ═══ database.rules.json ════════════════════════════════════════════════════

const rest = async (method, path, { token, body } = {}) => {
  const q = new URLSearchParams({ ns: NS });
  if (token) q.set('auth', token);
  const res = await fetch(`http://${DB_HOST}/${path}.json?${q}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
};
const canRead = async (path, token) => (await rest('GET', path, { token })) === 200;
const canWrite = async (path, body, token) => (await rest('PUT', path, { token, body })) === 200;

test('rules: clients write only their own birthday_prefs { show: boolean }', async () => {
  const a = await signUp();
  const b = await signUp();
  assert.ok(await canWrite(`birthday_prefs/${a.uid}`, { show: false }, a.token));
  assert.ok(await canRead(`birthday_prefs/${a.uid}`, a.token));
  assert.ok(!(await canRead(`birthday_prefs/${a.uid}`, b.token)));
  assert.ok(!(await canWrite(`birthday_prefs/${b.uid}`, { show: false }, a.token)));
  assert.ok(!(await canWrite(`birthday_prefs/${a.uid}`, { show: 'no' }, a.token)));
  assert.ok(!(await canWrite(`birthday_prefs/${a.uid}`, { show: true, extra: 1 }, a.token)));
  assert.ok(!(await canWrite(`birthday_prefs/${a.uid}`, { show: true })));
});

test('rules: no client can write any server node, even its own', async () => {
  const a = await signUp();
  const paths = [
    'birthday_index/1013/' + a.uid, 'birthday_counts/1013', 'birthday_server/edits/' + a.uid,
    `birthday_wishes/2026/${a.uid}/x`, `birthday_sent/${a.uid}/2026/x`, `birthday_wish_counts/2026/${a.uid}`,
    `birthday_wished_by/${a.uid}/x`, `birthday_gifts/${a.uid}/2026`,
  ];
  for (const p of paths) assert.ok(!(await canWrite(p, true, a.token)), `client wrote ${p}`);
});

test('rules: reads exactly as the spec table says', async () => {
  const a = await signUp();
  const b = await signUp();
  await db.ref('/').update({
    'birthday_index/1013/x': true,
    'birthday_counts/1013': 1,
    [`birthday_wishes/2026/${a.uid}/x`]: { t: 'hbd', at: 1, n: 'X' },
    [`birthday_sent/${a.uid}/2026/x`]: true,
    'birthday_wish_counts/2026/x': 1,
    [`birthday_wished_by/${a.uid}/x`]: true,
    [`birthday_gifts/${a.uid}/2026`]: { stars: 15, at: 1 },
    'birthday_server/edits/x': 1,
  });
  // any signed-in, one key at a time
  assert.ok(await canRead('birthday_counts/1013', a.token));
  assert.ok(await canRead('birthday_index/1013', a.token));
  assert.ok(await canRead('birthday_wish_counts/2026/x', a.token));
  assert.ok(!(await canRead('birthday_wish_counts/2026', a.token)));
  assert.ok(!(await canRead('birthday_counts/1013')));
  assert.ok(!(await canRead('birthday_counts', a.token)));
  assert.ok(!(await canRead('birthday_index', a.token)));
  // owner only
  assert.ok(await canRead(`birthday_wishes/2026/${a.uid}`, a.token));
  assert.ok(!(await canRead(`birthday_wishes/2026/${a.uid}`, b.token)));
  assert.ok(!(await canRead('birthday_wishes/2026', a.token)));
  assert.ok(await canRead(`birthday_sent/${a.uid}`, a.token));
  assert.ok(!(await canRead(`birthday_sent/${a.uid}`, b.token)));
  assert.ok(await canRead(`birthday_gifts/${a.uid}`, a.token));
  assert.ok(!(await canRead(`birthday_gifts/${a.uid}`, b.token)));
  // nobody
  assert.ok(!(await canRead(`birthday_wished_by/${a.uid}`, a.token)));
  assert.ok(!(await canRead('birthday_server', a.token)));
  assert.ok(!(await canRead('birthday_server/edits/x', a.token)));
});

test('rules: the app can add a first date of birth once, never change it', async () => {
  const a = await signUp();
  assert.ok(await canWrite(`users_private/${a.uid}/dateOfBirth`, '2000-10-13', a.token));
  assert.ok(!(await canWrite(`users_private/${a.uid}/dateOfBirth`, '2000-10-14', a.token)));
  assert.ok(!(await canWrite(`users_private/${a.uid}/dateOfBirth`, '2000-10-13x', a.token)));
  const b = await signUp();
  assert.ok(!(await canWrite(`users_private/${b.uid}/dateOfBirth`, 'not-a-date', b.token)));
  assert.ok(!(await canWrite(`users_private/${b.uid}/dateOfBirth`, '2000-10-13', a.token)));
});
