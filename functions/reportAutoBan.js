/**
 * reportAutoBan.js — the report-driven auto-bans, moved server-side.
 *
 * 📅 2026-09-27 (round 2). Both auto-bans used to run on the REPORTER's
 * device, keyed on an email copied into public data:
 *
 *   chat  ReportPopUp.jsx: the second report on a message banned the sender
 *         via message.currentUserEmail, then deleted the message
 *   feed  ReportModal.js: the report that flips a post's `banned` flag
 *         post-banned the author via post.email, then deleted their latest
 *         15 posts (PostCard's banUserwithEmail → deleteUsersLatestPosts)
 *
 * New builds stop publishing those emails, and a reporter cannot read
 * anyone's email, so the ban needs the Admin SDK. These reproduce the SAME
 * record, strike maths, threshold and clean-up the clients wrote — old
 * builds and the Admin Dashboard read those records and must not be able to
 * tell who wrote them.
 *
 *   autoBanOnMessageReports (+ _<room>)  RTDB <room>/{msg}/reportCount
 *   autoBanOnPostReports                 Firestore designPosts/{post}
 *
 * SAFE TO DEPLOY EARLY (with the rules, before the new app release), and it
 * should be: new builds depend on it from day one.
 *   - Chat: builds 1.0.9+ write reportCount 1 on the first report and DELETE
 *     the message on the second, so they never produce the 1 → 2 update this
 *     acts on. Only new builds write 2 — and builds ≤ 1.0.8 (2025), which
 *     counted reports without limit and never banned. Two reports from those
 *     now ban too, which is the policy every later build enforces.
 *   - Feed: acts only when the post carries NO email. A post that has one is
 *     banned by the reporter's own app exactly as before, so the two paths
 *     never both fire (and the "delete latest 15 posts" never runs twice).
 *
 * 📅 2026-10-13: report ledger (reportLedgerCore.js). One account reporting
 * the same message or post twice used to be enough. New builds record each
 * reporter (chat_reports/{room}/{msg}/{uid}, designPosts.reportedBy); when
 * that ledger exists, 2 DISTINCT reporters are required. Old builds write no
 * ledger, so without one the counter alone still decides, as before.
 *
 * Deploy:
 *   node -e "console.log(Object.keys(require('./functions')).filter(n=>/^autoBanOn/.test(n)).map(n=>'functions:'+n).join(','))"
 *   firebase deploy --only <that list> --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const { onValueUpdated } = require('firebase-functions/v2/database');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { CHAT_CHANNEL_PATHS } = require('./chatChannels');
const userEmail = require('./_userEmail');
const { distinctReporters, ledgerAllowsBan, postReportCrossesBan } = require('./reportLedgerCore');

const { encodeEmailForBan } = userEmail;

// Everything that touches Firebase goes through here, so
// test/reportAutoBan.test.js can swap in an in-memory database.
const deps = {
  db: () => userEmail.db(),
  firestore: () => admin.firestore(),
  banEmailFor: (uid) => userEmail.banEmailFor(uid),
  logModAction: (row) => userEmail.logModAction(row),
};
const db = () => deps.db();

// RTDB chat_reports/{room}/{msgId}/{uid}: true — written by ReportPopUp.jsx
// (new builds) in the same multi-path update as the reportCount +1.
const CHAT_REPORT_LEDGER = 'chat_reports';

const OPTS = { region: 'us-central1', memory: '128MiB', timeoutSeconds: 60 };

// Report counters are written by clients, so a counter alone must never be
// able to remove staff (2026-10-13 audit: one write of reportCount = 2, or of
// a post's `banned`, banned anyone). Staff = the role flags the RTDB rules'
// STAFF expression checks. A failed lookup counts as staff: skipping one
// auto-ban is cheaper than banning a moderator.
const isStaffUid = async (uid) => {
  if (!uid) return false;
  try {
    const u = (await db().ref(`users/${uid}`).once('value')).val() || {};
    return u.admin === true || u.isAdmin === true || u.isModerator === true
      || u.isBabyMod === true || u.isSeniorMod === true;
  } catch (e) {
    return true;
  }
};

// The second report bans. ReportPopUp's old test was "reportCount >= 1 when
// this report arrives", i.e. reaching 2.
const MESSAGE_REPORT_THRESHOLD = 2;

// Code/ChatScreen/utils.js STRIKE_LADDER — MM2's 3h / 3d / permanent.
const HOUR = 60 * 60 * 1000;
const chatSentence = (strikeCount) =>
  strikeCount === 1 ? Date.now() + 3 * HOUR
    : strikeCount === 2 ? Date.now() + 72 * HOUR
      : 'permanent';

// ═══════════════════════════════════════════════════════════════════════
//  autoBanOnMessageReports
// ═══════════════════════════════════════════════════════════════════════
//
// Reproduces, field for field, the client call it replaces:
//
//   banUserwithEmail(email, /*isAdmin*/ false, message.senderId,
//     { id: senderId, displayName: message.sender, avatar: message.avatar },
//     { id: 'system', displayName: 'Auto (message reports)', role: 'system' },
//     'Auto-ban: message reported twice', 'report')
//   …then remove(message)
//
// isAdmin=false means a repeat does NOT stack strikes: an existing record
// keeps its strikeCount (a mute's 0 counts as 1), and the sentence restarts.
//
// onValueUpdated, not onValueWritten: message creation (reportCount 0) and
// the nightly retention deletes are not updates, so neither wakes it.
//
// Returns a short outcome string (the tests read it; the trigger ignores it).
const handleMessageReport = async (path, messageId, beforeVal, afterVal) => {
  const before = Number(beforeVal) || 0;
  const after = Number(afterVal) || 0;
  if (after < MESSAGE_REPORT_THRESHOLD || after <= before) return 'below-threshold';

  const messageRef = db().ref(`${path}/${messageId}`);
  const ledgerRef = db().ref(`${CHAT_REPORT_LEDGER}/${path}/${messageId}`);
  try {
    const message = (await messageRef.once('value')).val();
    if (!message || typeof message !== 'object') return 'missing';

    const senderId = message.senderId || null;

    // New builds record each reporter. With a ledger, the counter alone is
    // not enough: one account reporting twice must not ban. No ledger = an
    // old build reported, judged on reportCount exactly as before.
    const ledger = (await ledgerRef.once('value')).val();
    if (!ledgerAllowsBan(ledger, senderId)) {
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: reportCount ${after} but ${distinctReporters(ledger, senderId)} distinct reporter(s); waiting`);
      return 'single-reporter';
    }

    if (await isStaffUid(senderId)) {
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: sender ${senderId} is staff; not banned, message kept`);
      return 'staff';
    }
    const email = senderId ? await deps.banEmailFor(senderId) : null;
    let outcome = 'removed';

    // Same guard the client had: no email, no ban — the message still goes.
    if (email) {
      const banRef = db().ref(`banned_users_by_email/${encodeEmailForBan(email)}`);
      const existing = (await banRef.once('value')).val();
      const strikeCount = existing && typeof existing === 'object' ? (existing.strikeCount || 1) : 1;
      const bannedUntil = chatSentence(strikeCount);
      const reason = 'Auto-ban: message reported twice';

      // utils.js buildBanRecord, with bannerInfo = the 'system' actor.
      const record = {
        strikeCount,
        bannedUntil,
        reason,
        bannedAt: Date.now(),
        userId: senderId,
        displayName: message.sender || 'Unknown User',
        avatar: message.avatar || null,
        email,
        bannedBy: 'system',
        bannerAvatar: null,
      };
      await banRef.set(record);

      await deps.logModAction({
        action: 'ban', targetEmail: email, targetUid: senderId, targetName: record.displayName,
        reason, strikeCount, bannedUntil, source: 'report',
        actorUid: 'system', actorName: 'Auto (message reports)', actorRole: 'system',
      });
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: sender ${senderId} → strike ${strikeCount}`);
      outcome = 'banned';
    } else {
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: no email for sender ${senderId}; message removed only`);
    }

    // The message and its ledger go together (retention sweeps the rest).
    await db().ref().update({
      [`${path}/${messageId}`]: null,
      [`${CHAT_REPORT_LEDGER}/${path}/${messageId}`]: null,
    });
    return outcome;
  } catch (err) {
    console.error(`[autoBanOnMessageReports] ${path}/${messageId} failed:`, err.message);
    return 'error';
  }
};

const makeMessageAutoBan = (path) => onValueUpdated({ ...OPTS, ref: `/${path}/{messageId}/reportCount` }, async (event) => {
  await handleMessageReport(path, event.params.messageId, event.data.before.val(), event.data.after.val());
  return null;
});

exports.autoBanOnMessageReports = makeMessageAutoBan('chat_new');
for (const path of CHAT_CHANNEL_PATHS) {
  if (path === 'chat_new') continue;
  exports[`autoBanOnMessageReports_${path.replace(/^chat_/, '')}`] = makeMessageAutoBan(path);
}

// ═══════════════════════════════════════════════════════════════════════
//  autoBanOnPostReports
// ═══════════════════════════════════════════════════════════════════════
//
// ReportModal's transaction sets `banned: true` on the report that reaches
// REPORT_THRESHOLD (2). The reporter's app then called PostCard's own
// banUserwithEmail(email, userId) — the POST ban list, a different record
// from the chat one:
//
//   banned_users_by_email_post/{encoded} = { strikeCount, bannedUntil, reason: 'Strike N' }
//   24h first time; an existing record keeps its strikeCount, 2 → 3 days,
//   3+ → permanent. (The client stacked strikes only when the REPORTER was
//   an admin — its `isAdmin` was the reporter's. The server cannot see who
//   reported, so it always takes the ordinary-reporter branch.)
//   …then deleteUsersLatestPosts(userId, 15)
//
// That client path writes no mod-log row, so neither does this.
//
// Runs only for posts WITHOUT an email: those are exactly the ones no
// reporter's app can ban (new-build posts, and every post once
// scrubPostEmails is live). A post that still has one is handled by the
// reporter's app as before.
//
// NB: builds with the 2026-09-23 PostCard/ReportModal change (1.4.6) pass
// arguments in the order of utils.js banUserwithEmail to PostCard's local
// (email, userId) function, so their deleteUsersLatestPosts receives
// `false`/`true` and deletes nothing. This reproduces the working path.
const POST_BAN_DELETE_LATEST = 15;

//
// When it fires (reportLedgerCore.postReportCrossesBan):
//   no `reportedBy` (old builds)  `banned` flips false → true with
//                                 reportCount ≥ 2 — unchanged from before.
//                                 ReportModal sets `banned` on the report
//                                 that reaches 2, in the same write as
//                                 reportCount; a bare `banned: true` is not
//                                 a report.
//   `reportedBy` (new builds)     additionally needs 2 distinct reporters
//                                 other than the author, and fires on the
//                                 write that brings it there (which may come
//                                 after `banned` was already set).
const handlePostReport = async (postId, before, after) => {
  if (!before || !after) return 'missing';
  if (!postReportCrossesBan(before, after)) return 'not-crossing';
  if (after.email) return 'client-handles';   // the reporter's app handles it
  const userId = after.userId;
  if (!userId || userId === 'Anonymous') return 'no-author';

  if (await isStaffUid(userId)) {
    console.log(`[autoBanOnPostReports] ${postId}: author ${userId} is staff; not banned`);
    return 'staff';
  }
  try {
    const email = await deps.banEmailFor(userId);
    if (!email) {
      console.log(`[autoBanOnPostReports] ${postId}: no email for ${userId}; not banned`);
      return 'no-email';
    }

    const banRef = db().ref(`banned_users_by_email_post/${encodeEmailForBan(email)}`);
    const existing = (await banRef.once('value')).val();
    let strikeCount = 1;
    let bannedUntil = Date.now() + 24 * HOUR;
    if (existing !== null) {
      if (existing && typeof existing === 'object') strikeCount = existing.strikeCount || 1;
      if (strikeCount === 2) bannedUntil = Date.now() + 72 * HOUR;
      else if (strikeCount >= 3) bannedUntil = 'permanent';
    }
    await banRef.set({ strikeCount, bannedUntil, reason: `Strike ${strikeCount}` });

    // DesignMainScreen.deleteUsersLatestPosts: newest 15 by the author.
    // Served by the (userId, createdAt desc) index the app already uses.
    const latest = await deps.firestore().collection('designPosts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(POST_BAN_DELETE_LATEST)
      .get();
    if (!latest.empty) {
      const batch = deps.firestore().batch();
      latest.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    console.log(`[autoBanOnPostReports] ${postId}: ${userId} post-banned (strike ${strikeCount}), ${latest.size} posts removed`);
    return 'banned';
  } catch (err) {
    console.error(`[autoBanOnPostReports] ${postId} failed:`, err.message);
    return 'error';
  }
};

exports.autoBanOnPostReports = onDocumentUpdated({ ...OPTS, document: 'designPosts/{postId}' }, async (event) => {
  const before = event.data && event.data.before.data();
  const after = event.data && event.data.after.data();
  await handlePostReport(event.params.postId, before, after);
  return null;
});

// Not a function: test/reportAutoBan.test.js only. index.js exports the
// triggers by name (`autoBanOn*`), so this never deploys.
exports._internal = { deps, handleMessageReport, handlePostReport, isStaffUid, CHAT_REPORT_LEDGER };
