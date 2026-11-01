/**
 * fantasy/index.js — the Fantasy League Cloud Functions (2026-10-30).
 * Rules in logic.js, reads/writes in core.js; this file only wires them.
 * All v1, us-central1 (the default), like the rest of functions/.
 *
 * HTTPS, POST JSON, Authorization: Bearer <Firebase ID token>. 200 with the
 * result, or 4xx/5xx { error } where error is one of sign_in, no_round,
 * closed, bad_picks, already_joined, not_joined, no_swaps, bad_guess,
 * no_guess, already_guessed, banned, try_later, generic (the app maps them
 * to fantasy.err.*):
 *   fantasyJoin, fantasySwap, fantasyGuess
 *
 * Scheduled: fantasyTick every 60 minutes (UTC).
 *
 * Deploy by name only (never a bare `--only functions`):
 *   firebase deploy --only functions:fantasyJoin,functions:fantasySwap,functions:fantasyGuess,functions:fantasyTick --project mm2vlaues-ed80c
 * Firestore rules first (managed() must list the fantasy_* collections, or
 * the signed-in catch-all would let players write their own scores).
 */

const functions = require('firebase-functions/v1');
const core = require('./core');

const { io, FantasyError } = core;

/** Wrap a core handler ({ uid, body }) as a token-verified JSON endpoint. */
async function handleRequest(handler, req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'generic' });
    return;
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  let uid = null;
  if (m) {
    try {
      uid = (await io.verifyIdToken(m[1])).uid;
    } catch (_) {
      uid = null;
    }
  }
  if (!uid) {
    res.status(401).json({ error: 'sign_in' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    res.status(200).json(await handler({ uid, body }));
  } catch (e) {
    if (e instanceof FantasyError) {
      res.status(e.status || 400).json({ error: e.code });
    } else {
      console.error('[fantasy]', e && e.message);
      res.status(500).json({ error: 'generic' });
    }
  }
}

const endpoint = (handler) => functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest((req, res) => handleRequest(handler, req, res));

exports.fantasyJoin = endpoint(core.joinRound);
exports.fantasySwap = endpoint(core.swapPick);
exports.fantasyGuess = endpoint(core.submitGuess);

exports.fantasyTick = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(() => core.runTick().then(() => null));

// Not functions: for the tests.
Object.defineProperty(exports, '_internal', { value: { handleRequest, core }, enumerable: false });
