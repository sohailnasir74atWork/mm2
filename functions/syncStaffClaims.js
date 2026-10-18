/**
 * syncStaffClaims.js — a `staff` custom claim that Firestore rules can see.
 *
 * 📅 2026-09-27 (round 2). Staff roles live in RTDB (users/{uid}/admin,
 * isModerator, … and jmd_granters/{uid}). RTDB rules read them directly —
 * that is the STAFF expression in database.rules.json — but Firestore rules
 * cannot read RTDB at all. firestore.rules restricts the `mod_actions` audit
 * log (every row carries the target's email) to staff, so staff status has
 * to reach Firestore some other way: as `request.auth.token.staff`.
 *
 * Every 30 minutes this recomputes the set with the SAME membership test as
 * STAFF — admin, isAdmin, isSeniorMod, isModerator, isBabyMod === true, or a
 * key under jmd_granters — and sets / clears the claim for whoever changed.
 * The founder emails need no claim; firestore.rules checks them directly.
 * `staff_claims/{uid}` (server-only, rules deny all clients) remembers who
 * currently holds it, so a demotion is noticed and cleared.
 *
 * A claim reaches the device on its next ID-token refresh (hourly, or at
 * sign-in). No client change is needed, so it works for old builds too.
 *
 * 📅 2026-10-18: admins (admin / isAdmin flag) also get an `admin` claim, so
 * firestore.rules can let ONLY admins delete reviews (owner decision; review
 * deletion used to be open to every moderator). staff_claims/{uid} holds
 * 'admin' for admins and true for other staff, so a promotion or demotion
 * between the two re-sets the claims too.
 *
 * ⚠️ Each flag is an equalTo(true) query on /users and MUST be indexed — an
 * unindexed query makes the Admin SDK download all 81k user records. Flags
 * whose index is missing from the live rules are skipped with a warning (and
 * that run revokes nobody), so deploying this before the rules is harmless,
 * just incomplete.
 *
 * Deploy (step a, then give it one run + an hour before the Firestore rules):
 *   firebase deploy --only functions:syncStaffClaims --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db } = require('./_userEmail');

const STAFF_FLAGS = ['admin', 'isAdmin', 'isSeniorMod', 'isModerator', 'isBabyMod'];

// The live rules' users/.indexOn, or null when they cannot be read.
async function indexedUserFields() {
  try {
    const raw = await db().getRules();
    // The deployed rules are JSON; strip line comments in case a console
    // edit ever adds some.
    const rules = JSON.parse(String(raw).replace(/^\s*\/\/.*$/gm, ''));
    const idx = rules && rules.rules && rules.rules.users && rules.rules.users['.indexOn'];
    return Array.isArray(idx) ? idx : (typeof idx === 'string' ? [idx] : []);
  } catch (err) {
    console.warn('[syncStaffClaims] could not read the rules:', err.message);
    return null;
  }
}

const ADMIN_FLAGS = ['admin', 'isAdmin'];

async function setStaffClaim(uid, isStaff, isAdmin = false) {
  const user = await admin.auth().getUser(uid);
  const claims = { ...(user.customClaims || {}) };
  if (isStaff) claims.staff = true;
  else delete claims.staff;
  if (isStaff && isAdmin) claims.admin = true;
  else delete claims.admin;
  await admin.auth().setCustomUserClaims(uid, Object.keys(claims).length ? claims : null);
}

exports.syncStaffClaims = onSchedule({
  schedule: 'every 30 minutes',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async () => {
  const indexedList = await indexedUserFields();
  if (!indexedList) return;   // try again next run; change nothing blind
  const indexed = new Set(indexedList);
  const staff = new Set();
  const admins = new Set();
  let complete = true;
  let adminsComplete = true;

  for (const flag of STAFF_FLAGS) {
    if (!indexed.has(flag)) {
      console.warn(`[syncStaffClaims] users/.indexOn lacks "${flag}" — skipped (an unindexed query downloads every user)`);
      complete = false;
      if (ADMIN_FLAGS.includes(flag)) adminsComplete = false;
      continue;
    }
    const snap = await db().ref('users').orderByChild(flag).equalTo(true).once('value');
    snap.forEach((child) => {
      staff.add(child.key);
      if (ADMIN_FLAGS.includes(flag)) admins.add(child.key);
    });
  }

  // STAFF tests jmd_granters/{uid}.exists(), so any value counts.
  const granters = await db().ref('jmd_granters').once('value');
  granters.forEach((child) => { staff.add(child.key); });

  const heldMap = (await db().ref('staff_claims').once('value')).val() || {};
  const held = new Set(Object.keys(heldMap));
  // 'admin' marks an admin claim; anything else (true) is staff only.
  const wantsAdmin = (uid) => admins.has(uid);
  const holdsAdmin = (uid) => heldMap[uid] === 'admin';
  // New staff, plus staff whose admin status changed. With an admin flag's
  // index missing, nobody is demoted from admin on a partial set.
  const grant = [...staff].filter((uid) => !held.has(uid)
    || (wantsAdmin(uid) && !holdsAdmin(uid))
    || (adminsComplete && !wantsAdmin(uid) && holdsAdmin(uid)));
  // With a flag skipped the set is only partial, so nobody is revoked on it —
  // a missing index must not strip every moderator's Mod Log access.
  const revoke = complete ? [...held].filter((uid) => !staff.has(uid)) : [];

  const updates = {};
  for (const uid of grant) {
    try {
      const asAdmin = wantsAdmin(uid) || (!adminsComplete && holdsAdmin(uid));
      await setStaffClaim(uid, true, asAdmin);
      updates[`staff_claims/${uid}`] = asAdmin ? 'admin' : true;
    } catch (err) {
      // A role flag on a record with no Auth account: nothing to claim.
      console.warn(`[syncStaffClaims] grant ${uid}:`, err.code || err.message);
    }
  }
  for (const uid of revoke) {
    try {
      await setStaffClaim(uid, false);
      updates[`staff_claims/${uid}`] = null;
    } catch (err) {
      if (err.code === 'auth/user-not-found') updates[`staff_claims/${uid}`] = null;
      else console.warn(`[syncStaffClaims] revoke ${uid}:`, err.code || err.message);
    }
  }
  if (Object.keys(updates).length) await db().ref().update(updates);

  console.log(`[syncStaffClaims] staff ${staff.size} (admins ${admins.size}); granted/changed ${grant.length}; revoked ${revoke.length}`);
});
