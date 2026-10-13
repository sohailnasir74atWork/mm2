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
 * Deploy:
 *   node -e "console.log(Object.keys(require('./functions')).filter(n=>/^autoBanOn/.test(n)).map(n=>'functions:'+n).join(','))"
 *   firebase deploy --only <that list> --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const { onValueUpdated } = require('firebase-functions/v2/database');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { CHAT_CHANNEL_PATHS } = require('./chatChannels');
const { db, encodeEmailForBan, banEmailFor, logModAction } = require('./_userEmail');

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
const makeMessageAutoBan = (path) => onValueUpdated({ ...OPTS, ref: `/${path}/{messageId}/reportCount` }, async (event) => {
  const { messageId } = event.params;
  const before = Number(event.data.before.val()) || 0;
  const after = Number(event.data.after.val()) || 0;
  if (after < MESSAGE_REPORT_THRESHOLD || after <= before) return null;

  const messageRef = db().ref(`${path}/${messageId}`);
  try {
    const message = (await messageRef.once('value')).val();
    if (!message || typeof message !== 'object') return null;

    const senderId = message.senderId || null;
    if (await isStaffUid(senderId)) {
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: sender ${senderId} is staff; not banned, message kept`);
      return null;
    }
    const email = senderId ? await banEmailFor(senderId) : null;

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

      await logModAction({
        action: 'ban', targetEmail: email, targetUid: senderId, targetName: record.displayName,
        reason, strikeCount, bannedUntil, source: 'report',
        actorUid: 'system', actorName: 'Auto (message reports)', actorRole: 'system',
      });
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: sender ${senderId} → strike ${strikeCount}`);
    } else {
      console.log(`[autoBanOnMessageReports] ${path}/${messageId}: no email for sender ${senderId}; message removed only`);
    }

    await messageRef.remove();
  } catch (err) {
    console.error(`[autoBanOnMessageReports] ${path}/${messageId} failed:`, err.message);
  }
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

exports.autoBanOnPostReports = onDocumentUpdated({ ...OPTS, document: 'designPosts/{postId}' }, async (event) => {
  const before = event.data && event.data.before.data();
  const after = event.data && event.data.after.data();
  if (!before || !after) return null;
  if (before.banned === true || after.banned !== true) return null;
  if (after.email) return null;           // the reporter's app handles it
  const userId = after.userId;
  if (!userId || userId === 'Anonymous') return null;
  // ReportModal sets `banned` on the report that reaches 2, in the same
  // write as reportCount. A bare `banned: true` is not a report.
  if (!(Number(after.reportCount) >= 2)) return null;

  const { postId } = event.params;
  if (await isStaffUid(userId)) {
    console.log(`[autoBanOnPostReports] ${postId}: author ${userId} is staff; not banned`);
    return null;
  }
  try {
    const email = await banEmailFor(userId);
    if (!email) {
      console.log(`[autoBanOnPostReports] ${postId}: no email for ${userId}; not banned`);
      return null;
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
    const latest = await admin.firestore().collection('designPosts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(POST_BAN_DELETE_LATEST)
      .get();
    if (!latest.empty) {
      const batch = admin.firestore().batch();
      latest.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    console.log(`[autoBanOnPostReports] ${postId}: ${userId} post-banned (strike ${strikeCount}), ${latest.size} posts removed`);
  } catch (err) {
    console.error(`[autoBanOnPostReports] ${postId} failed:`, err.message);
  }
  return null;
});
