/**
 * Cloud Function: delete expired statuses (port of Adopt Me, 2026-10-25).
 *
 * Statuses get expiresAt = createdAt + 24 h (Code/Design/StatusFeed.js) and the
 * app hides them after that, but nothing deleted them: on 2026-10-25 8,837 of
 * 8,863 docs were expired, the oldest from 2026-03-22. There is no Firestore
 * TTL policy on the project. Every 30 minutes this deletes up to 500 docs with
 * expiresAt < now, so the backlog drains in about nine hours.
 *
 * recursiveDelete instead of batch.delete(): MM2 statuses have no
 * subcollections today, but a deleted doc leaves any subcollection orphaned
 * and billed, so this stays safe if comments are added later (Adopt Me has
 * them). Docs without expiresAt never match the query and are left alone.
 * user_reports (RTDB) do not point at statuses, so nothing is kept as evidence.
 * No function triggers on statuses, so the deletes fire nothing.
 *
 * Deploy:
 *   firebase deploy --only functions:cleanupExpiredStatuses --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const PAGE = 500;
const CONCURRENCY = 10; // recursiveDelete streams its own writes

/** Delete up to PAGE expired statuses. Returns { found, deleted }. */
async function deleteExpiredStatuses(firestore, now = admin.firestore.Timestamp.now()) {
  const snapshot = await firestore.collection('statuses')
    .where('expiresAt', '<', now)
    .limit(PAGE)
    .get();

  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += CONCURRENCY) {
    const slice = snapshot.docs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((doc) => firestore.recursiveDelete(doc.ref)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') deleted++;
      // Left for the next run rather than failing the whole sweep.
      else console.error(`⚠️ Failed to delete status ${slice[idx].id}:`, r.reason?.message);
    });
  }
  return { found: snapshot.size, deleted };
}

exports.cleanupExpiredStatuses = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    try {
      const { found, deleted } = await deleteExpiredStatuses(admin.firestore());
      console.log(`✅ statuses: ${found} expired, ${deleted} deleted`);
    } catch (error) {
      console.error('❌ Error cleaning up statuses:', error);
    }
    return null;
  });

exports.deleteExpiredStatuses = deleteExpiredStatuses;
