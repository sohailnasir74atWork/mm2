/**
 * valueAlerts.js — FCM topic subscriptions for value-change push alerts.
 *
 * The user's "My Stuff" portfolio (owned + wishlist items) doubles as their
 * watchlist: we subscribe one FCM topic per item (`val_<game>_<slug>`).
 * A Supabase Edge Function diffs each manually-uploaded values file and
 * publishes to the matching topic when an item's value changes, so only
 * users holding/wanting that item get the push. No server-side subscriber
 * storage needed — FCM topics do the fan-out.
 */
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';

let mmkv = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  mmkv = createMMKV();
} catch (_) {}

const KEY = 'valueAlertTopics';
const GAME = 'mm2';
// Device-level FCM cap is 2000 topics; stay far below it.
const MAX_TOPICS = 300;

// MUST stay in sync with slug() in the value-alerts Edge Function — the
// topic string is the contract between app and server. FCM topic charset
// is [a-zA-Z0-9-_.~%]+.
export const slugItem = (name) =>
  String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

/**
 * Foreground display: Android/iOS only auto-show FCM notifications when the
 * app is in background or killed. This handler makes value alerts appear in
 * the system tray in EVERY app state, including while the user is inside
 * the app. Call once at startup (index.js); returns the unsubscribe fn.
 */
export function initValueAlertForegroundHandler() {
  return messaging().onMessage(async (msg) => {
    try {
      if (msg?.data?.kind !== 'value_change') return;
      const title = msg?.notification?.title;
      const body = msg?.notification?.body;
      if (!title && !body) return;
      await notifee.createChannel({
        id: 'value_alerts',
        name: 'Value Alerts',
        importance: AndroidImportance.HIGH,
      });
      await notifee.displayNotification({
        title,
        body,
        data: msg?.data || {},
        android: {
          channelId: 'value_alerts',
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
        },
      });
    } catch (_) {}
  });
}

/**
 * Reconcile FCM topic subscriptions with the user's current item list.
 * Idempotent and cheap: diffs against the last-synced set in MMKV and only
 * touches topics that were added/removed.
 */
export async function syncValueAlertTopics(itemNames) {
  try {
    const wanted = new Set();
    for (const n of itemNames || []) {
      const s = slugItem(n);
      if (s) wanted.add(`val_${GAME}_${s}`);
      if (wanted.size >= MAX_TOPICS) break;
    }

    let prev = [];
    try {
      prev = JSON.parse(mmkv?.getString(KEY) || '[]');
    } catch (_) {}
    const prevSet = new Set(prev);

    const toAdd = [...wanted].filter((t) => !prevSet.has(t));
    const toRemove = prev.filter((t) => !wanted.has(t));
    if (!toAdd.length && !toRemove.length) return;

    // Safe on both platforms; on iOS this is the standard permission ask,
    // on Android 13+ it maps to POST_NOTIFICATIONS.
    try {
      await messaging().requestPermission();
    } catch (_) {}

    await Promise.all([
      ...toAdd.map((t) => messaging().subscribeToTopic(t).catch(() => {})),
      ...toRemove.map((t) => messaging().unsubscribeFromTopic(t).catch(() => {})),
    ]);
    mmkv?.set(KEY, JSON.stringify([...wanted]));
  } catch (_) {
    // Never let alert plumbing break the portfolio UI.
  }
}
