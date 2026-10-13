/**
 * emailUnsubscribe — the unsubscribe link in every MM2 Values email
 * (ported from Adopt Me's emailUnsubscribe.js, 2026-10-13).
 *
 *   GET  ?u=<uid>&t=<token>&l=<lang>  a page with one "Unsubscribe" button
 *        (a GET never changes anything: mail scanners open every link);
 *   POST the button, or a mail app's one-click unsubscribe (RFC 8058,
 *        "List-Unsubscribe=One-Click"): turns email off and says so.
 *
 * Turning email off writes RTDB email_prefs/{uid} = { optIn: false,
 * source: 'settings', updatedAt }, exactly what Settings → Email updates
 * writes (Code/Helper/emailOptIn.js saveEmailPrefs), so the app shows the
 * switch off and notifyBirthdayEmails skips the player. update() keeps a
 * stored `dob` untouched and adds no other field: database.rules.json rejects
 * any extra child ($other: false) and an immutable dob, so anything else
 * would make the app's own later writes to this node fail.
 *
 * The token is an HMAC of the uid (EMAIL_UNSUB_SECRET, birthdayEmail.js), so
 * a link only ever works for its own player. The Admin SDK bypasses the RTDB
 * rules; the app's reads and writes of email_prefs are unaffected.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { defineSecret } = require('firebase-functions/params');
const { PAGE, pickLang, escapeHtml, verifyUnsubToken } = require('./birthdayEmail');

if (!admin.apps.length) {
  admin.initializeApp();
}

const EMAIL_UNSUB_SECRET = defineSecret('EMAIL_UNSUB_SECRET');

// Firebase uids (birthdays/core.js okUid), at least 10 characters.
const UID_RE = /^[A-Za-z0-9_-]{10,128}$/;

const page = (lang, title, body, form) => {
  const l = pickLang(lang);
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;
  return `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)}</title>
<style>
  body{margin:0;background:#EEF0FB;font-family:Helvetica,Arial,sans-serif;color:#141A33}
  .card{max-width:420px;margin:48px auto;background:#fff;border-radius:22px;padding:30px 24px;text-align:center}
  h1{font-size:22px;margin:10px 0 8px} p{color:#454B66;font-size:15px;line-height:22px;margin:0 0 18px}
  button{background:#6A5ACD;color:#fff;border:0;border-radius:999px;font-size:16px;font-weight:800;padding:13px 26px;cursor:pointer}
</style></head>
<body><div class="card"><div style="font-size:44px">🎂</div>
<h1>${e(title)}</h1><p>${e(body)}</p>${form || ''}</div></body></html>`;
};

/** The request handler, separate from the trigger so the tests can call it. */
async function handle(req, res, { db, secret }) {
  const uid = String(req.query.u || '');
  const token = String(req.query.t || '');
  const lang = pickLang(req.query.l);
  const copy = PAGE[lang];
  res.set('Cache-Control', 'no-store');

  if (!UID_RE.test(uid) || !verifyUnsubToken(uid, token, secret)) {
    res.status(400).send(page(lang, copy.bad, '', ''));
    return;
  }

  if (req.method === 'GET') {
    const action = `?u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}&l=${encodeURIComponent(lang)}`;
    res.status(200).send(page(lang, copy.confirmTitle, copy.confirmBody,
      `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(copy.confirm)}</button></form>`));
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('');
    return;
  }

  try {
    await db.ref(`email_prefs/${uid}`).update({
      optIn: false,
      source: 'settings',
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    console.log('[emailUnsubscribe] unsubscribed', uid);
    res.status(200).send(page(lang, copy.doneTitle, copy.doneBody, ''));
  } catch (e) {
    console.error('[emailUnsubscribe] write failed:', e.message);
    res.status(500).send(page(lang, copy.bad, '', ''));
  }
}

exports.emailUnsubscribe = functions
  .runWith({ secrets: [EMAIL_UNSUB_SECRET], memory: '128MB', timeoutSeconds: 30 })
  .https.onRequest((req, res) => handle(req, res, {
    db: admin.database(),
    secret: EMAIL_UNSUB_SECRET.value(),
  }));

// Not a function: for the tests.
Object.defineProperty(exports, '_internals', { value: { handle, page, UID_RE }, enumerable: false });
