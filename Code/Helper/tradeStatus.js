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
