/**
 * profileCache.js
 * MMKV-based profile cache for user display data.
 *
 * Purpose: Reduce RTDB bandwidth by caching sender profiles locally.
 * When rendering chat messages, avatar/isPro/badges come from this cache
 * instead of being embedded in every message payload.
 *
 * Source of truth: RTDB `users/{uid}` — one record, read once, cached twice:
 *   - `full_<uid>`  the raw record          (getOrFetchFullProfile)
 *   - `p_<uid>`     the slim render subset  (getCachedProfile)
 * Both entries share a 6-hour TTL and are cleared together by
 * invalidateFullProfile(uid), which every role/profile write calls.
 *
 * ⚠️ BACKWARDS COMPATIBLE:
 *   - Old messages still carry avatar/isPro/sender fields → used first
 *   - New slim messages miss these fields → cache fills them in
 *   - If the cache misses too → sensible defaults (no crash)
 *
 * 📅 2026-09-05: collapsed 16 RTDB reads per profile into 1. See the comment
 *    above fetchUserRecord, and PLAN_2026-09.md F1 for the measurements.
 */


import { ref, get } from '@react-native-firebase/database';
// MM2 is Firebase-only. Every profile field lives in one RTDB record at
// users/{uid}, so this file reads that record ONCE and picks the fields off
// it — see fetchUserRecord below.

let cache;
try {
  const { createMMKV } = require('react-native-mmkv');
  cache = createMMKV({ id: 'profile-cache' });
} catch (e) {
  console.warn('[profileCache] MMKV not available:', e.message);
  cache = {
    getString: () => undefined,
    set: () => {},
    remove: () => {},
  };
}
// 6 hours. Was 30 minutes, which is what a Supabase-backed build needed to
// pick up mirror lag. Nothing here drifts on its own: display name, avatar,
// role flags and cosmetics only change through a write that also calls
// invalidateFullProfile(uid), which clears BOTH cache keys for that user.
const TTL = 6 * 60 * 60 * 1000;

// ── Negative cache ──
// uids with no users/{uid} record at all. In-memory only (see the comment at
// the markProfileMiss call site for why this must not go in MMKV). Short TTL
// so a genuinely new account starts resolving soon after it is created.
const MISS_TTL = 5 * 60 * 1000; // 5 minutes
const profileMisses = new Map(); // uid -> timestamp

const markProfileMiss = (uid) => {
  if (uid) profileMisses.set(uid, Date.now());
};

/** True when this uid was recently confirmed to have no profile record. */
export const isRecentProfileMiss = (uid) => {
  const t = profileMisses.get(uid);
  if (!t) return false;
  if (Date.now() - t >= MISS_TTL) {
    profileMisses.delete(uid);
    return false;
  }
  return true;
};

// ────────────────────────────────────────────────────────
//  READ from cache (synchronous — safe in render)
// ────────────────────────────────────────────────────────
export const getCachedProfile = (uid) => {
  if (!uid) return null;
  try {
    const raw = cache.getString(`p_${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) {
      cache.remove(`p_${uid}`);
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  WRITE to cache
// ────────────────────────────────────────────────────────
export const setCachedProfile = (uid, data) => {
  if (!uid || !data) return;
  try {
    cache.set(`p_${uid}`, JSON.stringify({ d: data, t: Date.now() }));
  } catch {
    // Silently fail — cache is optional
  }
};

// ────────────────────────────────────────────────────────
//  FETCH from RTDB only if not cached (async)
//  Call this in useEffect or outside render loop
// ────────────────────────────────────────────────────────
export const getOrFetchProfile = async (db, uid) => {
  if (!uid || !db) return null;
  const cached = getCachedProfile(uid);
  if (cached) return cached;
  const record = await fetchUserRecord(db, uid);
  return buildAndCacheProfile(uid, record);
};

// ────────────────────────────────────────────────────────
//  ONE read per user, shared with the full-record cache
// ────────────────────────────────────────────────────────
//
// 2026-09-05 (PLAN_2026-09.md F1). This used to issue 16 RTDB reads for a
// single profile: 3 leaves for game/shop state, then one leaf per field for
// every "missing Supabase row" — and in MM2 every Supabase row is missing by
// definition, because there is no Supabase. A 10-minute production profile
// showed those 13 leaves accounting for ~8,000 of 10,165 total database
// reads, i.e. 79% of ALL RTDB traffic came from this one function.
//
// users/{uid} is a single small record (~2.9 KB average across 81k users), so
// reading it whole costs about the same bytes as the leaves did and 1/16th of
// the operations. RTDB bills per byte, but two thirds of MM2's egress is
// per-operation overhead rather than payload, which is why the op count is
// the number that matters here.
//
// It routes through getOrFetchFullProfile so the drawer (which needs the raw
// record) and chat rendering (which needs the slim projection) share ONE
// read and ONE cache entry per user.
const fetchUserRecord = async (db, uid) => {
  try {
    return await getOrFetchFullProfile(db, uid);
  } catch (err) {
    console.warn('[profileCache] fetchUserRecord error:', err?.message);
    return null;
  }
};

// Pick the active cosmetic off a shop entry, honouring its expiry.
// expiresAt === -1 means permanent.
const activeCosmetic = (entry, now) =>
  entry && (entry.expiresAt === -1 || entry.expiresAt > now) ? entry : null;

// Build the slim render-time profile from a raw users/{uid} record and cache
// it. Pure apart from the cache write — no database access.
const buildAndCacheProfile = (uid, record) => {
  if (!record || typeof record !== 'object') {
    // Nothing at users/{uid} — deleted account, or a system sender. Record
    // the miss so callers (which filter on `!getCachedProfile(id)`) stop
    // re-fetching it on every pass. In-memory only: getCachedProfile is read
    // synchronously during render and every caller treats truthy as "usable
    // profile", so a persisted null-shaped record would blank names/avatars.
    markProfileMiss(uid);
    return null;
  }

  const now = Date.now();
  const shop = record.shop?.activeItems || null;
  const textColor = shop ? activeCosmetic(shop.chatTextColor, now) : null;

  const profile = {
    displayName: record.displayName || 'Anonymous',
    avatar: record.avatar || null,
    isPro: !!record.isPro,
    robloxUsernameVerified: !!record.robloxUsernameVerified,
    // Stored flag first; fall back to deriving it from the timestamp so a
    // stale hasRecentGameWin cannot keep a trophy lit past 24h.
    hasRecentGameWin: !!record.hasRecentGameWin || (
      typeof record.lastGameWinAt === 'number' &&
      now - record.lastGameWinAt <= 24 * 60 * 60 * 1000
    ),
    lastGameWinAt: record.lastGameWinAt || null,
    // RTDB stores the owner flag as `admin`; the app reads it as `isAdmin`.
    isAdmin: !!record.admin || !!record.isAdmin,
    isModerator: !!record.isModerator,
    isBabyMod: !!record.isBabyMod,
    isTrusted: !!record.isTrusted,
    isCMSR: !!record.isCMSR,
    isHelper: !!record.isHelper,
    chatTextColor: textColor?.color || null,
    profileFrame: shop ? activeCosmetic(shop.profileFrame, now) : null,
    tradeCardBg: shop ? activeCosmetic(shop.tradeCardBg, now) : null,
    chatBubbleBg: shop ? activeCosmetic(shop.chatBubbleBg, now) : null,
    topBadge: record.topBadge || null,
  };
  setCachedProfile(uid, profile);
  return profile;
};

// ────────────────────────────────────────────────────────
//  WARM CACHE — pre-fetch profiles for a batch of UIDs
//  Call this when loading messages to cache all senders
// ────────────────────────────────────────────────────────
export const warmProfileCache = async (db, uids) => {
  if (!db || !Array.isArray(uids) || uids.length === 0) return;

  // Skip uids already cached, and uids we know have no record — otherwise
  // the latter stay "uncached" forever and are re-fetched on every pass.
  const uncached = [...new Set(uids)].filter(
    (uid) => uid && !getCachedProfile(uid) && !isRecentProfileMiss(uid),
  );
  if (uncached.length === 0) return;

  // One read per user, 10 at a time. A fresh chat page with 15 unknown
  // senders is now 15 reads; before this it was 15 x 16 = 240.
  const WAVE = 10;
  for (let i = 0; i < uncached.length; i += WAVE) {
    const wave = uncached.slice(i, i + WAVE);
    const records = await Promise.allSettled(wave.map((uid) => fetchUserRecord(db, uid)));
    wave.forEach((uid, idx) => {
      const r = records[idx];
      buildAndCacheProfile(uid, r.status === 'fulfilled' ? r.value : null);
    });
  }
};

// ────────────────────────────────────────────────────────
//  SEED CACHE — populate from a message that already has
//  the data (old format messages). Zero RTDB cost.
// ────────────────────────────────────────────────────────
export const seedFromMessage = (msg) => {
  if (!msg?.senderId) return;

  // Only seed if we don't already have a cached version
  const existing = getCachedProfile(msg.senderId);
  if (existing) return;

  // Only seed if message actually has the data (old format)
  if (!msg.avatar && !msg.sender) return;

  setCachedProfile(msg.senderId, {
    displayName: msg.sender || 'Anonymous',
    avatar: msg.avatar || null,
    isPro: !!msg.isPro,
    robloxUsernameVerified: !!msg.robloxUsernameVerified,
    hasRecentGameWin: !!msg.hasRecentGameWin,
    lastGameWinAt: msg.lastGameWinAt || null,
    isAdmin: !!msg.isAdmin,
    isModerator: !!msg.isModerator,
    isBabyMod: !!msg.isBabyMod,
    isTrusted: !!msg.isTrusted,
    isCMSR: !!msg.isCMSR,
    isHelper: !!msg.isHelper,
    topBadge: msg.topBadge || null,
    profileFrame: msg.profileFrame || null,
    chatTextColor: msg.chatTextColor || null,
    chatBubbleBg: msg.chatBubbleBg || null,
  });
};

// ────────────────────────────────────────────────────────
//  RESOLVE — get value from message first, then cache, then default
//  This is the key "backwards compatible" resolver
// ────────────────────────────────────────────────────────
export const resolveProfile = (msg) => {
  if (!msg) return { displayName: 'Anonymous', avatar: null, isPro: false, robloxUsernameVerified: false, hasRecentGameWin: false, chatTextColor: null, profileFrame: null, tradeCardBg: null, chatBubbleBg: null, topBadge: null, isAdmin: false, isModerator: false, isBabyMod: false, isTrusted: false, isCMSR: false, isHelper: false };

  const cached = getCachedProfile(msg.senderId);

  return {
    displayName: msg.sender || cached?.displayName || 'Anonymous',
    avatar: msg.avatar || cached?.avatar || null,
    isPro: msg.isPro ?? cached?.isPro ?? false,
    robloxUsernameVerified: msg.robloxUsernameVerified ?? cached?.robloxUsernameVerified ?? false,
    hasRecentGameWin: msg.hasRecentGameWin ?? cached?.hasRecentGameWin ?? (
      typeof (msg.lastGameWinAt || cached?.lastGameWinAt) === 'number' &&
      Date.now() - (msg.lastGameWinAt || cached?.lastGameWinAt) <= 24 * 60 * 60 * 1000
    ),
    isAdmin: msg.isAdmin ?? cached?.isAdmin ?? false,
    isModerator: msg.isModerator ?? cached?.isModerator ?? false,
    isBabyMod: msg.isBabyMod ?? cached?.isBabyMod ?? false,
    isTrusted: msg.isTrusted ?? cached?.isTrusted ?? false,
    isCMSR: msg.isCMSR ?? cached?.isCMSR ?? false,
    isHelper: msg.isHelper ?? cached?.isHelper ?? false,
    chatTextColor: msg.chatTextColor ?? cached?.chatTextColor ?? null,
    profileFrame: msg.profileFrame ?? cached?.profileFrame ?? null,
    tradeCardBg: cached?.tradeCardBg ?? null,
    chatBubbleBg: msg.chatBubbleBg ?? cached?.chatBubbleBg ?? null,
    topBadge: msg.topBadge ?? cached?.topBadge ?? null,
  };
};

// ────────────────────────────────────────────────────────
//  FULL-RECORD CACHE — caches the raw /users/{uid} record
//  for screens (BottomDrawer, admin tools) that need many
//  user fields beyond the chat-render subset. Kept under a
//  separate key prefix so the chat profile cache is unaffected.
// ────────────────────────────────────────────────────────
const FULL_KEY = (uid) => `full_${uid}`;

export const getCachedFullProfile = (uid) => {
  if (!uid) return null;
  try {
    const raw = cache.getString(FULL_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) {
      cache.remove(FULL_KEY(uid));
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
};

export const setCachedFullProfile = (uid, record) => {
  if (!uid) return;
  try {
    cache.set(FULL_KEY(uid), JSON.stringify({ d: record || null, t: Date.now() }));
  } catch {
    // ignore — cache is optional
  }
};

// Short-lived optimistic overrides for role flags we JUST wrote. RTDB is
// consistent immediately, but the drawer re-reads through the cache we are
// about to clear, and a slow round-trip made a freshly-granted badge appear
// only on the next open. In-memory, 5-minute TTL, cleared naturally.
const ROLE_OVERRIDE_TTL = 5 * 60 * 1000;
const roleOverrides = new Map(); // uid -> { flags, t }

export const setRoleOverride = (uid, flags) => {
  if (!uid || !flags) return;
  const prev = roleOverrides.get(uid);
  const fresh = prev && Date.now() - prev.t < ROLE_OVERRIDE_TTL ? prev.flags : {};
  roleOverrides.set(uid, { flags: { ...fresh, ...flags }, t: Date.now() });
};

export const getRoleOverride = (uid) => {
  if (!uid) return null;
  const entry = roleOverrides.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.t > ROLE_OVERRIDE_TTL) { roleOverrides.delete(uid); return null; }
  return entry.flags;
};

export const invalidateFullProfile = (uid) => {
  if (!uid) return;
  // BOTH keys. They are two projections of the same record, so clearing only
  // the raw one left the chat rows and online list showing a removed role
  // badge for up to the full TTL.
  try { cache.remove(FULL_KEY(uid)); } catch {}
  try { cache.remove(`p_${uid}`); } catch {}
};

// Read the raw /users/{uid} once, cache it, return it. Returns null on missing.
export const getOrFetchFullProfile = async (db, uid) => {
  if (!uid || !db) return null;
  const cached = getCachedFullProfile(uid);
  if (cached !== null) return cached;
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const record = snap.exists() ? snap.val() : null;
    setCachedFullProfile(uid, record);
    return record;
  } catch (err) {
    console.warn('[profileCache] getOrFetchFullProfile error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  SEED CURRENT USER — call once on mount in chat screens
//  This ensures the user's OWN slim messages resolve correctly
// ────────────────────────────────────────────────────────
export const seedCurrentUser = async (user, localState, db) => {
  if (!user?.id) return;

  // Base profile (immediate, no Firebase read)
  const profile = {
    displayName: user.displayName || 'Anonymous',
    avatar: user.avatar || null,
    isPro: !!localState?.isPro,
    robloxUsernameVerified: !!user.robloxUsernameVerified,
    hasRecentGameWin: !!user.hasRecentGameWin || (user.lastGameWinAt && Date.now() - user.lastGameWinAt <= 24 * 60 * 60 * 1000) || false,
    lastGameWinAt: user.lastGameWinAt || null,
    isAdmin: !!user.isAdmin,
    isModerator: !!user.isModerator,
    isBabyMod: !!user.isBabyMod,
    isTrusted: !!user.isTrusted,
    isCMSR: !!user.isCMSR,
    isHelper: !!user.isHelper,
    topBadge: user.topBadge || null,
    chatTextColor: null,
    profileFrame: null,
    tradeCardBg: null,
    chatBubbleBg: null,
  };

  // Seed immediately with base data
  setCachedProfile(user.id, profile);

  // Then fetch avatar + cosmetics async (fire-and-forget)
  if (db) {
    try {
      // ✅ Fetch avatar from RTDB if missing from global state
      if (!profile.avatar) {
        const avatarSnap = await get(ref(db, `users/${user.id}/avatar`));
        if (avatarSnap.exists()) {
          profile.avatar = avatarSnap.val();
          // Re-seed immediately so messages pick up avatar
          setCachedProfile(user.id, profile);
        }
      }

      const snap = await get(ref(db, `users/${user.id}/shop/activeItems`));
      if (snap.exists()) {
        const items = snap.val();
        const now = Date.now();
        if (items.chatTextColor && (items.chatTextColor.expiresAt === -1 || items.chatTextColor.expiresAt > now)) {
          profile.chatTextColor = items.chatTextColor.color || null;
        }
        if (items.profileFrame && (items.profileFrame.expiresAt === -1 || items.profileFrame.expiresAt > now)) {
          profile.profileFrame = items.profileFrame;
        }
        if (items.tradeCardBg && (items.tradeCardBg.expiresAt === -1 || items.tradeCardBg.expiresAt > now)) {
          profile.tradeCardBg = items.tradeCardBg;
        }
        if (items.chatBubbleBg && (items.chatBubbleBg.expiresAt === -1 || items.chatBubbleBg.expiresAt > now)) {
          profile.chatBubbleBg = items.chatBubbleBg;
        }
        // Re-seed with cosmetics
        setCachedProfile(user.id, profile);
      }
    } catch (e) {
      // Silently fail — cosmetics are non-essential
    }
  }
};

