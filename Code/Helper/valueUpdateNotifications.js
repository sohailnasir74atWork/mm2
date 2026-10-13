/**
 * valueUpdateNotifications.js — the "MM2 values updated" broadcast push.
 *
 * One FCM topic for every install, guest or signed in: `value-updates`. The
 * owner's publisher sends ONE message to it whenever the MM2 or Supreme values
 * change:
 *   notification: { title: 'MM2 values updated', body: 'MM2: 5 values changed: …' }
 *   data: { type: 'values_update', route: 'Values', kind: 'value_change', game: 'mm2' }
 * `kind: 'value_change'` is only there so builds older than this file still
 * show it in the foreground (initValueAlertForegroundHandler, valueAlerts.js).
 *
 * The opt-out is the Settings switch "Value Update Notifications": MMKV
 * boolean VALUE_UPDATES_SETTING_KEY, default ON.
 *
 * This is NOT part of the per-item alerts in valueAlerts.js.
 * syncValueAlertTopics only reconciles the `val_mm2_<slug>` names it saved
 * under MMKV 'valueAlertTopics', so this topic never counts against its
 * 300-topic cap and is never unsubscribed by it. Keep it out of that list.
 *
 * Also handles TAPS on value pushes (this broadcast and the per-item alerts):
 * they open the Values screen; and on birthday pushes (functions/birthdays,
 * data.route 'Birthdays'): they open the Birthdays screen; and on group pushes
 * (groupChat / groupInvitation / groupJoinRequest): see groupNotifications.js;
 * and on Trade Match alerts (type 'trade_match', route 'TradeMatch'): they open
 * the Trade Match screen.
 */
import { Platform } from 'react-native';
import {
  getMessaging,
  getAPNSToken,
  subscribeToTopic,
  unsubscribeFromTopic,
  onNotificationOpenedApp,
  getInitialNotification,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, AuthorizationStatus, EventType } from '@notifee/react-native';
import i18n from 'i18next';
import { navigationRef } from './navigationService';
import { whenAdsReady } from '../Ads/adsGate';
import { notificationTargetForGroupPush } from './groupNotifications';

let mmkv = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  mmkv = createMMKV();
} catch (_) {}

export const VALUE_UPDATES_TOPIC = 'value-updates';
// MMKV boolean, absent = ON. LocalGlobelStats reads the same key into
// localState.valueUpdateNotifications for the Settings switch.
export const VALUE_UPDATES_SETTING_KEY = 'valueUpdateNotifications';
// Set once the startup flow has asked for notification permission, so it
// asks at most once per install.
const PERMISSION_ASKED_KEY = 'valueUpdatesPermissionAsked';
// Gap after the consent chain before that one ask, so it doesn't land on
// top of the splash fade and the launch ad.
const PERMISSION_ASK_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isValueUpdatesEnabled = () => {
  try {
    return mmkv?.getBoolean(VALUE_UPDATES_SETTING_KEY) ?? true;
  } catch (_) {
    return true;
  }
};

// iOS: topic calls fail until the APNs token exists. Same wait as
// registerForNotifications (Globelhelper.js). Android needs nothing.
const waitForApnsToken = async (m) => {
  if (Platform.OS !== 'ios') return;
  for (let i = 0; i < 4; i++) {
    try {
      if (await getAPNSToken(m)) return;
    } catch (_) {}
    await sleep(1500);
  }
};

// One topic call at a time, and each reads the setting when it RUNS, so
// flipping the switch quickly always ends on the last value picked.
let topicQueue = Promise.resolve();
const syncTopic = () => {
  topicQueue = topicQueue
    .then(async () => {
      const m = getMessaging();
      await waitForApnsToken(m);
      if (isValueUpdatesEnabled()) {
        await subscribeToTopic(m, VALUE_UPDATES_TOPIC);
      } else {
        await unsubscribeFromTopic(m, VALUE_UPDATES_TOPIC);
      }
    })
    .catch(() => {});
  return topicQueue;
};

// Same channel initValueAlertForegroundHandler creates on first use. Making
// it up front means a push that arrives while the app is in the background
// lands on it (high importance) instead of FCM's fallback channel.
const ensureValueAlertsChannel = async () => {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.createChannel({
      id: 'value_alerts',
      // Shown in Android's notification settings, in the app language.
      name: i18n.t('settings.channel_value_alerts', { defaultValue: 'Value Alerts' }),
      importance: AndroidImportance.HIGH,
    });
  } catch (_) {}
};

// Without permission, guests on iOS and Android 13+ are subscribed but see
// nothing. Nothing else asks a guest, so ask once. notifee, not
// messaging().requestPermission(): the latter is a no-op on Android.
const askPermissionOnce = async () => {
  try {
    if (!isValueUpdatesEnabled() || mmkv?.getBoolean(PERMISSION_ASKED_KEY)) return;
    mmkv?.set(PERMISSION_ASKED_KEY, true);
    const { authorizationStatus } = await notifee.getNotificationSettings();
    if (
      authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      authorizationStatus === AuthorizationStatus.PROVISIONAL
    ) {
      return;
    }
    await notifee.requestPermission();
  } catch (_) {}
};

let startupDone = false;
/**
 * Call once at app start (GlobalStateProvider mount). Fire-and-forget: it
 * never throws and never delays startup.
 */
export function initValueUpdatesOnStartup() {
  if (startupDone) return;
  startupDone = true;
  try {
    ensureValueAlertsChannel();
    // Every launch, not once: the subscription belongs to the FCM token, and
    // a rotated token drops it. When OFF this unsubscribes instead, which also
    // undoes a server-side backfill that subscribed the token.
    syncTopic();
    // whenAdsReady resolves after onboarding and the ATT → UMP consent chain
    // (App.js), so this ask never stacks on those prompts.
    whenAdsReady()
      .then(() => sleep(PERMISSION_ASK_DELAY_MS))
      .then(askPermissionOnce)
      .catch(() => {});
  } catch (_) {}
}

/**
 * The Settings switch. Saves the choice and subscribes or unsubscribes in
 * the background. Never throws.
 */
export function setValueUpdatesEnabled(enabled) {
  try {
    mmkv?.set(VALUE_UPDATES_SETTING_KEY, !!enabled);
  } catch (_) {}
  return syncTopic();
}

// ── Notification taps ───────────────────────────────────────────────────

// Screens a push may open. data.route comes from the server, so it is
// matched against this list and never passed to navigate() unchecked.
const ALLOWED_ROUTES = ['Values', 'Birthdays', 'TradeMatch'];
// Birthday pushes (functions/birthdays): the birthday itself, a first wish,
// a thank-you. All carry route 'Birthdays'.
const BIRTHDAY_TYPES = ['birthday', 'birthday_wish', 'birthday_thanks'];

/** The root-stack screen a tapped push should open, or null to do nothing. */
export function routeForNotificationData(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'values_update') {
    return data.route === 'Values' ? 'Values' : null;
  }
  if (BIRTHDAY_TYPES.includes(data.type)) {
    return data.route === 'Birthdays' && ALLOWED_ROUTES.includes(data.route) ? 'Birthdays' : null;
  }
  // Trade Match dream alerts (functions/tradeMatch.js tradeMatchDreamAlerts):
  // { type: 'trade_match', route: 'TradeMatch', itemKey, fromUid }.
  if (data.type === 'trade_match' || data.route === 'TradeMatch') return 'TradeMatch';
  // Per-item alerts from valueAlertsPoll: { kind, game, item }, no route.
  if (data.kind === 'value_change') return 'Values';
  return null;
}

/**
 * Where a tapped push leads, as { name, params } (params may be undefined),
 * or null to only open the app. Root-stack routes come from
 * routeForNotificationData; group pushes lead into the Chat tab's stack.
 */
export function targetForNotificationData(data) {
  const route = routeForNotificationData(data);
  if (route) return { name: route, params: undefined };
  return notificationTargetForGroupPush(data);
}

let pendingRoute = null;
let lastOpenedKey = null;

const flushPendingRoute = () => {
  if (!pendingRoute) return;
  try {
    if (!navigationRef.isReady()) return;
    const target = pendingRoute;
    pendingRoute = null;
    if (target.params) {
      navigationRef.navigate(target.name, target.params);
    } else {
      navigationRef.navigate(target.name);
    }
  } catch (_) {}
};

const openFromNotification = (data, key) => {
  const target = targetForNotificationData(data);
  if (!target) return;
  // One tap can be reported twice (notifee's getInitialNotification and a
  // PRESS event); navigate once.
  if (key) {
    if (key === lastOpenedKey) return;
    lastOpenedKey = key;
  }
  pendingRoute = target;
  flushPendingRoute();
};

const onRemoteOpened = (msg) => {
  if (!msg) return;
  openFromNotification(msg.data, msg.messageId ? `fcm:${msg.messageId}` : null);
};

// groupNotifications.js reuses one notifee id per slot (a group, Trade
// Match) and stamps each display with shownAt, so the id alone would make the
// next tap in that slot look like a repeat. Other notifications: id only.
const notifeeTapKey = (n) => {
  if (!n?.id) return null;
  const shownAt = n.data?.shownAt;
  return shownAt ? `notifee:${n.id}:${shownAt}` : `notifee:${n.id}`;
};

const onNotifeeEvent = ({ type, detail } = {}) => {
  if (type !== EventType.PRESS) return;
  const n = detail?.notification;
  openFromNotification(n?.data, notifeeTapKey(n));
};

/**
 * notifee.onBackgroundEvent handler: a press on a notification the app
 * displayed (foreground value alerts) while the app is in the background.
 * notifee allows ONE background handler, registered in index.js; anything
 * else that needs background events must be added here or composed there.
 */
export const handleNotifeeBackgroundEvent = async (event) => {
  try {
    onNotifeeEvent(event);
  } catch (_) {}
};

let tapHandlersStarted = false;
/**
 * Call once from a mounted component (GlobalStateProvider). Not at module
 * scope: on Android getInitialNotification reads the launch Activity's
 * intent, which may not be attached yet while index.js is evaluating.
 */
export function initValueNotificationTapHandlers() {
  if (tapHandlersStarted) return;
  tapHandlersStarted = true;
  try {
    // A cold-start tap can arrive before the NavigationContainer is ready
    // (App.js mounts it only after onboarding); it waits here until then.
    navigationRef.addListener('ready', () => setTimeout(flushPendingRoute, 0));
  } catch (_) {}
  try {
    const m = getMessaging();
    // System-shown push tapped while the app was in the background...
    onNotificationOpenedApp(m, onRemoteOpened);
    // ...or while it was not running.
    getInitialNotification(m).then(onRemoteOpened).catch(() => {});
  } catch (_) {}
  try {
    // Pushes shown by initValueAlertForegroundHandler are notifee
    // notifications: their presses come through notifee instead.
    notifee.onForegroundEvent(onNotifeeEvent);
    notifee
      .getInitialNotification()
      .then((initial) => {
        if (initial) onNotifeeEvent({ type: EventType.PRESS, detail: initial });
      })
      .catch(() => {});
  } catch (_) {}
}
