#!/usr/bin/env node
/**
 * scrub-public-emails.js — one-time removal of the email copies that old
 * builds wrote into public data before cutover.
 *
 * 📅 2026-09-27 (round 2). Old builds put the sender's email into every
 * public chat message (`currentUserEmail`), pinning copied it into
 * pin_messages, and every feed post carried `email`. All three are readable
 * signed out. After cutover, functions/emailPrivacy.js strips each new copy
 * on create (scrubChatEmails*, scrubPostEmails); this clears what was already
 * there.
 *
 * Do NOT run before cutover: until then old builds' moderation reads these
 * copies (admin Block/Unblock, feed Ban User, the report auto-bans).
 *
 * How much is there to do: chat rooms and designPosts keep 15 days
 * (functions/retention.js, daily 03:00 / 06:00 UTC), so without this script
 * every pre-cutover copy in them is gone 15–16 days after cutover anyway.
 * pin_messages has NO retention — pins keep their copy until scrubbed.
 *
 * Modes:
 *   (default)   dry run: count, write nothing
 *   --apply     remove the fields
 *   --only rtdb|firestore   restrict to one database
 *
 * Pages every node by key (orderByKey + limitToFirst) and designPosts by
 * document id — never one read of a whole node. Removes ONLY the email field;
 * every other field is left exactly as it is. Safe to re-run.
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
// The server-side list of rooms — the same one retention and the triggers use.
const { CHAT_CHANNEL_PATHS } = require('../functions/chatChannels');

const PROJECT_ID = 'mm2vlaues-ed80c';
const DATABASE_URL = 'https://mm2vlaues-ed80c-default-rtdb.firebaseio.com';
const RTDB_PATHS = [...CHAT_CHANNEL_PATHS, 'pin_messages'];
const PAGE = 500;
const FS_PAGE = 400;   // Firestore commit cap is 500

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

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

async function scrubRtdbPath(db, node) {
  let lastKey = null;
  let scanned = 0;
  let found = 0;
  for (;;) {
    let q = db.ref(node).orderByKey();
    q = lastKey === null ? q.limitToFirst(PAGE) : q.startAt(lastKey).limitToFirst(PAGE + 1);
    const snap = await q.once('value');
    const updates = {};
    let n = 0;
    snap.forEach((child) => {
      if (child.key === lastKey) return;
      n++;
      lastKey = child.key;
      const v = child.val();
      if (v && typeof v === 'object' && v.currentUserEmail !== undefined) {
        updates[`${node}/${child.key}/currentUserEmail`] = null;
        found++;
      }
    });
    scanned += n;
    if (APPLY && Object.keys(updates).length) await db.ref().update(updates);
    if (n < PAGE) break;
  }
  return { scanned, found };
}

async function scrubPosts(firestore) {
  let cursor = null;
  let scanned = 0;
  let found = 0;
  for (;;) {
    let q = firestore.collection('designPosts').orderBy('__name__').limit(FS_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = firestore.batch();
    let pending = 0;
    snap.docs.forEach((doc) => {
      scanned++;
      if (doc.get('email') !== undefined) {
        found++;
        batch.update(doc.ref, { email: admin.firestore.FieldValue.delete() });
        pending++;
      }
    });
    if (APPLY && pending) await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < FS_PAGE) break;
  }
  return { scanned, found };
}

async function main() {
  init();
  console.log(APPLY ? '✍️  APPLY — removing email copies' : '🔍 DRY RUN — nothing will be written');
  const verb = APPLY ? 'removed' : 'would remove';

  if (ONLY !== 'firestore') {
    const db = admin.database();
    for (const node of RTDB_PATHS) {
      const { scanned, found } = await scrubRtdbPath(db, node);
      console.log(`  ${node.padEnd(14)} scanned ${String(scanned).padStart(6)}   currentUserEmail ${verb}: ${found}`);
    }
  }
  if (ONLY !== 'rtdb') {
    const { scanned, found } = await scrubPosts(admin.firestore());
    console.log(`  ${'designPosts'.padEnd(14)} scanned ${String(scanned).padStart(6)}   email ${verb}: ${found}`);
  }
  if (!APPLY) console.log('\nRe-run with --apply (at cutover, after scrubChatEmails/scrubPostEmails are live).');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ scrub failed:', err);
  process.exit(1);
});
