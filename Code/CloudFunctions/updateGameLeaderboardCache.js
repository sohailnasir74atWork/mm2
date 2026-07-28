const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();
const rtdb = admin.database();

/**
 * updateGameLeaderboardCache
 * 
 * Scheduled daily at 3:00 AM UTC.
 * Pre-computes top 20 players for each game and stores in
 * game_leaderboard_cache/{gameId} for efficient 1-read leaderboard loading.
 * 
 * Deploy: firebase deploy --only functions
 */

const GAMES = [
  { id: 'whack',  order: 'desc' },
  { id: 'safe',   order: 'desc' },
  { id: 'draw',   order: 'asc'  },  // Lower ms = better
  { id: 'bomb',   order: 'desc' },
  { id: 'memory', order: 'asc'  },  // Fewer moves = better
  { id: 'killer', order: 'desc' },  // Higher total score = better
];

// ─── Scheduled: runs every day at 3:00 AM UTC ───
exports.updateGameLeaderboardCache = functions.pubsub
  .schedule('0 3 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log('🏆 Starting daily leaderboard cache update...');

    for (const game of GAMES) {
      try {
        const snapshot = await firestore
          .collection('game_scores').doc(game.id).collection('scores')
          .orderBy('score', game.order)
          .limit(20)
          .get();

        if (snapshot.empty) {
          console.log(`⚠️ No scores for ${game.id}`);
          continue;
        }

        let users = snapshot.docs.map(doc => {
          const d = doc.data();
          return { uid: doc.id, score: d.score || 0, username: d.username || 'Unknown', avatar: d.avatar || null };
        }).filter(u => u.score > 0);

        if (game.order === 'asc') {
          users = users.filter(u => u.score < 999);
        }

        // Refresh usernames/avatars from RTDB
        const updatedUsers = await Promise.all(users.map(async (user) => {
          try {
            const [nameSnap, avatarSnap] = await Promise.all([
              rtdb.ref(`users/${user.uid}/robloxUsername`).once('value'),
              rtdb.ref(`users/${user.uid}/avatar`).once('value'),
            ]);
            return {
              ...user,
              username: nameSnap.exists() ? nameSnap.val() : user.username,
              avatar: avatarSnap.exists() ? avatarSnap.val() : user.avatar,
            };
          } catch (err) {
            return user;
          }
        }));

        updatedUsers.sort((a, b) =>
          game.order === 'asc' ? a.score - b.score : b.score - a.score
        );

        await firestore.collection('game_leaderboard_cache').doc(game.id).set({
          users: updatedUsers,
          gameId: game.id,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          userCount: updatedUsers.length,
        });

        console.log(`✅ Cached ${updatedUsers.length} users for ${game.id}`);
      } catch (error) {
        console.error(`❌ Error processing ${game.id}:`, error);
      }
    }

    console.log('🏆 Cache update complete!');
    return null;
  });

// ─── HTTP endpoint for manual testing ───
exports.manualUpdateGameLeaderboard = functions.https.onRequest(async (req, res) => {
  try {
    for (const game of GAMES) {
      const snapshot = await firestore
        .collection('game_scores').doc(game.id).collection('scores')
        .orderBy('score', game.order)
        .limit(20)
        .get();

      if (snapshot.empty) continue;

      let users = snapshot.docs.map(doc => {
        const d = doc.data();
        return { uid: doc.id, score: d.score || 0, username: d.username || 'Unknown', avatar: d.avatar || null };
      }).filter(u => u.score > 0);

      if (game.order === 'asc') {
        users = users.filter(u => u.score < 999);
      }

      const updatedUsers = await Promise.all(users.map(async (user) => {
        try {
          const [nameSnap, avatarSnap] = await Promise.all([
            rtdb.ref(`users/${user.uid}/robloxUsername`).once('value'),
            rtdb.ref(`users/${user.uid}/avatar`).once('value'),
          ]);
          return {
            ...user,
            username: nameSnap.exists() ? nameSnap.val() : user.username,
            avatar: avatarSnap.exists() ? avatarSnap.val() : user.avatar,
          };
        } catch (_) {
          return user;
        }
      }));

      updatedUsers.sort((a, b) =>
        game.order === 'asc' ? a.score - b.score : b.score - a.score
      );

      await firestore.collection('game_leaderboard_cache').doc(game.id).set({
        users: updatedUsers,
        gameId: game.id,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        userCount: updatedUsers.length,
      });
    }

    res.status(200).json({ success: true, message: 'Game leaderboard cache updated!' });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
