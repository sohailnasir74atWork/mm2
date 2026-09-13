/**
 * Cloud Functions entry point — mm2vlaues-ed80c.
 *
 * `firebase deploy --only functions` deploys exactly what this file exports.
 * A function that is live but missing here is NOT deleted by a deploy, so
 * removing an export is safe; deleting a live function needs an explicit
 * `firebase functions:delete`.
 *
 * ── Live in production before this pass (5) ────────────────────────────
 *   notifyNewMessage          v1  RTDB onWrite chat_meta_data/{u}/{p}/unreadCount
 *   cleanUpNoContentMessages  v1  RTDB onWrite chat_new/{messageId}
 *   updateLeaderboardCache    v1  scheduled
 *   updateLeaderboardCacheManual v1 https
 *   valueAlertsPoll           v2  scheduled  (deployed from firebase-value-alerts/)
 *
 * `notifyNewMessage` and `cleanUpNoContentMessages` had no source in this repo
 * until 2026-09-06. Recovered from their deployed archives (kept verbatim in
 * functions/recovered/), then FIXED and re-owned here as chatMaintenance.js —
 * both carried real defects, see docs/FUNCTION_AUDIT_2026-09-06.md.
 *
 * ── Added 2026-09-05 (PLAN_2026-09.md) ────────────────────────────────
 * Additive and safe to deploy: they create new nodes and never remove user
 * data.
 *   syncModRole_Moderator, syncModRole_BabyMod, syncRoleTrusted,
 *   syncRoleCMSR, refreshAllRosters   → the /mods, /trusted, /cmsr rosters
 *   clearPresenceNode                 → fixes 70,730 ghost presence rows
 *
 * Deploy those:
 *   firebase deploy --only functions:syncModRole_Moderator,functions:syncModRole_BabyMod,functions:syncRoleTrusted,functions:syncRoleCMSR,functions:refreshAllRosters,functions:clearPresenceNode --project mm2vlaues-ed80c
 *
 * ── Retention, authorised 2026-09-06 ──────────────────────────────────
 * 15-day window on public chat, trades and the feed. See retention.js.
 * These DELETE production data.
 *
 * ── Still NOT exported ────────────────────────────────────────────────
 * cleanupOldPrivateChats. Private conversation history; deleting it was
 * never asked for. Export it only on an explicit instruction.
 */

// ── Leaderboard ────────────────────────────────────────────────────────
const leaderboard = require('./updateLeaderboardCache');
exports.updateLeaderboardCache = leaderboard.updateLeaderboardCache;
exports.updateLeaderboardCacheManual = leaderboard.updateLeaderboardCacheManual;

// ── Public chat hygiene + private chat push ────────────────────────────
// Fixed 2026-09-06: cleanUpNoContentMessages was deleting pets-only and
// GIF-only messages; notifyNewMessage suppressed pushes from every other
// conversation whenever one chat was open.
const chatMaintenance = require('./chatMaintenance');
exports.cleanUpNoContentMessages = chatMaintenance.cleanUpNoContentMessages;
exports.notifyNewMessage = chatMaintenance.notifyNewMessage;

// One empty-message cleaner per language channel (2026-09-13). Re-exported by
// name so `fetch-live-functions.js` can audit them and so they deploy
// individually — this file is the deploy manifest, and the list of names it
// prints is what goes into `firebase deploy --only`.
for (const [name, fn] of Object.entries(chatMaintenance)) {
  if (name.startsWith('cleanUpNoContent_')) exports[name] = fn;
}

// ── Push notifications ─────────────────────────────────────────────────
// Enabled 2026-09-13. notifyPostComment had been written but left commented
// out here, so it was never deployed and nobody was ever told about a comment
// on their post. notifyPostLike is new.
//
// Both are live now, so both cost money per feed interaction. The caps matter:
// notifyPostComment notifies at most 50 people (author + previous commenters
// + likers) and notifyPostLike notifies exactly one (the author). Raise either
// and a popular post becomes expensive fast.
//
// Both honour an opt-out under users/{uid}/notificationSettings —
// postCommentNotifications and postLikeNotifications. Absent means on.
exports.notifyPostComment = require('./notifyPostComment').notifyPostComment;
exports.notifyPostLike = require('./notifyPostLike').notifyPostLike;

// ── Role rosters (mods / trusted / cmsr) ───────────────────────────────
const rosters = require('./syncRoleRosters');
exports.syncModRole_Moderator = rosters.syncModRole_Moderator;
exports.syncModRole_BabyMod = rosters.syncModRole_BabyMod;
exports.syncRoleTrusted = rosters.syncRoleTrusted;
exports.syncRoleCMSR = rosters.syncRoleCMSR;
exports.syncRoleHelper = rosters.syncRoleHelper;
exports.refreshAllRosters = rosters.refreshAllRosters;

// ── Presence hygiene ───────────────────────────────────────────────────
exports.clearPresenceNode = require('./clearPresenceNode').clearPresenceNode;

// ── Retention: 15 days on chat, trades and the feed ───────────────────
const retention = require('./retention');
exports.cleanupOldPublicChats = retention.cleanupOldPublicChats;
exports.cleanupOldTrades = retention.cleanupOldTrades;
exports.cleanupOldPosts = retention.cleanupOldPosts;

// NOT exported: private message retention. See the header.
// exports.cleanupOldPrivateChats = require('./cleanupOldPrivateChats').cleanupOldPrivateChats;

// NOT exported: dead-group cleanup (added 2026-09-13). Deletes groups with no
// messages for 7 days, across six paths — Firestore groups + group_invitations
// + group_join_requests, and RTDB groups/{id} + group_messages/{id} +
// group_meta_data/{member}/{id} for every member.
//
// It ships with DRY_RUN = true, so exporting it only produces a log of what it
// WOULD delete. Read one night's log, confirm the count and sampled names,
// then set DRY_RUN = false. Note the header in that file: the obvious Firestore
// query on lastMessageTimestamp would have matched every group, because
// nothing ever writes that field.
// exports.cleanupDeadGroups = require('./cleanupDeadGroups').cleanupDeadGroups;
