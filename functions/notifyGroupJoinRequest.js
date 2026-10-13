/**
 * notifyGroupJoinRequest — push to a group's creator when someone asks to join.
 *
 * Ported from Adopt Me (functions/notifyGroupJoinRequest.js, 2026-10-13).
 * Trigger: Firestore group_join_requests/{requestId} onCreate, written by
 * sendJoinRequest (Code/ChatScreen/utils/groupUtils.js) on every build.
 *
 * Builds before 2026-10-13 stored `groupName: groupData.groupName`, a field
 * most groups don't have, so their requests all say "Group". When that is
 * the name on the request, this reads the group doc for the real one (one
 * Firestore read, only for those requests).
 *
 * Skips: non-pending requests, the creator asking their own group, a creator
 * who has blocked the requester (RTDB bannedUsers/{creator}/{requester}), and
 * the opt-out users/{uid}/notificationSettings/groupJoinRequestNotifications
 * === false (Adopt Me's key; absent means on).
 *
 * Push text is English, as in Adopt Me.
 *
 * Deploy (not deployed yet):
 *   firebase deploy --only functions:notifyGroupJoinRequest --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

exports.notifyGroupJoinRequest = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore
  .document('group_join_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const request = snap.data() || {};
    const { requestId } = context.params;

    if (request.status !== 'pending') return null;

    const creatorId = request.creatorId;
    const requesterId = request.requesterId || '';
    if (!creatorId || creatorId === requesterId) return null;

    const groupId = request.groupId || '';
    const requesterName = request.requesterDisplayName || 'Someone';

    const db = admin.database();
    const [tokenSnap, prefsSnap, blockedSnap] = await Promise.all([
      db.ref(`/users/${creatorId}/fcmToken`).once('value'),
      db.ref(`/users/${creatorId}/notificationSettings`).once('value'),
      requesterId
        ? db.ref(`/bannedUsers/${creatorId}/${requesterId}`).once('value')
        : Promise.resolve(null),
    ]);

    const fcmToken = tokenSnap.val();
    if (!fcmToken || typeof fcmToken !== 'string') return null;

    const prefs = prefsSnap.val() || {};
    if (prefs.groupJoinRequestNotifications === false) return null;
    if (blockedSnap && blockedSnap.exists()) return null;

    let groupName = request.groupName;
    if ((!groupName || groupName === 'Group') && groupId) {
      try {
        const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
        const data = groupDoc.exists ? groupDoc.data() || {} : {};
        groupName = data.name || data.groupName || groupName;
      } catch (e) {
        console.warn('[notifyGroupJoinRequest] group name lookup failed:', e.message);
      }
    }
    groupName = groupName || 'your group';

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'Join Request',
          body: `${requesterName} wants to join "${groupName}"`,
        },
        data: {
          type: 'groupJoinRequest',
          requestId: requestId || '',
          groupId: String(groupId),
          requesterId: String(requesterId),
          groupName: String(groupName),
          timestamp: Date.now().toString(),
        },
        android: {
          priority: 'high',
          notification: { channelId: 'default', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });
    } catch (error) {
      console.error('[notifyGroupJoinRequest] send failed:', error && error.code, error && error.message);
      if (error && DEAD_TOKEN_CODES.has(error.code)) {
        await db.ref(`/users/${creatorId}`)
          .update({ fcmToken: null, isTokenInvalid: true })
          .catch(() => {});
      }
    }

    return null;
  });
