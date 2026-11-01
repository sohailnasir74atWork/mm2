/**
 * tradeStatus.js — the one Win / Fair / Lose rule for every screen
 * (ported from Adopt Me, adoptme-jan7/Code/Helper/tradeStatus.js).
 *
 * Within 5% of the bigger side, either way, is FAIR. Before this the MM2
 * calculator called a trade FAIR only when both totals were exactly equal,
 * and the share card called every two-sided trade FAIR. Screens still show
 * the exact difference next to the word.
 *
 * give: what you hand over. get: what you receive.
 */

export const FAIR_BAND = 0.05;

// Signed gap as a fraction of the bigger side: + you get more, - you give more.
export const valueGap = (give, get) => {
  const g = Number(give) || 0;
  const r = Number(get) || 0;
  const big = Math.max(g, r);
  return big > 0 ? (r - g) / big : 0;
};

export const tradeStatus = (give, get) => {
  const gap = valueGap(give, get);
  if (gap > FAIR_BAND) return 'win';
  if (gap < -FAIR_BAND) return 'lose';
  return 'fair';
};

// The single letter stored as `status` on posted trades.
export const STATUS_LETTER = { win: 'w', lose: 'l', fair: 'f' };

/**
 * The calculator's verdict, or why it has none.
 *
 * give / get: { count, total, unpriced } — count is the filled slots,
 * total and unpriced come from summarizeItems (valueSources.js).
 * feedLoaded: the active catalogue is present on this device.
 *
 * Returns { status: 'win' | 'fair' | 'lose' | null, reason }:
 *   'empty'       nothing on either side
 *   'no_data'     the catalogue never loaded, so every item reads 0
 *   'incomplete'  something on a side has no price, or a side holding items
 *                 totals 0 because all of it is bundle-tier
 *
 * A word next to an unpriced item is the scam (2026-10-30 audit): Nik's
 * Scythe is "Priceless" on Supreme, so giving it away totalled 0 and read
 * WIN, and 0 vs 0 used to read WIN as well. A trade posted with status null
 * shows no badge in any reader (they all check `status &&`).
 */
export const calculatorVerdict = ({ give, get, feedLoaded }) => {
  if (!give.count && !get.count) return { status: null, reason: 'empty' };
  if (!feedLoaded) return { status: null, reason: 'no_data' };
  if (give.unpriced || get.unpriced) return { status: null, reason: 'incomplete' };
  if ((give.count && !give.total) || (get.count && !get.total)) {
    return { status: null, reason: 'incomplete' };
  }
  return { status: tradeStatus(give.total, get.total), reason: null };
};
