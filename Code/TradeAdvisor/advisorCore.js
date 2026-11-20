/**
 * advisorCore.js — "What can I get?" (2026-11-20).
 *
 * Players asked for an advisor that says what their items can be traded for
 * (~20 in-app suggestions across the three apps). v1 is plain value math over
 * the value list the player picked (MM2 or Supreme): no outside service, runs
 * on the phone. Pure functions only, so __tests__/advisorCore.test.js can run
 * them without React Native.
 *
 * Input rows are already priced by the caller (priceOf in valueSources.js):
 *   { key, name, value, demand, row }
 * where `value` is a summable price (> 0) and `demand` is 0-10 or null.
 */

// A swap within this band of the offer counts as a suggestion at all.
export const SINGLE_MIN = 0.85;
export const SINGLE_MAX = 1.15;
export const COMBO_MIN = 0.9;
export const COMBO_MAX = 1.12;
// Each half of a two-item swap is at least this share of the offer, so a
// combo is two real items and not one item plus filler.
export const COMBO_PART_MIN = 0.2;
// Pairs are built from the best-demanded candidates only, to keep it fast on
// a phone (~1,100 items in the pool would be ~600k pairs).
const COMBO_POOL = 120;

/** Win / fair / loss for the player: what they get against what they give. */
export const verdictFor = (getValue, giveValue) => {
  if (!(giveValue > 0)) return 'fair';
  const r = getValue / giveValue;
  if (r > 1.05) return 'win';
  if (r >= 0.95) return 'fair';
  return 'loss';
};

const closeness = (value, total) => Math.abs(1 - value / total);
const demandOf = (c) => (Number.isFinite(c.demand) ? c.demand : 0);
// Lower is better: how close the value is, with demand (0-10) worth up to
// 0.15 — the same as the width of the band. Without it a demand-1 Chroma one
// value point closer beat an item people actually trade (real feeds, 2026-11-20).
const DEMAND_WEIGHT = 0.015;
const score = (value, total, demand) => closeness(value, total) - DEMAND_WEIGHT * demand;

/**
 * offer:      priced rows the player gives (duplicates allowed: two Sunsets).
 * candidates: priced rows from the pool, already filtered to tradable items.
 * Returns { total, singles, combos } — at most `limit` of each, best first.
 */
export const adviseTrade = (offer, candidates, { limit = 5, comboLimit = 3 } = {}) => {
  const give = (offer || []).filter((o) => o && o.value > 0);
  const total = give.reduce((s, o) => s + o.value, 0);
  if (!(total > 0)) return { total: 0, singles: [], combos: [] };

  const offered = new Set(give.map((o) => o.key));
  const pool = (candidates || []).filter((c) => c && c.value > 0 && !offered.has(c.key));

  const singles = pool
    .filter((c) => c.value >= total * SINGLE_MIN && c.value <= total * SINGLE_MAX)
    .sort((a, b) => score(a.value, total, demandOf(a)) - score(b.value, total, demandOf(b))
      || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => ({ items: [c], value: c.value, verdict: verdictFor(c.value, total), demand: c.demand }));

  const parts = pool
    .filter((c) => c.value >= total * COMBO_PART_MIN && c.value <= total * COMBO_MAX)
    .sort((a, b) => demandOf(b) - demandOf(a) || b.value - a.value)
    .slice(0, COMBO_POOL);

  const pairs = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const sum = parts[i].value + parts[j].value;
      if (sum < total * COMBO_MIN || sum > total * COMBO_MAX) continue;
      pairs.push({ a: parts[i], b: parts[j], sum });
    }
  }
  pairs.sort((x, y) => score(x.sum, total, (demandOf(x.a) + demandOf(x.b)) / 2)
    - score(y.sum, total, (demandOf(y.a) + demandOf(y.b)) / 2));

  // No item twice across the shown combos, so the list stays varied.
  const used = new Set();
  const combos = [];
  for (const p of pairs) {
    if (combos.length >= comboLimit) break;
    if (used.has(p.a.key) || used.has(p.b.key)) continue;
    used.add(p.a.key);
    used.add(p.b.key);
    const d = [p.a.demand, p.b.demand].filter(Number.isFinite);
    combos.push({
      items: [p.a, p.b],
      value: p.sum,
      verdict: verdictFor(p.sum, total),
      demand: d.length ? Math.round(d.reduce((s, x) => s + x, 0) / d.length) : null,
    });
  }

  return { total, singles, combos };
};
