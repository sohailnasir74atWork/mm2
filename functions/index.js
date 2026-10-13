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

// ── Group pushes (2026-10-13, ported from Adopt Me) ───────────────────
// Invitations, join requests and new group messages. None of the three was
// ever deployed on this project (checked against `gcloud functions list`
// 2026-10-13). All read-only apart from clearing dead FCM tokens. Each honours
// an opt-out under users/{uid}/notificationSettings — groupInvitationNotifications,
// groupJoinRequestNotifications, groupChatNotifications; absent means on —
// and skips players who blocked the sender (bannedUsers/{uid}/{sender}).
// notifyGroupMessage also skips muted groups and readers of the chat, caps
// pushes per group at 3 unread, and collapses each group to one notification.
// Deploy by name:
//   firebase deploy --only functions:notifyGroupInvitation,functions:notifyGroupJoinRequest,functions:notifyGroupMessage --project mm2vlaues-ed80c
exports.notifyGroupInvitation = require('./notifyGroupInvitation').notifyGroupInvitation;
exports.notifyGroupJoinRequest = require('./notifyGroupJoinRequest').notifyGroupJoinRequest;
exports.notifyGroupMessage = require('./notifyGroupMessage').notifyGroupMessage;

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
exports.expireFeaturedTrades = require('./expireFeaturedTrades').expireFeaturedTrades;

// ── Feed Hot / Trending (2026-10-13) ───────────────────────────────────
// The feed's Hot and Trending tabs read /feedRanking/{hot,trending}, which
// only this function writes (every 30 min, ≤200 Firestore reads per run).
// It lived in Code/CloudFunctions and was never deployed, so both tabs were
// always empty.
exports.computeFeedRanking = require('./computeFeedRanking').computeFeedRanking;

// Every ban record gets `bannedAt`: the Banned List orders by it, and RTDB
// leaves records missing the key out of that query (88 of 103 were). Ported
// from Adopt Me 2026-10-13.
exports.stampBanTimestamp = require('./stampBanTimestamp').stampBanTimestamp;

// ── Email privacy, round 2 (2026-09-27) ────────────────────────────────
// Emails leave every public node: users/{uid} → users_private/{uid}, and
// chat messages / feed posts stop carrying one. Two deploy moments — each
// file's header has its deploy command:
//
//   reportAutoBan.js    EARLY (with the rules, before the app release). The
//                       report auto-bans, moved server-side because new
//                       builds no longer publish the emails they keyed on.
//   syncStaffClaims.js  EARLY. `staff` custom claim for firestore.rules
//                       (mod_actions is staff-read); one run + an hour
//                       before those rules deploy.
//   privateEmailOnSignup.js  EARLY. New accounts' email → users_private,
//                       whichever build created them.
//   emailPrivacy.js     CUTOVER only. Strips the copies old builds keep
//                       writing — which old builds' moderation still reads.
const reportAutoBan = require('./reportAutoBan');
for (const [name, fn] of Object.entries(reportAutoBan)) exports[name] = fn;

exports.syncStaffClaims = require('./syncStaffClaims').syncStaffClaims;
exports.privateEmailOnSignup = require('./privateEmailOnSignup').privateEmailOnSignup;

const emailPrivacy = require('./emailPrivacy');
for (const [name, fn] of Object.entries(emailPrivacy)) exports[name] = fn;

// ── Image uploads, server-side (2026-10-11) ────────────────────────────
// The app used to PUT to Bunny with the post-gag storage password in the
// bundle. uploadImage holds it in Secret Manager (BUNNY_STORAGE_KEY) instead.
// Set the secret before the first deploy; rotate the password only after old
// builds have aged out — docs/BUNNY_UPLOAD_ROLLOUT_2026-10-11.md.
exports.uploadImage = require('./uploadImage').uploadImage;

// ── Birthdays (2026-10-13, BIRTHDAYS_PLAN.md) ──────────────────────────
// Firebase port of Blox Fruit's birthdays. Index triggers, seven HTTPS
// endpoints the app calls with an ID token, and two daily schedules. All
// additive: new nodes only (rules in database.rules.json), except that
// claimBirthdayGift adds 15 to users/{uid}/dailyStars and updateMyBirthday
// rewrites users_private/{uid}/dateOfBirth once. Deploy by name:
//   firebase deploy --only functions:birthdayIndexOnDob,functions:birthdayIndexOnEmailDob,functions:birthdayIndexOnShow,functions:birthdayTop,functions:sendBirthdayWish,functions:wishAllBirthdays,functions:thankBirthdayWishers,functions:claimBirthdayGift,functions:updateMyBirthday,functions:myBirthday,functions:refreshBirthdayAges,functions:notifyBirthdays --project mm2vlaues-ed80c
// Then once: node scripts/birthdays/backfillIndex.js --prod (dry run), then --prod --apply.
const birthdays = require('./birthdays');
for (const name of [
  'birthdayIndexOnDob', 'birthdayIndexOnEmailDob', 'birthdayIndexOnShow',
  'birthdayTop', 'sendBirthdayWish', 'wishAllBirthdays', 'thankBirthdayWishers',
  'claimBirthdayGift', 'updateMyBirthday', 'myBirthday',
  'refreshBirthdayAges', 'notifyBirthdays',
]) {
  exports[name] = birthdays[name];
}

// ── Birthday email (2026-10-13, ported from Adopt Me) ─────────────────
// One email through Brevo on the player's birthday: every player turning 13+
// today (shown or hidden birthday) unless email_prefs/{uid}.optIn === false;
// never Apple relay addresses; at most 100 a UTC day (Brevo's free 300/day is
// shared with Adopt Me and Blox). Claimed once per year in
// birthday_server/email_sent, so a retry never double-sends. See
// notifyBirthdayEmails.js, birthdayEmail.js and emailUnsubscribe.js.
//
// Needs the BREVO_API_KEY and EMAIL_UNSUB_SECRET secrets and the mm2values.app
// sender authenticated in Brevo BEFORE the first deploy. It also relies on the
// birthday_server/hidden13 index added to birthdays/core.js the same day, so
// redeploy the reindexBirthday callers with it. Deploy by name:
//   firebase deploy --only functions:emailUnsubscribe,functions:notifyBirthdayEmails,functions:birthdayIndexOnDob,functions:birthdayIndexOnEmailDob,functions:birthdayIndexOnShow,functions:updateMyBirthday,functions:refreshBirthdayAges --project mm2vlaues-ed80c
//
// notifyBirthdayEmails is a SCHEDULER: deploy it, then PAUSE it straight away
// and leave it paused until the owner approves the first real send:
//   gcloud scheduler jobs pause firebase-schedule-notifyBirthdayEmails-us-central1 --location us-central1 --project mm2vlaues-ed80c
// Resume (owner's call only):
//   gcloud scheduler jobs resume firebase-schedule-notifyBirthdayEmails-us-central1 --location us-central1 --project mm2vlaues-ed80c
// A later `firebase deploy` of this function does not un-pause the job.
// emailUnsubscribe is safe to leave live: it only ever turns email OFF.
exports.notifyBirthdayEmails = require('./notifyBirthdayEmails').notifyBirthdayEmails;
exports.emailUnsubscribe = require('./emailUnsubscribe').emailUnsubscribe;

// ── Trade Match (2026-10-13) ───────────────────────────────────────────
// Port of Adopt Me's Trade Match onto Firebase. tradeMatchIndex mirrors every
// player's public lists (Firestore reviews/{uid}.ownedPets / .wishlistPets,
// written by every build) into the RTDB inverted index trade_index/*, which
// the app queries per item (Code/Helper/tradeMatch.js). Additive: new nodes
// only. tradeMatchDreamAlerts pushes "your dream item is up for trade"; deploy
// it after the app routes data.route 'TradeMatch'. Rules first (trade_index
// block, with its .indexOn), then:
//   firebase deploy --only functions:tradeMatchIndex --project mm2vlaues-ed80c
//   node scripts/trade-match/backfillIndex.js --prod            (dry run)
//   node scripts/trade-match/backfillIndex.js --prod --apply
//   firebase deploy --only functions:tradeMatchDreamAlerts --project mm2vlaues-ed80c
const tradeMatch = require('./tradeMatch');
exports.tradeMatchIndex = tradeMatch.tradeMatchIndex;
exports.tradeMatchDreamAlerts = tradeMatch.tradeMatchDreamAlerts;
