/**
 * Fantasy League rules (functions/fantasy/logic.js) — pure, no emulators.
 *   node --test functions/test/fantasyLogic.test.js
 */
const test = require('node:test');
const assert = require('assert');
const L = require('../fantasy/logic');

const DAY = L.DAY;

const feedJson = (rows) => ({
  meta: { generatedAt: '2026-10-30T02:03:20.852Z' },
  data: { Godly: { 'TIER 1': rows } },
});
const row = (name, value, extra = {}) => ({ name, value, valueType: 'exact', image: `img/${name}.png`, demand: '5', ...extra });

test('slug matches the value-alerts slug', () => {
  assert.strictEqual(L.slug("  Nik's Scythe "), 'nik_s_scythe');
  assert.strictEqual(L.slug('Bat'), 'bat');
});

test('parseFeed keeps exact, unique, ≥1 items and records every key', () => {
  const f = L.parseFeed(feedJson([
    row('Harvester', 2000),
    row('Bat', 100),
    row('Bat', 90), // duplicate name → ambiguous, left out
    row('Tiny', 0.2, { valueType: 'relative' }),
    row('Comma', '1,250'),
  ]));
  assert.strictEqual(f.generatedAt, '2026-10-30T02:03:20.852Z');
  assert.deepStrictEqual([...f.items.keys()].sort(), ['comma', 'harvester']);
  assert.strictEqual(f.items.get('comma').v, 1250);
  assert.strictEqual(f.items.get('harvester').cat, 'Godly');
  assert.ok(f.allKeys.has('bat') && f.allKeys.has('tiny'));
});

test('round ids are ISO weeks starting Monday 00:00 UTC', () => {
  const thu = Date.UTC(2026, 9, 29, 15); // Thu 2026-10-29
  const w = L.roundWindow(thu);
  assert.strictEqual(w.startsAt, Date.UTC(2026, 9, 26));
  assert.strictEqual(w.id, '2026-W44');
  assert.strictEqual(w.endsAt - w.startsAt, 7 * DAY);
  assert.strictEqual(w.joinUntil, w.endsAt - DAY);
  // Year boundaries: 2027-01-01 is a Friday → still 2026-W53.
  assert.strictEqual(L.roundWindow(Date.UTC(2027, 0, 1)).id, '2026-W53');
  assert.strictEqual(L.roundWindow(Date.UTC(2027, 0, 4)).id, '2027-W01');
  // Sunday belongs to the week that started the Monday before.
  assert.strictEqual(L.roundWindow(Date.UTC(2026, 10, 1, 23)).id, '2026-W44');
});

test('seasons follow events, then calendar months', () => {
  const s1 = L.seasonFor(Date.UTC(2026, 10, 2), null); // W45, Thu Nov 5 → Halloween (Oct 17 + 35d)
  assert.strictEqual(s1.id, 'halloween-2026');
  assert.strictEqual(s1.kind, 'event');
  const s2 = L.seasonFor(Date.UTC(2027, 0, 4), null); // Thu Jan 7 → Christmas 2026 (Dec 17 + 40d)
  assert.strictEqual(s2.id, 'christmas-2026');
  const s3 = L.seasonFor(Date.UTC(2026, 8, 7), null); // Sep → no event
  assert.strictEqual(s3.id, 'm-2026-09');
  assert.strictEqual(s3.kind, 'month');
  // A remote override moves the window; enabled:false removes it.
  const remote = { christmas: { start: Date.UTC(2026, 11, 1), end: Date.UTC(2026, 11, 30), enabled: true } };
  assert.strictEqual(L.seasonFor(Date.UTC(2026, 11, 7), remote).id, 'christmas-2026');
  assert.strictEqual(L.seasonFor(Date.UTC(2027, 0, 4), remote).id, 'm-2027-01');
  assert.strictEqual(L.seasonFor(Date.UTC(2026, 10, 2), { halloween: { enabled: false } }).id, 'm-2026-11');
});

test('pool: recent movers first, then new items, topped up to the minimum', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push(row(`Item${i}`, 100 + i, { demand: String(i % 10) }));
  const { items } = L.parseFeed(feedJson(rows));
  const now = Date.UTC(2026, 10, 2);
  const changes = [
    { item_slug: 'item1', old_value: 100, new_value: 90, changed_at: now - 2 * DAY },
    { item_slug: 'item1', old_value: 90, new_value: 101, changed_at: now - 1 * DAY },
    { item_slug: 'item2', old_value: 200, new_value: 150, changed_at: now - 3 * DAY },
    { item_slug: 'item3', old_value: 100, new_value: 50, changed_at: now - 40 * DAY }, // too old
    { item_slug: 'ghost', old_value: 1, new_value: 2, changed_at: now - DAY }, // not in feed
  ];
  const pool = L.buildPool(items, changes, { item5: now - 5 * DAY, item6: 0 }, now);
  assert.strictEqual(pool[0].k, 'item1');
  assert.strictEqual(pool[0].ch, 2);
  assert.strictEqual(pool[0].last.p, 12.2);
  assert.strictEqual(pool[1].k, 'item2');
  assert.strictEqual(pool[2].k, 'item5');
  assert.strictEqual(pool[2].isNew, true);
  assert.strictEqual(pool.length, 40);
  assert.ok(!pool.some((p) => p.k === 'item3' && p.ch));
  assert.ok(!pool.some((p) => p.k === 'ghost'));
  assert.strictEqual(new Set(pool.map((p) => p.k)).size, pool.length);
});

test('pickScore: right call, wrong call, no move, captain', () => {
  assert.deepStrictEqual(L.pickScore({ base: 100, dir: 'up' }, 100), { pct: 0, pts: 0 });
  assert.deepStrictEqual(L.pickScore({ base: 100, dir: 'up' }, 118), { pct: 18, pts: 28 });
  assert.deepStrictEqual(L.pickScore({ base: 100, dir: 'down' }, 118), { pct: 18, pts: 2 });
  assert.deepStrictEqual(L.pickScore({ base: 100, dir: 'down', cap: true }, 50), { pct: -50, pts: 100 });
  assert.deepStrictEqual(L.pickScore({ base: 100, dir: 'up' }, 300), { pct: 200, pts: 50 });
  assert.deepStrictEqual(L.pickScore({ base: 0, dir: 'up' }, 300), { pct: 0, pts: 0 });
});

test('scoreEntry adds banked points and hype; missing values keep the last one', () => {
  const entry = {
    banked: 7,
    picks: [
      { k: 'a', dir: 'up', cap: true, base: 100, cur: 100 },
      { k: 'b', dir: 'down', base: 50, cur: 45 },
    ],
  };
  const values = { a: 110 };
  const s = L.scoreEntry(entry, (k) => (k in values ? values[k] : null), (k) => (k === 'b' ? 3 : 0));
  assert.strictEqual(s.picks[0].pts, 40); // (10 + 10) × 2
  assert.strictEqual(s.picks[1].cur, 45); // kept
  assert.strictEqual(s.picks[1].pts, 20); // -10% called down
  assert.strictEqual(s.points, 7 + 40 + 20 + 3);
});

test('rankEntries: points, then the earlier joiner', () => {
  const r = L.rankEntries([
    { uid: 'a', points: 10, createdAt: 3 },
    { uid: 'b', points: 30, createdAt: 2 },
    { uid: 'c', points: 10, createdAt: 1 },
  ]);
  assert.deepStrictEqual(r.map((e) => [e.uid, e.rank]), [['b', 1], ['c', 2], ['a', 3]]);
});

test('round rewards', () => {
  assert.strictEqual(L.roundReward(1, 50), 25);
  assert.strictEqual(L.roundReward(3, 50), 15);
  assert.strictEqual(L.roundReward(10, 50), 10);
  assert.strictEqual(L.roundReward(100, 1), 3);
  assert.strictEqual(L.roundReward(101, 1), 1);
  assert.strictEqual(L.roundReward(1, 0), 0);
});

test('hype counts unique posters, excludes the picker, pro-rates last week', () => {
  const start = Date.UTC(2026, 10, 2);
  const t = (uid, ts, names) => ({ userId: uid, ts, hasItems: names.map((name) => ({ name })), wantsItems: [] });
  const trades = [
    t('u1', start + DAY, ['Bat']),
    t('u1', start + DAY, ['Bat', 'Bat']), // same poster again
    t('u2', start + DAY, ['Bat']),
    t('u3', start + 2 * DAY, ['Bat']),
    t('me', start + 2 * DAY, ['Bat']),
    t('u4', start - DAY, ['Bat']), // last week
    t('u5', start - DAY, ['Bat']),
    t('Anonymous', start + DAY, ['Bat']),
    t('u6', start + DAY, ['Harvester']), // not in the pool
  ];
  const h = L.collectHype(trades, ['bat'], start);
  assert.strictEqual(h.get('bat').cur.size, 4);
  assert.strictEqual(h.get('bat').prev.size, 2);
  assert.ok(!h.has('harvester'));
  // Full week: 3 others this week − 2 last week = 1.
  assert.strictEqual(L.hypePoints(h, 'bat', 'me', 7 * DAY), 1);
  // Half way through: 3 − 2 × 0.5 = 2.
  assert.strictEqual(L.hypePoints(h, 'bat', 'me', 3.5 * DAY), 2);
  assert.strictEqual(L.hypePoints(h, 'nothing', 'me', 7 * DAY), 0);
  // Capped.
  const many = Array.from({ length: 20 }, (_, i) => t(`p${i}`, start + DAY, ['Bat']));
  assert.strictEqual(L.hypePoints(L.collectHype(many, ['bat'], start), 'bat', 'me', 7 * DAY), L.HYPE_MAX);
});

test('guess points by % error', () => {
  assert.deepStrictEqual(L.guessScore(750, 750), { err: 0, pts: 50 });
  assert.deepStrictEqual(L.guessScore(860, 750), { err: 14.7, pts: 30 });
  assert.deepStrictEqual(L.guessScore(1300, 750), { err: 73.3, pts: 0 });
  assert.deepStrictEqual(L.guessScore(0, 750), { err: null, pts: 0 });
});

test('new guess items: usable, most valuable, capped; a reshaped feed opens none', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`New${i}`, (i + 1) * 100));
  const { items } = L.parseFeed(feedJson(rows));
  const keys = [...items.keys()];
  const g = L.newGuessItems(items, [...keys, 'unknown']);
  assert.strictEqual(g.length, 6);
  assert.strictEqual(g[0].k, 'new9');
  assert.deepStrictEqual(L.newGuessItems(items, Array.from({ length: 151 }, (_, i) => `k${i}`)), []);
  assert.strictEqual(L.guessId('emberbow', Date.UTC(2026, 11, 18, 5)), 'emberbow-2026-12-18');
});

test('validatePicks', () => {
  const pool = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
  const picks = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ k, dir: 'up' }));
  const ok = L.validatePicks({ picks, captain: 'c' }, pool);
  assert.strictEqual(ok.picks.length, 5);
  assert.deepStrictEqual(ok.picks.filter((p) => p.cap).map((p) => p.k), ['c']);
  assert.strictEqual(L.validatePicks({ picks: picks.slice(0, 4), captain: 'a' }, pool).error, 'bad_picks');
  assert.strictEqual(L.validatePicks({ picks: [...picks.slice(0, 4), { k: 'a', dir: 'up' }], captain: 'a' }, pool).error, 'bad_picks');
  assert.strictEqual(L.validatePicks({ picks: [...picks.slice(0, 4), { k: 'z', dir: 'up' }], captain: 'a' }, pool).error, 'bad_picks');
  assert.strictEqual(L.validatePicks({ picks: [...picks.slice(0, 4), { k: 'f', dir: 'sideways' }], captain: 'a' }, pool).error, 'bad_picks');
  assert.strictEqual(L.validatePicks({ picks, captain: 'f' }, pool).error, 'bad_picks');
  assert.strictEqual(L.okGuess('750'), 750);
  assert.strictEqual(L.okGuess(-1), null);
  assert.strictEqual(L.okGuess('abc'), null);
});
