/**
 * xpUtils.js
 * XP & Level System — Universal progression for MM2 Values.
 *
 * Every action earns XP → XP determines level → levels unlock cosmetics.
 * Uses RTDB increment() for atomic, non-blocking writes.
 *
 * RTDB structure:
 *   users/{uid}/xp/total: 4520
 *   users/{uid}/xp/level: 12
 */

import { ref, increment, update, get } from '@react-native-firebase/database';

// ────────────────────────────────────────────────────────
//  LEVEL TABLE  (MM2-themed titles & unlocks)
// ────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1,  xp: 0,       title: 'Rookie',       emoji: '🔪' },
  { level: 2,  xp: 200,     title: 'Trainee',      emoji: '🗡️' },
  { level: 3,  xp: 500,     title: 'Apprentice',   emoji: '🌱' },
  { level: 5,  xp: 1200,    title: 'Scout',        emoji: '🔍',  unlock: 'greenName' },
  { level: 7,  xp: 2500,    title: 'Detective',    emoji: '🕵️' },
  { level: 10, xp: 5000,    title: 'Collector',    emoji: '🌟',  unlock: 'sparkle' },
  { level: 12, xp: 8000,    title: 'Veteran',      emoji: '🔥' },
  { level: 15, xp: 12000,   title: 'Trade Pro',    emoji: '💼',  unlock: 'tradeBorder' },
  { level: 18, xp: 18000,   title: 'Expert',       emoji: '💎' },
  { level: 20, xp: 25000,   title: 'Sheriff',      emoji: '⭐',  unlock: 'animatedFrame' },
  { level: 23, xp: 35000,   title: 'Master',       emoji: '🏆' },
  { level: 25, xp: 50000,   title: 'Godly',        emoji: '👑',  unlock: 'rainbowName' },
  { level: 28, xp: 75000,   title: 'Ancient',      emoji: '🦅' },
  { level: 30, xp: 100000,  title: 'Mythic',       emoji: '🌀',  unlock: 'holographic' },
];

// ────────────────────────────────────────────────────────
//  XP ACTIONS & AMOUNTS
// ────────────────────────────────────────────────────────
export const XP_ACTIONS = {
  DAILY_LOGIN:       50,
  COMPLETE_TRADE:    25,
  CREATE_POST:       20,
  LEAVE_REVIEW:      30,
  CORRECT_QUIZ:      10,
  WIN_MEMORY_GAME:   50,
  UPDATE_INVENTORY:  10,
  STREAK_7_DAY:      200,
  POST_STATUS:       15,
};

// ────────────────────────────────────────────────────────
//  GET LEVEL FROM XP
// ────────────────────────────────────────────────────────
export const getLevelFromXP = (xp) => {
  if (!xp || xp < 0) return LEVELS[0];
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xp) current = lvl;
    else break;
  }
  return current;
};

// ────────────────────────────────────────────────────────
//  GET NEXT LEVEL INFO (for progress bar)
// ────────────────────────────────────────────────────────
export const getNextLevel = (xp) => {
  if (!xp || xp < 0) return LEVELS[1] || LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp < lvl.xp) return lvl;
  }
  return LEVELS[LEVELS.length - 1]; // Max level
};

// ────────────────────────────────────────────────────────
//  GET XP PROGRESS (0 to 1) for current level
// ────────────────────────────────────────────────────────
export const getXPProgress = (xp) => {
  const current = getLevelFromXP(xp);
  const next = getNextLevel(xp);
  if (current.level === next.level) return 1; // Max level
  const required = next.xp - current.xp;
  const earned = xp - current.xp;
  return Math.min(1, Math.max(0, earned / required));
};

// ────────────────────────────────────────────────────────
//  GET ALL UNLOCKS for a given level
// ────────────────────────────────────────────────────────
export const getUnlocks = (level) => {
  return LEVELS
    .filter(l => l.level <= level && l.unlock)
    .map(l => l.unlock);
};

// ────────────────────────────────────────────────────────
//  UNLOCK MAPPING & AUTO-GRANT
// ────────────────────────────────────────────────────────
const UNLOCK_ITEM_MAP = {
  greenName: 'emerald_green',
  sparkle: 'sparkle',
  tradeBorder: 'tradeBorder',
  animatedFrame: 'animatedFrame',
  rainbowName: 'rainbow',
  holographic: 'holographic',
};

// ────────────────────────────────────────────────────────
//  ADD XP — fire-and-forget, non-blocking
//  Uses increment() for atomic writes
// ────────────────────────────────────────────────────────
export const addXP = async (db, uid, amount, action = null) => {
  if (!db || !uid || !amount || amount <= 0) return;

  try {
    const xpRef = ref(db, `users/${uid}/xp`);

    // 1. Atomic increment (always — 1 write only)
    await update(xpRef, {
      total: increment(amount),
    });

    // OPTIMIZATION: For small XP (< 10), skip level recalculation
    // Level only changes at big thresholds so recalculating
    // for every 2-10 XP gain wastes reads per call.
    if (amount < 10) {
      return null; // Skip level check — saves reads
    }

    // 2. Read new total & recalculate level (only for XP >= 10)
    const snap = await get(ref(db, `users/${uid}/xp/total`));
    const newTotal = snap.val() || 0;
    const newLevel = getLevelFromXP(newTotal);

    // 3. Update level if changed & check for unlocks
    await update(xpRef, {
      level: newLevel.level,
    });

    // Auto-grant level unlocks
    if (newLevel.unlock && UNLOCK_ITEM_MAP[newLevel.unlock]) {
      const rewardKey = newLevel.unlock;
      const rewardSnap = await get(ref(db, `users/${uid}/levelRewards/${rewardKey}`));

      // If not already granted
      if (!rewardSnap.exists()) {
        const itemId = UNLOCK_ITEM_MAP[rewardKey];

        // Record as granted (cosmetics/shop integration added later)
        await update(ref(db, `users/${uid}`), {
          [`levelRewards/${rewardKey}`]: Date.now(),
        });
      }
    }

    return { total: newTotal, level: newLevel };
  } catch (err) {
    console.warn('[XP] addXP error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  GET USER XP DATA
// ────────────────────────────────────────────────────────
export const getUserXP = async (db, uid) => {
  if (!db || !uid) return { total: 0, level: 1 };
  try {
    const snap = await get(ref(db, `users/${uid}/xp`));
    if (!snap.exists()) return { total: 0, level: 1 };
    const data = snap.val();
    return {
      total: data.total || 0,
      level: data.level || getLevelFromXP(data.total || 0).level,
    };
  } catch {
    return { total: 0, level: 1 };
  }
};

// Export LEVELS for UI
export { LEVELS };
