/**
 * groupNotifications.js — group pushes while the app is OPEN, plus where a
 * tap on one leads. Sibling of postNotifications.js.
 *
 * Server side (functions/): notifyGroupMessage, notifyGroupInvitation and
 * notifyGroupJoinRequest send with data.type
 *   'groupChat'        { groupId, senderId, messageId, timestamp }
 *   'groupInvitation'  { inviteId, groupId, invitedBy, groupName, timestamp }
 *   'groupJoinRequest' { requestId, groupId, requesterId, groupName, timestamp }
 * on Android channel 'default'. Each function honours an opt-out under
 * users/{uid}/notificationSettings (groupChatNotifications,
 * groupInvitationNotifications, groupJoinRequestNotifications; absent = on),
 * the Settings switches in GroupNotificationRows.jsx.
 *
 * Foreground: FCM drops a push that arrives while the app is open unless the
 * app shows it. Rules, as in Adopt Me's foreground handler: needs a title and
 * a body, and nothing from a sender the user blocked. On top of that a group
 * message is never shown while the user is looking at that same group
 * (GroupChatScreen calls setViewingGroup / clearViewingGroup on focus/blur).
 * The server already skips members present in /activeGroupChats; this covers
 * the gap while that presence write is in flight.
 *
 * Taps: notificationTargetForGroupPush maps a group push to a screen in the
 * Chat tab's stack (ChatNavigator.js). valueUpdateNotifications.js owns every
 * tap handler and asks this file for group types.
 *
 * The same foreground handler also shows Trade Match dream alerts
 * (functions/tradeMatch.js tradeMatchDreamAlerts: data { type: 'trade_match',
 * route: 'TradeMatch', itemKey, fromUid }, channel 'default', tag
 * 'trade_match'), with the same rules. Their taps open the TradeMatch root
 * screen via routeForNotificationData (valueUpdateNotifications.js).
 */
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import { ensurePostChannel, POST_CHANNEL_ID, isBlockedSender } from './postNotifications';

export const GROUP_PUSH_TYPES = ['groupChat', 'groupInvitation', 'groupJoinRequest'];
// Everything initGroupForegroundHandler shows.
const FOREGROUND_TYPES = [...GROUP_PUSH_TYPES, 'trade_match'];

// ── The group the user is looking at right now ───────────────────────────

let viewingGroupId = null;

/** GroupChatScreen, on focus. */
export const setViewingGroup = (groupId) => {
  viewingGroupId = groupId ? String(groupId) : null;
};

/** GroupChatScreen, on blur. Only clears if it is still that group. */
export const clearViewingGroup = (groupId) => {
  if (!groupId || viewingGroupId === String(groupId)) viewingGroupId = null;
};

export const getViewingGroup = () => viewingGroupId;

// Who caused each push, for the blocked-sender check.
const senderOf = (data) => {
  if (data.type === 'groupChat') return data.senderId;
  if (data.type === 'groupInvitation') return data.invitedBy;
  if (data.type === 'groupJoinRequest') return data.requesterId;
  if (data.type === 'trade_match') return data.fromUid;
  return null;
};

/**
 * Call once at startup (index.js). Returns the unsubscribe function.
 */
export function initGroupForegroundHandler() {
  return messaging().onMessage(async (msg) => {
    try {
      const data = msg?.data || {};
      if (!FOREGROUND_TYPES.includes(data.type)) return;
      if (isBlockedSender(senderOf(data))) return;
      if (data.type === 'groupChat' && data.groupId && String(data.groupId) === viewingGroupId) return;
      const title = msg?.notification?.title;
      const body = msg?.notification?.body;
      if (!title || !body) return;
      await ensurePostChannel();
      await notifee.displayNotification({
        // One entry per group, replaced by the next message, like the
        // system-shown copies (android tag / apns-collapse-id group_<id>).
        // Trade Match alerts share one slot too (server tag 'trade_match').
        ...(data.type === 'groupChat' && data.groupId ? { id: `group_${data.groupId}` } : {}),
        ...(data.type === 'trade_match' ? { id: 'trade_match' } : {}),
        title,
        body,
        // Carried through to a press; notificationTargetForGroupPush (or
        // routeForNotificationData for trade_match) routes it. shownAt makes
        // each display a distinct tap: the id above is reused per slot.
        data: { ...data, shownAt: String(Date.now()) },
        android: {
          channelId: POST_CHANNEL_ID,
          smallIcon: 'ic_notification',
          pressAction: { id: 'default' },
        },
      });
    } catch (_) {}
  });
}

// ── Taps ─────────────────────────────────────────────────────────────────

// Push data comes from the server: ids are only used as route params, and
// only when they look like plain document ids.
const isPlainId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[/\s]/.test(v);

// The Chat tab (MainTabs.js) holds ChatNavigator's stack. `initial: false`
// keeps the community chat underneath, so Back leads somewhere sensible when
// the tap cold-starts the app.
const inChatStack = (screen, params) => ({
  name: 'MainTabs',
  params: { screen: 'Chat', params: { screen, params, initial: false } },
});

/**
 * The screen a tapped group push should open, as { name, params }, or null
 * when the data is not a group push (or is unusable).
 *   groupChat        → that group's chat (GroupChatDetail)
 *   groupInvitation  → Groups, invitations section open
 *   groupJoinRequest → Groups, join requests section open
 */
export function notificationTargetForGroupPush(data) {
  if (!data || typeof data !== 'object' || !GROUP_PUSH_TYPES.includes(data.type)) return null;
  if (data.type === 'groupChat') {
    if (!isPlainId(data.groupId)) return null;
    return inChatStack('GroupChatDetail', { groupId: data.groupId });
  }
  // pushAt changes on every tap, so GroupsScreen re-opens the section even
  // when it is already the current screen.
  const openSection = data.type === 'groupInvitation' ? 'invitations' : 'joinRequests';
  return inChatStack('Groups', { openSection, pushAt: Date.now() });
}
