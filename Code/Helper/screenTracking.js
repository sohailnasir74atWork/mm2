/**
 * screenTracking.js — crash reports that name the screen and the user
 * (ported from Adopt Me's trackCurrentScreen, adoptme-jan7/Code/Helper/navigationService.js).
 *
 * MM2 1.5.1 still has the RN 0.87 Fabric addViewAt crash (~1.1% of users) and
 * every Android breadcrumb said only "MainActivity", so it could not be tied to
 * a screen. On each navigation change this writes a Crashlytics log line
 * `screen <Route>`, sets the `screen` key (the screen at the moment of the
 * crash) and logs a GA screen_view, which Crashlytics also shows as a
 * breadcrumb. Wired as NavigationContainer onReady / onStateChange in App.js.
 *
 * setCrashUserId puts the signed-in uid (only the uid: never an email or a
 * name) on crash reports, and clears it on sign-out.
 */
import { getCrashlytics, setAttribute, setUserId, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { navigationRef } from './navigationService';

let lastScreen = null;

export function trackCurrentScreen() {
  let name = null;
  try {
    name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : null;
  } catch (_) {
    name = null;
  }
  if (!name || name === lastScreen) return;
  lastScreen = name;
  try {
    const c = getCrashlytics();
    crashlyticsLog(c, `screen ${name}`);
    Promise.resolve(setAttribute(c, 'screen', name)).catch(() => {});
  } catch (_) {}
  try {
    Promise.resolve(
      logEvent(getAnalytics(), 'screen_view', { screen_name: name, screen_class: name }),
    ).catch(() => {});
  } catch (_) {}
}

let lastUserId = null;

export function setCrashUserId(uid) {
  const id = typeof uid === 'string' ? uid : '';
  if (id === lastUserId) return;
  lastUserId = id;
  try {
    Promise.resolve(setUserId(getCrashlytics(), id)).catch(() => {});
  } catch (_) {}
}
