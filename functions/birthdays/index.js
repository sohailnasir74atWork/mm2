/**
 * birthdays/index.js — the Birthdays Cloud Functions (BIRTHDAYS_PLAN.md).
 * Logic lives in core.js; this file only wires it to triggers, HTTPS and
 * schedules. All v1, us-central1 (the default), like the rest of functions/.
 *
 * Index maintenance (RTDB onWrite → reindexBirthday(uid)):
 *   birthdayIndexOnDob       users_private/{uid}/dateOfBirth
 *   birthdayIndexOnEmailDob  email_prefs/{uid}/dob
 *   birthdayIndexOnShow      birthday_prefs/{uid}/show
 *
 * HTTPS, POST JSON, Authorization: Bearer <Firebase ID token>. 200 with the
 * result, or 4xx/5xx { error } where error is one of sign_in, not_today,
 * already_wished, limit, cannot_wish, bad_date, already_edited, age_change,
 * gift_unavailable, generic (the app maps them to birthdays.err.*):
 *   birthdayTop, sendBirthdayWish, wishAllBirthdays, thankBirthdayWishers,
 *   claimBirthdayGift, updateMyBirthday, myBirthday
 *
 * Scheduled (UTC): refreshBirthdayAges 03:30, notifyBirthdays 14:00.
 *
 * Deploy by name only (HANDOFF.md §6 — never a bare `--only functions`).
 * The full command is in the header of functions/index.js.
 */

const functions = require('firebase-functions/v1');
const core = require('./core');

const { io, BirthdayError } = core;

const STATUS_FOR = { sign_in: 401 };

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
    res.status(STATUS_FOR.sign_in).json({ error: 'sign_in' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    res.status(200).json(await handler({ uid, body }));
  } catch (e) {
    if (e instanceof BirthdayError) {
      res.status(e.status || 400).json({ error: e.code });
    } else {
      console.error('[birthdays]', e && e.message);
      res.status(500).json({ error: 'generic' });
    }
  }
}

const endpoint = (handler, opts = {}) => functions
  .runWith({ memory: '256MB', timeoutSeconds: 60, ...opts })
  .https.onRequest((req, res) => handleRequest(handler, req, res));

const reindexOn = (path) => functions
  .runWith({ memory: '128MB', timeoutSeconds: 60 })
  .database.ref(path)
  .onWrite((change, context) => core.reindexBirthday(context.params.uid).then(() => null));

exports.birthdayIndexOnDob = reindexOn('/users_private/{uid}/dateOfBirth');
exports.birthdayIndexOnEmailDob = reindexOn('/email_prefs/{uid}/dob');
exports.birthdayIndexOnShow = reindexOn('/birthday_prefs/{uid}/show');

exports.birthdayTop = endpoint(core.birthdayTop);
exports.sendBirthdayWish = endpoint(core.sendBirthdayWish);
exports.wishAllBirthdays = endpoint(core.wishAllBirthdays, { timeoutSeconds: 120 });
exports.thankBirthdayWishers = endpoint(core.thankBirthdayWishers, { timeoutSeconds: 120 });
exports.claimBirthdayGift = endpoint(core.claimBirthdayGift);
exports.updateMyBirthday = endpoint(core.updateMyBirthday);
exports.myBirthday = endpoint(core.myBirthday);

exports.refreshBirthdayAges = functions
  .runWith({ memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every day 03:30')
  .timeZone('UTC')
  .onRun(() => core.runRefreshBirthdayAges().then(() => null));

exports.notifyBirthdays = functions
  .runWith({ memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every day 14:00')
  .timeZone('UTC')
  .onRun(() => core.runNotifyBirthdays().then(() => null));

// Not functions: for the tests.
Object.defineProperty(exports, '_internal', { value: { handleRequest, core }, enumerable: false });
