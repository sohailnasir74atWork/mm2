/**
 * matchCore.js — Trade Match matching rules, pure (no React Native, no
 * Firebase), so functions/test/tradeMatch.test.js can run them under Node.
 *
 * The app reads the RTDB inverted index (functions/tradeMatchCore.js) item by
 * item and ranks the players it finds here, the way Adopt Me's SQL did
 * (supabase/032 find_trade_matches, 053 find_pet_wanters):
 *
 *   Have what I want   players who list For Trade an item on my wishlist.
 *                      dream = they have my dream item; full ("perfect") =
 *                      they also want an item I list For Trade.
 *   Want my items      players whose wishlist has an item I list For Trade.
 *                      dream = one of my items is THEIR dream; full = they
 *                      list something I want.
 *   Order: dream, then perfect, then most items in common, then the most
 *   recently updated lists; after the profiles load, the most recently
 *   active player wins ties (Adopt Me orders by last activity too).
 *
 * Item keys and the For Trade default MUST match functions/tradeMatchCore.js
 * (the test checks): missing availableForTrade = listed.
 */

const MAX_ITEMS = 150;
const KEY_RE = /^[a-z0-9]{1,60}$/;

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

const itemKey = (item) => {
  if (!item || typeof item !== 'object') return null;
  const k = normalizeName(item.name || item.Name).slice(0, 60);
  return KEY_RE.test(k) ? k : null;
};

/** For Trade / Looking for unless switched to Private (missing = listed). */
const isListed = (item) => !!item && typeof item === 'object' && item.availableForTrade !== false;

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

/** My public lists: the same rule the index function applies to everyone. */
const buildLists = (ownedPets, wishlistPets, dreamKey) => {
  const wishKeys = new Set(uniqueKeys(wishlistPets, () => true));
  const dream = okKey(dreamKey) && wishKeys.has(dreamKey) ? dreamKey : null;
  const have = uniqueKeys(ownedPets, isListed);
  const want = uniqueKeys(wishlistPets, (it) => isListed(it) || (dream && itemKey(it) === dream));
  return { have, want, dream };
};

/**
 * The keys to query, capped (each key is one small RTDB query). The dream
 * goes first; `rank` (optional, key -> number) puts the most valuable first.
 */
const queryKeys = (keys, max, first, rank) => {
  const list = [...keys];
  if (typeof rank === 'function') list.sort((a, b) => (rank(b) || 0) - (rank(a) || 0));
  if (first && list.includes(first)) {
    list.splice(list.indexOf(first), 1);
    list.unshift(first);
  }
  return list.slice(0, max);
};

/**
 * [[itemKey, {uid: ms}], ...] (one per query) -> Map uid -> {keys, ts}.
 * `skip` holds uids to leave out (me, blocked players).
 */
const collectHits = (results, skip) => {
  const hits = new Map();
  for (const [key, entries] of Array.isArray(results) ? results : []) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [uid, raw] of Object.entries(entries)) {
      if (skip && skip.has(uid)) continue;
      const ts = Number(raw) || 0;
      const h = hits.get(uid) || { keys: [], ts: 0 };
      if (!h.keys.includes(key)) h.keys.push(key);
      if (ts > h.ts) h.ts = ts;
      hits.set(uid, h);
    }
  }
  return hits;
};

const byRank = (a, b) => (
  (b.dream - a.dream)
  || (b.full - a.full)
  || ((b.gives.length + b.wants.length) - (a.gives.length + a.wants.length))
  || (b.ts - a.ts)
  || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
);

/**
 * Have what I want. haveHits: players found under have/{my want keys};
 * wantHits: players found under want/{my have keys}.
 * -> [{uid, gives: [my wanted keys they have, dream first], wants: [my keys
 *     they want], dream, full, ts}]
 */
const rankMatches = ({ dream, haveHits, wantHits, limit }) => {
  const out = [];
  for (const [uid, h] of haveHits) {
    const w = wantHits.get(uid);
    const gives = [...h.keys];
    if (dream && gives.includes(dream)) {
      gives.splice(gives.indexOf(dream), 1);
      gives.unshift(dream);
    }
    out.push({
      uid,
      gives,
      wants: w ? [...w.keys] : [],
      dream: dream && h.keys.includes(dream) ? 1 : 0,
      full: w ? 1 : 0,
      ts: Math.max(h.ts, w ? w.ts : 0),
    });
  }
  return out.sort(byRank).slice(0, limit || 50);
};

/**
 * Want my items. wantHits: players found under want/{my have keys};
 * dreamHits: under dream/{my have keys}; haveHits: under have/{my want keys}.
 * -> [{uid, wants: [my keys they want, their dream first], dreamKey, dream,
 *     full, gives: [my wanted keys they list], ts}]
 */
const rankWanters = ({ wantHits, dreamHits, haveHits, limit }) => {
  const out = [];
  for (const [uid, w] of wantHits) {
    const d = dreamHits && dreamHits.get(uid);
    const dreamKey = d && d.keys.length ? d.keys[0] : null;
    const wants = [...w.keys];
    if (dreamKey && wants.includes(dreamKey)) {
      wants.splice(wants.indexOf(dreamKey), 1);
      wants.unshift(dreamKey);
    } else if (dreamKey) {
      wants.unshift(dreamKey);
    }
    const h = haveHits && haveHits.get(uid);
    out.push({
      uid,
      wants,
      dreamKey,
      dream: dreamKey ? 1 : 0,
      full: h ? 1 : 0,
      gives: h ? [...h.keys] : [],
      ts: Math.max(w.ts, d ? d.ts : 0),
    });
  }
  return out.sort(byRank).slice(0, limit || 50);
};

/**
 * After the profiles load: drop players idle longer than `maxIdleMs` (when
 * their last activity is known) and order ties by last activity.
 * meta: Map uid -> { lastActiveMs }.
 */
const applyActivity = (list, meta, now, maxIdleMs, limit) => {
  const kept = list.filter((m) => {
    const last = meta.get(m.uid)?.lastActiveMs || 0;
    return !last || now - last <= maxIdleMs;
  });
  const lastOf = (m) => meta.get(m.uid)?.lastActiveMs || 0;
  return kept
    .sort((a, b) => (b.dream - a.dream) || (b.full - a.full) || (lastOf(b) - lastOf(a)) || byRank(a, b))
    .slice(0, limit);
};

/**
 * What a wanter could give: everything they list For Trade (from their
 * summary), the items I want first, each marked w, at most `max`.
 */
const wanterGives = (theirHave, myWant, max) => {
  const all = Array.isArray(theirHave) ? theirHave.filter(okKey) : [];
  const wanted = all.filter((k) => myWant.has(k));
  const rest = all.filter((k) => !myWant.has(k));
  const list = [...wanted, ...rest].slice(0, max || 12).map((k) => ({ k, w: myWant.has(k) }));
  return { gives: list, count: all.length };
};

/** "a,b,c" summary strings -> keys. */
const splitKeys = (s) => (typeof s === 'string' && s ? s.split(',').filter(okKey) : []);

/** trade_index/stats -> { traders, found7d } (day buckets are UTC YYYYMMDD). */
const readStats = (val, now) => {
  const v = val && typeof val === 'object' ? val : {};
  const from = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  let found7d = 0;
  for (const [day, n] of Object.entries(v.found || {})) if (day >= from) found7d += Number(n) || 0;
  return { traders: Number(v.traders) || 0, found7d };
};

module.exports = {
  MAX_ITEMS,
  normalizeName,
  itemKey,
  isListed,
  okKey,
  buildLists,
  queryKeys,
  collectHits,
  rankMatches,
  rankWanters,
  applyActivity,
  wanterGives,
  splitKeys,
  readStats,
  _NAME_ALIASES: NAME_ALIASES,
};
