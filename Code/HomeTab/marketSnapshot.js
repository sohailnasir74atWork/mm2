// marketSnapshot.js — the numbers behind Home's Market card (2026-11-04,
// batch 2). Pure, so it is tested without React (__tests__/marketSnapshot.test.js).
//
// Data: only what the app already has. Supreme's feed carries, per item,
// `change` (value units) and `changePct` ("+4.8%") — the movement since the
// site's previous value update — and buildItemPool copies them onto the pool
// row, including the 787 rows MM2 owns. MM2's feed publishes no movement at
// all, and the pipeline's diff JSON (MM2VALUES/*/diff.json) is not on the CDN,
// so Supreme is the only source of real rising/falling data. No reads, no
// new fetch.
//
// Sets are left out: a Set's change is the sum of its parts' changes, so the
// same move would be listed twice ("Chroma Ever Set" -2,000 is Chroma
// Evergreen -1,000 plus Chroma Evergun -1,000).
//
// Movers are ranked by the size of the move in value units, not by percent:
// by percent the top of the list is bundle-tier items going 1 -> 2 (+100%),
// which says nothing about the market. The percent is what is shown.

const TOP = 3;

/** "+4.8%" / "-10.0%" / 4.8 → 4.8 / -10 ; anything else → null. */
export const parsePct = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const m = String(raw ?? '').replace(',', '.').match(/^\s*([+-]?\d+(?:\.\d+)?)\s*%?\s*$/);
  return m ? Number(m[1]) : null;
};

/**
 * @param {Array} pool  buildItemPool() rows
 * @returns {{changed:number, rising:number, falling:number,
 *            topRising:Array<{item, pct}>, topFalling:Array<{item, pct}>}|null}
 *          null when nothing moved (or the feed is missing), so the card hides.
 */
export const buildMarketSnapshot = (pool) => {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const moved = [];
  for (const item of pool) {
    if (!item || String(item.category).toLowerCase() === 'sets') continue;
    const change = Number(item.change);
    if (item.change == null || !Number.isFinite(change) || change === 0) continue;
    moved.push({ item, change, pct: parsePct(item.changePct) });
  }
  if (moved.length === 0) return null;

  const up = moved.filter((m) => m.change > 0);
  const down = moved.filter((m) => m.change < 0);
  // Only rows with a percent can be shown in the columns.
  const shown = (list) => list.filter((m) => m.pct != null && m.pct !== 0);
  const pick = (list) => list.slice(0, TOP).map(({ item, pct }) => ({ item, pct }));

  return {
    changed: moved.length,
    rising: up.length,
    falling: down.length,
    topRising: pick(shown(up).sort((a, b) => b.change - a.change || b.pct - a.pct)),
    topFalling: pick(shown(down).sort((a, b) => a.change - b.change || a.pct - b.pct)),
  };
};

/** "+4.8%" / "−10%" with a real minus sign; one decimal, trailing .0 dropped. */
export const formatPct = (pct) => {
  const n = Math.abs(pct);
  const body = n.toFixed(1).replace(/\.0$/, '');
  return `${pct > 0 ? '+' : '−'}${body}%`;
};
