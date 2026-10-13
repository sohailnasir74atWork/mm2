/**
 * postNotifications.js — show feed pushes (a comment on your post, a like of
 * your post) while the app is OPEN, the way Adopt Me does.
 *
 * The server side has worked since 2026-09-13: notifyPostComment and
 * notifyPostLike send to the author's /users/{uid}/fcmToken and FCM accepts
 * them. But FCM only puts a push in the system tray by itself when the app is
 * in the background or killed. In the foreground the push goes to
 * messaging().onMessage and is dropped unless the app displays it. MM2's
 * general foreground handler (Code/Firebase/FrontendNotificationHandling.js,
 * which Adopt Me still mounts) was deleted on 2026-07-28, and the only
 * onMessage left (valueAlerts.js) shows value alerts and nothing else. So a
 * comment or like that arrives while the author is in the app never appears.
 *
 * Scope is deliberately limited to the post types. Chat pushes stay as they
 * are (the chat UI already shows those messages live). Group pushes have their
 * own handler in groupNotifications.js, which shares this channel and
 * isBlockedSender.
 *
 * Android channel: notifyPostComment sends channelId 'default'. Until now no
 * MM2 build ever created that channel, so background comment pushes landed on
 * FCM's low-importance fallback channel ("Miscellaneous"). ensurePostChannel
 * creates it with high importance, as Adopt Me's handler does.
 */
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import i18n from 'i18next';

let mmkv = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  mmkv = createMMKV();
} catch (_) {}

// data.type values sent by functions/notifyPostComment.js and
// functions/notifyPostLike.js.
const POST_PUSH_TYPES = ['postComment', 'post_like'];

// Must match the channelId in functions/notifyPostComment.js (and
// notifyPostLike.js). Changing it strands every installed build.
export const POST_CHANNEL_ID = 'default';

export const ensurePostChannel = async () => {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.createChannel({
      id: POST_CHANNEL_ID,
      // Shown in Android's notification settings, in the app language.
      // Re-creating an existing channel only updates its name. Generic, as in
      // Adopt Me: group, trade-match, comment and like pushes all use it.
      name: i18n.t('misc.notification_channel_name', { defaultValue: 'General notifications' }),
      importance: AndroidImportance.HIGH,
    });
  } catch (_) {}
};

// Same list and MMKV key as LocalGlobelStats (localState.bannedUsers): pushes
// from someone the user blocked are not shown, as in Adopt Me.
export const isBlockedSender = (uid) => {
  if (!uid) return false;
  try {
    const list = JSON.parse(mmkv?.getString('bannedUsers') || '[]');
    return Array.isArray(list) && list.includes(uid);
  } catch (_) {
    return false;
  }
};

/**
 * Call once at startup (index.js). Returns the unsubscribe function.
 */
export function initPostForegroundHandler() {
  return messaging().onMessage(async (msg) => {
    try {
      const data = msg?.data || {};
      if (!POST_PUSH_TYPES.includes(data.type)) return;
      if (isBlockedSender(data.senderId || data.commenterId || data.likerId)) return;
      const title = msg?.notification?.title;
      const body = msg?.notification?.body;
      if (!title && !body) return;
      await ensurePostChannel();
      await notifee.displayNotification({
        title,
        body,
        // Carried through to a press. routeForNotificationData
        // (valueUpdateNotifications.js) maps these types to no screen, so a
        // tap just opens the app, the same as Adopt Me.
        data,
        android: {
          channelId: POST_CHANNEL_ID,
          smallIcon: 'ic_notification',
          pressAction: { id: 'default' },
        },
      });
    } catch (_) {}
  });
}
