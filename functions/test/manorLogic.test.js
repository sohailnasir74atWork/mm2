/**
 * Lights Out Manor crate rules (functions/manor/logic.js) — pure, no emulators.
 *   node --test functions/test/manorLogic.test.js
 */
const test = require('node:test');
const assert = require('assert');
const L = require('../manor/logic');

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('odds add up to 100 and every tier has a skin', () => {
  assert.strictEqual(L.ODDS.reduce((s, [, w]) => s + w, 0), 100);
  for (const [r] of L.ODDS) assert.ok(L.SKINS.some((s) => s.rarity === r), r);
});

test('rollSkin follows the odds table', () => {
  assert.strictEqual(L.rollSkin(seq(0, 0)).rarity, 'common');
  assert.strictEqual(L.rollSkin(seq(0.56, 0)).rarity, 'uncommon');
  assert.strictEqual(L.rollSkin(seq(0.84, 0)).rarity, 'rare');
  assert.strictEqual(L.rollSkin(seq(0.97, 0)).rarity, 'legendary');
  assert.strictEqual(L.rollSkin(seq(0.995, 0)).id, 'void');
  assert.strictEqual(L.rollSkin(seq(0.1, 0.99)).id, 'mint');
  // Over many rolls the shares land near the table.
  const n = 20000, c = {};
  for (let i = 0; i < n; i++) { const r = L.rollSkin().rarity; c[r] = (c[r] || 0) + 1; }
  assert.ok(Math.abs(c.common / n - 0.55) < 0.02, `common ${c.common / n}`);
  assert.ok(c.exclusive / n < 0.02);
});

test('round tickets: wrong id, too fast, too old', () => {
  const now = 1_000_000;
  const r = { id: 'abc', role: 'seeker', at: now - 30_000 };
  assert.strictEqual(L.roundProblem(r, 'abc', now), null);
  assert.strictEqual(L.roundProblem(r, 'xyz', now), 'no_round');
  assert.strictEqual(L.roundProblem(null, 'abc', now), 'no_round');
  assert.strictEqual(L.roundProblem({ ...r, at: now - 5_000 }, 'abc', now), 'too_fast');
  assert.strictEqual(L.roundProblem({ ...r, at: now - 11 * 60_000 }, 'abc', now), 'expired');
});

test('daily counters reset at UTC midnight', () => {
  const t = Date.UTC(2026, 10, 2, 23, 59);
  assert.deepStrictEqual(L.todayCrates({ day: '2026-11-02', n: 4, d: 1 }, t), { day: '2026-11-02', n: 4, d: 1 });
  assert.deepStrictEqual(L.todayCrates({ day: '2026-11-02', n: 4, d: 1 }, t + 2 * 60_000), { day: '2026-11-03', n: 0, d: 0 });
  assert.deepStrictEqual(L.todayCrates(undefined, t), { day: '2026-11-02', n: 0, d: 0 });
});

test('frame records match the My Cosmetics shape', () => {
  const f = L.frameRecord(L.skinById('ember'), 123);
  assert.deepStrictEqual(Object.keys(f).sort(), ['activatedAt', 'borderColors', 'borderWidth', 'expiresAt', 'glowColor', 'id', 'name', 'rarity', 'source', 'type']);
  assert.strictEqual(f.id, 'manor_ember');
  assert.strictEqual(f.expiresAt, -1);
  assert.strictEqual(f.type, 'profileFrame');
});

test('round ids are 16 safe characters', () => {
  assert.match(L.newRoundId(), /^[a-z2-9]{16}$/);
});
