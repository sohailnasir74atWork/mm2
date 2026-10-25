#!/usr/bin/env node
/**
 * backfill-group-name-lower.js
 *
 * One-time seed for groups/{groupId}.groupNameLower (see
 * functions/syncGroupNameLower.js). The All Groups search matches on that
 * field, so groups created before it existed are not found until it is
 * written. After syncGroupNameLower is deployed every CHANGE to a group fills
 * it; this script fills it for every existing group. Ported from Adopt Me
 * 2026-10-25.
 *
 * Usage:
 *   node scripts/backfill-group-name-lower.js --dry-run   # count only
 *   node scripts/backfill-group-name-lower.js             # write
 *
 * Safe to re-run: groups that already match are skipped, and nothing but
 * groupNameLower is ever written.
 *
 * Needs serviceAccount.json in the repo root, or GOOGLE_APPLICATION_CREDENTIALS
 * (or gcloud application-default credentials).
 */
const path = require('path');
const fs = require('fs');

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE = 400;

function init() {
  if (admin.apps.length) return;
  const keyPath = path.resolve(__dirname, '..', 'serviceAccount.json');
  if (fs.existsSync(keyPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'mm2vlaues-ed80c' });
  }
}

async function main() {
  // init() BEFORE requiring the function module: it calls initializeApp() with
  // no options when no app exists, which would pick the gcloud default project
  // (adoptme-7b50c on this Mac) instead of mm2vlaues-ed80c.
  init();
  const { _internals: { toGroupNameLower } } = require(path.join(__dirname, '..', 'functions', 'syncGroupNameLower.js'));
  const db = admin.firestore();
  const writer = DRY_RUN ? null : db.bulkWriter();
  const FieldPath = admin.firestore.FieldPath;

  let cursor = null;
  let scanned = 0;
  let active = 0;
  let needs = 0;
  const samples = [];
  for (;;) {
    let q = db.collection('groups').orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const data = d.data();
      if (data.isActive === true) active++;
      const lower = toGroupNameLower(data);
      if (data.groupNameLower === lower) continue;
      needs++;
      if (samples.length < 5) samples.push(`${d.id}: ${JSON.stringify(data.groupName || data.name || '')} -> ${JSON.stringify(lower)}`);
      if (writer) writer.update(d.ref, { groupNameLower: lower });
    }
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (writer) await writer.close();

  console.log(`scanned ${scanned} groups (${active} active); ${needs} ${DRY_RUN ? 'need groupNameLower' : 'updated'}`);
  for (const s of samples) console.log(`  e.g. ${s}`);
  if (DRY_RUN && needs) console.log('dry run — re-run without --dry-run to write');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
