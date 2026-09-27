#!/usr/bin/env node
/**
 * migrate-user-pii.js — move legacy emails out of users/{uid}.
 *
 * 📅 2026-09-27 (round 2). users/{uid} is readable by anyone (the website
 * reads single profiles signed out) and any signed-in user may write another
 * user's non-role fields, so an email there is public. Some legacy records
 * still carry `email` and/or `decodedEmail` (`name(dot)domain(dot)tld`). This
 * moves them to users_private/{uid}/email — owner + staff only — as the
 * lowercased raw address, preferring the Firebase Auth email when the
 * account still exists (same rule as functions/emailPrivacy.js
 * privatizeUserPII, which handles anything written after cutover).
 *
 * A second pass copies the Auth email of EVERY account into users_private.
 * MM2 clients never wrote emails into users/{uid}, so most accounts have no
 * legacy leaf to move, and old builds never write users_private — without
 * this pass a new build's staff tools could not find the email of anyone
 * who has not yet signed in on a new build or the website. New accounts are
 * covered from then on by functions/privateEmailOnSignup.js.
 *
 * Modes:
 *   (default)     dry run: read and count, write nothing
 *   --copy-only   write users_private, leave users/{uid} as it is. Safe at
 *                 step (a): old builds' staff tools still find the email in
 *                 users/{uid}, and new builds find it in users_private.
 *   --apply       write users_private AND remove both legacy leaves. CUTOVER
 *                 only — from then on old builds' staff tools see no email.
 *   --skip-auth   skip the all-accounts Auth pass
 *   --limit N     stop after N user records / N Auth accounts (try a slice)
 *   --batch N     records per page (default 500)
 *
 * Pages /users by key (orderByKey + limitToFirst) — it never downloads the
 * whole node in one read. It does read every record once: the pass costs
 * roughly the size of /users in RTDB download (printed at the end).
 *
 * Records whose KEY is an encoded email instead of a uid are reported and
 * never touched. Keys that look like other personal data (anything matching
 * /mail|birth|dob/i besides the two moved leaves) are counted, not moved.
 *
 * Safe to re-run: a record with no legacy leaf is skipped, and a
 * users_private value that is already correct is not rewritten.
 *
 * Needs serviceAccount.json in the repo root, GOOGLE_APPLICATION_CREDENTIALS,
 * or gcloud application-default credentials.
 */

const path = require('path');
const fs = require('fs');

const loadAdmin = () => {
  try { return require('firebase-admin'); } catch (_) {
    return require(require.resolve('firebase-admin', { paths: [path.resolve(__dirname, '..', 'functions')] }));
  }
};
const admin = loadAdmin();

const PROJECT_ID = 'mm2vlaues-ed80c';
const DATABASE_URL = 'https://mm2vlaues-ed80c-default-rtdb.firebaseio.com';
const LEGACY_LEAVES = ['email', 'decodedEmail'];

// ── args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const COPY_ONLY = args.includes('--copy-only');
const numArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? parseInt(args[i + 1], 10) : fallback;
};
const LIMIT = numArg('--limit', Infinity);
const PAGE = numArg('--batch', 500);
const SKIP_AUTH = args.includes('--skip-auth');
const WRITE = APPLY || COPY_ONLY;
if (APPLY && COPY_ONLY) {
  console.error('Pass --copy-only OR --apply, not both.');
  process.exit(1);
}

function init() {
  if (admin.apps.length) return;
  const opts = { projectId: PROJECT_ID, databaseURL: DATABASE_URL };
  const keyPath = path.resolve(__dirname, '..', 'serviceAccount.json');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(keyPath)) {
    admin.initializeApp({ ...opts, credential: admin.credential.cert(require(keyPath)) });
  } else {
    admin.initializeApp({ ...opts, credential: admin.credential.applicationDefault() });
  }
}

// Legacy writers stored `name(dot)domain(dot)tld`, a few used commas.
const decodeEmail = (value) => {
  if (!value || typeof value !== 'string') return null;
  const clean = value.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return clean.includes('@') ? clean : null;
};
const isEmailKey = (key) => /@|\(dot\)|,/.test(String(key || ''));
const OTHER_PII = /mail|birth|dob/i;

// uid → Auth email (raw), for up to 100 uids per call.
async function authEmails(uids) {
  const out = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    res.users.forEach((u) => { if (u.email) out.set(u.uid, u.email); });
  }
  return out;
}

// Pass 2: every Auth account's email → users_private, 1000 per page (the
// listUsers maximum), one multi-path update per page. Idempotent — the value
// is the same every time.
async function authPass(db) {
  const out = { accounts: 0, withEmail: 0 };
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    const updates = {};
    for (const u of res.users) {
      if (out.accounts >= LIMIT) break;
      out.accounts++;
      const e = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
      if (!e) continue;
      out.withEmail++;
      updates[`users_private/${u.uid}/email`] = e;
    }
    if (WRITE && Object.keys(updates).length) await db.ref().update(updates);
    pageToken = res.pageToken;
    console.log(`  auth accounts ${out.accounts}  with email ${out.withEmail}`);
  } while (pageToken && out.accounts < LIMIT);
  return out;
}

async function main() {
  init();
  const db = admin.database();

  console.log(
    APPLY ? '✍️  APPLY — copying to users_private and REMOVING users/{uid}/email + decodedEmail'
      : COPY_ONLY ? '✍️  COPY ONLY — writing users_private; users/{uid} untouched'
        : '🔍 DRY RUN — nothing will be written',
  );

  const stats = {
    scanned: 0, withLegacy: 0, fromAuth: 0, fromLegacy: 0, alreadyPrivate: 0,
    privateWrites: 0, leavesRemoved: 0, noUsableEmail: 0, bytes: 0,
  };
  const emailKeys = [];
  const otherPii = new Map(); // key name → count

  let lastKey = null;
  for (;;) {
    let q = db.ref('users').orderByKey();
    // startAt is inclusive; ask for one extra and drop the repeat.
    q = lastKey === null ? q.limitToFirst(PAGE) : q.startAt(lastKey).limitToFirst(PAGE + 1);
    const snap = await q.once('value');
    const page = [];
    snap.forEach((child) => {
      if (child.key !== lastKey) page.push([child.key, child.val()]);
    });
    if (page.length === 0) break;

    const candidates = [];
    for (const [key, rec] of page) {
      if (stats.scanned >= LIMIT) break;
      stats.scanned++;
      stats.bytes += (JSON.stringify(rec) || '').length; // ~bytes; close enough for a cost estimate
      if (!rec || typeof rec !== 'object') continue;

      for (const k of Object.keys(rec)) {
        if (!LEGACY_LEAVES.includes(k) && OTHER_PII.test(k)) otherPii.set(k, (otherPii.get(k) || 0) + 1);
      }
      const hasLegacy = LEGACY_LEAVES.some((leaf) => rec[leaf] !== undefined && rec[leaf] !== null);
      if (!hasLegacy) continue;
      if (isEmailKey(key)) { emailKeys.push(key); continue; }
      stats.withLegacy++;
      candidates.push([key, rec]);
    }

    if (candidates.length) {
      const fromAuth = await authEmails(candidates.map(([uid]) => uid));
      const privSnaps = await Promise.all(candidates.map(([uid]) => db.ref(`users_private/${uid}/email`).once('value')));
      const updates = {};
      candidates.forEach(([uid, rec], i) => {
        const authEmail = fromAuth.get(uid);
        const email = (authEmail ? authEmail.trim().toLowerCase() : null)
          || decodeEmail(rec.email) || decodeEmail(rec.decodedEmail);
        if (authEmail) stats.fromAuth++; else if (email) stats.fromLegacy++;
        if (!email) stats.noUsableEmail++;

        if (email && privSnaps[i].val() === email) stats.alreadyPrivate++;
        else if (email) { updates[`users_private/${uid}/email`] = email; stats.privateWrites++; }

        if (APPLY) {
          LEGACY_LEAVES.forEach((leaf) => {
            if (rec[leaf] !== undefined && rec[leaf] !== null) { updates[`users/${uid}/${leaf}`] = null; stats.leavesRemoved++; }
          });
        }
      });
      if (WRITE && Object.keys(updates).length) await db.ref().update(updates);
    }

    lastKey = page[page.length - 1][0];
    console.log(`  scanned ${stats.scanned}  with legacy email ${stats.withLegacy}  users_private writes ${stats.privateWrites}${APPLY ? `  leaves removed ${stats.leavesRemoved}` : ''}`);
    if (page.length < PAGE || stats.scanned >= LIMIT) break;
  }

  const w = WRITE ? '' : ' (would have)';
  console.log('\n── done ──');
  console.log(`  records scanned        : ${stats.scanned}  (~${(stats.bytes / 1048576).toFixed(1)} MB downloaded)`);
  console.log(`  with email/decodedEmail: ${stats.withLegacy}`);
  console.log(`    email from Auth      : ${stats.fromAuth}`);
  console.log(`    email from the leaf  : ${stats.fromLegacy}  (no Auth account)`);
  console.log(`    no usable email      : ${stats.noUsableEmail}`);
  console.log(`  users_private written  : ${stats.privateWrites}${w}`);
  console.log(`  users_private correct  : ${stats.alreadyPrivate}  (skipped)`);
  if (APPLY || !WRITE) console.log(`  legacy leaves removed  : ${APPLY ? stats.leavesRemoved : 0}${APPLY ? '' : ' (only with --apply)'}`);
  console.log(`  email-KEYED records    : ${emailKeys.length}  (reported, not touched)`);
  emailKeys.slice(0, 50).forEach((k) => console.log(`      users/${k}`));
  if (emailKeys.length > 50) console.log(`      … and ${emailKeys.length - 50} more`);
  if (otherPii.size) {
    console.log('  other personal-looking keys (not moved — review):');
    [...otherPii.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`      ${k}: ${n}`));
  }

  if (!SKIP_AUTH) {
    console.log('\n── Auth pass: every account → users_private ──');
    const auth = await authPass(db);
    console.log(`  Auth accounts          : ${auth.accounts}`);
    console.log(`  users_private written  : ${auth.withEmail}${w}  (accounts with an email)`);
  }
  if (!WRITE) console.log('\nRe-run with --copy-only (step a) or --apply (cutover) to write.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ migration failed:', err);
  process.exit(1);
});
