/**
 * notifyGroupInvitation — push to a player who was invited to a group.
 *
 * Ported from Adopt Me (functions/notifyGroupInvitation.js, 2026-10-13).
 * Trigger: Firestore group_invitations/{inviteId} onCreate. MM2 writes these
 * docs from createGroup, sendGroupInvite and addMembersToGroup
 * (Code/ChatScreen/utils/groupUtils.js), every build alike, so old builds'
 * invitations notify too. Nothing is written except clearing a dead token.
 *
 * Skips: non-pending or expired invites, self-invites, a player who has
 * blocked the inviter (RTDB bannedUsers/{invitee}/{inviter}, written by the
 * private-chat Block button), and the opt-out
 * users/{uid}/notificationSettings/groupInvitationNotifications === false
 * (Adopt Me's key; absent means on — MM2 has no switch for it yet).
 *
 * Push text is English, as in Adopt Me.
 *
 * Deploy (not deployed yet):
 *   firebase deploy --only functions:notifyGroupInvitation --project mm2vlaues-ed80c
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

exports.notifyGroupInvitation = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore
  .document('group_invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    const invite = snap.data() || {};
    const { inviteId } = context.params;

    if (invite.status !== 'pending') return null;
    if (invite.expiresAt && Date.now() > invite.expiresAt) return null;

    const invitedUserId = invite.invitedUserId;
    const inviterId = invite.invitedBy || '';
    if (!invitedUserId || invitedUserId === inviterId) return null;

    const groupId = invite.groupId || '';
    const groupName = invite.groupName || 'a group';
    const inviterName = invite.invitedByDisplayName || 'Someone';

    const db = admin.database();
    const [tokenSnap, prefsSnap, blockedSnap] = await Promise.all([
      db.ref(`/users/${invitedUserId}/fcmToken`).once('value'),
      db.ref(`/users/${invitedUserId}/notificationSettings`).once('value'),
      inviterId
        ? db.ref(`/bannedUsers/${invitedUserId}/${inviterId}`).once('value')
        : Promise.resolve(null),
    ]);

    const fcmToken = tokenSnap.val();
    if (!fcmToken || typeof fcmToken !== 'string') return null;

    const prefs = prefsSnap.val() || {};
    if (prefs.groupInvitationNotifications === false) return null;
    if (blockedSnap && blockedSnap.exists()) return null;

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'Group Invitation',
          body: `${inviterName} invited you to join "${groupName}"`,
        },
        data: {
          type: 'groupInvitation',
          inviteId: inviteId || '',
          groupId: String(groupId),
          invitedBy: String(inviterId),
          groupName: String(invite.groupName || ''),
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
      console.error('[notifyGroupInvitation] send failed:', error && error.code, error && error.message);
      if (error && DEAD_TOKEN_CODES.has(error.code)) {
        // Same convention as notifyNewMessage: the app re-registers when it
        // sees isTokenInvalid.
        await db.ref(`/users/${invitedUserId}`)
          .update({ fcmToken: null, isTokenInvalid: true })
          .catch(() => {});
      }
    }

    return null;
  });
