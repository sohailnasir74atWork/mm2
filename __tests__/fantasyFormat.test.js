/**
 * Fantasy League screen helpers (Code/FantasyLeague/fantasyFormat.js).
 * The round id must match the server's (functions/fantasy/logic.js roundId),
 * or the screen reads a round document that does not exist.
 */
import {
  currentRoundId, timeLeft, signedPct, formatValue, swapsLeft, nextSwapNeedsExtra,
  draftReady, filterPool, parseGuess, monthSeasonLabel, daysAgo,
} from '../Code/FantasyLeague/fantasyFormat';

const serverLogic = require('../functions/fantasy/logic');

describe('currentRoundId', () => {
  it('matches the server for every day across a year boundary', () => {
    const start = Date.UTC(2026, 11, 20);
    for (let i = 0; i < 40; i++) {
      const t = start + i * 86400000 + 13 * 3600000;
      expect(currentRoundId(t)).toBe(serverLogic.roundWindow(t).id);
    }
  });
  it('known weeks', () => {
    expect(currentRoundId(Date.UTC(2026, 9, 30, 12))).toBe('2026-W44');
    expect(currentRoundId(Date.UTC(2027, 0, 1))).toBe('2026-W53');
  });
});

describe('formatting', () => {
  it('timeLeft', () => {
    const now = 1000000;
    expect(timeLeft(now + 2 * 86400000 + 4 * 3600000, now)).toBe('2d 4h');
    expect(timeLeft(now + 5 * 3600000 + 12 * 60000, now)).toBe('5h 12m');
    expect(timeLeft(now + 30000, now)).toBe('1m');
    expect(timeLeft(now - 5, now)).toBe('0m');
  });
  it('signedPct and formatValue', () => {
    expect(signedPct(18)).toBe('+18%');
    expect(signedPct(-12.5)).toBe('-12.5%');
    expect(signedPct(0)).toBe('0%');
    expect(formatValue(1250)).toBe('1,250');
    expect(formatValue(undefined)).toBe('—');
  });
  it('daysAgo', () => {
    expect(daysAgo(null)).toBe(null);
    expect(daysAgo(0 + 1, 3 * 86400000 + 2)).toBe(3);
  });
  it('monthSeasonLabel', () => {
    expect(monthSeasonLabel('m-2026-12', 'en')).toMatch(/December 2026/);
    expect(monthSeasonLabel('christmas-2026', 'en')).toBe('');
  });
});

describe('team rules', () => {
  it('swaps: one free, one with the extra allowance', () => {
    expect(swapsLeft({ swaps: 0 })).toBe(2);
    expect(nextSwapNeedsExtra({ swaps: 0 })).toBe(false);
    expect(nextSwapNeedsExtra({ swaps: 1 })).toBe(true);
    expect(nextSwapNeedsExtra({ swaps: 1, extraSwap: true })).toBe(false);
    expect(swapsLeft({ swaps: 2, extraSwap: true })).toBe(0);
    expect(swapsLeft(null)).toBe(0);
  });
  it('draftReady needs 5 directions and a captain among them', () => {
    const d = { a: 'up', b: 'down', c: 'up', d: 'up', e: 'down' };
    expect(draftReady(d, 'c')).toBe(true);
    expect(draftReady(d, 'z')).toBe(false);
    expect(draftReady({ a: 'up' }, 'a')).toBe(false);
  });
  it('filterPool and parseGuess', () => {
    const pool = [{ k: 'bat', n: 'Bat' }, { k: 'harvester', n: 'Harvester' }];
    expect(filterPool(pool, 'harv').map((p) => p.k)).toEqual(['harvester']);
    expect(filterPool(pool, '')).toHaveLength(2);
    expect(parseGuess('1,250')).toBe(1250);
    expect(parseGuess('1.5k')).toBe(1500);
    expect(parseGuess('2m')).toBe(2000000);
    expect(parseGuess('abc')).toBe(null);
    expect(parseGuess('0')).toBe(null);
  });
});

describe('kid-friendly helpers', () => {
  const { wholePct, nextUpdateAt, quickPick } = require('../Code/FantasyLeague/fantasyFormat');
  it('wholePct', () => {
    expect(wholePct(-12.5)).toBe('13');
    expect(wholePct(18)).toBe('18');
    expect(wholePct(undefined)).toBe('0');
  });
  it('nextUpdateAt', () => {
    expect(nextUpdateAt('2026-10-30T02:03:20.852Z')).toBe(Date.parse('2026-10-30T02:03:20.852Z') + 2.5 * 86400000);
    expect(nextUpdateAt(null)).toBe(null);
    expect(nextUpdateAt('garbage')).toBe(null);
  });
  it('quickPick makes a ready team from the pool', () => {
    const pool = Array.from({ length: 12 }, (_, i) => ({ k: `k${i}`, n: `Item ${i}` }));
    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const { draft, captain } = quickPick(pool, rand);
    expect(Object.keys(draft)).toHaveLength(5);
    expect(draftReady(draft, captain)).toBe(true);
    Object.keys(draft).forEach((k) => expect(pool.some((p) => p.k === k)).toBe(true));
    expect(quickPick([], rand)).toEqual({ draft: {}, captain: null });
  });
});
