/**
 * tradeMatch.js — Trade Match ("get your dream item") client helpers.
 *
 * Port of Adopt Me's Code/Helper/tradeMatch.js. Adopt Me synced each
 * player's lists to Supabase and asked SQL for matches; MM2 is Firebase-only,
 * so:
 *   - nothing is synced from the phone: functions/tradeMatch.js
 *     (tradeMatchIndex) mirrors Firestore reviews/{uid}.ownedPets /
 *     .wishlistPets, which every build already saves, into the RTDB index
 *       trade_index/have|want|dream/{itemKey}/{uid} = last update (ms);
 *   - the phone matches by reading that index ONE ITEM AT A TIME: for each
 *     item on my wishlist, the 20 most recently active players who list it
 *     For Trade (have/), and for each item I list, the 20 who want it
 *     (want/, and dream/ for "it's their dream"). Matching rules and ranking:
 *     Code/TradeMatch/matchCore.js.
 *
 * Cost rules (the reason for the shape):
 *   - at most 30 + 30 small queries per open, 20 rows each; the rules only
 *     allow orderByValue + limitToLast <= 25 on these nodes, so a whole
 *     popular item can never be downloaded;
 *   - results cached on the phone for 10 minutes per list signature,
 *     stats for 1 hour; the "Want my items" queries run only when that tab
 *     opens;
 *   - profiles (name, avatar, last active) are read only for the ~40 players
 *     that make the cut, a handful of leaves each;
 *   - once a week while the screen is used, `tradeMatchSeenAt` is stamped on
 *     reviews/{uid} so an active player's entries stay fresh (Adopt Me's
 *     weekly re-sync). Old builds never stamp it: their entries carry the
 *     time their lists last changed.
 *
 * Everything is keyed by uid, never by device: callers pass lists they just
 * read for a known uid (MMKV `ownedPets` is per device).
 */

import { ref, get, set, query, orderByValue, limitToLast } from '@react-native-firebase/database';
import { doc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import {
  buildLists, queryKeys, collectHits, rankMatches, rankWanters, applyActivity,
  wanterGives, splitKeys, readStats, itemKey,
} from '../TradeMatch/matchCore';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'trade-match' });
} catch (e) {
  const mem = new Map();
  storage = {
    getString: (k) => mem.get(k),
    getNumber: (k) => mem.get(k),
    getBoolean: (k) => mem.get(k),
    set: (k, v) => mem.set(k, v),
    remove: (k) => mem.delete(k),
  };
}

export const PER_KEY = 20;            // rows per item query (rules allow <= 25)
export const MAX_QUERY_KEYS = 30;     // items queried per direction
export const LIST_LIMIT = 30;         // players shown per tab
const CANDIDATES = 40;                // players whose profiles are read
const MATCHES_TTL_MS = 10 * 60 * 1000;
const STATS_TTL_MS = 60 * 60 * 1000;
const TOUCH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IDLE_MS = 45 * 24 * 60 * 60 * 1000;
const LANGS = ['en', 'pt', 'es', 'es-ES', 'fr', 'de', 'ru', 'ja', 'ar'];

export { buildLists, itemKey };

// ── Small utilities ──────────────────────────────────────────────────────

// FNV-1a — only used to tell list versions apart in the cache.
/* eslint-disable no-bitwise */
const hashString = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};
/* eslint-enable no-bitwise */

const readCache = (key, ttl, sig) => {
  try {
    const raw = storage.getString(key);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (sig !== undefined && c.sig !== sig) return null;
    return Date.now() - c.at < ttl ? c.data : null;
  } catch (e) {
    return null;
  }
};
const writeCache = (key, data, sig) => {
  try { storage.set(key, JSON.stringify({ at: Date.now(), sig, data })); } catch (e) { /* full disk: skip */ }
};

export const langOf = (lang) => (LANGS.includes(lang) ? lang : 'en');

// ── Per-uid dream (Firestore reviews/{uid}.dreamItemKey is the truth) ─────

export const getDreamKey = (uid) => (uid ? storage.getString(`dream_${uid}`) || null : null);

export const setDreamKeyLocal = (uid, key) => {
  if (!uid) return;
  if (key) storage.set(`dream_${uid}`, key);
  else storage.remove(`dream_${uid}`);
};

/** Save the dream on the player's own document (merge, additive field). */
export const saveDreamKey = async (firestoreDB, uid, key, lang) => {
  await setDoc(doc(firestoreDB, 'reviews', uid), {
    dreamItemKey: key || null,
    tradeMatchLang: langOf(lang),
  }, { merge: true });
  setDreamKeyLocal(uid, key);
  invalidateTradeMatch(uid);
};

/**
 * Weekly while Trade Match is in use: stamp the document so the index
 * function rewrites this player's entries with a fresh time (old builds and
 * idle players sink in everyone's results instead). Only for players who
 * list something.
 */
export const touchTradeMatch = (firestoreDB, uid, lists, lang) => {
  if (!uid || !firestoreDB || !lists) return;
  if (!lists.have.length && !lists.want.length) return;
  const last = storage.getNumber(`touch_${uid}`) || 0;
  if (Date.now() - last < TOUCH_EVERY_MS) return;
  storage.set(`touch_${uid}`, Date.now());
  setDoc(doc(firestoreDB, 'reviews', uid), {
    tradeMatchSeenAt: serverTimestamp(),
    tradeMatchLang: langOf(lang),
  }, { merge: true }).catch((e) => {
    storage.remove(`touch_${uid}`);
    console.warn('[tradeMatch] touch failed:', e?.message);
  });
};

// ── Alerts opt-out (users/{uid}/notificationSettings, absent = on) ────────

export const getAlertsEnabled = async (db, uid) => {
  if (!db || !uid) return true;
  try {
    const snap = await get(ref(db, `users/${uid}/notificationSettings/tradeMatchAlerts`));
    return snap.val() !== false;
  } catch (e) {
    return true;
  }
};

export const setAlertsEnabled = (db, uid, on) =>
  set(ref(db, `users/${uid}/notificationSettings/tradeMatchAlerts`), !!on);

// ── Index reads ──────────────────────────────────────────────────────────

const readFamily = (db, family, keys) => Promise.all(keys.map(async (k) => {
  try {
    const snap = await get(query(ref(db, `trade_index/${family}/${k}`), orderByValue(), limitToLast(PER_KEY)));
    return [k, snap.val() || {}];
  } catch (e) {
    // One unreadable item must not sink the screen (rules not yet deployed
    // reads as an empty item).
    return [k, {}];
  }
}));

const lastActiveMs = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

/** Name, avatar and activity for a few players (leaf reads, never users/{uid}). */
const readProfiles = (db, uids) => Promise.all(uids.map(async (uid) => {
  const leaf = (k) => get(ref(db, `users/${uid}/${k}`)).then((s) => s.val()).catch(() => null);
  const [displayName, avatar, isPro, lastActivity, verified] = await Promise.all([
    leaf('displayName'), leaf('avatar'), leaf('isPro'), leaf('lastActivity'), leaf('robloxUsernameVerified'),
  ]);
  return [uid, {
    name: typeof displayName === 'string' ? displayName : '',
    avatar: typeof avatar === 'string' ? avatar : null,
    isPro: isPro === true,
    verified: verified === true,
    lastActiveMs: lastActiveMs(lastActivity),
  }];
}));

const withProfiles = async (db, ranked) => {
  const top = ranked.slice(0, CANDIDATES);
  const meta = new Map(await readProfiles(db, top.map((m) => m.uid)));
  return applyActivity(top, meta, Date.now(), MAX_IDLE_MS, LIST_LIMIT)
    .map((m) => ({ ...m, ...(meta.get(m.uid) || {}) }));
};

const skipSet = (uid, blocked) => new Set([uid, ...(Array.isArray(blocked) ? blocked : [])]);

/**
 * Players who have what I want.
 * lists: buildLists(...) of MY lists; rank: optional key -> value.
 */
export const fetchTradeMatches = async (db, uid, lists, opts) => {
  const { blocked, rank, force } = opts || {};
  if (!db || !uid || !lists || !lists.want.length) return [];
  const wantQ = queryKeys(lists.want, MAX_QUERY_KEYS, lists.dream, rank);
  const haveQ = queryKeys(lists.have, MAX_QUERY_KEYS, null, rank);
  const sig = hashString(JSON.stringify([wantQ, haveQ, lists.dream, blocked || []]));
  if (!force) {
    const cached = readCache(`matches_${uid}`, MATCHES_TTL_MS, sig);
    if (cached) return cached;
  }
  const skip = skipSet(uid, blocked);
  const [haveRes, wantRes] = await Promise.all([readFamily(db, 'have', wantQ), readFamily(db, 'want', haveQ)]);
  const ranked = rankMatches({
    dream: lists.dream,
    haveHits: collectHits(haveRes, skip),
    wantHits: collectHits(wantRes, skip),
    limit: CANDIDATES,
  });
  const list = await withProfiles(db, ranked);
  writeCache(`matches_${uid}`, list, sig);
  return list;
};

/** Players who want items I list For Trade, their dream first. */
export const fetchItemWanters = async (db, uid, lists, opts) => {
  const { blocked, rank, force } = opts || {};
  if (!db || !uid || !lists || !lists.have.length) return [];
  const haveQ = queryKeys(lists.have, MAX_QUERY_KEYS, null, rank);
  const wantQ = queryKeys(lists.want, MAX_QUERY_KEYS, lists.dream, rank);
  const sig = hashString(JSON.stringify([haveQ, wantQ, blocked || []]));
  if (!force) {
    const cached = readCache(`wanters_${uid}`, MATCHES_TTL_MS, sig);
    if (cached) return cached;
  }
  const skip = skipSet(uid, blocked);
  const [wantRes, dreamRes, haveRes] = await Promise.all([
    readFamily(db, 'want', haveQ),
    readFamily(db, 'dream', haveQ),
    wantQ.length ? readFamily(db, 'have', wantQ) : Promise.resolve([]),
  ]);
  const ranked = rankWanters({
    wantHits: collectHits(wantRes, skip),
    dreamHits: collectHits(dreamRes, skip),
    haveHits: collectHits(haveRes, skip),
    limit: CANDIDATES,
  });
  const list = await withProfiles(db, ranked);
  // What each could give: their whole For Trade list (one leaf each).
  const myWant = new Set(lists.want);
  const withGives = await Promise.all(list.map(async (m) => {
    let theirs = m.gives;
    try {
      const snap = await get(ref(db, `trade_index/user/${m.uid}/h`));
      const all = splitKeys(snap.val());
      if (all.length) theirs = all;
    } catch (e) { /* keep the ones we know */ }
    const { gives, count } = wanterGives(theirs, myWant, 12);
    return { ...m, gives, givesCount: count };
  }));
  writeCache(`wanters_${uid}`, withGives, sig);
  return withGives;
};

export const fetchTradeMatchStats = async (db, opts) => {
  if (!(opts && opts.force)) {
    const cached = readCache('stats', STATS_TTL_MS);
    if (cached) return cached;
  }
  const snap = await get(ref(db, 'trade_index/stats'));
  const stats = readStats(snap.val(), Date.now());
  writeCache('stats', stats);
  return stats;
};

/** Lists changed (My Stuff, a dream, "I got it!"): both tabs are stale. */
export const invalidateTradeMatch = (uid) => {
  if (!uid) return;
  storage.remove(`matches_${uid}`);
  storage.remove(`wanters_${uid}`);
};
