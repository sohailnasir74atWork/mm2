/**
 * fantasyMock.js — sample league data for __DEV__ previews only.
 * FantasyLeagueScreen switches to it on a long-press of the header trophy in
 * debug builds (like Birthdays/birthdayMock.js), so every state can be seen
 * before the functions are deployed. Release builds never use it, and it
 * never writes anything anywhere.
 */
import { currentRoundId } from './fantasyFormat';

const DAY = 24 * 60 * 60 * 1000;
const ITEMS = [
  ['raygun', 'Raygun', 'img/Raygun.png', 'Godly', 1750, -12.5, 1],
  ['emberscythe', 'Emberscythe', 'img/Emberscythe.png', 'Ancient', 1150, 0, 0, true],
  ['flowerwood_knife', 'Flowerwood Knife', 'img/Flowerwood_Knife.png', 'Godly', 230, 4.5, 2],
  ['chroma_snowcannon', 'Chroma Snowcannon', 'img/Chroma_Snowcannon.png', 'Chroma', 7650, -8, 3],
  ['watergun', 'WaterGun', 'img/WaterGun.png', 'Godly', 150, 25, 0],
  ['blue_ew_revolver', 'Blue EW Revolver', 'img/blueewr.png', 'Unique', 50000, -20, 5],
  ['blue_elderwood_blade', 'Blue Elderwood Blade', 'img/BlueElderwoodBlade.png', 'Unique', 45000, 12, 6],
  ['blue_gingerscope', 'Blue Gingerscope', 'img/BlueGscope.png', 'Unique', 45000, -5, 9],
  ['bronze_swirly_axe', 'Bronze Swirly Axe', 'img/Bronzeswirly.png', 'Unique', 100000, 10, 12],
  ['bronze_travelers_axe', 'Bronze Travelers Axe', 'img/bronzetravsaxe.png', 'Unique', 100000, -15, 16],
];

export function mockRound(now = Date.now()) {
  const d = new Date(now);
  const startsAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const pool = ITEMS.map(([k, n, img, cat, v, p, ago, isNew]) => ({
    k, n, img, cat, v, ch: p ? 1 + (ago % 3) : 0, ...(isNew ? { isNew: true } : {}),
    last: p || isNew ? { p, at: now - ago * DAY } : null,
  }));
  const top = ['Shadow', 'Nikilis Fan', 'Godly Hunter', 'Trader Joe', 'Candy'].map((name, i) => ({
    uid: `mock${i}`, name, avatar: null, points: 140 - i * 23, rank: i + 1,
  }));
  return {
    id: currentRoundId(now),
    startsAt,
    endsAt: startsAt + 7 * DAY,
    joinUntil: startsAt + 6 * DAY,
    season: { id: 'halloween-2026', kind: 'event', label: 'Halloween', emoji: '🎃', startsAt, endsAt: startsAt + 20 * DAY },
    pool,
    top,
    players: 2310,
    status: 'live',
    // A day ago, so the "next value update" line shows a countdown.
    valuesAt: new Date(now - DAY).toISOString(),
  };
}

/** A joined team built from a draft, with made-up moves so every row state shows. */
export function mockEntry(round, draft, captain, uid) {
  const moves = [18, -12, 0, 6, -3];
  const picks = Object.keys(draft).map((k, i) => {
    const it = round.pool.find((p) => p.k === k) || {};
    const pct = moves[i % moves.length];
    const right = pct !== 0 && (draft[k] === 'up') === (pct > 0);
    let pts = pct === 0 ? 0 : right ? 10 + Math.abs(pct) : 2;
    if (k === captain) pts *= 2;
    return {
      k, n: it.n, img: it.img, cat: it.cat, dir: draft[k], cap: k === captain,
      base: it.v, cur: Math.round(it.v * (1 + pct / 100)), pct, pts, hype: i === 1 ? 3 : 0,
    };
  });
  return {
    uid, name: 'You', picks, banked: 0, swaps: 0, extraSwap: false,
    points: picks.reduce((s, p) => s + p.pts + p.hype, 0), rank: 4, createdAt: Date.now(),
  };
}

export function mockGuesses(now = Date.now()) {
  return {
    open: [{
      id: 'emberbow-mock', k: 'emberbow', n: 'Emberscythe', img: 'img/Emberscythe.png', valueAtOpen: 1300,
      openedAt: now - 3 * 3600000, closesAt: now + 45 * 3600000, resolveAt: now + 7 * DAY, status: 'open', players: 214,
    }],
    done: [{
      id: 'raygun-mock', k: 'raygun', n: 'Raygun', img: 'img/Raygun.png', valueAtOpen: 2000, final: 1750, status: 'final',
      top: [{ name: 'Shadow' }],
    }],
    mine: { 'raygun-mock': { guess: 1800, pts: 50 } },
  };
}

export function mockSeason(round) {
  return {
    season: { ...round.season, top: round.top, players: 5120 },
    me: { points: 212, rounds: 2, guessPts: 50 },
  };
}
