// Private profile fields — a user's email, kept out of users/{uid}.
//
// Lives in RTDB at users_private/{uid}:
//   { email: '<the auth email, lowercased, raw — no (dot) encoding>' }
// (Adopt Me also keeps a write-once dateOfBirth here; MM2 stores DOB only in
// email_prefs, so nothing here writes one.)
//
// Owner-only read/write, and the owner can only ever write their OWN auth
// email (database.rules.json). Staff — the same STAFF expression that guards
// the ban list — read the whole node, which is what moderation needs. It is
// deliberately NOT under users/{uid}: that node is readable by anyone, and
// other signed-in users can write its non-role fields.
//
// Bans stay keyed by email (banned_users_by_email/{encoded}); only the SOURCE
// of another user's email changed. The user's own email for logic (ban
// listener, founder check, send guard) still comes from Firebase Auth.
//
// Legacy records may still carry users/{uid}/email or decodedEmail until
// scripts/migrate-user-pii.js has run (functions/emailPrivacy.js moves any
// later write). getUserEmail falls back to those, so staff tools work across
// the whole rollout.
import { ref, get, update, query, orderByChild, equalTo, limitToFirst } from '@react-native-firebase/database';

const DOB_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// Legacy writers stored `name(dot)domain(dot)tld`, a few used commas.
const decodeEmail = (value) => {
  if (!value || typeof value !== 'string') return null;
  const clean = value.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return clean.includes('@') ? clean : null;
};

/**
 * Another user's email, for staff moderation. users_private first, then the
 * legacy users/{uid} leaves for records the migration has not reached.
 *
 * A denied users_private read (rules not live yet, or a non-staff caller)
 * still tries the legacy leaves: those are world-readable until the migration
 * removes them, so nothing new is exposed, and staff tools keep working even
 * if the app ships before the rules. Every caller is staff-only UI.
 */
export const getUserEmail = async (db, uid) => {
  if (!db || !uid) return null;
  try {
    const snap = await get(ref(db, `users_private/${uid}/email`));
    const email = decodeEmail(snap.exists() ? snap.val() : null);
    if (email) return email;
  } catch (_) {
    // fall through to the legacy leaves
  }

  try {
    const legacy = await get(ref(db, `users/${uid}/email`));
    const fromEmail = decodeEmail(legacy.exists() ? legacy.val() : null);
    if (fromEmail) return fromEmail;
    const decoded = await get(ref(db, `users/${uid}/decodedEmail`));
    return decodeEmail(decoded.exists() ? decoded.val() : null);
  } catch (_) {
    return null;
  }
};

/** getUserEmail for several users at once → { [uid]: email | null }. */
export const getUserEmails = async (db, uids) => {
  const unique = [...new Set((uids || []).filter(Boolean))];
  const emails = await Promise.all(unique.map((uid) => getUserEmail(db, uid)));
  return unique.reduce((acc, uid, i) => { acc[uid] = emails[i]; return acc; }, {});
};

/**
 * Exact-match email → uids, staff only. Indexed (users_private .indexOn
 * ["email"]), so RTDB answers from the index instead of scanning the node.
 */
export const findUidsByEmail = async (db, email, max = 5) => {
  const e = decodeEmail(email);
  if (!db || !e) return [];
  const run = async (path, value) => {
    try {
      const snap = await get(query(ref(db, path), orderByChild('email'), equalTo(value), limitToFirst(max)));
      const uids = [];
      if (snap.exists()) snap.forEach((child) => { uids.push(child.key); return undefined; });
      return uids;
    } catch (_) {
      return []; // denied (rules not live) or offline — never throws into the UI
    }
  };
  const found = await run('users_private', e);
  if (found.length) return found;
  // Not migrated yet: the legacy users/{uid}/email leaf (indexed on /users),
  // stored raw or '(dot)'-encoded by older writers.
  const legacy = await run('users', e);
  return legacy.length ? legacy : run('users', e.replace(/\./g, '(dot)'));
};

// One write per user per app session is plenty — the value only changes
// when the account's email does.
const savedThisSession = new Map(); // uid → serialized patch

/**
 * Write the signed-in user's own private fields. `email` is the Firebase Auth
 * email; the rules reject anything but auth.token.email lowercased. Callers
 * fire-and-forget: sign-in must never wait on, or fail because of, this.
 */
export const saveOwnPrivateProfile = async (db, uid, { email, dateOfBirth } = {}) => {
  if (!db || !uid) return false;
  const patch = {};
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (e) patch.email = e;
  if (typeof dateOfBirth === 'string' && DOB_RE.test(dateOfBirth)) patch.dateOfBirth = dateOfBirth;
  if (Object.keys(patch).length === 0) return false;

  const key = JSON.stringify(patch);
  if (savedThisSession.get(uid) === key) return true;
  await update(ref(db, `users_private/${uid}`), patch);
  savedThisSession.set(uid, key);
  return true;
};
