/**
 * tradeHelpers.js — saved (bookmarked) trades
 *
 * A saved trade is a lightweight pointer in RTDB at savedTrades/<uid>/<tradeId>.
 * The trade body itself stays in Firestore (trades_new) — we only store enough
 * to render a placeholder and to know the trade is saved. Reading the Saved tab
 * fans the ids back out to Firestore; trades the owner deleted are skipped.
 *
 * Capped at MAX_SAVED so the node stays small and the fan-out stays cheap.
 */
import { ref, set, remove, get, serverTimestamp as rtdbTimestamp } from '@react-native-firebase/database';

export const MAX_SAVED = 10;

const countSaved = async (appdatabase, myUid) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (!snap.exists()) return 0;
    return Object.keys(snap.val() || {}).length;
  } catch {
    return 0;
  }
};

/**
 * Bookmark a trade. Throws with a user-facing message when the cap is hit —
 * callers surface e.message directly in the error toast.
 *
 * @param {number} [knownCount] how many trades the caller already knows are
 *   saved. The feed holds this in state, so passing it skips a redundant read
 *   of the whole savedTrades node on every save.
 */
export const saveTrade = async (appdatabase, myUid, trade, knownCount) => {
  const tradeId = trade?.id;
  if (!appdatabase || !myUid || !tradeId) throw new Error('Could not save this trade.');

  const count = Number.isInteger(knownCount)
    ? knownCount
    : await countSaved(appdatabase, myUid);
  if (count >= MAX_SAVED) {
    throw new Error(`You can only save ${MAX_SAVED} trades at a time. Remove some first.`);
  }

  await set(ref(appdatabase, `savedTrades/${myUid}/${tradeId}`), {
    type: 'saved',
    traderId: trade.userId || '',
    traderName: trade.traderName || 'Unknown',
    traderRobloxUsername: trade.robloxUsername || '',
    savedAt: rtdbTimestamp(),
  });
};

export const unsaveTrade = async (appdatabase, myUid, tradeId) => {
  if (!appdatabase || !myUid || !tradeId) return;
  await remove(ref(appdatabase, `savedTrades/${myUid}/${tradeId}`));
};

/**
 * @returns {Promise<Object>} { [tradeId]: { type, traderId, traderName, ... } }
 *
 * Keys are normalised on the way out. Until 2026-09-06 the feed gave featured
 * trades a synthetic `featured-<docId>` id, so saving one wrote that string
 * here — and the Saved tab then looked up trades_new/featured-<docId>, which
 * does not exist. The trade looked saved and never appeared again. Stripping
 * the prefix on read repairs those rows without a migration.
 */
export const fetchSavedTradeRefs = async (appdatabase, myUid) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (!snap.exists()) return {};

    const raw = snap.val() || {};
    const normalised = {};
    for (const [key, value] of Object.entries(raw)) {
      const id = key.startsWith('featured-') ? key.slice('featured-'.length) : key;
      // If both the prefixed and clean key exist, keep the clean one.
      if (!normalised[id] || key === id) normalised[id] = value;
    }
    return normalised;
  } catch (e) {
    console.warn('[tradeHelpers] Failed to fetch saved trades:', e?.message);
    return {};
  }
};

/**
 * Remove a legacy `featured-<docId>` pointer. The feed calls this after it
 * successfully renders the same trade under its real id, so the stale row does
 * not keep occupying one of the MAX_SAVED slots.
 */
export const cleanupLegacySavedKey = async (appdatabase, myUid, tradeId) => {
  if (!appdatabase || !myUid || !tradeId) return;
  try {
    await remove(ref(appdatabase, `savedTrades/${myUid}/featured-${tradeId}`));
  } catch {
    // best effort — the pointer is harmless, just untidy
  }
};
