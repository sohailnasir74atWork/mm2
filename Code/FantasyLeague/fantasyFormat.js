/**
 * fantasyFormat.js — small pure helpers for the Fantasy League screen.
 * No React, no Firebase, so __tests__/fantasyFormat.test.js can cover them.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export const PICKS = 5;
export const FREE_SWAPS = 1;

/** Same id as functions/fantasy/logic.js roundId: ISO week, Monday 00:00 UTC. */
export const currentRoundId = (now = Date.now()) => {
  const d = new Date(now);
  const startsAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const thursday = new Date(startsAt + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstWeek = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
  const n = 1 + Math.round((startsAt - firstWeek) / WEEK);
  return `${year}-W${String(n).padStart(2, '0')}`;
};

/** "2d 4h", "5h 12m", "3m" — time left until `until`. */
export const timeLeft = (until, now = Date.now()) => {
  const ms = Math.max(0, Number(until) - now);
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, ms > 0 ? 1 : 0)}m`;
};

export const signedPct = (p) => {
  const n = Number(p) || 0;
  if (n === 0) return '0%';
  return `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}%`;
};

export const formatValue = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 });
};

/** Whole days since `at` (0 = today), or null. */
export const daysAgo = (at, now = Date.now()) => (at ? Math.max(0, Math.floor((now - Number(at)) / DAY)) : null);

/** Swaps a player still has: one free, one more after an ad (or Pro). */
export const swapsLeft = (entry) => {
  if (!entry) return 0;
  return Math.max(0, FREE_SWAPS + 1 - (Number(entry.swaps) || 0));
};

/** Whether the next swap needs the extra (ad / Pro) allowance. */
export const nextSwapNeedsExtra = (entry) => !!entry && (Number(entry.swaps) || 0) >= FREE_SWAPS && !entry.extraSwap;

/** A draft team is ready when it has 5 picks, each with a direction, and a captain among them. */
export const draftReady = (draft, captain) => {
  const keys = Object.keys(draft || {});
  return keys.length === PICKS && keys.every((k) => draft[k] === 'up' || draft[k] === 'down') && keys.includes(captain);
};

/** Filter the pool by a search term (name words, case-insensitive). */
export const filterPool = (pool, term) => {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return pool || [];
  return (pool || []).filter((p) => String(p.n || '').toLowerCase().includes(q));
};

/** Parse a typed guess ("1,250" / "1.5k" / "2m") into a number, or null. */
export const parseGuess = (text) => {
  const s = String(text || '').trim().toLowerCase().replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
  return n > 0 && n <= 1e10 ? n : null;
};

/** Month season label in the app language ("December 2026"), from "m-2026-12". */
export const monthSeasonLabel = (seasonId, locale) => {
  const m = /^m-(\d{4})-(\d{2})$/.exec(String(seasonId || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  try {
    return d.toLocaleDateString(locale || 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (e) {
    return `${m[2]}/${m[1]}`;
  }
};

/** "13" for -12.5 — kids read a whole number and an arrow, not "-12.5%". */
export const wholePct = (p) => String(Math.round(Math.abs(Number(p) || 0)));

// The MM2 feed is re-scraped roughly every 2–3 days (value_alerts history),
// so "next update" is an estimate from the last one, never a promise.
const TYPICAL_UPDATE_MS = 2.5 * DAY;

/** When the next value update is likely, from the round's valuesAt (ISO), or null. */
export const nextUpdateAt = (valuesAt) => {
  const t = Date.parse(valuesAt || '');
  return Number.isFinite(t) ? t + TYPICAL_UPDATE_MS : null;
};

/**
 * 🎲 Quick Pick: 5 random items from the pool, a random call on each, the
 * first one starred. For players who do not follow values yet; they can
 * still change any of it before joining. `rand` is injectable for tests.
 */
export const quickPick = (pool, rand = Math.random) => {
  const items = [...(pool || [])];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const draft = {};
  items.slice(0, PICKS).forEach((p) => { draft[p.k] = rand() < 0.5 ? 'up' : 'down'; });
  return { draft, captain: Object.keys(draft)[0] || null };
};
