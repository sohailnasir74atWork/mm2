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

// ── Push notifications ─────────────────────────────────────────────────
// NOT deployed historically. Exporting it here means a full-codebase deploy
// WILL create it and users will start receiving comment notifications.
// exports.notifyPostComment = require('./notifyPostComment').notifyPostComment;

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
