/**
 * emailPrivacy.js — keep users' emails out of every public node.
 *
 * 📅 2026-09-27 (round 2). Goal: after cutover, nobody but the user and staff
 * can read a user's email. Three public places carried one:
 *
 *   users/{uid}/email, /decodedEmail   public read, and any signed-in user
 *                                      may write another user's non-role
 *                                      fields — so the email must not live
 *                                      there at all
 *   <chat room>/{msg}/currentUserEmail every public room (chat_new + the
 *   pin_messages/{pin}/currentUserEmail language rooms) and pins, readable
 *                                      signed out by the app AND the website
 *   designPosts/{post}.email           Firestore, `allow read: if true`
 *
 * New builds write none of these (the email goes to users_private/{uid}).
 * Builds already in the field keep writing them for months, so these
 * functions remove each copy as it lands:
 *
 *   privatizeUserPII (+ _decodedEmail)  users/{uid}/<leaf> → users_private
 *   scrubChatEmails  (+ _<room>, _pins) drop currentUserEmail on create
 *   scrubPostEmails                     drop designPosts.email on create
 *
 * ⚠️ DEPLOY AT CUTOVER, not before — and only once the new app release is
 * the one most staff run. Until then old builds' moderation READS these
 * copies: the profile drawer and dashboard read users/{uid}/email, the admin
 * chat Block/Unblock menu reads message.currentUserEmail, the feed's Ban
 * User reads post.email, and the report auto-ban reads both. The one-time
 * catch-up for data written before cutover is scripts/migrate-user-pii.js
 * (users) and scripts/scrub-public-emails.js (chat, pins, posts).
 *
 * Every trigger is on a LEAF (users/{uid}/email, …/currentUserEmail), never a
 * whole node, so the common writes — profile edits, messages from new builds
 * — never wake them.
 *
 * These are the first 2nd-gen functions in this directory (spec: v2
 * onValueWritten). A first v2 deploy enables Eventarc; the CLI prompts.
 *
 * Deploy (cutover):
 *   node -e "console.log(Object.keys(require('./functions')).filter(n=>/^(privatizeUserPII|scrubChatEmails|scrubPostEmails)/.test(n)).map(n=>'functions:'+n).join(','))"
 *   firebase deploy --only <that list> --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const { onValueWritten, onValueCreated } = require('firebase-functions/v2/database');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { CHAT_CHANNEL_PATHS } = require('./chatChannels');
const { db, decodeEmail, isEmailKey, authEmail } = require('./_userEmail');

const OPTS = { region: 'us-central1', memory: '128MiB', timeoutSeconds: 30 };

// ═══════════════════════════════════════════════════════════════════════
//  privatizeUserPII
// ═══════════════════════════════════════════════════════════════════════
//
// A legacy build (or anything else) wrote an email leaf into users/{uid}.
// Move it: the canonical email goes to users_private/{uid}/email — the Auth
// email if the account still exists, else the decoded leaf — and BOTH legacy
// leaves are removed in the same multi-path update.
//
// Idempotent: the removal re-fires this trigger as a deletion, which is
// ignored, and a second run over the same data writes the same values.
// Never throws — a failure is logged and the next write retries it.
const makePrivatizer = (leaf) => onValueWritten({ ...OPTS, ref: `/users/{uid}/${leaf}` }, async (event) => {
  const { uid } = event.params;
  const value = event.data.after.val();
  if (value === null || value === undefined) return null;

  // Legacy records keyed by an encoded email are reported by the migration
  // script and left alone here too.
  if (isEmailKey(uid)) {
    console.warn(`[privatizeUserPII] users/${uid}/${leaf}: key is an email, not a uid — left untouched`);
    return null;
  }

  try {
    // Firebase Auth only — never the written value: users/$userId lets any
    // signed-in user write another user's fields, so trusting the leaf would
    // let someone plant a victim's email and get the wrong person banned.
    const fromAuth = await authEmail(uid);
    const email = fromAuth ? fromAuth.trim().toLowerCase() : null;

    const updates = {
      [`users/${uid}/email`]: null,
      [`users/${uid}/decodedEmail`]: null,
    };
    if (email) updates[`users_private/${uid}/email`] = email;
    await db().ref().update(updates);

    console.log(`[privatizeUserPII] users/${uid}/${leaf} → users_private${email ? '' : ' (no usable email; leaf removed)'}`);
  } catch (err) {
    console.error(`[privatizeUserPII] users/${uid}/${leaf} failed:`, err.message);
  }
  return null;
});

exports.privatizeUserPII = makePrivatizer('email');
exports.privatizeUserPII_decodedEmail = makePrivatizer('decodedEmail');

// ═══════════════════════════════════════════════════════════════════════
//  scrubChatEmails
// ═══════════════════════════════════════════════════════════════════════
//
// Old builds put `currentUserEmail` in every public message, and pinning
// copied the whole message into pin_messages. The trigger is on the leaf, so
// it fires only for messages that actually carry an email — never for
// messages from new builds or the website.
//
// Once the leaf is gone, an old build's report auto-ban (`if
// (message.currentUserEmail)` in ReportPopUp.jsx, unchanged since 1.0.9)
// skips the ban and just deletes the message on the second report, and its
// admin Block/Unblock menu gets "Invalid email address". Both are expected
// cutover costs; new builds resolve the email server-side / from
// users_private instead.
//
// One function per room, because an RTDB trigger cannot wildcard across
// sibling top-level nodes (same reason as cleanUpNoContent_<room>). English
// takes the bare name.
const makeChatScrubber = (path) => onValueCreated({ ...OPTS, ref: `/${path}/{messageId}/currentUserEmail` }, async (event) => {
  const { messageId } = event.params;
  try {
    await db().ref(`${path}/${messageId}/currentUserEmail`).remove();
  } catch (err) {
    console.error(`[scrubChatEmails] ${path}/${messageId} failed:`, err.message);
  }
  return null;
});

exports.scrubChatEmails = makeChatScrubber('chat_new');
for (const path of CHAT_CHANNEL_PATHS) {
  if (path === 'chat_new') continue;
  exports[`scrubChatEmails_${path.replace(/^chat_/, '')}`] = makeChatScrubber(path);
}
exports.scrubChatEmails_pins = makeChatScrubber('pin_messages');

// ═══════════════════════════════════════════════════════════════════════
//  scrubPostEmails
// ═══════════════════════════════════════════════════════════════════════
//
// Old builds write the poster's email into every designPosts document, and
// Firestore rules cannot hide one field of a readable document. Removed on
// create. With it gone, an old build's report auto-ban on that post skips
// (it needs post.email), and autoBanOnPostReports in reportAutoBan.js bans
// server-side instead — it acts exactly when the post has no email.
exports.scrubPostEmails = onDocumentCreated({ ...OPTS, document: 'designPosts/{postId}' }, async (event) => {
  const snap = event.data;
  if (!snap || !snap.get('email')) return null;
  try {
    await snap.ref.update({ email: admin.firestore.FieldValue.delete() });
  } catch (err) {
    // NOT_FOUND: the post was deleted in the meantime — nothing to scrub.
    console.error(`[scrubPostEmails] designPosts/${event.params.postId} failed:`, err.message);
  }
  return null;
});
