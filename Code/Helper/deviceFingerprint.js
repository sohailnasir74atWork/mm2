// deviceFingerprint.js — a stable, RTDB-key-safe ID for this install's device.
//
// Ported from adoptme-jan7/Code/Helper/deviceFingerprint.js (2026-10-13) for
// device bans: banned_devices/{fingerprint}, written by the staff ban helpers
// in ChatScreen/utils.js and read by GlobelStats' device-ban listener, so a
// banned player cannot just sign up again with a fresh account.
//
// WHAT THE ID IS (no hardware serials, no IMEI, no advertising ID):
//   Android: Settings.Secure.ANDROID_ID via react-native-device-info
//     getUniqueId(). A 64-bit software value, scoped to the app signing key
//     + device user on Android 8+. Survives reinstall; resets on factory
//     reset. Needs no permission.
//   iOS: react-native-device-info getUniqueId(). Its native DeviceUID class
//     returns the identifierForVendor and persists it in the Keychain
//     (service "deviceUID", AfterFirstUnlockThisDeviceOnly), so it survives
//     reinstall and the "uninstall every app from this vendor" IDFV reset.
//     Wiped only by Erase All Content and Settings or a different phone.
//     Adopt Me reaches the same behaviour with react-native-keychain; MM2
//     does not have that library and does not need it, because device-info
//     14.x already keeps the value in the Keychain itself.
//
// The ID is stored on the user at users_private/{uid}/deviceId (owner write,
// staff read), NOT users/{uid}/deviceId as Adopt Me does: users/{uid} is
// world-readable, and any signed-in user may write its non-role fields, so a
// stranger could read which accounts share a phone or point someone else's
// record at a third party's device.

import DeviceInfo from 'react-native-device-info';
import { ref, update } from '@react-native-firebase/database';

// Same shape the banned_devices rule validates (device_ban_rules.md). An
// ANDROID_ID is 16 hex chars, an IDFV a 36-char UUID.
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

// Values that are not unique to one device. A ban on one of these would
// lock out every phone that reports it, so they are treated as "no ID".
// 9774d56d682e549c is the ANDROID_ID shared by many Android 2.2 devices;
// the rest are what broken ROMs and some emulators return.
const NOT_UNIQUE = new Set([
  '9774d56d682e549c',
  '0000000000000000',
  '00000000-0000-0000-0000-000000000000',
  'unknown',
]);

let _cached = null;
let _inflight = null;

const toKey = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  // RTDB keys disallow . # $ [ ] /; KEY_RE then rejects anything else odd
  // (control characters included).
  const key = raw.trim().replace(/[.#$[\]/]/g, '_');
  if (!KEY_RE.test(key) || NOT_UNIQUE.has(key.toLowerCase())) return null;
  return key;
};

export const isValidDeviceKey = (v) => typeof v === 'string' && KEY_RE.test(v) && !NOT_UNIQUE.has(v.toLowerCase());

/**
 * This device's fingerprint, or null when none is available. Never throws.
 * Cached for the life of the JS runtime.
 */
export async function getDeviceFingerprint() {
  if (_cached) return _cached;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const key = toKey(await DeviceInfo.getUniqueId());
      if (key) _cached = key;
      return key;
    } catch (e) {
      return null;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

// uid -> fingerprint already written this session, so a profile reload or a
// second login pass does not write again.
const stampedThisSession = new Map();

/**
 * Record this device on the signed-in user (users_private/{uid}/deviceId) so
 * a later staff ban of the account can lock the device too. Fire-and-forget:
 * resolves true/false and never rejects. A refused write (rule not deployed
 * yet, offline) only means a ban of this account will not reach the device.
 */
export const stampOwnDeviceId = async (db, uid) => {
  if (!db || !uid) return false;
  try {
    const fp = await getDeviceFingerprint();
    if (!fp) return false;
    if (stampedThisSession.get(uid) === fp) return true;
    await update(ref(db, `users_private/${uid}`), { deviceId: fp });
    stampedThisSession.set(uid, fp);
    return true;
  } catch (e) {
    return false;
  }
};
