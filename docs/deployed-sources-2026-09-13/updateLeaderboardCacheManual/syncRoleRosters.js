/**
 * Cloud Functions: role roster sync
 *
 * Ported from adoptme-jan7 2026-09-05 (PLAN_2026-09.md).
 *
 * Keeps three small denormalised roster nodes in step with the role flags on
 * user records, so the app's "Our Team" screen can render the staff list from
 * ~60 bytes per member instead of scanning 81,000 user records:
 *
 *   mods/{uid}    { displayName, avatar, role: 'mod' | 'jmod', updatedAt }
 *   trusted/{uid} { displayName, avatar, role: 'trusted',      updatedAt }
 *   cmsr/{uid}    { displayName, avatar, role: 'cmsr',         updatedAt }
 *
 * Every trigger is on a DEEP path — users/{uid}/isModerator, not users/{uid} —
 * so a routine profile write does not wake them. That distinction is what
 * kept Adopt Me's equivalent under 1% of its invocation bill.
 *
 * Deploy:
 *   firebase deploy --only functions:syncModRole_Moderator,functions:syncModRole_BabyMod,functions:syncRoleTrusted,functions:syncRoleCMSR,functions:refreshAllRosters --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Resolved lazily. At module scope this needs FIREBASE_CONFIG to already
// carry databaseURL, which is true inside a deployed function but not
// necessarily while the CLI is analysing the source — and a throw there fails
// the whole deploy with an opaque error.
const db = () => admin.database();

// Two leaves, not the whole record — a user row carries an email and an FCM
// token that have no business in a world-readable roster node.
async function readNameAvatar(uid) {
  const [nameSnap, avatarSnap] = await Promise.all([
    db().ref(`users/${uid}/displayName`).once('value'),
    db().ref(`users/${uid}/avatar`).once('value'),
  ]);
  return {
    displayName: nameSnap.val() || 'Unknown',
    avatar: avatarSnap.val() || '',
  };
}

/** Add or remove a single-role roster entry. */
function simpleRosterTrigger(flag, node, role) {
  return functions
    .runWith({ memory: '128MB', timeoutSeconds: 10 })
    .database
    .ref(`users/{uid}/${flag}`)
    .onWrite(async (change, context) => {
      const { uid } = context.params;
      if (change.after.val() === true) {
        const profile = await readNameAvatar(uid);
        await db().ref(`${node}/${uid}`).set({ ...profile, role, updatedAt: Date.now() });
      } else {
        await db().ref(`${node}/${uid}`).remove();
      }
      return null;
    });
}

// ─── mods/{uid} — one node, two flags, mod outranks jmod ───────────────
exports.syncModRole_Moderator = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isModerator')
  .onWrite(async (change, context) => {
    const { uid } = context.params;

    if (change.after.val() === true) {
      const profile = await readNameAvatar(uid);
      await db().ref(`mods/${uid}`).set({ ...profile, role: 'mod', updatedAt: Date.now() });
      return null;
    }

    // Demoted. If they are still a Junior Mod, downgrade the entry rather
    // than deleting it — otherwise demoting a mod who is also a jmod would
    // silently drop them off the roster entirely.
    const jmodSnap = await db().ref(`users/${uid}/isBabyMod`).once('value');
    if (jmodSnap.val() === true) {
      await db().ref(`mods/${uid}`).update({ role: 'jmod', updatedAt: Date.now() });
    } else {
      await db().ref(`mods/${uid}`).remove();
    }
    return null;
  });

exports.syncModRole_BabyMod = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isBabyMod')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const modSnap = await db().ref(`users/${uid}/isModerator`).once('value');
    // A full moderator's entry always wins; leave it alone either way.
    if (modSnap.val() === true) return null;

    if (change.after.val() === true) {
      const profile = await readNameAvatar(uid);
      await db().ref(`mods/${uid}`).set({ ...profile, role: 'jmod', updatedAt: Date.now() });
    } else {
      await db().ref(`mods/${uid}`).remove();
    }
    return null;
  });

// ─── community badges ──────────────────────────────────────────────────
exports.syncRoleTrusted = simpleRosterTrigger('isTrusted', 'trusted', 'trusted');
exports.syncRoleCMSR = simpleRosterTrigger('isCMSR', 'cmsr', 'cmsr');

// ─── keep names and avatars current ────────────────────────────────────
//
// Roster entries copy displayName/avatar at grant time, so a member who later
// changes either would show stale details forever. Reads only the roster
// nodes and two leaves per member — a few dozen tiny reads every six hours.
exports.refreshAllRosters = functions
  .runWith({ memory: '128MB', timeoutSeconds: 60 })
  .pubsub
  .schedule('every 6 hours')
  .onRun(async () => {
    const updates = {};
    let touched = 0;

    for (const node of ['mods', 'trusted', 'cmsr']) {
      const rosterSnap = await db().ref(node).once('value');
      if (!rosterSnap.exists()) continue;

      const current = rosterSnap.val();
      const uids = Object.keys(current);

      const profiles = await Promise.all(uids.map((uid) => Promise.all([
        db().ref(`users/${uid}/displayName`).once('value'),
        db().ref(`users/${uid}/avatar`).once('value'),
      ])));

      profiles.forEach(([nameSnap, avatarSnap], i) => {
        const uid = uids[i];

        // Neither field exists → the account is gone. Drop the entry.
        if (!nameSnap.exists() && !avatarSnap.exists()) {
          updates[`${node}/${uid}`] = null;
          touched++;
          return;
        }

        const newName = nameSnap.val() || 'Unknown';
        const newAvatar = avatarSnap.val() || '';
        const entry = current[uid];
        if (newName !== entry.displayName || newAvatar !== entry.avatar) {
          updates[`${node}/${uid}/displayName`] = newName;
          updates[`${node}/${uid}/avatar`] = newAvatar;
          updates[`${node}/${uid}/updatedAt`] = Date.now();
          touched++;
        }
      });
    }

    if (Object.keys(updates).length > 0) {
      await db().ref().update(updates);
      console.log(`[RosterSync] refreshed ${touched} entries`);
    } else {
      console.log('[RosterSync] all entries up to date');
    }
    return null;
  });
