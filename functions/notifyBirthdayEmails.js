/**
 * notifyBirthdayEmails — the birthday email: one email on the day to each
 * player whose birthday it is, nothing else. Ported 2026-10-13 from Adopt Me
 * (adoptme-jan7/functions/notifyBirthdayEmails.js + supabase/055), with the
 * Supabase claim replaced by RTDB claims, since MM2 is Firebase-only.
 *
 * Audience (the owner's rule for Adopt Me, kept here): EVERY player whose
 * birthday is today (UTC) and who turns 13 or older today, whatever their
 * email_prefs.optIn says EXCEPT an explicit optIn === false (Settings → Email
 * updates off, or the unsubscribe link). Never anyone under 13, never an
 * Apple "Hide My Email" relay address, never an account with no email.
 *
 * Once a day at 08:00 UTC:
 *   1. Candidates: birthday_index/{MMDD} (shown 13+ players) plus
 *      birthday_server/hidden13/{MMDD} (13+ players who hid their birthday:
 *      the email is private, so hiding it from other players doesn't stop
 *      it). On 28 Feb of a non-leap year '0229' is included too. Both lists
 *      are kept by birthdays/core.js reindexBirthday.
 *   2. Re-checks each one at send time: a valid date of birth whose birthday
 *      is today and who is 13+ today (users_private/dateOfBirth, else
 *      email_prefs/dob: core.js effectiveDob), not opted out, not already
 *      emailed this year.
 *   3. Takes the address from Firebase Auth (Google, Apple or email
 *      accounts; disabled accounts skipped), else users_private/{uid}/email.
 *   4. Reserves today's quota (birthday_server/email_day), claims the player
 *      once per birthday year (birthday_server/email_sent/{year}/{uid},
 *      create-only transaction), and only then sends. A retried, crashed or
 *      duplicated run can never email anyone twice: whoever loses the claim
 *      skips them. A send that fails after its claim is NOT retried (Brevo
 *      may have accepted it) — the same choice as Adopt Me.
 *   5. Language: the app language Trade Match records (trade_index/user/{uid}/l),
 *      else English. Name: users/{uid}/displayName. Gift copy ("your 15 ⭐
 *      stars are waiting") only when the account is 30+ days old, the
 *      Birthdays gift rule (core.js claimBirthdayGift); otherwise "players can
 *      wish you today".
 *
 * Cap: Brevo's free plan allows 300 emails a day for the whole account,
 * shared with Adopt Me (150, 08:00 UTC) and Blox Fruits (120 planned), so MM2
 * sends at most MAX_SENDS a UTC day, counted in RTDB so a second run the same
 * day can't go over it. Anyone past the cap gets no email (never a late one:
 * tomorrow their birthday isn't today).
 *
 * 08:00 UTC: the birthday's UTC date is already the local date almost
 * everywhere (03:00 in New York, 13:00 in Karachi, 18:00 in Sydney).
 *
 * RTDB written here (all inside birthday_server, already .read/.write false):
 *   birthday_server/email_sent/{year}/{uid}  ms of the claim; years before
 *                                            last year are dropped each run
 *   birthday_server/email_day                { 'YYYY-MM-DD': sent today }
 *
 * DEPLOY, THEN PAUSE: see the comment at its export in index.js.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { defineSecret } = require('firebase-functions/params');
const D = require('./birthdays/dates');
const { renderBirthdayEmail, sendBrevo, unsubUrl, cleanName, pickLang } = require('./birthdayEmail');

if (!admin.apps.length) {
  admin.initializeApp();
}

const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
const EMAIL_UNSUB_SECRET = defineSecret('EMAIL_UNSUB_SECRET');

const MAX_SENDS = 100;          // per UTC day; Brevo's free 300/day is shared (Adopt Me 150, Blox 120 planned)
const MIN_AGE = 13;             // birthdays/core.js MIN_AGE
const ACCOUNT_MIN_DAYS = 30;    // birthdays/core.js ACCOUNT_MIN_DAYS (gift rule)
const AUTH_BATCH = 100;         // Firebase Auth getUsers() limit
const READ_CONCURRENCY = 20;
const SEND_CONCURRENCY = 5;
const SKIP_APPLE_RELAY = true;  // until mm2values.app is registered for Sign in with Apple email relay
const APPLE_RELAY_RE = /@privaterelay\.appleid\.com$/i;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const valOf = async (db, path) => (await db.ref(path).once('value')).val();

// Small worker pool so one slow request doesn't hold up the rest.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

const accountOldEnough = (createdAt, now) => {
  const c = Number(createdAt);
  return !c || c <= now - ACCOUNT_MIN_DAYS * D.DAY_MS;
};

/** Every indexed uid (shown or hidden) whose birthday key is today. */
async function candidates(db, today) {
  const paths = D.keysForDate(today).flatMap((k) => [`birthday_index/${k}`, `birthday_server/hidden13/${k}`]);
  const nodes = await Promise.all(paths.map((p) => valOf(db, p)));
  const set = new Set();
  nodes.forEach((n) => Object.keys(n || {}).forEach((uid) => { if (UID_RE.test(uid)) set.add(uid); }));
  return [...set].sort();
}

/**
 * Is it this player's 13+ birthday today? Same DOB sources and the same
 * calendar rules as birthdays/core.js (29 Feb → 28 Feb in non-leap years).
 */
async function birthdayCheck(db, uid, today) {
  const [priv, emailDob] = await Promise.all([
    valOf(db, `users_private/${uid}/dateOfBirth`),
    valOf(db, `email_prefs/${uid}/dob`),
  ]);
  const dob = D.parseDate(priv) || D.parseDate(emailDob);
  if (!dob || !D.sameDate(D.birthdayOn(today.y, dob.m, dob.d), today)) return 'notToday';
  const age = D.ageOn(dob, today);
  if (age == null || age < MIN_AGE) return 'under13';
  return null;
}

/** uid → address, from Firebase Auth (100 per call), else users_private. */
async function emailsFor(db, auth, uids) {
  const out = {};
  const gone = new Set();
  for (let i = 0; i < uids.length; i += AUTH_BATCH) {
    const chunk = uids.slice(i, i + AUTH_BATCH);
    const res = await auth.getUsers(chunk.map((uid) => ({ uid })));
    const found = new Set();
    for (const u of res.users) {
      found.add(u.uid);
      if (u.disabled) { gone.add(u.uid); continue; }
      if (u.email) out[u.uid] = u.email;
    }
    chunk.forEach((uid) => { if (!found.has(uid)) gone.add(uid); }); // deleted accounts
  }
  const missing = uids.filter((uid) => !out[uid] && !gone.has(uid));
  const stored = await pool(missing, READ_CONCURRENCY, (uid) => valOf(db, `users_private/${uid}/email`));
  missing.forEach((uid, k) => {
    const e = stored[k];
    if (typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())) out[uid] = e.trim();
  });
  return out;
}

/** Reserve up to `want` of today's sends. Resolves how many were granted. */
async function takeQuota(db, day, want) {
  let granted = 0;
  const res = await db.ref('birthday_server/email_day').transaction((cur) => {
    const n = Number(cur && cur[day]) || 0;
    granted = Math.max(0, Math.min(want, MAX_SENDS - n));
    if (granted <= 0) return undefined;
    return { [day]: n + granted }; // older days drop off
  }, undefined, false);
  return res.committed ? granted : 0;
}

async function giveBackQuota(db, day, k) {
  if (k <= 0) return;
  await db.ref(`birthday_server/email_day/${day}`)
    .transaction((n) => Math.max(0, (Number(n) || 0) - k), undefined, false);
}

/** Create-once claim: true only for the call that created the path. */
async function claimOnce(db, path, value) {
  const res = await db.ref(path).transaction((cur) => (cur == null ? value : undefined), undefined, false);
  return res.committed;
}

async function run({ db, auth, apiKey, unsubSecret, now = Date.now(), log = console.log }) {
  if (!apiKey || !unsubSecret) throw new Error('BREVO_API_KEY / EMAIL_UNSUB_SECRET not set');
  const stats = {
    candidates: 0, notToday: 0, under13: 0, optedOut: 0, alreadySent: 0,
    noEmail: 0, appleRelay: 0, overCap: 0, claimed: 0, sent: 0, failed: 0,
  };
  const today = D.utcToday(now);
  const year = today.y;
  const day = D.isoOf(today);

  // Retention: a claim only matters within its birthday year.
  await db.ref(`birthday_server/email_sent/${year - 2}`).remove();

  const uids = await candidates(db, today);
  stats.candidates = uids.length;

  // Reads only: who is due, and not opted out or already emailed this year.
  const checked = await pool(uids, READ_CONCURRENCY, async (uid) => {
    const [why, optIn, sent] = await Promise.all([
      birthdayCheck(db, uid, today),
      valOf(db, `email_prefs/${uid}/optIn`),
      valOf(db, `birthday_server/email_sent/${year}/${uid}`),
    ]);
    if (why) return why;
    if (optIn === false) return 'optedOut';
    if (sent != null) return 'alreadySent';
    return null;
  });
  const due = [];
  uids.forEach((uid, k) => { if (checked[k]) stats[checked[k]] += 1; else due.push(uid); });

  const emails = await emailsFor(db, auth, due);
  const ready = [];
  for (const uid of due) {
    const email = emails[uid];
    if (!email) { stats.noEmail += 1; continue; }
    if (SKIP_APPLE_RELAY && APPLE_RELAY_RE.test(email)) { stats.appleRelay += 1; continue; }
    ready.push({ uid, email });
  }

  // Today's quota: reserve up front, give back what wasn't used.
  const granted = await takeQuota(db, day, ready.length);
  stats.overCap = ready.length - granted;
  const todo = ready.slice(0, granted);
  let used = 0;

  await pool(todo, SEND_CONCURRENCY, async ({ uid, email }) => {
    const [name, createdAt, lang] = await Promise.all([
      valOf(db, `users/${uid}/displayName`),
      valOf(db, `users/${uid}/createdAt`),
      valOf(db, `trade_index/user/${uid}/l`),
    ]);
    if (!(await claimOnce(db, `birthday_server/email_sent/${year}/${uid}`, now))) {
      stats.alreadySent += 1; // a parallel or earlier run got there first
      return;
    }
    stats.claimed += 1;
    const l = pickLang(lang);
    const unsubscribeUrl = unsubUrl(uid, l, unsubSecret);
    const mail = renderBirthdayEmail({ name, gift: accountOldEnough(createdAt, now), lang: l, unsubscribeUrl });
    try {
      await sendBrevo({ apiKey, to: email, toName: cleanName(name), unsubscribeUrl, ...mail });
      stats.sent += 1;
      used += 1;
    } catch (e) {
      stats.failed += 1;
      used += 1; // Brevo may still have counted it; don't hand the slot back
      log('[notifyBirthdayEmails] send failed:', e.message);
    }
  });
  await giveBackQuota(db, day, granted - used);

  log('[notifyBirthdayEmails]', JSON.stringify(stats));
  return stats;
}

exports.notifyBirthdayEmails = functions
  .runWith({ secrets: [BREVO_API_KEY, EMAIL_UNSUB_SECRET], memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every day 08:00')
  .timeZone('UTC')
  .onRun(() => run({
    db: admin.database(),
    auth: admin.auth(),
    apiKey: BREVO_API_KEY.value(),
    unsubSecret: EMAIL_UNSUB_SECRET.value(),
  }).then(() => null));

// Not a function: for the tests.
Object.defineProperty(exports, '_internals', {
  value: { run, candidates, birthdayCheck, emailsFor, takeQuota, MAX_SENDS, MIN_AGE, ACCOUNT_MIN_DAYS },
  enumerable: false,
});
