/**
 * updateLeaderboardCache — pre-computes the "Top Rated" leaderboard.
 *
 * Writes Firestore leaderboard_cache/top50, which is the ONLY thing
 * Code/ChatScreen/GroupChat/LeaderboardScreen.jsx reads. Without this function
 * running, that screen shows an empty list forever.
 *
 * What it does, every 12 hours:
 *   1. Read every doc in user_ratings_summary
 *   2. Keep users with >= 1 review AND averageRating >= MIN_RATING_THRESHOLD
 *   3. Sort by review count desc, then rating desc as a tie-break
 *   4. Take the top 50
 *   5. Attach displayName + avatar from RTDB users/{uid}
 *   6. Write the whole thing to one document
 *
 * Why pre-compute: the client then pays exactly ONE document read per refresh
 * instead of 50 reads + 100 RTDB gets doing this work on device.
 *
 * Document shape (must stay in sync with LeaderboardScreen.jsx:96-131):
 *   users: [{ userId, ratingCount, averageRating, displayName, avatar, rank, updatedAt }]
 *   lastUpdated: serverTimestamp
 *   version, minRatingThreshold, totalUsers
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MIN_RATING_THRESHOLD = 3.7; // Minimum average rating to qualify
const TOP_USERS_LIMIT = 50;       // Size of the cached leaderboard
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const RTDB_CONCURRENCY = 10;      // Parallel RTDB lookups per batch

/** Read user_ratings_summary and return the qualifying users, best first. */
const collectTopUsers = async () => {
  const snapshot = await db.collection('user_ratings_summary').get();
  if (snapshot.empty) return [];

  const eligible = [];
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const ratingCount = data.count || 0;
    const averageRating = data.averageRating || 0;

    if (ratingCount > 0 && averageRating >= MIN_RATING_THRESHOLD) {
      eligible.push({
        userId: docSnap.id,
        ratingCount,
        averageRating,
        // toMillis() only exists on a Timestamp; docs written by an older
        // client may hold a raw number here.
        updatedAt: typeof data.updatedAt?.toMillis === 'function'
          ? data.updatedAt.toMillis()
          : (typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()),
      });
    }
  });

  // Most-reviewed first; average rating only breaks ties.
  eligible.sort((a, b) => (
    b.ratingCount !== a.ratingCount
      ? b.ratingCount - a.ratingCount
      : b.averageRating - a.averageRating
  ));

  return eligible.slice(0, TOP_USERS_LIMIT);
};

/**
 * Attach displayName/avatar from RTDB.
 * Batched rather than one big Promise.all so 50 concurrent RTDB reads don't
 * spike. Rank comes from the array index — using indexOf() here would be
 * O(n^2) and, worse, returns the FIRST match, so duplicate entries would all
 * share a rank.
 */
const attachProfiles = async (topUsers) => {
  const database = admin.database();
  const out = [];

  for (let i = 0; i < topUsers.length; i += RTDB_CONCURRENCY) {
    const batch = topUsers.slice(i, i + RTDB_CONCURRENCY);
    const resolved = await Promise.all(batch.map(async (user, offset) => {
      const rank = i + offset + 1; // 1-based, positional
      let profile = null;
      try {
        const snap = await database.ref(`users/${user.userId}`).once('value');
        profile = snap.val();
      } catch (error) {
        console.error(`[Leaderboard] profile read failed for ${user.userId}:`, error?.message);
      }
      return {
        userId: user.userId,
        ratingCount: user.ratingCount,
        averageRating: user.averageRating,
        displayName: profile?.displayName || 'Anonymous',
        avatar: profile?.avatar || DEFAULT_AVATAR,
        rank,
        updatedAt: user.updatedAt,
      };
    }));
    out.push(...resolved);
  }

  return out;
};

/** Shared by the scheduled and manual entry points. */
const buildAndStoreLeaderboard = async () => {
  const topUsers = await collectTopUsers();

  if (topUsers.length === 0) {
    console.log('[Leaderboard] No users met the criteria — leaving the existing cache in place.');
    // Deliberately NOT writing an empty doc: that would blank the live
    // leaderboard on any transient read problem.
    return { success: false, userCount: 0, reason: 'no-eligible-users' };
  }

  const users = await attachProfiles(topUsers);

  await db.collection('leaderboard_cache').doc('top50').set({
    users,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    version: '1.0',
    minRatingThreshold: MIN_RATING_THRESHOLD,
    totalUsers: users.length,
  }, { merge: false });

  console.log(`[Leaderboard] Cached ${users.length} users. Top 3:`,
    users.slice(0, 3).map(u => `${u.displayName} (${u.ratingCount} reviews, ${u.averageRating.toFixed(2)})`).join(' | '));

  return { success: true, userCount: users.length };
};

/** Scheduled: every 12 hours, at 00:00 and 12:00 UTC. */
exports.updateLeaderboardCache = functions.pubsub
  .schedule('0 */12 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    console.log('[Leaderboard] Starting scheduled cache update…');
    try {
      const result = await buildAndStoreLeaderboard();
      return result;
    } catch (error) {
      console.error('[Leaderboard] Update failed:', error);
      throw error; // let Firebase retry
    }
  });

/**
 * Manual trigger, for seeding the cache the first time and for testing.
 * Requires ?key=<LEADERBOARD_ADMIN_KEY> — without a check this endpoint is
 * public and anyone could hammer a full-collection scan.
 * Set the secret with:
 *   firebase functions:config:set leaderboard.admin_key="<something-long>"
 */
exports.updateLeaderboardCacheManual = functions.https.onRequest(async (req, res) => {
  const expected = functions.config()?.leaderboard?.admin_key;
  if (!expected || req.query.key !== expected) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  try {
    const result = await buildAndStoreLeaderboard();
    res.status(200).json({ ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[Leaderboard] Manual trigger failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
