/**
 * notifyGroupMessage — push to group members when a group message is sent.
 *
 * Ported from Adopt Me, 2026-10-13. Adopt Me has two versions:
 *   notifyGroupMessageLegacy  RTDB onWrite group_meta_data/{uid}/{g}/unreadCount
 *   notifyGroupMessage        HTTPS, called by a Supabase webhook on insert
 * MM2's group messages never left RTDB, so this is the live version's logic
 * (one fan-out per message, membership from the Firestore group doc) on an
 * RTDB trigger:
 *
 *   group_messages/{groupId}/messages/{messageId}  onCreate
 *
 * One invocation per message instead of the legacy one per member per
 * message. Every build writes this path (sendGroupMessage in
 * Code/ChatScreen/utils/groupUtils.js), so old builds' messages notify too.
 * Nothing is written except clearing a dead FCM token.
 *
 * Who is NOT notified:
 *   - the sender, and anyone not in groups/{g}.memberIds (the sender too:
 *     a non-member's message is not relayed);
 *   - members reading the group now (activeGroupChats/{g}/{uid} === true —
 *     the app sets it while the chat screen is focused);
 *   - members who muted the group (group_meta_data/{uid}/{g}/muted === true,
 *     the Mute switch on the Groups screen);
 *   - members who blocked the sender (bannedUsers/{uid}/{sender}, the
 *     private-chat Block button; the device-only block list is invisible to
 *     the server);
 *   - the opt-out users/{uid}/notificationSettings/groupChatNotifications
 *     === false (Adopt Me's key; absent means on — MM2 has no switch yet).
 *
 * Rate limit and collapse (MM2 additions; Adopt Me only skips active readers):
 *   - a member stops getting pushes for a group once UNREAD_PUSH_CAP messages
 *     are waiting there unread (group_meta_data/{uid}/{g}/unreadCount), and
 *     starts again after opening the chat, which zeroes the counter. The
 *     sender's client bumps that counter right after writing the message, so
 *     the count read here may or may not include this message yet; either
 *     way a member gets roughly the first three pushes, then quiet.
 *   - each group's pushes replace each other in the tray (Android `tag`,
 *     iOS `apns-collapse-id`), so a busy group is one notification, not a
 *     stack.
 *
 * Cost per message: 1 Firestore read (the group doc) + ~4 small RTDB reads
 * per member not reading the chat (≤ 50 members).
 *
 * Push text is English, as in Adopt Me.
 *
 * Deploy (not deployed yet):
 *   firebase deploy --only functions:notifyGroupMessage --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const UNREAD_PUSH_CAP = 3;
// A message written long after its timestamp (a restore, a replay) is not
// news; don't wake anyone for it.
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const PREVIEW_MAX = 120;

const DEAD_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

function previewFor(m) {
  const text = typeof m.text === 'string' ? m.text.replace(/\s+/g, ' ').trim() : '';
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
  if (m.imageUrl || (Array.isArray(m.imageUrls) && m.imageUrls.length > 0)) return '📷 Photo';
  if (Array.isArray(m.fruits) && m.fruits.length > 0) {
    return m.fruits.length === 1 ? '🐾 Sent an item' : `🐾 Sent ${m.fruits.length} items`;
  }
  return 'New message';
}

exports.notifyGroupMessage = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .database
  .ref('/group_messages/{groupId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const { groupId, messageId } = context.params;
    const message = snap.val();
    if (!message || typeof message !== 'object') return null;

    const senderId = message.senderId;
    if (!senderId) return null;

    const sentAt = Number(message.timestamp) || Number(messageId) || Date.now();
    if (Date.now() - sentAt > MAX_MESSAGE_AGE_MS) return null;

    try {
      const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
      if (!groupDoc.exists) return null;
      const group = groupDoc.data() || {};
      if (group.isActive === false) return null;

      const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
      if (!memberIds.includes(senderId)) return null;
      const recipients = [...new Set(memberIds)].filter((id) => id && typeof id === 'string' && id !== senderId);
      if (recipients.length === 0) return null;

      const db = admin.database();
      const activeSnap = await db.ref(`/activeGroupChats/${groupId}`).once('value');
      const active = activeSnap.val() || {};
      const candidates = recipients.filter((uid) => active[uid] !== true);
      if (candidates.length === 0) return null;

      // One bad record must not sink the rest of the fan-out.
      const reads = await Promise.all(candidates.map((uid) =>
        Promise.all([
          db.ref(`/users/${uid}/fcmToken`).once('value'),
          db.ref(`/users/${uid}/notificationSettings/groupChatNotifications`).once('value'),
          db.ref(`/group_meta_data/${uid}/${groupId}`).once('value'),
          db.ref(`/bannedUsers/${uid}/${senderId}`).once('value'),
        ])
          .then(([tokenSnap, optSnap, metaSnap, blockedSnap]) => ({
            uid,
            token: tokenSnap.val(),
            optedOut: optSnap.val() === false,
            meta: metaSnap.val() || {},
            blocked: blockedSnap.exists(),
          }))
          .catch((e) => {
            console.warn(`[notifyGroupMessage] read failed for ${uid}:`, e.message);
            return null;
          })));

      const tokens = [];
      const tokenToUid = new Map();
      for (const r of reads) {
        if (!r || r.optedOut || r.blocked) continue;
        if (r.meta.muted === true) continue;
        if ((Number(r.meta.unreadCount) || 0) > UNREAD_PUSH_CAP) continue;
        if (!r.token || typeof r.token !== 'string' || tokenToUid.has(r.token)) continue;
        tokens.push(r.token);
        tokenToUid.set(r.token, r.uid);
      }
      if (tokens.length === 0) return null;

      const groupName = group.name || group.groupName || 'Group Chat';
      const senderName = message.sender || 'Someone';
      const collapseId = `group_${groupId}`.slice(0, 64);

      const result = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: groupName,
          body: `${senderName}: ${previewFor(message)}`,
        },
        data: {
          type: 'groupChat',
          groupId: String(groupId),
          senderId: String(senderId),
          messageId: String(messageId),
          timestamp: String(sentAt),
        },
        android: {
          priority: 'high',
          collapseKey: collapseId,
          notification: { channelId: 'default', sound: 'default', tag: collapseId },
        },
        apns: {
          headers: { 'apns-collapse-id': collapseId },
          payload: { aps: { sound: 'default', badge: 1, 'thread-id': String(groupId) } },
        },
      });

      // Clear tokens the device no longer owns; the app re-registers when it
      // sees isTokenInvalid (same convention as notifyNewMessage).
      if (result && Array.isArray(result.responses)) {
        const cleanup = [];
        result.responses.forEach((resp, i) => {
          if (resp.success) return;
          const code = resp.error && resp.error.code;
          if (!DEAD_TOKEN_CODES.has(code)) return;
          const uid = tokenToUid.get(tokens[i]);
          if (uid) {
            cleanup.push(db.ref(`/users/${uid}`).update({ fcmToken: null, isTokenInvalid: true }).catch(() => {}));
          }
        });
        if (cleanup.length > 0) await Promise.all(cleanup);
      }
    } catch (error) {
      console.error('[notifyGroupMessage] error:', error && error.message);
    }

    return null;
  });
