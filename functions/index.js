/**
 * Cloud Functions entry point.
 *
 * Everything deployed must be re-exported here — `firebase deploy --only
 * functions` only sees what this file exports.
 */

// Top Rated leaderboard: builds leaderboard_cache/top50, which
// Code/ChatScreen/GroupChat/LeaderboardScreen.jsx reads.
const leaderboard = require('./updateLeaderboardCache');
exports.updateLeaderboardCache = leaderboard.updateLeaderboardCache;
exports.updateLeaderboardCacheManual = leaderboard.updateLeaderboardCacheManual;

// Push notification on a new post comment.
const postComment = require('./notifyPostComment');
exports.notifyPostComment = postComment.notifyPostComment;
