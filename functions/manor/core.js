/**
 * manor/core.js — Lights Out Manor crates on the server (2026-10-30).
 * Rules in logic.js; wiring in index.js.
 *
 * Why the server rolls: My Cosmetics lives under users/{uid}/shop, which the
 * app can write (owner-accepted gap), and Mystery Egg rolls happen on the
 * phone. A crate prize must not be something a player can grant themselves,
 * so ownership is kept where only the functions write:
 *
 *   Firestore manor_players/{uid}   { uid, owned[], played, wins,
 *       round { id, role, at }  (the open round ticket),
 *       crates { day, n, d }, lastWin { id, at, doubled }, updatedAt }
 *       (firestore.rules lists it in managed(): readable, never client-written)
 * The ticket check, its use and the payout are one Firestore transaction.
 *
 * The frame that comes with a NEW skin is pushed into
 * users/{uid}/shop/ownedItems/profileFrame (+ an inventory history row), the
 * same shape a Mystery Egg prize has, so My Cosmetics lists it and chat shows
 * it once equipped. Duplicates grant nothing extra.
 *
 * A win itself is the app's word (the game runs on the phone). What the
 * server enforces: a ticket per round, at least 20 s per round, each ticket
 * pays once, 6 crates + 3 video doubles per UTC day.
 */

const admin = require('firebase-admin');
const L = require('./logic');

if (!admin.apps.length) admin.initializeApp();

const io = {
  db: () => admin.database(),
  fs: () => admin.firestore(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  now: () => Date.now(),
  random: () => Math.random(),
  log: (...a) => console.log(...a),
};

class ManorError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => { throw new ManorError(code, status); };

const players = () => io.fs().collection('manor_players');

/** manorStart { role } → { roundId } — opens (or replaces) the player's round ticket. */
async function startRound({ uid, body }) {
  const role = String(body.role || '');
  if (!L.ROLES.includes(role)) fail('bad_role');
  const id = L.newRoundId(io.random);
  await players().doc(uid).set({ uid, round: { id, role, at: io.now() } }, { merge: true });
  return { roundId: id };
}

async function grantFrame(uid, skin, now) {
  const db = io.db();
  await Promise.all([
    db.ref(`users/${uid}/shop/ownedItems/profileFrame`).push(L.frameRecord(skin, now)),
    db.ref(`users/${uid}/shop/inventory`).push({
      itemId: L.frameId(skin.id), itemName: skin.name, type: 'profileFrame', rarity: skin.rarity,
      eggSource: 'manor', purchasedAt: now, expiresAt: -1, xpCost: 0, starCost: 0,
    }),
  ]);
}

const crateOut = (skin, isNew, left) => ({ crate: { skin: skin.id, rarity: skin.rarity, isNew }, left });

/** manorFinish { roundId, win } → { crate | null, left, capped? } */
async function finishRound({ uid, body }) {
  const now = io.now();
  const roundId = String(body.roundId || '');
  const win = body.win === true;
  const out = await io.fs().runTransaction(async (tx) => {
    const ref = players().doc(uid);
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    // The ticket pays once: it is cleared in this same transaction. A ticket
    // finished too fast or too late is cleared too, so it can't be retried.
    const problem = L.roundProblem(d.round, roundId, now);
    if (problem === 'no_round') fail('no_round');
    if (problem) { tx.update(ref, { round: null }); return { error: problem }; }
    const ticket = d.round;
    const owned = Array.isArray(d.owned) && d.owned.length ? d.owned.filter((id) => L.SKIN_IDS.includes(id)) : ['classic'];
    if (!owned.includes('classic')) owned.unshift('classic');
    const crates = L.todayCrates(d.crates, now);
    const next = {
      uid,
      owned,
      played: (Number(d.played) || 0) + 1,
      wins: (Number(d.wins) || 0) + (win ? 1 : 0),
      crates,
      round: null,
      lastRole: ticket.role,
      updatedAt: now,
    };
    let result = { crate: null, left: L.DAILY_CRATES - crates.n };
    if (win && crates.n >= L.DAILY_CRATES) result = { crate: null, left: 0, capped: true };
    else if (win) {
      const skin = L.rollSkin(io.random);
      const isNew = !owned.includes(skin.id);
      if (isNew) next.owned = [...owned, skin.id];
      next.crates = { ...crates, n: crates.n + 1 };
      next.lastWin = { id: roundId, at: now, doubled: false };
      result = { ...crateOut(skin, isNew, L.DAILY_CRATES - next.crates.n), grant: isNew ? skin : null };
    }
    tx.set(ref, next, { merge: true });
    return result;
  });
  if (out.error) fail(out.error);
  if (out.grant) await grantFrame(uid, out.grant, now);
  delete out.grant;
  return out;
}

/** manorDouble { roundId } → { crate } — one extra crate for the last win, after a rewarded ad. */
async function doubleCrate({ uid, body }) {
  const now = io.now();
  const roundId = String(body.roundId || '');
  const out = await io.fs().runTransaction(async (tx) => {
    const ref = players().doc(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('no_round');
    const d = snap.data();
    const w = d.lastWin;
    if (!w || w.id !== roundId || w.doubled) fail('no_round');
    if (now - Number(w.at) > L.DOUBLE_WINDOW_MS) fail('expired');
    const crates = L.todayCrates(d.crates, now);
    if (crates.d >= L.DAILY_DOUBLES) fail('capped');
    const skin = L.rollSkin(io.random);
    const owned = Array.isArray(d.owned) ? d.owned : ['classic'];
    const isNew = !owned.includes(skin.id);
    tx.set(ref, {
      owned: isNew ? [...owned, skin.id] : owned,
      crates: { ...crates, d: crates.d + 1 },
      lastWin: { ...w, doubled: true },
      updatedAt: now,
    }, { merge: true });
    return { ...crateOut(skin, isNew, L.DAILY_CRATES - crates.n), grant: isNew ? skin : null };
  });
  if (out.grant) await grantFrame(uid, out.grant, now);
  delete out.grant;
  return out;
}

module.exports = { io, ManorError, startRound, finishRound, doubleCrate };
