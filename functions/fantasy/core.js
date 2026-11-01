/**
 * fantasy/core.js — Fantasy League reads, writes and pushes (2026-10-30).
 * The rules themselves are in logic.js; the wiring in index.js.
 *
 * Data (Firestore, every collection server-written only — firestore.rules
 * lists them in managed(), so the signed-in catch-all cannot write them):
 *
 *   fantasy_rounds/{2026-W45}            one per ISO week (Mon 00:00 UTC)
 *       { id, startsAt, endsAt, joinUntil, season, pool[], top[], players,
 *         status 'live'|'final', valuesAt, scoredAt, finalizedAt }
 *   fantasy_rounds/{id}/entries/{uid}    a player's team
 *       { uid, name, avatar, picks[{k,n,img,cat,dir,cap,base,cur,pct,pts,hype,at}],
 *         banked, swapped[], swaps, extraSwap, points, rank, createdAt,
 *         updatedAt, lastPushAt, settled, stars }
 *   fantasy_seasons/{halloween-2026|m-2026-12}  { id, kind, label, emoji, startsAt, endsAt, top[], players }
 *   fantasy_seasons/{id}/players/{uid}   { uid, name, avatar, points, roundPts, guessPts, rounds }
 *   fantasy_guess/{slug-YYYY-MM-DD}      a new item to price
 *       { id, k, n, img, cat, valueAtOpen, openedAt, closesAt, resolveAt,
 *         status 'open'|'final'|'void', final, players, top[] }
 *   fantasy_guess/{id}/entries/{uid}     { uid, name, avatar, guess, at, err, pts, rank, settled }
 *   fantasy_state/main                   { known{slug: firstSeenMs}, scored, hypeDay, generatedAt }
 *
 * RTDB (admin only — no client rule exists for these nodes):
 *   fantasy_server/rewards/{round}/{uid}, fantasy_server/pushed/{key}
 *   read: value_alerts/changes (the hot list), events (season windows),
 *         users/{uid}/displayName|avatar|fcmToken|notificationSettings/fantasyAlerts
 *   write: users/{uid}/dailyStars (prizes, same fields as starUtils.js)
 *
 * Values are the MM2 feed (mm2values.com), fetched cache-busted, so a value
 * stamped on a pick is never older than what the app itself shows. Joins
 * and swaps stamp the value at that moment: a change seen before you pick
 * cannot score for you.
 */

const admin = require('firebase-admin');
const L = require('./logic');

if (!admin.apps.length) {
  admin.initializeApp();
}

const VALUES_URL = 'https://mm2-api.b-cdn.net/data.json';
const HOUR = 60 * 60 * 1000;
const PUSH_GAP_MS = 12 * HOUR;
const FEED_CACHE_MS = 60 * 1000;
const FCM_CHUNK = 500;
const READ_CONCURRENCY = 50;
const FREE_SWAPS = 1;
const DEAD_TOKEN = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

// Everything that leaves the process. Tests replace fetchFeed, messaging, now.
let feedCache = null;
const io = {
  db: () => admin.database(),
  fs: () => admin.firestore(),
  messaging: () => admin.messaging(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  now: () => Date.now(),
  log: (...a) => console.log(...a),
  fetchFeed: async () => {
    if (feedCache && Date.now() - feedCache.at < FEED_CACHE_MS) return feedCache.feed;
    const res = await fetch(`${VALUES_URL}?_=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const feed = L.parseFeed(await res.json());
    feedCache = { at: Date.now(), feed };
    return feed;
  },
};

class FantasyError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => { throw new FantasyError(code, status); };

const FieldValue = () => admin.firestore.FieldValue;
const rounds = () => io.fs().collection('fantasy_rounds');
const seasons = () => io.fs().collection('fantasy_seasons');
const guesses = () => io.fs().collection('fantasy_guess');
const stateRef = () => io.fs().collection('fantasy_state').doc('main');
const ref = (p) => io.db().ref(p);
const val = async (p) => (await ref(p).once('value')).val();

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number(t) || 0);
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const alreadyExists = (e) => e && (e.code === 6 || e.code === 'already-exists' || /ALREADY_EXISTS/.test(e.message || ''));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function claimOnce(path, value = true) {
  const res = await ref(path).transaction((cur) => (cur == null ? value : undefined), undefined, false);
  return res.committed;
}

const cleanName = (n) => {
  const s = typeof n === 'string' ? n.replace(/[\r\n\t]+/g, ' ').trim() : '';
  return s ? s.slice(0, 40) : 'Player';
};
const cleanAvatar = (a) => (typeof a === 'string' && /^https?:\/\//.test(a) ? a.slice(0, 500) : null);

async function profile(uid) {
  const [name, avatar] = await Promise.all([val(`users/${uid}/displayName`), val(`users/${uid}/avatar`)]);
  return { name: cleanName(name), avatar: cleanAvatar(avatar) };
}

// Same check as tradeMatch.js: banned players cannot join or guess.
async function isBanned(uid, now) {
  try {
    const { banEmailFor, encodeEmailForBan } = require('../_userEmail');
    const email = await banEmailFor(uid);
    if (!email) return false;
    const ban = await val(`banned_users_by_email/${encodeEmailForBan(email)}`);
    if (!ban || typeof ban !== 'object') return false;
    return ban.bannedUntil === 'permanent' || Number(ban.bannedUntil) > now;
  } catch (e) {
    return false;
  }
}

async function freshFeed() {
  let feed;
  try {
    feed = await io.fetchFeed();
  } catch (e) {
    io.log('[fantasy] feed fetch failed:', e.message);
  }
  // Never stamp a pick from a stale or half-read file.
  if (!feed || feed.items.size < 100) fail('try_later', 503);
  return feed;
}

const pickRow = (poolItem, dir, cap, base, now) => ({
  k: poolItem.k,
  n: poolItem.n,
  img: poolItem.img || null,
  cat: poolItem.cat || null,
  dir,
  cap: !!cap,
  base,
  cur: base,
  pct: 0,
  pts: 0,
  hype: 0,
  at: now,
});

const entryPoints = (e) => (Number(e.banked) || 0)
  + (e.picks || []).reduce((s, p) => s + (Number(p.pts) || 0) + (Number(p.hype) || 0), 0);

async function liveRound(rid, now) {
  const snap = await rounds().doc(String(rid || '')).get();
  if (!snap.exists) fail('no_round', 404);
  const r = snap.data();
  if (r.status !== 'live' || now >= r.joinUntil || now < r.startsAt) fail('closed');
  return { snap, r, pool: new Map((r.pool || []).map((p) => [p.k, p])) };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

/** fantasyJoin { round, picks: [{k, dir}] × 5, captain } → { entry } */
async function joinRound({ uid, body }) {
  const now = io.now();
  const { snap, pool } = await liveRound(body.round, now);
  const v = L.validatePicks(body, new Set(pool.keys()));
  if (v.error) fail(v.error);
  if (await isBanned(uid, now)) fail('banned', 403);
  const [feed, who] = await Promise.all([freshFeed(), profile(uid)]);
  const picks = v.picks.map((p) => {
    const it = feed.items.get(p.k);
    return pickRow(pool.get(p.k), p.dir, p.cap, it ? it.v : pool.get(p.k).v, now);
  });
  const entry = {
    uid,
    ...who,
    picks,
    banked: 0,
    swapped: [],
    swaps: 0,
    extraSwap: false,
    points: 0,
    rank: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await snap.ref.collection('entries').doc(uid).create(entry);
  } catch (e) {
    if (alreadyExists(e)) fail('already_joined');
    throw e;
  }
  await snap.ref.update({ players: FieldValue().increment(1) }).catch(() => {});
  return { entry };
}

/**
 * fantasySwap { round, out, in, dir, extra } → { entry }
 * One free swap a round; `extra: true` (sent after a rewarded ad, or by a
 * Pro player) allows one more. The swapped-out pick's points so far are
 * banked; the new pick starts from today's value and keeps the slot's
 * captaincy. The ad cannot be verified server-side (no SSV) — the stake is
 * one swap, so the client's word is accepted.
 */
async function swapPick({ uid, body }) {
  const now = io.now();
  const { snap, pool } = await liveRound(body.round, now);
  const outK = String(body.out || '');
  const inK = String(body.in || '');
  if (!pool.has(inK) || (body.dir !== 'up' && body.dir !== 'down')) fail('bad_picks');
  const feed = await freshFeed();
  const eRef = snap.ref.collection('entries').doc(uid);
  const next = await io.fs().runTransaction(async (tx) => {
    const eSnap = await tx.get(eRef);
    if (!eSnap.exists) fail('not_joined');
    const e = eSnap.data();
    const extra = !!(e.extraSwap || body.extra === true);
    if ((Number(e.swaps) || 0) >= FREE_SWAPS + (extra ? 1 : 0)) fail('no_swaps');
    const picks = [...(e.picks || [])];
    const i = picks.findIndex((p) => p.k === outK);
    if (i < 0 || picks.some((p) => p.k === inK)) fail('bad_picks');
    const old = picks[i];
    const curIt = feed.items.get(old.k);
    const cur = curIt ? curIt.v : Number(old.cur) || Number(old.base);
    const { pct, pts } = L.pickScore(old, cur);
    const inIt = feed.items.get(inK);
    picks[i] = pickRow(pool.get(inK), body.dir, old.cap, inIt ? inIt.v : pool.get(inK).v, now);
    const swapped = [...(e.swapped || []), { k: old.k, n: old.n, dir: old.dir, cap: !!old.cap, base: old.base, cur, pct, pts, at: now }];
    const out = {
      ...e,
      picks,
      swapped,
      banked: (Number(e.banked) || 0) + pts + (Number(old.hype) || 0),
      swaps: (Number(e.swaps) || 0) + 1,
      extraSwap: extra,
      updatedAt: now,
    };
    out.points = entryPoints(out);
    tx.set(eRef, out);
    return out;
  });
  return { entry: next };
}

/** fantasyGuess { id, guess } → { guess } — one guess per player per item. */
async function submitGuess({ uid, body }) {
  const now = io.now();
  const g = L.okGuess(body.guess);
  if (g === null) fail('bad_guess');
  const gRef = guesses().doc(String(body.id || '') || '_');
  const snap = await gRef.get();
  if (!snap.exists) fail('no_guess', 404);
  const d = snap.data();
  if (d.status !== 'open' || now >= d.closesAt) fail('closed');
  if (await isBanned(uid, now)) fail('banned', 403);
  const who = await profile(uid);
  try {
    await gRef.collection('entries').doc(uid).create({
      uid, ...who, guess: g, at: now, err: null, pts: null, rank: null, settled: false,
    });
  } catch (e) {
    if (alreadyExists(e)) fail('already_guessed');
    throw e;
  }
  await gRef.update({ players: FieldValue().increment(1) }).catch(() => {});
  return { guess: g };
}

// ─── Pushes ─────────────────────────────────────────────────────────────────

const buildMessage = (token, type, notification, extra = {}) => ({
  token,
  notification,
  data: { type, route: 'FantasyLeague', ...extra },
  android: { priority: 'high', notification: { sound: 'default', tag: `fantasy-${type}` } },
  apns: { headers: { 'apns-collapse-id': `fantasy-${type}` }, payload: { aps: { sound: 'default' } } },
});

/**
 * Push to players: [{ uid, type, notification }]. Skips players who turned
 * league alerts off (users/{uid}/notificationSettings/fantasyAlerts false),
 * sends in chunks of 500 and clears dead tokens like birthdays/core.js.
 */
async function pushTo(items) {
  if (!items.length) return 0;
  const rows = await mapLimit(items, READ_CONCURRENCY, async (it) => {
    const [token, opt] = await Promise.all([
      val(`users/${it.uid}/fcmToken`),
      val(`users/${it.uid}/notificationSettings/fantasyAlerts`),
    ]);
    return opt === false || typeof token !== 'string' || !token ? null : { ...it, token };
  });
  const ready = rows.filter(Boolean);
  let sent = 0;
  for (let i = 0; i < ready.length; i += FCM_CHUNK) {
    const chunk = ready.slice(i, i + FCM_CHUNK);
    let res;
    try {
      res = await io.messaging().sendEach(chunk.map((it) => buildMessage(it.token, it.type, it.notification, it.data)));
    } catch (e) {
      io.log('[fantasy] sendEach failed:', e.message);
      continue;
    }
    const dead = [];
    res.responses.forEach((r, j) => {
      if (r.success) sent += 1;
      else if (r.error && DEAD_TOKEN.has(r.error.code)) dead.push(chunk[j].uid);
    });
    await Promise.all(dead.map((u) => ref(`users/${u}`).update({ fcmToken: null, isTokenInvalid: true }).catch(() => {})));
  }
  return sent;
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const signed = (p) => `${p > 0 ? '+' : ''}${p}%`;

// ─── Hype ───────────────────────────────────────────────────────────────────

/** Unique posters per pool item, this round and the week before (trades_new). */
async function loadHype(r, now) {
  const since = admin.firestore.Timestamp.fromMillis(r.startsAt - L.WEEK);
  const until = Math.min(now, r.endsAt);
  const snap = await io.fs().collection('trades_new')
    .where('timestamp', '>=', since)
    .select('userId', 'hasItems', 'wantsItems', 'timestamp')
    .get();
  const trades = [];
  snap.forEach((d) => {
    const x = d.data();
    const ts = ms(x.timestamp);
    if (ts && ts < until) trades.push({ userId: x.userId, hasItems: x.hasItems, wantsItems: x.wantsItems, ts });
  });
  return L.collectHype(trades, (r.pool || []).map((p) => p.k), r.startsAt);
}

// ─── Rounds ─────────────────────────────────────────────────────────────────

async function ensureSeason(season) {
  const { id, kind, label, emoji, startsAt, endsAt } = season;
  await seasons().doc(id).set({ id, kind, label, emoji, startsAt, endsAt }, { merge: true });
}

async function createRound(w, feed, known, remote, now) {
  const changes = Object.values((await val('value_alerts/changes')) || {});
  const pool = L.buildPool(feed.items, changes, known, now);
  const season = L.seasonFor(w.startsAt, remote);
  await ensureSeason(season);
  try {
    await rounds().doc(w.id).create({
      ...w,
      season,
      pool,
      top: [],
      players: 0,
      status: 'live',
      valuesAt: feed.generatedAt,
      createdAt: now,
      scoredAt: null,
      finalizedAt: null,
    });
  } catch (e) {
    if (!alreadyExists(e)) throw e;
  }
  return { pool: pool.length, season: season.id };
}

const topRow = (e) => ({ uid: e.uid, name: e.name, avatar: e.avatar || null, points: e.points, rank: e.rank });

/**
 * Re-score every entry of a round against `feed` (and, with opts.hype, the
 * trade-post hype), re-rank, refresh the round's top 100 and pool values.
 * With opts.push, players whose points went up hear about their best mover
 * (at most one push per PUSH_GAP_MS).
 */
async function rescoreRound(rRef, r, feed, now, opts = {}) {
  const at = Math.min(now, r.endsAt);
  const snap = await rRef.collection('entries').get();
  const hype = opts.hype && !snap.empty ? await loadHype(r, at) : null;
  const elapsed = at - r.startsAt;
  const valueOf = (k) => {
    const it = feed.items.get(k);
    return it ? it.v : null;
  };
  const entries = snap.docs.map((d) => {
    const old = d.data();
    const s = L.scoreEntry(old, valueOf, hype ? (k) => L.hypePoints(hype, k, old.uid, elapsed) : null);
    return { ref: d.ref, old, uid: old.uid, name: old.name, avatar: old.avatar, createdAt: old.createdAt, picks: s.picks, points: s.points };
  });
  L.rankEntries(entries);

  const pushes = [];
  if (opts.push) {
    for (const e of entries) {
      if (e.points <= (Number(e.old.points) || 0)) continue;
      if (now - (Number(e.old.lastPushAt) || 0) < PUSH_GAP_MS) continue;
      const before = new Map((e.old.picks || []).map((p) => [p.k, Number(p.pts) || 0]));
      const best = e.picks
        .filter((p) => p.pts > (before.get(p.k) || 0))
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
      if (!best) continue;
      e.lastPushAt = now;
      pushes.push({
        uid: e.uid,
        type: 'fantasy_move',
        notification: {
          title: `📈 ${best.n} moved ${signed(best.pct)}!`,
          body: `Your league team has ${fmt(e.points)} pts · #${fmt(e.rank)} of ${fmt(entries.length)}`,
        },
        data: { round: r.id },
      });
    }
  }

  const writer = io.fs().bulkWriter();
  for (const e of entries) {
    const changed = e.points !== e.old.points || e.rank !== e.old.rank
      || JSON.stringify(e.picks) !== JSON.stringify(e.old.picks) || e.lastPushAt;
    if (!changed) continue;
    const up = { picks: e.picks, points: e.points, rank: e.rank, updatedAt: now };
    if (e.lastPushAt) up.lastPushAt = e.lastPushAt;
    writer.update(e.ref, up);
  }
  await writer.close();

  await rRef.update({
    top: entries.slice(0, L.TOP_N).map(topRow),
    players: entries.length,
    pool: (r.pool || []).map((p) => {
      const v = valueOf(p.k);
      return v == null ? p : { ...p, v };
    }),
    valuesAt: feed.generatedAt,
    scoredAt: now,
    ...(hype ? { hypeAt: now } : {}),
  });
  const sent = pushes.length ? await pushTo(pushes) : 0;
  return { entries: entries.length, pushed: sent };
}

async function refreshSeasonTop(sid, now) {
  const players = seasons().doc(sid).collection('players');
  const [q, count] = await Promise.all([
    players.orderBy('points', 'desc').limit(L.TOP_N).get(),
    players.count().get(),
  ]);
  const top = q.docs.map((d, i) => {
    const x = d.data();
    return { uid: x.uid, name: x.name, avatar: x.avatar || null, points: x.points, rank: i + 1 };
  });
  await seasons().doc(sid).set({ top, players: count.data().count, updatedAt: now }, { merge: true });
}

/** Stars into users/{uid}/dailyStars, once per (key, uid) — same fields as birthdays' gift. */
async function grantStars(key, uid, stars, now) {
  if (!(stars > 0)) return false;
  const mark = `fantasy_server/rewards/${key}/${uid}`;
  if (!(await claimOnce(mark, { stars, at: now }))) return false;
  try {
    await ref(`users/${uid}/dailyStars`).transaction((cur) => {
      const s = cur && typeof cur === 'object' ? cur : {};
      const earned = Number(s.totalStarsEarned) || 0;
      const balance = s.starBalance === undefined || s.starBalance === null ? earned : Number(s.starBalance) || 0;
      return { ...s, starBalance: balance + stars, totalStarsEarned: earned + stars };
    }, undefined, false);
  } catch (e) {
    await ref(mark).remove().catch(() => {});
    throw e;
  }
  return true;
}

/**
 * Close a round: final score (full-week hype, no move pushes), add each
 * team to its season (once — `settled` is written in the same batch as the
 * season increment), pay the stars, mark the round final, push results.
 * Safe to re-run after a crash at any step.
 */
async function finalizeRound(rRef, r, feed, now) {
  await rescoreRound(rRef, r, feed, now, { hype: true });
  const sid = r.season && r.season.id;
  const snap = await rRef.collection('entries').get();
  const docs = snap.docs.map((d) => ({ ref: d.ref, ...d.data() }));
  const todo = docs.filter((e) => !e.settled);
  for (let i = 0; i < todo.length; i += 200) {
    const batch = io.fs().batch();
    for (const e of todo.slice(i, i + 200)) {
      const stars = L.roundReward(e.rank, e.points);
      e.stars = stars;
      batch.update(e.ref, { settled: true, stars });
      if (sid) {
        batch.set(seasons().doc(sid).collection('players').doc(e.uid), {
          uid: e.uid,
          name: e.name,
          avatar: e.avatar || null,
          points: FieldValue().increment(e.points),
          roundPts: FieldValue().increment(e.points),
          rounds: FieldValue().increment(1),
          updatedAt: now,
        }, { merge: true });
      }
    }
    await batch.commit();
  }
  await mapLimit(docs, READ_CONCURRENCY, (e) => grantStars(`round-${r.id}`, e.uid, Number(e.stars) || L.roundReward(e.rank, e.points), now));
  await rRef.update({ status: 'final', finalizedAt: now });
  if (sid) await refreshSeasonTop(sid, now);

  if (docs.length && (await claimOnce(`fantasy_server/pushed/results-${r.id}`, now))) {
    await pushTo(docs.map((e) => {
      const stars = Number(e.stars) || L.roundReward(e.rank, e.points);
      return {
        uid: e.uid,
        type: 'fantasy_results',
        notification: {
          title: `🏁 League results: #${fmt(e.rank)} of ${fmt(docs.length)}`,
          body: `${fmt(e.points)} pts${stars ? ` · +${stars} ⭐` : ''}. A new round is open: pick your 5!`,
        },
        data: { round: r.id },
      };
    }));
  }
  return { entries: docs.length };
}

// ─── Guess the Value ────────────────────────────────────────────────────────

async function openGuesses(feed, newKeys, now) {
  const items = L.newGuessItems(feed.items, newKeys);
  for (const it of items) {
    const id = L.guessId(it.k, now);
    try {
      await guesses().doc(id).create({
        id,
        k: it.k,
        n: it.n,
        img: it.img || null,
        cat: it.cat || null,
        valueAtOpen: it.v,
        openedAt: now,
        closesAt: now + L.GUESS_OPEN_MS,
        resolveAt: now + L.GUESS_RESOLVE_MS,
        status: 'open',
        final: null,
        players: 0,
        top: [],
      });
    } catch (e) {
      if (!alreadyExists(e)) throw e;
    }
  }
  return items.length;
}

async function resolveGuess(gRef, g, feed, now, remote) {
  const it = feed.items.get(g.k);
  if (!it) {
    // The item left the feed or lost its number: nothing to settle against.
    await gRef.update({ status: 'void', resolvedAt: now });
    return { void: true };
  }
  const final = it.v;
  const snap = await gRef.collection('entries').get();
  const rows = snap.docs.map((d) => {
    const x = d.data();
    return { ref: d.ref, ...x, ...L.guessScore(x.guess, final) };
  });
  rows.sort((a, b) => ((a.err == null ? Infinity : a.err) - (b.err == null ? Infinity : b.err)) || (a.at - b.at));
  rows.forEach((x, i) => { x.rank = i + 1; });

  const season = L.seasonFor(L.weekStart(now), remote);
  await ensureSeason(season);
  const todo = rows.filter((x) => !x.settled);
  for (let i = 0; i < todo.length; i += 200) {
    const batch = io.fs().batch();
    for (const x of todo.slice(i, i + 200)) {
      batch.update(x.ref, { err: x.err, pts: x.pts, rank: x.rank, settled: true });
      if (x.pts > 0) {
        batch.set(seasons().doc(season.id).collection('players').doc(x.uid), {
          uid: x.uid,
          name: x.name,
          avatar: x.avatar || null,
          points: FieldValue().increment(x.pts),
          guessPts: FieldValue().increment(x.pts),
          updatedAt: now,
        }, { merge: true });
      }
    }
    await batch.commit();
  }
  await gRef.update({
    status: 'final',
    final,
    resolvedAt: now,
    season: season.id,
    top: rows.slice(0, L.TOP_N).map((x) => ({ uid: x.uid, name: x.name, avatar: x.avatar || null, guess: x.guess, err: x.err, pts: x.pts, rank: x.rank })),
  });
  if (rows.some((x) => x.pts > 0)) await refreshSeasonTop(season.id, now);

  if (rows.length && (await claimOnce(`fantasy_server/pushed/guess-${g.id}`, now))) {
    await pushTo(rows.map((x) => ({
      uid: x.uid,
      type: 'fantasy_guess',
      notification: {
        title: `🎯 ${g.n} settled at ${fmt(final)}`,
        body: `Your guess ${fmt(x.guess)} → ${x.pts} pts (#${fmt(x.rank)} of ${fmt(rows.length)})`,
      },
      data: { guess: g.id },
    })));
  }
  return { entries: rows.length, final };
}

// ─── Tick (hourly) ──────────────────────────────────────────────────────────

/**
 * Once an hour: note new feed items (and open Guess the Value challenges for
 * them), finalize rounds that ended, create this week's round, re-score it
 * when the feed changed or a new UTC day started (hype), settle guesses that
 * reached day 7. Most hours change nothing and cost two reads and a fetch.
 */
async function runTick() {
  const now = io.now();
  let feed;
  try {
    feed = await io.fetchFeed();
  } catch (e) {
    io.log('[fantasy] tick: feed fetch failed:', e.message);
    return { skipped: 'feed' };
  }
  if (!feed || feed.items.size < 100) {
    io.log('[fantasy] tick: feed too small, skipped');
    return { skipped: 'feed' };
  }
  const out = {};
  const state = (await stateRef().get()).data() || {};
  const remote = await val('events');

  // 1. New items. The first run only records what exists.
  let known = state.known && typeof state.known === 'object' ? { ...state.known } : null;
  const newKeys = [];
  if (!known) {
    known = {};
    for (const k of feed.allKeys) known[k] = 0;
    out.seeded = feed.allKeys.size;
  } else {
    for (const k of feed.allKeys) {
      if (!(k in known)) {
        known[k] = now;
        newKeys.push(k);
      }
    }
  }

  // 2. Rounds that ended.
  const live = await rounds().where('status', '==', 'live').get();
  for (const d of live.docs) {
    const r = d.data();
    if (r.endsAt <= now) out[`final_${r.id}`] = await finalizeRound(d.ref, r, feed, now);
  }

  // 3. This week's round.
  const w = L.roundWindow(now);
  let rSnap = await rounds().doc(w.id).get();
  if (!rSnap.exists) {
    out.created = await createRound(w, feed, known, remote, now);
    rSnap = await rounds().doc(w.id).get();
  }

  // 4. Re-score: the feed changed (values → pushes), or a new day (hype).
  const scored = `${w.id}|${feed.generatedAt}`;
  const day = isoDay(now);
  if (rSnap.exists && rSnap.data().status === 'live' && (state.scored !== scored || state.hypeDay !== day)) {
    out.rescore = await rescoreRound(rSnap.ref, rSnap.data(), feed, now, { hype: true, push: state.scored !== scored && !!state.scored });
  }

  // 5. Guess the Value: settle day-7 challenges, open new ones.
  const open = await guesses().where('status', '==', 'open').get();
  for (const d of open.docs) {
    const g = d.data();
    if (g.resolveAt <= now) out[`guess_${g.id}`] = await resolveGuess(d.ref, g, feed, now, remote);
  }
  if (newKeys.length) out.newItems = newKeys.length;
  if (newKeys.length) out.guessesOpened = await openGuesses(feed, newKeys, now);

  await stateRef().set({ known, scored, hypeDay: day, generatedAt: feed.generatedAt, updatedAt: now }, { merge: true });
  io.log('[fantasy] tick', JSON.stringify(out));
  return out;
}

module.exports = {
  io,
  FantasyError,
  joinRound,
  swapPick,
  submitGuess,
  runTick,
  // for tests
  _feedCacheReset: () => { feedCache = null; },
};
