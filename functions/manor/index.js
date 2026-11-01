/**
 * manor/index.js — Lights Out Manor Cloud Functions (2026-10-30).
 * Rules in logic.js, reads/writes in core.js; this file only wires them.
 *
 * HTTPS, POST JSON, Authorization: Bearer <Firebase ID token>. 200 with the
 * result, or 4xx/5xx { error } where error is one of sign_in, bad_role,
 * no_round, too_fast, expired, capped, generic:
 *   manorStart, manorFinish, manorDouble
 *
 * Deploy by name only (never a bare `--only functions`), Firestore rules
 * first (managed() must list manor_players):
 *   firebase deploy --only functions:manorStart,functions:manorFinish,functions:manorDouble --project mm2vlaues-ed80c
 */

const functions = require('firebase-functions/v1');
const core = require('./core');

const { io, ManorError } = core;

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
    if (e instanceof ManorError) res.status(e.status || 400).json({ error: e.code });
    else {
      console.error('[manor]', e && e.message);
      res.status(500).json({ error: 'generic' });
    }
  }
}

const endpoint = (handler) => functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest((req, res) => handleRequest(handler, req, res));

exports.manorStart = endpoint(core.startRound);
exports.manorFinish = endpoint(core.finishRound);
exports.manorDouble = endpoint(core.doubleCrate);

Object.defineProperty(exports, '_internal', { value: { handleRequest, core }, enumerable: false });
