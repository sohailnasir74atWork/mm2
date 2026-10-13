#!/usr/bin/env node
/**
 * backfillIndex.js — build trade_index/* (Trade Match) for every player who
 * already has lists in Firestore reviews/{uid}. Run ONCE by the lead, after
 * the trade_index rules and the tradeMatchIndex function are deployed; the
 * trigger keeps the index right from then on.
 *
 * Pages through the `reviews` collection by document id (never all at once),
 * skips the review documents themselves ("{toUid}_{fromUid}") and players
 * with nothing listed, and runs the same reindexUser() the trigger uses
 * (functions/tradeMatch.js). Every entry is stamped with the document's own
 * `updatedAt` (or its last write time), so players who have not touched their
 * lists in months rank behind active ones, exactly as if the trigger had
 * indexed them back then.
 *
 * Safe to re-run, or to run while the trigger is live: a summary already
 * holding the same or a newer document version is left alone, and a
 * summary's first write never sends a dream alert (tradeMatchDreamAlerts
 * skips creations), so this cannot set off pushes.
 *
 * Target (one is required; nothing runs without it):
 *   --prod          the live project (mm2vlaues-ed80c unless --project)
 *   --emulator      the emulators at FIREBASE_DATABASE_EMULATOR_HOST and
 *                   FIRESTORE_EMULATOR_HOST (project demo-mm2 unless --project)
 *
 * Modes:
 *   (default)       dry run: read and count, write nothing
 *   --apply         write the index
 *   --limit N       stop after N player documents with lists (try a slice)
 *   --batch N       documents per page (default 500)
 *   --project ID    override the project id
 *
 *   node scripts/trade-match/backfillIndex.js --prod            # count
 *   node scripts/trade-match/backfillIndex.js --prod --apply    # build it
 *
 * Production needs serviceAccount.json in the repo root,
 * GOOGLE_APPLICATION_CREDENTIALS, or gcloud application-default credentials.
 * Cost: one Firestore read per reviews document (review documents included),
 * then per indexed player one small RTDB read and one multi-path update.
 */

const path = require('path');
const fs = require('fs');

const FUNCTIONS_DIR = path.resolve(__dirname, '..', '..', 'functions');
// The same firebase-admin instance functions/tradeMatch.js uses.
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_DIR] }));

const PROD_PROJECT = 'mm2vlaues-ed80c';
const CONCURRENCY = 20;
const FIELDS = ['ownedPets', 'wishlistPets', 'dreamItemKey', 'tradeMatchLang', 'updatedAt'];

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
 * The backfill itself (also callable from tests). Uses whatever admin app is
 * already initialised.
 */
async function backfill({ apply = false, limit = Infinity, page = 500, log = console.log } = {}) {
  const core = require(path.join(FUNCTIONS_DIR, 'tradeMatchCore'));
  const { reindexUser } = require(path.join(FUNCTIONS_DIR, 'tradeMatch'))._internal;
  const fsdb = admin.firestore();
  const stats = {
    scanned: 0, reviewDocs: 0, players: 0, withLists: 0, haveEntries: 0, wantEntries: 0, dreams: 0,
    indexed: 0, skipped: 0, traders: 0,
  };
  let last = null;
  let traderDelta = 0;

  for (;;) {
    let q = fsdb.collection('reviews').orderBy(admin.firestore.FieldPath.documentId()).select(...FIELDS).limit(page);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;
    stats.scanned += snap.size;

    const todo = [];
    for (const doc of snap.docs) {
      if (!core.okUid(doc.id)) { stats.reviewDocs += 1; continue; }
      stats.players += 1;
      const data = doc.data() || {};
      const lists = core.buildLists(data);
      if (core.isEmpty(lists)) continue;
      if (stats.withLists >= limit) break;
      stats.withLists += 1;
      stats.haveEntries += lists.have.length;
      stats.wantEntries += lists.want.length;
      if (lists.dream) stats.dreams += 1;
      if (lists.have.length) stats.traders += 1;
      const v = core.ms(doc.updateTime);
      todo.push({ uid: doc.id, data, v, ts: core.ms(data.updatedAt) || v || Date.now() });
    }

    if (apply && todo.length) {
      await mapLimit(todo, CONCURRENCY, async ({ uid, data, v, ts }) => {
        const r = await reindexUser(uid, data, { ts, v, skipSameVersion: true, countTraders: false });
        if (r.skipped) stats.skipped += 1;
        else {
          stats.indexed += 1;
          traderDelta += r.delta || 0;
        }
      });
    }
    if (stats.scanned % (page * 20) === 0) log(`[backfill] scanned ${stats.scanned}, ${stats.withLists} players with lists`);
    if (snap.size < page || stats.withLists >= limit) break;
  }

  if (apply && traderDelta) {
    await admin.database().ref('trade_index/stats/traders')
      .transaction((n) => Math.max(0, (Number(n) || 0) + traderDelta));
  }

  log(`[backfill] scanned ${stats.scanned} documents: ${stats.reviewDocs} reviews, ${stats.players} player docs, `
    + `${stats.withLists} with listed items (${stats.traders} offering something, ${stats.dreams} with a dream)`);
  log(`[backfill] entries: ${stats.haveEntries} have, ${stats.wantEntries} want`);
  if (apply) log(`[backfill] wrote ${stats.indexed}, skipped ${stats.skipped} already indexed, traders +${traderDelta}`);
  else log('[backfill] dry run: nothing written (pass --apply to build the index)');
  return stats;
}

function init({ emulator, project }) {
  if (admin.apps.length) return;
  if (emulator) {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host || !process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('--emulator needs FIREBASE_DATABASE_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST');
    }
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
    console.error('Pick a target: --prod (live project) or --emulator. See the header of this file.');
    process.exit(1);
  }
  if (prod && (process.env.FIREBASE_DATABASE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) {
    console.error('An emulator host is set: unset it to target production, or pass --emulator.');
    process.exit(1);
  }
  init({ emulator, project: arg('--project') });
  backfill({
    apply: args.includes('--apply'),
    limit: arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity,
    page: arg('--batch') ? parseInt(arg('--batch'), 10) : 500,
  })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[backfill] failed:', e);
      process.exit(1);
    });
}

module.exports = { backfill };
