/**
 * fantasy/logic.js — the Fantasy League's rules, with no I/O (2026-10-30).
 *
 * Everything here is a pure function so the scoring can be tested without
 * the emulators (test/fantasyLogic.test.js). core.js does the reads, writes
 * and pushes around it.
 *
 * Why the game looks the way it does (value_alerts/changes, 2026-07-20 to
 * 2026-10-29, 1,030 rows): only 19–78 of the 1,096 feed items change in a
 * week (mean ~45), the median move is 4.8%, and 64% of moves are drops. A
 * league that scores "% gained" on any item would leave most teams at zero
 * for days. So players pick from a HOT LIST (items that changed in the last
 * four weeks; in the backtest it held 43–100% of the next week's movers) and
 * call the DIRECTION, and the points reward spotting a mover at all.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const PICKS = 5;
const HOT_WINDOW_MS = 28 * DAY;
const POOL_MIN = 40;
const POOL_MAX = 120;
// Joins and swaps close one day before the round ends, so a last-minute
// team cannot be built from a value change everyone has already seen.
const JOIN_CLOSE_MS = DAY;
const HYPE_MAX = 5;
const TOP_N = 100;

// Weekly prizes, in stars (same balance as Daily Stars). Rank ≤ n → stars.
const ROUND_REWARDS = [[1, 25], [3, 15], [10, 10], [100, 3]];
const PARTICIPATION_STARS = 1;

// Guess the Value: a new item takes guesses for two days and settles on day 7.
const GUESS_OPEN_MS = 2 * DAY;
const GUESS_RESOLVE_MS = 7 * DAY;
const MAX_NEW_GUESSES = 6;
// More "new" items than this in one feed means the feed changed shape, not
// that MM2 dropped 150 items. No challenges are opened from such a run.
const MAX_PLAUSIBLE_NEW = 150;

// Event windows, kept in step with the app's Code/Engagement/eventConfig.js
// (same fallbacks; RTDB /events overrides win on both sides). `month` is
// 0-indexed.
const EVENTS = [
  { id: 'halloween', label: 'Halloween', emoji: '🎃', month: 9, day: 17, durationDays: 35 },
  { id: 'thanksgiving', label: 'Thanksgiving', emoji: '🦃', month: 10, day: 21, durationDays: 25 },
  { id: 'christmas', label: 'Christmas', emoji: '🎄', month: 11, day: 17, durationDays: 40 },
  { id: 'valentines', label: "Valentine's", emoji: '💘', month: 1, day: 13, durationDays: 30 },
  { id: 'easter', label: 'Easter', emoji: '🐰', month: 3, day: 5, durationDays: 35 },
  { id: 'summer', label: 'Summer', emoji: '🏖️', month: 6, day: 15, durationDays: 45 },
];

// ── Items ────────────────────────────────────────────────────────────────

// MUST stay identical to slug() in firebase-value-alerts/functions/index.js:
// the hot list is built from that function's change log, keyed by this.
const slug = (name) =>
  String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * Read the public MM2 feed (mm2-api.b-cdn.net/data.json, { meta, data }).
 * Returns { generatedAt, items, allKeys }:
 *   items    Map slug → { k, n, img, cat, v, d } for the items the league
 *            can use: a real number (valueType 'exact', value ≥ 1) and a
 *            name that appears once. 125 names repeat in the feed (several
 *            "Bats", "Candy Corn"); a name that could mean two items cannot
 *            be scored fairly, so those are left out.
 *   allKeys  every slug in the feed, usable or not (new-item detection).
 */
function parseFeed(json) {
  const root = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json;
  const rows = [];
  const walk = (node, cat) => {
    if (Array.isArray(node)) {
      for (const el of node) walk(el, cat);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && 'value' in node) {
      rows.push({ cat, row: node });
      return;
    }
    for (const [key, child] of Object.entries(node)) walk(child, cat || key);
  };
  walk(root, null);

  const counts = new Map();
  for (const { row } of rows) {
    const k = slug(row.name);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const items = new Map();
  const allKeys = new Set();
  for (const { cat, row } of rows) {
    const k = slug(row.name);
    if (!k) continue;
    allKeys.add(k);
    if (counts.get(k) !== 1) continue;
    const v = toNum(row.value);
    if (v === null || v < 1 || row.valueType === 'relative') continue;
    items.set(k, {
      k,
      n: String(row.name).slice(0, 80),
      img: typeof row.image === 'string' ? row.image.slice(0, 200) : null,
      cat: cat ? String(cat).slice(0, 40) : null,
      v,
      d: toNum(row.demand) || 0,
    });
  }
  const generatedAt = json && json.meta && json.meta.generatedAt ? String(json.meta.generatedAt) : null;
  return { generatedAt, items, allKeys };
}

// ── Rounds (ISO weeks, Monday 00:00 UTC) ─────────────────────────────────

const weekStart = (ms) => {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
};

/** "2026-W45" for the week starting `startMs` (a Monday 00:00 UTC). */
const roundId = (startMs) => {
  const thursday = new Date(startMs + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const firstWeek = weekStart(Date.UTC(year, 0, 4));
  const n = 1 + Math.round((startMs - firstWeek) / WEEK);
  return `${year}-W${String(n).padStart(2, '0')}`;
};

const roundWindow = (now) => {
  const startsAt = weekStart(now);
  const endsAt = startsAt + WEEK;
  return { id: roundId(startsAt), startsAt, endsAt, joinUntil: endsAt - JOIN_CLOSE_MS };
};

// ── Seasons ──────────────────────────────────────────────────────────────

/** Every event window that could contain `t`, overrides applied. */
function eventWindows(t, remote) {
  const out = [];
  const year = new Date(t).getUTCFullYear();
  const byId = new Map(EVENTS.map((e) => [e.id, e]));
  if (remote && typeof remote === 'object') {
    for (const id of Object.keys(remote)) if (!byId.has(id)) byId.set(id, null);
  }
  for (const [id, base] of byId) {
    const o = remote && remote[id] && typeof remote[id] === 'object' ? remote[id] : null;
    if (o && o.enabled === false) continue;
    const label = (o && typeof o.label === 'string' && o.label.slice(0, 30)) || (base && base.label) || id;
    const emoji = (o && typeof o.emoji === 'string' && o.emoji.slice(0, 8)) || (base && base.emoji) || '🎉';
    if (o && Number(o.start) > 0 && Number(o.end) > Number(o.start)) {
      out.push({ id, label, emoji, start: Number(o.start), end: Number(o.end) });
      continue;
    }
    if (!base) continue;
    // This year's and last year's estimate, so a December event still
    // resolves in January.
    for (const y of [year - 1, year]) {
      const start = Date.UTC(y, base.month, base.day, 12);
      out.push({ id, label, emoji, start, end: start + base.durationDays * DAY });
    }
  }
  return out;
}

/**
 * The season a round belongs to, judged at its Thursday. During an event
 * that is the event (the newest one, when two overlap); otherwise the
 * calendar month. Ids: "halloween-2026", "m-2026-12".
 */
function seasonFor(roundStart, remote) {
  const t = roundStart + 3 * DAY;
  const hits = eventWindows(t, remote).filter((w) => w.start <= t && t < w.end);
  if (hits.length) {
    hits.sort((a, b) => b.start - a.start);
    const w = hits[0];
    return {
      id: `${w.id}-${new Date(w.start).getUTCFullYear()}`,
      kind: 'event',
      label: w.label,
      emoji: w.emoji,
      startsAt: w.start,
      endsAt: w.end,
    };
  }
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    id: `m-${y}-${String(m + 1).padStart(2, '0')}`,
    kind: 'month',
    label: null, // the app formats the month in the user's language
    emoji: '📅',
    startsAt: Date.UTC(y, m, 1),
    endsAt: Date.UTC(y, m + 1, 1),
  };
}

// ── Hot list ─────────────────────────────────────────────────────────────

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * The items a round can be picked from.
 *   changes    value_alerts/changes rows ({ item_slug, old_value, new_value, changed_at })
 *   firstSeen  { slug: ms } — when the league first saw each item (0 = was
 *              already there when the league started)
 * Order: recent movers first (newest change first), then new items, then —
 * only if that is fewer than POOL_MIN — the highest-demand items.
 */
function buildPool(items, changes, firstSeen, now) {
  const since = now - HOT_WINDOW_MS;
  const moved = new Map();
  for (const c of Array.isArray(changes) ? changes : []) {
    if (!c || Number(c.changed_at) < since) continue;
    const k = c.item_slug;
    if (!items.has(k)) continue;
    const prev = moved.get(k) || { n: 0, at: 0, p: 0 };
    prev.n += 1;
    if (Number(c.changed_at) > prev.at) {
      prev.at = Number(c.changed_at);
      const o = Number(c.old_value);
      prev.p = o > 0 ? round1(((Number(c.new_value) - o) / o) * 100) : 0;
    }
    moved.set(k, prev);
  }
  const picked = new Map();
  const add = (k, extra) => {
    if (picked.size >= POOL_MAX || picked.has(k)) return;
    const it = items.get(k);
    if (!it) return;
    picked.set(k, { k, n: it.n, img: it.img, cat: it.cat, v: it.v, ...extra });
  };
  [...moved.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .forEach(([k, m]) => add(k, { ch: m.n, last: { p: m.p, at: m.at } }));
  Object.entries(firstSeen || {})
    .filter(([, at]) => Number(at) >= since)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, at]) => add(k, { ch: 0, isNew: true, last: { p: 0, at: Number(at) } }));
  if (picked.size < POOL_MIN) {
    [...items.values()]
      .sort((a, b) => (b.d - a.d) || (b.v - a.v))
      .forEach((it) => { if (picked.size < POOL_MIN) add(it.k, { ch: 0, last: null }); });
  }
  return [...picked.values()];
}

// ── Scoring ──────────────────────────────────────────────────────────────

/**
 * One pick's points against the current value.
 *   no change          0
 *   right direction    10 + |% moved| (capped at 40) → 10..50
 *   wrong direction    2 (you still spotted a mover)
 *   captain            × 2
 */
function pickScore(pick, cur) {
  const base = Number(pick && pick.base);
  const now = Number(cur);
  if (!(base > 0) || !(now > 0) || now === base) return { pct: 0, pts: 0 };
  const pct = ((now - base) / base) * 100;
  const right = (pick.dir === 'up') === (pct > 0);
  let pts = right ? 10 + Math.min(40, Math.round(Math.abs(pct))) : 2;
  if (pick.cap) pts *= 2;
  return { pct: round1(pct), pts };
}

/** Re-score an entry's picks with `valueOf(k)` (null = keep the last value). */
function scoreEntry(entry, valueOf, hypeOf) {
  const picks = (entry.picks || []).map((p) => {
    const v = valueOf(p.k);
    const cur = v == null ? Number(p.cur) || Number(p.base) : v;
    const { pct, pts } = pickScore(p, cur);
    const hype = hypeOf ? hypeOf(p.k) : Number(p.hype) || 0;
    return { ...p, cur, pct, pts, hype };
  });
  const points = (Number(entry.banked) || 0) + picks.reduce((s, p) => s + p.pts + p.hype, 0);
  return { picks, points };
}

/** Rank entries in place: points high→low, then the earlier joiner. */
function rankEntries(entries) {
  entries.sort((a, b) => (b.points - a.points) || ((a.createdAt || 0) - (b.createdAt || 0)));
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

const roundReward = (rank, points) => {
  for (const [maxRank, stars] of ROUND_REWARDS) if (rank <= maxRank && points > 0) return stars;
  return points > 0 ? PARTICIPATION_STARS : 0;
};

// ── Hype ─────────────────────────────────────────────────────────────────

/**
 * Who posted each item this round and the week before, from trades_new rows
 * ({ userId, hasItems, wantsItems, ts }). Unique posters only, so 50 trades
 * from one player count once.
 *   → Map slug → { cur: Set<uid>, prev: Set<uid> }
 */
function collectHype(trades, keys, roundStart) {
  const want = keys instanceof Set ? keys : new Set(keys);
  const out = new Map();
  for (const t of trades) {
    const uid = t && t.userId;
    if (!uid || uid === 'Anonymous' || typeof uid !== 'string') continue;
    const bucket = Number(t.ts) >= roundStart ? 'cur' : 'prev';
    const seen = new Set();
    for (const it of [...(t.hasItems || []), ...(t.wantsItems || [])]) {
      const k = slug(it && (it.name || it.Name));
      if (!k || !want.has(k) || seen.has(k)) continue;
      seen.add(k);
      if (!out.has(k)) out.set(k, { cur: new Set(), prev: new Set() });
      out.get(k)[bucket].add(uid);
    }
  }
  return out;
}

/**
 * Hype points for `uid`'s pick `k`: how many MORE players posted it this
 * round than last week (pro-rated to the days elapsed), the player's own
 * posts excluded, 0..HYPE_MAX. Never captain-doubled.
 */
function hypePoints(hype, k, uid, elapsedMs) {
  const h = hype && hype.get(k);
  if (!h) return 0;
  const cur = h.cur.size - (h.cur.has(uid) ? 1 : 0);
  const prev = h.prev.size - (h.prev.has(uid) ? 1 : 0);
  const share = Math.min(1, Math.max(0, elapsedMs / WEEK));
  return Math.max(0, Math.min(HYPE_MAX, Math.floor(cur - prev * share)));
}

// ── Guess the Value ──────────────────────────────────────────────────────

/** Points for a guess against the settled value, by % error. */
function guessScore(guess, final) {
  const g = Number(guess);
  const f = Number(final);
  if (!(g > 0) || !(f > 0)) return { err: null, pts: 0 };
  const err = (Math.abs(g - f) / f) * 100;
  let pts = 0;
  if (err <= 5) pts = 50;
  else if (err <= 15) pts = 30;
  else if (err <= 30) pts = 15;
  else if (err <= 50) pts = 5;
  return { err: round1(err), pts };
}

/** Which of this run's new items get a challenge: usable ones, most valuable first. */
function newGuessItems(items, newKeys) {
  if (newKeys.length > MAX_PLAUSIBLE_NEW) return [];
  return newKeys
    .map((k) => items.get(k))
    .filter(Boolean)
    .sort((a, b) => b.v - a.v)
    .slice(0, MAX_NEW_GUESSES);
}

const guessId = (k, openedAt) => `${k}-${new Date(openedAt).toISOString().slice(0, 10)}`;

// ── Validation (endpoint bodies) ─────────────────────────────────────────

const DIRS = new Set(['up', 'down']);

/** { picks: [{k, dir}] × 5, captain } against the pool → normalised picks, or an error code. */
function validatePicks(body, poolKeys) {
  const raw = body && Array.isArray(body.picks) ? body.picks : null;
  if (!raw || raw.length !== PICKS) return { error: 'bad_picks' };
  const seen = new Set();
  const picks = [];
  for (const p of raw) {
    const k = p && typeof p.k === 'string' ? p.k : '';
    if (!poolKeys.has(k) || seen.has(k) || !DIRS.has(p.dir)) return { error: 'bad_picks' };
    seen.add(k);
    picks.push({ k, dir: p.dir });
  }
  const captain = body.captain;
  if (!seen.has(captain)) return { error: 'bad_picks' };
  return { picks: picks.map((p) => ({ ...p, cap: p.k === captain })) };
}

const okGuess = (g) => {
  const n = Number(g);
  return Number.isFinite(n) && n > 0 && n <= 1e10 ? Math.round(n * 100) / 100 : null;
};

module.exports = {
  DAY,
  WEEK,
  PICKS,
  POOL_MAX,
  HYPE_MAX,
  TOP_N,
  GUESS_OPEN_MS,
  GUESS_RESOLVE_MS,
  JOIN_CLOSE_MS,
  EVENTS,
  slug,
  parseFeed,
  weekStart,
  roundId,
  roundWindow,
  seasonFor,
  buildPool,
  pickScore,
  scoreEntry,
  rankEntries,
  roundReward,
  collectHype,
  hypePoints,
  guessScore,
  newGuessItems,
  guessId,
  validatePicks,
  okGuess,
};
