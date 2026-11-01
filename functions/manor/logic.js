/**
 * manor/logic.js — Lights Out Manor crate rules, no I/O (2026-10-30).
 * Pure so test/manorLogic.test.js covers it without the emulators; core.js
 * does the reads and writes.
 *
 * Each skin is also a permanent profile frame in My Cosmetics (id
 * `manor_<skin>`), so a crate win shows next to the player's name in chat
 * through the existing cosmetics flow. Builds that do not know a frame id
 * draw it as a plain gradient ring from borderColors (FramedAvatar
 * DEFAULT_DEF), so older installs still show it. The app's catalogue copy
 * (Code/Engagement/shopItems.js MANOR_FRAMES) must match SKINS — the app
 * test compares them.
 */

const MIN_ROUND_MS = 20 * 1000;
// Longest round (90 s + 20 s easy mode) plus room for pauses.
const MAX_ROUND_MS = 10 * 60 * 1000;
const DAILY_CRATES = 6;
const DAILY_DOUBLES = 3;
const DOUBLE_WINDOW_MS = 15 * 60 * 1000;
const ROLES = ['seeker', 'shadow', 'runner'];

// App rarity tiers (Code/Engagement/shopItems.js RARITY), odds in %.
const ODDS = [['common', 55], ['uncommon', 28], ['rare', 12], ['legendary', 4], ['exclusive', 1]];

const SKINS = [
  { id: 'classic', rarity: 'common', name: 'Candle Wax', borderColors: ['#efe4d2', '#c9b79c'], borderWidth: 2.2, glowColor: null },
  { id: 'moth', rarity: 'common', name: 'Moth Grey', borderColors: ['#b9b2c4', '#8b839a'], borderWidth: 2.2, glowColor: null },
  { id: 'mint', rarity: 'common', name: 'Mint Lantern', borderColors: ['#8fe3b0', '#4fbf86'], borderWidth: 2.2, glowColor: null },
  { id: 'frost', rarity: 'uncommon', name: 'Frost Halo', borderColors: ['#8fd3ff', '#bfe6ff', '#5aa9ff'], borderWidth: 3, glowColor: '#8fd3ff40' },
  { id: 'coral', rarity: 'uncommon', name: 'Coral Glow', borderColors: ['#ff9f80', '#ffc2ad', '#ff6f61'], borderWidth: 3, glowColor: '#ff9f8040' },
  { id: 'neon', rarity: 'rare', name: 'Neon Ghost', borderColors: ['#c48bff', '#7b5cff', '#ff5ad8'], borderWidth: 3.4, glowColor: '#c48bff60' },
  { id: 'ember', rarity: 'legendary', name: 'Ember Trail', borderColors: ['#ffb547', '#ff7a2f', '#ff3b30'], borderWidth: 4, glowColor: '#ff7a2f80' },
  { id: 'void', rarity: 'exclusive', name: 'Void Prism', borderColors: ['#ff5a8a', '#ffb547', '#73e6d3', '#5aa9ff', '#b36bff'], borderWidth: 4.5, glowColor: '#b36bff90' },
];
const SKIN_IDS = SKINS.map((s) => s.id);
const skinById = (id) => SKINS.find((s) => s.id === id) || null;
const frameId = (skinId) => `manor_${skinId}`;

/** Roll one skin: rarity by ODDS, then a skin of that rarity. `rand` returns [0, 1). */
function rollSkin(rand = Math.random) {
  let n = rand() * 100;
  let rarity = ODDS[0][0];
  for (const [r, w] of ODDS) {
    if (n < w) { rarity = r; break; }
    n -= w;
  }
  const pool = SKINS.filter((s) => s.rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Today's crate counters ({ day, n, d }), reset when the UTC day changed. */
const todayCrates = (crates, now) => (crates && crates.day === isoDay(now)
  ? { day: crates.day, n: Number(crates.n) || 0, d: Number(crates.d) || 0 }
  : { day: isoDay(now), n: 0, d: 0 });

/** Why a finished round cannot pay out, or null. */
function roundProblem(round, roundId, now) {
  if (!round || typeof round !== 'object' || round.id !== roundId) return 'no_round';
  const age = now - Number(round.at);
  if (!(age >= MIN_ROUND_MS)) return 'too_fast';
  if (age > MAX_ROUND_MS) return 'expired';
  return null;
}

/** The My Cosmetics record for a skin's frame (same fields as shopUtils purchaseEgg). */
function frameRecord(skin, now) {
  return {
    id: frameId(skin.id),
    name: skin.name,
    rarity: skin.rarity,
    type: 'profileFrame',
    activatedAt: now,
    expiresAt: -1,
    borderColors: skin.borderColors,
    borderWidth: skin.borderWidth,
    glowColor: skin.glowColor,
    source: 'manor',
  };
}

const newRoundId = (rand = Math.random) => Array.from({ length: 16 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rand() * 32)]).join('');

module.exports = {
  MIN_ROUND_MS,
  MAX_ROUND_MS,
  DAILY_CRATES,
  DAILY_DOUBLES,
  DOUBLE_WINDOW_MS,
  ROLES,
  ODDS,
  SKINS,
  SKIN_IDS,
  skinById,
  frameId,
  rollSkin,
  isoDay,
  todayCrates,
  roundProblem,
  frameRecord,
  newRoundId,
};
