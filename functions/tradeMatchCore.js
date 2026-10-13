/**
 * tradeMatchCore.js — pure helpers for the Trade Match index (no Firebase).
 *
 * Firebase port of Adopt Me's Trade Match (adoptme-jan7 supabase/032 + 053).
 * Adopt Me kept one Postgres row per player and matched with GIN array
 * overlaps; MM2 has no SQL, so the same lists live in an inverted index in
 * the Realtime Database, one node per item, written ONLY by functions
 * (functions/tradeMatch.js) and read by the app (Code/Helper/tradeMatch.js):
 *
 *   trade_index/have/{itemKey}/{uid}  = ms   owned item listed For Trade
 *   trade_index/want/{itemKey}/{uid}  = ms   wishlist item "Looking for" (+ dream)
 *   trade_index/dream/{itemKey}/{uid} = ms   the one dream item
 *   trade_index/user/{uid}            = { h, w, d, t, v, l }   what is indexed
 *   trade_index/stats                 = { traders, found: { YYYYMMDD: n } }
 *
 * ms is when the lists were last written (the app touches them weekly while
 * Trade Match is in use), so `orderByValue().limitToLast(n)` returns the
 * most recently active players for an item.
 *
 * Source of the lists: Firestore reviews/{uid}.ownedPets / .wishlistPets,
 * which every MM2 build already writes. New fields are all additive:
 *   item.availableForTrade  false = Private. MISSING = listed (For Trade /
 *                           Looking for). Old builds have no switch, and
 *                           those lists are already public on the profile
 *                           sheet, so indexing them exposes nothing new.
 *                           (Adopt Me's default is the opposite, private
 *                           until marked; it shipped the switch before
 *                           Trade Match. MM2 never had it, so private-by-
 *                           default would leave the index empty for every
 *                           old build.)
 *   dreamItemKey            the dream item's key (must be on the wishlist)
 *   tradeMatchLang          push language, set by builds with the screen
 *   tradeMatchSeenAt        weekly touch from the screen (refreshes ms)
 *   dreamFoundAt / dreamFoundKey   "I got it!" (feeds stats.found)
 *
 * The item key is the app's own item identity: valueSources.normalizeName()
 * of the name (the calculator pool is keyed by it, so two catalogue rows
 * with one normalised name are already one item in the app). The copy below
 * must stay identical to Code/Helper/valueSources.js and
 * Code/TradeMatch/matchCore.js; functions/test/tradeMatch.test.js checks.
 */

const MAX_ITEMS = 150;
const KEY_RE = /^[a-z0-9]{1,60}$/;
const UID_RE = /^[A-Za-z0-9]{6,128}$/;
const LANGS = ['en', 'pt', 'es', 'es-ES', 'fr', 'de', 'ru', 'ja', 'ar'];

// ── Name normalisation (copy of Code/Helper/valueSources.js) ───────────────
const baseKey = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const applyNameRules = (name) =>
  String(name || '')
    .replace(/^c\.\s*/i, 'Chroma ')
    .replace(/vamp'?s\b/i, 'Vampires');

const NAME_ALIASES = new Map([
  ['Silver Hallows', 'Silver Hallow'],
  ['Bronze Hallows', 'Bronze Hallow'],
  ['Gold Hallows', 'Gold Hallow'],
  ['Red Hallows', 'Red Hallow'],
  ['Mystery Keys', 'Mystery Key'],
  ['Gold Travelers Axe', "Gold Traveler's"],
  ['Red Travelers Axe', "Red Traveler's"],
  ['Silver Travelers Axe', "Silver Traveler's"],
  ['Bronze Travelers Axe', "Bronze Traveler's"],
  ['Moonlight Gun', 'Moonlight'],
  ['Balloons Gun', 'Balloons'],
  ['Curse Knife', 'Cursed (Knife)'],
].map(([from, to]) => [baseKey(applyNameRules(from)), baseKey(applyNameRules(to))]));

const normalizeName = (name) => {
  const key = baseKey(applyNameRules(name));
  return NAME_ALIASES.get(key) || key;
};

/** Index key for a saved item, or null. */
const itemKey = (item) => {
  if (!item || typeof item !== 'object') return null;
  const k = normalizeName(item.name || item.Name).slice(0, 60);
  return KEY_RE.test(k) ? k : null;
};

/** Listed unless the player switched it to Private (missing = listed). */
const isListed = (item) => !!item && typeof item === 'object' && item.availableForTrade !== false;

const okUid = (uid) => typeof uid === 'string' && UID_RE.test(uid);
const okKey = (k) => typeof k === 'string' && KEY_RE.test(k);

const uniqueKeys = (items, pick) => {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (out.length >= MAX_ITEMS) break;
    if (!pick(item)) continue;
    const k = itemKey(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
};

/**
 * The public trade lists in a reviews/{uid} document.
 * have = owned items not Private; want = wishlist items not Private, plus the
 * dream (even when Private: picking it is the player saying "find this").
 * The dream counts only while it is on the wishlist.
 */
const buildLists = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  const dreamRaw = okKey(d.dreamItemKey) ? d.dreamItemKey : null;
  const wishKeys = new Set(uniqueKeys(d.wishlistPets, () => true));
  const dream = dreamRaw && wishKeys.has(dreamRaw) ? dreamRaw : null;
  const have = uniqueKeys(d.ownedPets, isListed);
  const want = uniqueKeys(d.wishlistPets, (it) => isListed(it) || (dream && itemKey(it) === dream));
  return { have, want, dream };
};

const langOf = (l) => (LANGS.includes(l) ? l : 'en');

/** Milliseconds from a Firestore Timestamp, a Date, a number or nothing. */
const ms = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
};

/**
 * Everything in a reviews document that the index depends on. Two documents
 * with the same signature produce the same index, so a trigger whose
 * before/after signatures match (a bio edit, a rating) does nothing at all.
 */
const signature = (data) => {
  const lists = buildLists(data);
  const d = data && typeof data === 'object' ? data : {};
  return JSON.stringify([
    lists.have, lists.want, lists.dream,
    langOf(d.tradeMatchLang),
    ms(d.tradeMatchSeenAt),
    ms(d.dreamFoundAt),
  ]);
};

// ── Summary node ───────────────────────────────────────────────────────────

const encodeSummary = (lists, meta) => ({
  h: lists.have.join(','),
  w: lists.want.join(','),
  d: lists.dream || null,
  t: meta.t,
  v: meta.v || 0,
  l: langOf(meta.l),
});

const splitKeys = (s) => (typeof s === 'string' && s ? s.split(',').filter(okKey) : []);

const decodeSummary = (val) => {
  if (!val || typeof val !== 'object') return null;
  return {
    have: splitKeys(val.h),
    want: splitKeys(val.w),
    dream: okKey(val.d) ? val.d : null,
    t: Number(val.t) || 0,
    v: Number(val.v) || 0,
    l: langOf(val.l),
  };
};

const isEmpty = (lists) => !lists.have.length && !lists.want.length && !lists.dream;

/**
 * The multi-path update (relative to trade_index/) that moves `uid` from
 * what is indexed (`old`, a decoded summary or null) to `lists`. Every
 * current entry is (re)written with `ts`, so a player who edits their
 * lists moves to the front for every item; entries that are gone are
 * removed. An empty result removes the summary too.
 */
const buildIndexUpdate = (uid, old, lists, meta) => {
  const ts = meta.t;
  const up = {};
  const prev = old || { have: [], want: [], dream: null };
  const newHave = new Set(lists.have);
  const newWant = new Set(lists.want);
  for (const k of prev.have) if (!newHave.has(k)) up[`have/${k}/${uid}`] = null;
  for (const k of prev.want) if (!newWant.has(k)) up[`want/${k}/${uid}`] = null;
  if (prev.dream && prev.dream !== lists.dream) up[`dream/${prev.dream}/${uid}`] = null;
  for (const k of lists.have) up[`have/${k}/${uid}`] = ts;
  for (const k of lists.want) up[`want/${k}/${uid}`] = ts;
  if (lists.dream) up[`dream/${lists.dream}/${uid}`] = ts;
  up[`user/${uid}`] = isEmpty(lists) ? null : encodeSummary(lists, meta);
  return up;
};

/** +1 when a player starts offering something, -1 when they stop. */
const traderDelta = (old, lists) =>
  (lists.have.length > 0 ? 1 : 0) - (old && old.have.length > 0 ? 1 : 0);

/** Keys in `after.have` that were not in `before.have` (for dream alerts). */
const newHaveKeys = (before, after) => {
  if (!after) return [];
  const had = new Set(before ? before.have : []);
  return after.have.filter((k) => !had.has(k));
};

/** UTC day bucket for stats.found. */
const dayKey = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

module.exports = {
  MAX_ITEMS,
  LANGS,
  normalizeName,
  itemKey,
  isListed,
  okUid,
  okKey,
  buildLists,
  langOf,
  ms,
  signature,
  encodeSummary,
  decodeSummary,
  buildIndexUpdate,
  traderDelta,
  newHaveKeys,
  dayKey,
  isEmpty,
  _NAME_ALIASES: NAME_ALIASES,
};
