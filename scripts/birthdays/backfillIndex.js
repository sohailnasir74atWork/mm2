#!/usr/bin/env node
/**
 * backfillIndex.js — build birthday_index / birthday_counts for every player
 * who already has a date of birth (BIRTHDAYS_PLAN.md). Run ONCE by the lead,
 * after the birthday functions and rules are deployed; the index triggers
 * keep it right from then on.
 *
 * Walks users_private (dateOfBirth) and email_prefs (dob) page by page
 * (orderByKey + limitToFirst — never the whole node in one read), collects
 * every uid with a DOB in either, and runs the same reindexBirthday() the
 * triggers use (functions/birthdays/core.js). That is idempotent — counts
 * move only when an entry actually appears or disappears — so the script is
 * safe to re-run, or to run while the triggers are live.
 *
 * Target (one is required; nothing runs without it):
 *   --prod          the live database (project mm2vlaues-ed80c unless --project)
 *   --emulator      the RTDB emulator at FIREBASE_DATABASE_EMULATOR_HOST
 *                   (project demo-mm2 unless --project)
 *
 * Modes:
 *   (default)       dry run: page through both nodes and count, write nothing
 *   --apply         reindex every uid found
 *   --limit N       stop after N uids (try a slice first)
 *   --batch N       records per page (default 1000)
 *   --project ID    override the project id
 *
 *   node scripts/birthdays/backfillIndex.js --prod            # count
 *   node scripts/birthdays/backfillIndex.js --prod --apply    # build the index
 *
 * Production needs serviceAccount.json in the repo root,
 * GOOGLE_APPLICATION_CREDENTIALS, or gcloud application-default credentials.
 * Cost: one download of users_private + email_prefs (small leaves), then
 * ~6 reads and a few writes per uid with a DOB.
 */

const path = require('path');
const fs = require('fs');

const FUNCTIONS_DIR = path.resolve(__dirname, '..', '..', 'functions');
// The same firebase-admin instance functions/birthdays/core.js uses.
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_DIR] }));

const PROD_PROJECT = 'mm2vlaues-ed80c';
const CONCURRENCY = 25;

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * The backfill itself (also called by functions/test/birthdays.test.js).
 * Uses whatever admin app is already initialised.
 */
async function backfill({ apply = false, limit = Infinity, page = 1000, log = console.log } = {}) {
  const core = require(path.join(FUNCTIONS_DIR, 'birthdays', 'core'));
  const db = core.io.db();
  const uids = new Set();
  let scanned = 0;

  for (const [node, field] of [['users_private', 'dateOfBirth'], ['email_prefs', 'dob']]) {
    let last = null;
    for (;;) {
      let q = db.ref(node).orderByKey();
      if (last != null) q = q.startAfter(last);
      const snap = await q.limitToFirst(page).once('value');
      let n = 0;
      snap.forEach((child) => {
        n += 1;
        last = child.key;
        const v = child.val();
        if (v && typeof v === 'object' && typeof v[field] === 'string' && core.okUid(child.key)) uids.add(child.key);
      });
      scanned += n;
      if (n < page || uids.size >= limit) break;
    }
    if (uids.size >= limit) break;
  }

  const todo = [...uids].slice(0, limit);
  log(`[backfill] scanned ${scanned} records, ${todo.length} uids with a date of birth`);
  if (!apply) {
    log('[backfill] dry run: nothing written (pass --apply to build the index)');
    return { scanned, uids: todo.length, indexed: 0, pending: 0, hidden: 0 };
  }

  let indexed = 0;
  let pending = 0;
  let done = 0;
  await mapLimit(todo, CONCURRENCY, async (uid) => {
    const r = await core.reindexBirthday(uid);
    if (r.key) indexed += 1;
    else if (r.pending) pending += 1;
    done += 1;
    if (done % 1000 === 0) log(`[backfill] ${done}/${todo.length}`);
  });
  const hidden = todo.length - indexed - pending;
  log(`[backfill] done: ${indexed} indexed, ${pending} under 13 (pending), ${hidden} hidden or invalid`);
  return { scanned, uids: todo.length, indexed, pending, hidden };
}

function init({ emulator, project }) {
  if (admin.apps.length) return;
  if (emulator) {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host) throw new Error('--emulator needs FIREBASE_DATABASE_EMULATOR_HOST');
    const projectId = project || 'demo-mm2';
    admin.initializeApp({ projectId, databaseURL: `http://${host}?ns=${projectId}-default-rtdb` });
    return;
  }
  const projectId = project || PROD_PROJECT;
  const opts = { projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` };
  const keyPath = path.resolve(__dirname, '..', '..', 'serviceAccount.json');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(keyPath)) {
    admin.initializeApp({ ...opts, credential: admin.credential.cert(require(keyPath)) });
  } else {
    admin.initializeApp({ ...opts, credential: admin.credential.applicationDefault() });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const emulator = args.includes('--emulator');
  const prod = args.includes('--prod');
  if (emulator === prod) {
    console.error('Pick a target: --prod (live database) or --emulator. See the header of this file.');
    process.exit(1);
  }
  if (prod && process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    console.error('FIREBASE_DATABASE_EMULATOR_HOST is set: unset it to target production, or pass --emulator.');
    process.exit(1);
  }
  init({ emulator, project: arg('--project') });
  backfill({
    apply: args.includes('--apply'),
    limit: arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity,
    page: arg('--batch') ? parseInt(arg('--batch'), 10) : 1000,
  })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[backfill] failed:', e);
      process.exit(1);
    });
}

module.exports = { backfill };
