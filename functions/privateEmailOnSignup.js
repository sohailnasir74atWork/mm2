/**
 * privateEmailOnSignup.js — every new account's email lands in users_private.
 *
 * 📅 2026-09-27 (round 2). Staff tools in new builds look another user's
 * email up in users_private/{uid} (Code/Helper/privateProfile.js), because
 * chat messages and posts no longer carry it. New builds and the website
 * write the owner's own record at sign-in — but an account created by an
 * OLD build never does, and MM2 never wrote emails into users/{uid} either.
 * Without this, a troublemaker who signs up on an old build after cutover
 * could not be sanctioned from a new build.
 *
 * Existing accounts are backfilled once by scripts/migrate-user-pii.js
 * (its Auth pass). This covers every account created after that.
 *
 * 1st gen on purpose: 2nd gen has only BLOCKING auth triggers, which need
 * Identity Platform and sit in the sign-up path.
 *
 * SAFE TO DEPLOY EARLY (step a): it only writes users_private.
 *   firebase deploy --only functions:privateEmailOnSignup --project mm2vlaues-ed80c
 */

const functions = require('firebase-functions/v1');
const { db } = require('./_userEmail');

exports.privateEmailOnSignup = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .auth.user()
  .onCreate(async (user) => {
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email) return null;   // phone / anonymous accounts have none
    try {
      await db().ref(`users_private/${user.uid}/email`).set(email);
    } catch (err) {
      console.error(`[privateEmailOnSignup] ${user.uid} failed:`, err.message);
    }
    return null;
  });
