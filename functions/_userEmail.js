/**
 * _userEmail.js — shared helpers for the email-privacy functions.
 *
 * 📅 2026-09-27 (round 2). A user's email no longer lives anywhere public:
 * users/{uid} → users_private/{uid} (owner + staff only), and chat messages
 * and feed posts stopped carrying a copy. Bans are still KEYED by email
 * (banned_users_by_email/{encoded}), so whenever the server has to ban it
 * looks the email up here rather than trusting a copy in public data.
 *
 * Used by emailPrivacy.js and reportAutoBan.js. Not a function itself —
 * index.js does not export anything from this file.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Resolved lazily, same as syncRoleRosters.js: at module scope this needs
// FIREBASE_CONFIG to already carry databaseURL, which is not guaranteed while
// the CLI is analysing the source.
const db = () => admin.database();

// EXACTLY Code/ChatScreen/utils.js encodeEmailForBan — dots only, NOT
// lowercased. Every build reads its own ban at the raw auth email with the
// dots replaced (GlobelStats.js); a different casing here would write a ban
// nobody ever reads.
const encodeEmailForBan = (email) => String(email).replace(/\./g, '(dot)');

// Legacy users/{uid} writers stored `name(dot)domain(dot)tld`, a few used
// commas. → the raw, lowercased address users_private holds.
const decodeEmail = (value) => {
  if (!value || typeof value !== 'string') return null;
  const clean = value.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return clean.includes('@') ? clean : null;
};

// Firebase uids never contain these. A handful of legacy records are keyed
// by an encoded EMAIL instead of a uid; those are reported, never touched.
const isEmailKey = (key) => /@|\(dot\)|,/.test(String(key || ''));

/** The Firebase Auth email, exactly as the account holds it, or null. */
async function authEmail(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return user.email || null;
  } catch (err) {
    // auth/user-not-found for a deleted account; anything else is logged.
    if (err && err.code !== 'auth/user-not-found') {
      console.warn(`[userEmail] getUser(${uid}) failed:`, err.message);
    }
    return null;
  }
}

/** users_private first, then the legacy users/{uid} leaves. Lowercased. */
async function storedEmail(uid) {
  const [privSnap, legacySnap, decodedSnap] = await Promise.all([
    db().ref(`users_private/${uid}/email`).once('value'),
    db().ref(`users/${uid}/email`).once('value'),
    db().ref(`users/${uid}/decodedEmail`).once('value'),
  ]);
  return decodeEmail(privSnap.val()) || decodeEmail(legacySnap.val()) || decodeEmail(decodedSnap.val());
}

/**
 * The email to key a ban on. The Auth email comes first and is NOT
 * lowercased: it is byte-for-byte what old builds copied into
 * `currentUserEmail` / post `email`, and what the banned user's own app
 * listens on. users_private (lowercased) is the fallback.
 */
async function banEmailFor(uid) {
  if (!uid || isEmailKey(uid)) return null;
  return (await authEmail(uid)) || (await storedEmail(uid));
}

// Same row shape as Code/Helper/modLog.js logModAction. Never throws: a log
// failure must not fail a real ban.
async function logModAction(entry) {
  try {
    const targetEmail = decodeEmail(entry.targetEmail);
    await admin.firestore().collection('mod_actions').add({
      action: entry.action,
      targetEmail,
      targetUid: entry.targetUid || null,
      targetName: entry.targetName || null,
      reason: typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim().slice(0, 500) : null,
      strikeCount: Number.isFinite(entry.strikeCount) ? entry.strikeCount : null,
      durationMinutes: null,
      bannedUntilMs: typeof entry.bannedUntil === 'number' ? Math.round(entry.bannedUntil) : null,
      isPermanent: entry.bannedUntil === 'permanent',
      actorUid: entry.actorUid || null,
      actorName: entry.actorName || null,
      actorRole: entry.actorRole || null,
      source: entry.source || 'unknown',
      meta: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
  } catch (err) {
    console.warn('[userEmail] mod log insert failed:', err.message);
  }
}

module.exports = {
  db,
  encodeEmailForBan,
  decodeEmail,
  isEmailKey,
  authEmail,
  storedEmail,
  banEmailFor,
  logModAction,
};
