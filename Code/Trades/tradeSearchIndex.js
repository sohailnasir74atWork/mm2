/**
 * tradeSearchIndex.js — the search tokens stored on every trade document.
 *
 * 📅 2026-09-06. Trade search was querying `hasItemNames` / `wantsItemNames`
 * with `array-contains`, but NOTHING in the app has ever written those fields.
 * Verified against production: not one document in `trades_new` has them, so
 * every search returned zero results, always. Both catch blocks logged and
 * carried on, so it looked like "no trades matched" rather than a bug.
 *
 * Why an array of tokens rather than the item names:
 *   `array-contains` matches an element EXACTLY. Storing only full names means
 *   "knife" cannot find "Flowerwood Knife". Storing each word as its own
 *   element makes word-level search work with one index and one query.
 *
 * Known limit: this gives whole-word matching, not prefix matching. "kni" will
 * not find "Knife". Firestore cannot do substring search without a separate
 * search service, and the alternative — downloading trades and filtering on
 * the device — is what the indexed query replaced. The screen also matches
 * already-loaded trades locally, which covers most short partial queries
 * without a single extra read.
 */

// Firestore creates one index entry per array element. Thirty is far below any
// limit and is more tokens than a 20-item trade can realistically need.
const MAX_TOKENS = 30;

/** Normalise one item name the same way the query normalises the search term. */
export const normalizeSearchTerm = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Build the token array for one side of a trade.
 *
 * @param {Array} items  hasItems or wantsItems — objects with a `name`
 * @returns {string[]}   lowercase full names plus their individual words
 */
export const buildSearchTokens = (items) => {
  if (!Array.isArray(items)) return [];

  const tokens = new Set();

  for (const item of items) {
    const full = normalizeSearchTerm(item?.name || item?.Name);
    if (!full) continue;

    tokens.add(full);

    // Individual words, so "knife" finds "Flowerwood Knife".
    // Single characters are dropped: they match almost everything and cost an
    // index entry each.
    for (const word of full.split(/[^a-z0-9]+/)) {
      if (word.length >= 2) tokens.add(word);
    }

    if (tokens.size >= MAX_TOKENS) break;
  }

  return Array.from(tokens).slice(0, MAX_TOKENS);
};

/**
 * Does an already-loaded trade match this search term?
 *
 * Used for the instant local pass over trades that are already in memory, so
 * the list responds before the network answers and partial words still find
 * something. Costs no reads. Falls back to reading the item arrays directly,
 * which means it also works on the older documents that have no tokens yet.
 */
export const tradeMatchesLocally = (trade, term, { searchInHas, searchInWants }) => {
  const needle = normalizeSearchTerm(term);
  if (!needle) return false;

  const sides = [];
  if (searchInHas) sides.push(trade?.hasItems);
  if (searchInWants) sides.push(trade?.wantsItems);

  for (const items of sides) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (normalizeSearchTerm(item?.name || item?.Name).includes(needle)) return true;
    }
  }
  return false;
};
