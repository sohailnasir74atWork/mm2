/**
 * userSearch.js — find users by display name, for the group member picker.
 *
 * Until now the picker (OnlineUsersList in 'select' mode) could only offer
 * people who happened to be online at that moment, because it reads
 * /presence where the value is true. If the person you wanted to add was not
 * online you simply could not add them.
 *
 * ── Why a prefix query and not substring search ───────────────────────────
 *
 * Realtime Database has no text search. What it does have, and what makes
 * this cheap, is that /users is ALREADY indexed on displayName
 * (database.rules.json: users/.indexOn includes 'displayName') and readable
 * by any signed-in user (users/.read = "auth != null"). So an indexed range
 * query needs no rules change, no new index, and no new infrastructure:
 *
 *   orderByChild('displayName').startAt(q).endAt(q + HIGH)
 *
 * HIGH is U+F8FF, a code point above any realistic name, so [q, q+HIGH]
 * is every string that starts with q. That is a PREFIX match: "Sha" finds
 * "Shadow", but "dow" does not. Substring search would mean downloading
 * every user and filtering client-side, and this database has hundreds of
 * thousands of user rows.
 *
 * ── Case ──────────────────────────────────────────────────────────────────
 *
 * RTDB range queries are byte-ordered, so they are case-sensitive, and there
 * is no lowercase mirror of displayName on the user records (grep: no
 * displayNameLower anywhere). Rather than require a backfill of every user
 * row, we fire the query for a few likely capitalisations of what was typed
 * and merge the results — two or three indexed, limited queries, which is
 * still far cheaper than a scan.
 *
 * The proper fix, if search becomes important, is to write a normalised
 * `displayNameLower` on every user record and index that instead. That needs
 * a one-off backfill of existing users plus a write on profile update, so it
 * is deliberately not done here.
 */

import { ref, query, orderByChild, startAt, endAt, limitToFirst, get } from '@react-native-firebase/database';

/** \uf8ff sorts above any realistic name, so [q, q+HIGH] is "starts with q". */
const HIGH = '\uf8ff';

const DEFAULT_LIMIT = 25;

/**
 * The capitalisations worth trying for a byte-ordered prefix query. Typing
 * "sha" should still find "Shadow", which is how names are almost always
 * stored, so the Capitalised form matters most.
 */
const caseVariants = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const capitalised = lower.charAt(0).toUpperCase() + lower.slice(1);
  const upper = trimmed.toUpperCase();
  // Set keeps this at 1-4 queries and drops duplicates when the input is
  // already in one of these forms.
  return [...new Set([trimmed, capitalised, lower, upper])];
};

/** Shaped to match the rows OnlineUsersList already renders. */
const toUser = (id, record) => ({
  id,
  displayName: record.displayName || 'Anonymous',
  avatar: record.avatar
    || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
  isPro: !!record.isPro,
  robloxUsernameVerified: !!record.robloxUsernameVerified,
  lastGameWinAt: record.lastGameWinAt ?? null,
  // RTDB stores the owner flag as `admin`; older rows used `isAdmin`.
  isAdmin: !!record.admin || !!record.isAdmin,
  isModerator: !!record.isModerator,
  isBabyMod: !!record.isBabyMod,
  isTrusted: !!record.isTrusted,
  isCMSR: !!record.isCMSR,
  isHelper: !!record.isHelper,
  OS: record.OS ?? null,
  isPlaying: !!record.isPlaying,
});

/**
 * Users whose displayName starts with `text`.
 *
 * @param appdatabase RTDB instance
 * @param text        what the user typed
 * @param options     { limit, excludeIds }
 * @returns {Promise<Array>} deduped, name-sorted; [] for a blank query
 */
export const searchUsersByName = async (appdatabase, text, options = {}) => {
  const { limit = DEFAULT_LIMIT, excludeIds = [] } = options;
  if (!appdatabase) return [];

  const variants = caseVariants(text || '');
  // One character matches a huge slice of the user table for no benefit, and
  // the picker debounces anyway — wait for something selective.
  if (!variants.length || variants[0].length < 2) return [];

  const skip = new Set(excludeIds.filter(Boolean));
  const found = new Map();

  const results = await Promise.allSettled(
    variants.map((v) =>
      get(query(
        ref(appdatabase, 'users'),
        orderByChild('displayName'),
        startAt(v),
        endAt(v + HIGH),
        limitToFirst(limit),
      )),
    ),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value.exists()) continue;
    result.value.forEach((child) => {
      const id = child.key;
      if (!id || skip.has(id) || found.has(id)) return false;
      const record = child.val();
      // A row with neither a name nor an avatar is a deleted account still
      // occupying a key — the same guard the online list uses.
      if (!record || (!record.displayName && !record.avatar)) return false;
      found.set(id, toUser(id, record));
      return false;
    });
  }

  return [...found.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
};

export default searchUsersByName;
