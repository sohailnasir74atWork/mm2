/**
 * retention.js — 15-day data retention for MM2.
 *
 * 📅 2026-09-06. Authorised by the app owner: public chat, trades and the feed
 * keep 15 days of history. Everything older is deleted.
 *
 * Covers, one scheduled function each:
 *   cleanupOldPublicChats  RTDB      chat_new                  (91,284 rows)
 *   cleanupOldTrades       Firestore trades_new                (54,002 docs)
 *   cleanupOldPosts        Firestore designPosts + comments    (3,146 docs)
 *
 * ⚠️ These DELETE production data and there is no undo. The retention window
 * is deliberately one constant, below, so it can be widened in one place.
 *
 * Deliberately NOT covered:
 *   - private_messages. Personal conversation history; nobody asked for it to
 *     be deleted, and cleanupOldPrivateChats stays unexported.
 *   - statuses. They already carry their own expiresAt.
 *   - Bunny CDN images behind feed posts. The storage zone `post-gag` is
 *     SHARED with another app in this account, so a deletion bug there would
 *     damage data this project does not own. The documents go; the image files
 *     stay. They are cheap and harmless.
 *
 * Deploy:
 *   firebase deploy --only functions:cleanupOldPublicChats,functions:cleanupOldTrades,functions:cleanupOldPosts --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

// ── the retention window ───────────────────────────────────────────────
const RETENTION_DAYS = 15;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const RTDB_BATCH = 500;      // keys per multi-path RTDB update
const { CHAT_CHANNEL_PATHS } = require('./chatChannels');

const FS_BATCH = 400;        // docs per Firestore commit; the hard cap is 500

// ═══════════════════════════════════════════════════════════════════════
//  Public chat — RTDB chat_new
// ═══════════════════════════════════════════════════════════════════════
exports.cleanupOldPublicChats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 03:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = Date.now() - RETENTION_MS;
    const db = admin.database();
    let deletedTotal = 0;

    // Every language room, not just English. A channel left out of this loop
    // grows without limit — see functions/chatChannels.js.
    for (const path of CHAT_CHANNEL_PATHS) {
      const chatRef = db.ref(path);
      let deleted = 0;

      console.log(`🧹 ${path}: deleting messages before ${new Date(cutoff).toISOString()}`);

      // orderByChild('timestamp') needs the .indexOn that database.rules.json
      // declares for each channel. Without it RTDB still answers but sorts the
      // whole node in memory on every page.
      for (;;) {
        const snap = await chatRef
          .orderByChild('timestamp')
          .endAt(cutoff)
          .limitToFirst(RTDB_BATCH)
          .once('value');

        if (!snap.exists() || snap.numChildren() === 0) break;

        const updates = {};
        snap.forEach((child) => { updates[`${path}/${child.key}`] = null; });

        const n = Object.keys(updates).length;
        await db.ref().update(updates);   // one write for the whole batch
        deleted += n;

        if (n < RTDB_BATCH) break;
      }

      console.log(`✅ ${path}: deleted ${deleted} messages`);
      deletedTotal += deleted;
    }

    console.log(`✅ public chat: deleted ${deletedTotal} messages across ${CHAT_CHANNEL_PATHS.length} channels`);
    return null;
  });

// ═══════════════════════════════════════════════════════════════════════
//  Trades — Firestore trades_new
// ═══════════════════════════════════════════════════════════════════════
//
// Dangling savedTrades/<uid>/<tradeId> pointers are left behind on purpose.
// The Saved tab already skips ids whose document is gone, so they are inert,
// and chasing them would mean reading every user's saved list on every run.
exports.cleanupOldTrades = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 05:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - RETENTION_MS);
    const firestore = admin.firestore();
    let deleted = 0;

    console.log(`🧹 trades_new: deleting trades before ${cutoff.toDate().toISOString()}`);

    for (;;) {
      // Single-field inequality — served by the automatic index, no composite
      // index required.
      const snap = await firestore.collection('trades_new')
        .where('timestamp', '<', cutoff)
        .limit(FS_BATCH)
        .get();

      if (snap.empty) break;

      const batch = firestore.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < FS_BATCH) break;
    }

    console.log(`✅ trades_new: deleted ${deleted} trades`);
    return null;
  });

// ═══════════════════════════════════════════════════════════════════════
//  Feed — Firestore designPosts (+ its comments subcollection)
// ═══════════════════════════════════════════════════════════════════════
//
// Deleting a Firestore document does NOT delete its subcollections: the
// comments would survive as unreachable orphans that still cost storage. Each
// post's comments are drained first.
async function deleteComments(firestore, postId) {
  const commentsRef = firestore.collection(`designPosts/${postId}/comments`);
  let removed = 0;

  for (;;) {
    const snap = await commentsRef.limit(FS_BATCH).get();
    if (snap.empty) break;

    const batch = firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    removed += snap.size;

    if (snap.size < FS_BATCH) break;
  }
  return removed;
}

exports.cleanupOldPosts = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 06:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - RETENTION_MS);
    const firestore = admin.firestore();
    let postsDeleted = 0;
    let commentsDeleted = 0;

    console.log(`🧹 designPosts: deleting posts before ${cutoff.toDate().toISOString()}`);

    for (;;) {
      // Smaller page than the others: each post costs a comments sweep, so a
      // full 400 could run past the timeout.
      const snap = await firestore.collection('designPosts')
        .where('createdAt', '<', cutoff)
        .limit(100)
        .get();

      if (snap.empty) break;

      for (const doc of snap.docs) {
        try {
          commentsDeleted += await deleteComments(firestore, doc.id);
        } catch (e) {
          // A failed comment sweep must not block the post delete, or one bad
          // post stalls the whole job forever.
          console.warn(`⚠️ comments for ${doc.id}:`, e.message);
        }
      }

      const batch = firestore.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      postsDeleted += snap.size;

      if (snap.size < 100) break;
    }

    console.log(`✅ designPosts: deleted ${postsDeleted} posts, ${commentsDeleted} comments`);
    return null;
  });
