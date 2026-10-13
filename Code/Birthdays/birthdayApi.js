/**
 * birthdayApi.js — Birthdays server calls + caches (BIRTHDAYS_PLAN.md).
 * Ported from Blox Fruit's Code/Birthdays (2026-10-13), rewritten for MM2's
 * Firebase-only backend: HTTPS functions in functions/birthdays (called with
 * fetch + the Firebase ID token, like Helper/imageUpload.js) and a few
 * small RTDB reads. No Supabase, no native modules, no listeners.
 *
 * Other players' birthdays come back as month and day only, never a year
 * or an age, and only for players who show their birthday (on by default)
 * and are 13 or older. The server enforces that.
 *
 * Built to cost almost nothing:
 *   - Home: ONE tiny RTDB read per local day, birthday_counts/{MMDD} (kept in
 *     MMKV for the day), plus your own date of birth (users_private, else
 *     email_prefs) and birthday_prefs — read once and kept in MMKV; while you
 *     have none it is re-checked at most once a day. myBirthday (HTTPS) only
 *     when it is your birthday, refreshed at most every MINE_TTL_MS.
 *   - Birthdays screen: ONE birthdayTop call per open (TOP_LIMIT rows),
 *     kept LIST_TTL_MS per account and local day. "See all" is the same call
 *     with ALL_LIMIT rows, shown PAGE_SIZE at a time on the phone.
 *   - Your own actions (a wish, Show/Hide, adding or correcting your
 *     birthday, the gift) patch the caches at once.
 *   - Nothing crosses midnight: each day's birthdays are different.
 *
 * The gift: BIRTHDAY_GIFT_STARS stars, once a year, 13+, accounts 30+ days
 * old. claimBirthdayGift adds them to users/{uid}/dailyStars on the server.
 *
 * Birthday data is never passed to ads (owner decision).
 *
 * Development: when the functions are not deployed (404) or nobody is
 * signed in, __DEV__ builds fall back to birthdayMock.js so every screen can
 * be previewed. Release builds never switch to the mock.
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { ref, get, set } from '@react-native-firebase/database';
import { onEmailPrefsChange } from '../Helper/emailOptIn';
import { daysUntilBirthday, isUnder13Dob, monthDayFromDob, localISODate, localDayKeys } from './birthdayDate';

// Same base as Helper/imageUpload.js (uploadImage).
const FUNCTIONS_URL = 'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net';

const MINE_TTL_MS = 2 * 60 * 60 * 1000;
const LIST_TTL_MS = 30 * 60 * 1000;
const PAGE_SIZE = 20;
const TOP_LIMIT = 6;
const ALL_LIMIT = 200;

/** What claimBirthdayGift gives (functions/birthdays/core.js GIFT_STARS); the label before claiming. */
export const BIRTHDAY_GIFT_STARS = 15;

export const WISH_TEMPLATES = ['hbd', 'party', 'cake', 'gift'];
export const WISH_EMOJI = { hbd: '🎂', party: '🎉', cake: '🍰', gift: '🎁' };

const ERROR_CODES = new Set([
  'sign_in', 'not_today', 'already_wished', 'limit', 'cannot_wish', 'bad_date',
  'already_edited', 'age_change', 'gift_unavailable', 'generic',
]);

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'birthdays' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

let currentUid = null;
let ownCache = null;      // { uid, dob: 'YYYY-MM-DD' | null, show: boolean, day }   your own, from RTDB
let countCache = null;    // { day, n }   birthday_counts for the local day (not per account)
let mineCache = null;     // { at, uid, day, data }   myBirthday
let topCache = null;      // { at, uid, day, rows, total, unwished, tomorrow }
let listCache = null;     // { at, uid, day, rows, shown }   "See all": up to ALL_LIMIT rows
let mock = null;

const listeners = new Set();
const emit = () => listeners.forEach((l) => { try { l(); } catch (_) {} });
export const onBirthdaysChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const localDay = () => localISODate();
const fresh = (c, ttl) => !!c && c.uid === currentUid && c.day === localDay() && Date.now() - c.at < ttl;

const readSaved = (key) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};
const save = (key, value) => {
  if (mock) return; // never persist the sample data
  try { storage.set(key, JSON.stringify(value)); } catch (_) {}
};
const forget = (key) => { try { storage.remove(key); } catch (_) {} };
const ownKey = (uid) => `own:${uid}`;
const mineKey = () => `mine:${currentUid}`;
const topKey = () => `top:${currentUid}`;
const countKey = 'counts';

const switchToMock = (why) => {
  if (!mock) {
    mock = require('./birthdayMock').default;
    console.log(`[Birthdays] ${why}: using the local mock`);
  }
  return mock;
};

const codeError = (code) => Object.assign(new Error(code), { code });

/** POST one functions/birthdays endpoint with the ID token. Throws Error with `.code`. */
async function call(fn, body = {}) {
  if (mock) return mock[fn](body);
  // Signed out (or the account not loaded yet): the mock for this call only.
  if (__DEV__ && !currentUid) return require('./birthdayMock').default[fn](body);
  const user = getAuth().currentUser;
  if (!user) throw codeError('sign_in');
  const token = await getIdToken(user);
  let res;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) {
    throw codeError('generic');
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    if (__DEV__) console.log(`[Birthdays] ${fn} failed: ${res.status} ${data?.error || ''}`);
    if (__DEV__ && res.status === 404) return switchToMock('not deployed')[fn](body);
    throw codeError(data?.error || 'generic');
  }
  return data;
}

/** Map an error to an i18n key under birthdays.err.* */
export const birthdayErrorKey = (e) => {
  const code = e?.code || e?.message;
  return ERROR_CODES.has(code) ? code : 'generic';
};

export const isBirthdayMockActive = () => !!mock;
export const getBirthdayMock = () => mock;

const resetLists = () => {
  topCache = null;
  listCache = null;
};

/** __DEV__ only: switch this session to the sample data (long-press the 🎂 on the Birthdays screen). */
export const enableBirthdayPreview = () => {
  if (!__DEV__) return;
  switchToMock('preview');
  mineCache = null;
  resetLists();
  emit();
};

/** Scope caches to the signed-in player (null after sign-out). */
export const setBirthdayUser = (uid) => {
  if ((uid || null) === currentUid) return;
  currentUid = uid || null;
  ownCache = null;
  mineCache = null;
  resetLists();
  // A cold start reads the saved copies instead of the network.
  if (currentUid) {
    const o = readSaved(ownKey(currentUid));
    if (o && o.uid === currentUid) ownCache = o;
    const m = readSaved(mineKey());
    if (m && m.day === localDay()) mineCache = { ...m, uid: currentUid };
    const tp = readSaved(topKey());
    if (tp && tp.day === localDay() && Array.isArray(tp.rows)) topCache = { ...tp, uid: currentUid };
  }
  emit();
};

/** Drop every cache (the dev preview switch). */
export const invalidateBirthdays = () => {
  mineCache = null;
  resetLists();
  if (currentUid) { forget(mineKey()); forget(topKey()); }
  emit();
};

// ─── Your own birthday (RTDB, owner reads) ──────────────────────────────────

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const shapeOwn = (o) => {
  if (!o) return null;
  const md = monthDayFromDob(o.dob);
  const minor = !!o.dob && isUnder13Dob(o.dob);
  return { dob: o.dob || null, month: md?.month || null, day: md?.day || null, show: o.show !== false && !minor, minor, hasDob: !!md };
};
const putOwn = (patch) => {
  if (!currentUid) return;
  ownCache = { uid: currentUid, dob: null, show: true, day: localDay(), ...(ownCache || {}), ...patch };
  save(ownKey(currentUid), ownCache);
};

// The email opt-in flow may record a DOB (email_prefs) while the app runs.
onEmailPrefsChange((uid, next) => {
  if (!uid || uid !== currentUid || !next?.dob || ownCache?.dob) return;
  if (!DOB_RE.test(next.dob)) return;
  putOwn({ dob: next.dob });
  mineCache = null;
  emit();
});

/**
 * Your birthday from your own records: { dob, month, day, show, minor, hasDob }.
 * `dob` (with the year) stays on this phone; it is only for the one-time
 * correction and the under-13 check. Reads RTDB only when nothing is known
 * yet, or once a day while you have no date of birth.
 */
export async function getOwnBirthday(db, { force = false } = {}) {
  if (mock) return shapeOwn(mock.ownBirthday());
  if (!currentUid) return null;
  if (!force && ownCache && (ownCache.dob || ownCache.day === localDay())) return shapeOwn(ownCache);
  if (!db) return shapeOwn(ownCache);
  const uid = currentUid;
  const [priv, emailDob, show] = await Promise.all([
    get(ref(db, `users_private/${uid}/dateOfBirth`)).then((s) => s.val()).catch(() => null),
    get(ref(db, `email_prefs/${uid}/dob`)).then((s) => s.val()).catch(() => null),
    get(ref(db, `birthday_prefs/${uid}/show`)).then((s) => s.val()).catch(() => null),
  ]);
  if (uid !== currentUid) return shapeOwn(ownCache);
  const dob = (typeof priv === 'string' && DOB_RE.test(priv) && priv)
    || (typeof emailDob === 'string' && DOB_RE.test(emailDob) && emailDob) || null;
  ownCache = { uid, dob, show: show !== false, day: localDay() };
  save(ownKey(uid), ownCache);
  return shapeOwn(ownCache);
}

export const peekOwnBirthday = () => (mock ? shapeOwn(mock.ownBirthday()) : (ownCache && ownCache.uid === currentUid ? shapeOwn(ownCache) : null));

/**
 * Add your date of birth when there is none yet: users_private/{uid}/dateOfBirth,
 * which the rules let the app write once. The server indexes it.
 */
export async function addMyBirthday(db, dob) {
  if (!DOB_RE.test(String(dob || ''))) throw codeError('bad_date');
  if (mock) {
    mock.addBirthday(dob);
  } else {
    if (!currentUid || !db) throw codeError('sign_in');
    await set(ref(db, `users_private/${currentUid}/dateOfBirth`), dob);
    putOwn({ dob });
  }
  mineCache = null;
  resetLists();
  if (currentUid) { forget(mineKey()); forget(topKey()); }
  emit();
  return shapeOwn(mock ? mock.ownBirthday() : ownCache);
}

/** Turn "Show my birthday" on or off (birthday_prefs/{uid}, owner write). */
export async function setBirthdayVisibility(db, show) {
  if (mock) {
    mock.setShow(!!show);
  } else {
    if (!currentUid || !db) throw codeError('sign_in');
    await set(ref(db, `birthday_prefs/${currentUid}`), { show: !!show });
    putOwn({ show: !!show });
  }
  if (mineCache?.data) mineCache = { ...mineCache, data: { ...mineCache.data, show: !!show } };
  // Your own row isn't in your list, but a refresh shows the server's view.
  resetLists();
  if (currentUid) forget(topKey());
  emit();
  return { show: !!show };
}

// ─── Home: today's count ────────────────────────────────────────────────────

/** Shown players with a birthday on the phone's date (birthday_counts, one read per day). */
export async function getTodayCount(db) {
  if (mock) return mock.todayCount();
  const day = localDay();
  if (countCache?.day === day) return countCache.n;
  const saved = readSaved(countKey);
  if (saved?.day === day && Number.isFinite(saved.n)) {
    countCache = saved;
    return saved.n;
  }
  if (!db || !currentUid) return 0;
  const counts = await Promise.all(localDayKeys().map((k) => get(ref(db, `birthday_counts/${k}`)).then((s) => Number(s.val()) || 0)));
  countCache = { day, n: counts.reduce((a, b) => a + b, 0) };
  save(countKey, countCache);
  return countCache.n;
}

// ─── myBirthday (HTTPS) ─────────────────────────────────────────────────────

/**
 * { month, day, show, minor, canEdit, wishes: [{ name, avatar, template }],
 *   wishCount, thankPending, giftReady, giftOpened }
 */
export async function getMyBirthday({ force = false } = {}) {
  if (!force && fresh(mineCache, MINE_TTL_MS)) return mineCache.data;
  const data = await call('myBirthday');
  mineCache = { at: Date.now(), uid: currentUid, day: localDay(), data };
  save(mineKey(), mineCache);
  emit();
  return data;
}

export const peekMyBirthday = () => (mineCache && mineCache.uid === currentUid && mineCache.day === localDay() ? mineCache.data : null);

const patchMine = (patch) => {
  if (!mineCache?.data) return;
  mineCache = { ...mineCache, data: { ...mineCache.data, ...patch } };
  save(mineKey(), mineCache);
};

/** Is it your birthday on this phone's date? */
export const isOwnBirthdayToday = (own) => !!own?.month && daysUntilBirthday(own.month, own.day) === 0;

// ─── Other players ──────────────────────────────────────────────────────────

// MM2 keeps blocks in MMKV (localState.bannedUsers): uids, or { id }.
const blockedUids = (blocked) => (Array.isArray(blocked) ? blocked : [])
  .map((b) => (typeof b === 'string' ? b : b?.id))
  .filter((u) => typeof u === 'string' && u)
  .slice(0, 2000);

/**
 * The Birthdays screen's short list: today's TOP_LIMIT players, people you
 * know first. { rows: [{ uid, name, avatar, month, day, wishes, wished, reason }],
 * total, unwished, tomorrow }.
 */
export async function listBirthdaysTop({ force = false, blocked } = {}) {
  if (!force && fresh(topCache, LIST_TTL_MS)) return topCache;
  const res = await call('birthdayTop', { localDate: localISODate(), limit: TOP_LIMIT, blocked: blockedUids(blocked) });
  topCache = {
    at: Date.now(),
    uid: currentUid,
    day: localDay(),
    rows: res?.rows || [],
    total: res?.total ?? 0,
    unwished: res?.unwished ?? 0,
    tomorrow: res?.tomorrow ?? 0,
  };
  save(topKey(), topCache);
  return topCache;
}

export const peekBirthdayTop = () =>
  (topCache && topCache.uid === currentUid && topCache.day === localDay() ? topCache : null);

const listView = (c) => (c ? { rows: c.rows.slice(0, c.shown), next: c.shown < c.rows.length ? c.shown : null } : null);

/**
 * "See all": today's players (up to ALL_LIMIT, one call), handed out
 * PAGE_SIZE at a time. Resolves { rows, next } (next null = no more).
 */
export async function listBirthdays({ force = false, blocked } = {}) {
  if (!force && fresh(listCache, LIST_TTL_MS)) return listView(listCache);
  const res = await call('birthdayTop', { localDate: localISODate(), limit: ALL_LIMIT, blocked: blockedUids(blocked) });
  listCache = { at: Date.now(), uid: currentUid, day: localDay(), rows: res?.rows || [], shown: PAGE_SIZE };
  return listView(listCache);
}

/** "Load more": the next PAGE_SIZE rows (no network). */
export const loadMoreBirthdays = () => {
  if (listCache) listCache = { ...listCache, shown: listCache.shown + PAGE_SIZE };
  return Promise.resolve(listView(listCache));
};

export const peekBirthdayList = () =>
  (listCache && listCache.uid === currentUid && listCache.day === localDay() ? listView(listCache) : null);

/** Record a wish on the saved lists (also for "already wished" answers). */
export const markWished = (toUid, wishes) => {
  const patch = (b) => (b.uid === toUid ? { ...b, wished: true, wishes: wishes ?? (b.wished ? b.wishes : (b.wishes || 0) + 1) } : b);
  if (listCache) listCache = { ...listCache, rows: listCache.rows.map(patch) };
  if (topCache) {
    const was = topCache.rows.find((b) => b.uid === toUid);
    // A wish from "See all" to someone outside the top rows also counts down.
    const newly = !was || !was.wished;
    topCache = { ...topCache, rows: topCache.rows.map(patch), unwished: Math.max(0, (topCache.unwished || 0) - (newly ? 1 : 0)) };
    save(topKey(), topCache);
  }
};

/** One wish per player per birthday. Resolves { wishes }. */
export async function sendBirthdayWish(toUid, template) {
  const data = await call('sendBirthdayWish', { to: toUid, template, localDate: localISODate() });
  markWished(toUid, data?.wishes);
  return data;
}

/** "Wish everyone": every one of today's players you haven't wished, up to the daily limit. { sent, left, limited } */
export async function wishAllBirthdays(template = 'party', blocked) {
  const data = await call('wishAllBirthdays', { localDate: localISODate(), template, blocked: blockedUids(blocked) });
  const left = data?.left ?? 0;
  if (topCache) {
    // Who got wished beyond the top rows isn't known here: when nobody is
    // left, every row was; otherwise the next refresh tells.
    const rows = left ? topCache.rows : topCache.rows.map((b) => (b.wished ? b : { ...b, wished: true, wishes: (b.wishes || 0) + 1 }));
    topCache = { ...topCache, rows, unwished: left, at: left ? 0 : topCache.at };
    save(topKey(), topCache);
  }
  listCache = null; // its wish states are stale; "See all" reloads it
  return data;
}

/** On your birthday: thank everyone who wished you so far. { thanked } */
export async function thankBirthdayWishers() {
  const data = await call('thankBirthdayWishers');
  patchMine({ thankPending: 0 });
  emit();
  return data;
}

/** This year's gift; the server adds the stars. { stars } */
export async function claimBirthdayGift() {
  const data = await call('claimBirthdayGift');
  patchMine({ giftReady: false, giftOpened: true });
  emit();
  return { stars: Number(data?.stars) || 0 };
}

/**
 * Correct your birthday (day, month and year), once. functions/birthdays
 * updateMyBirthday does it: the rules keep the date write-once for the app.
 * It refuses a change across 13. Resolves { month, day, dob }.
 */
export async function updateMyBirthday(year, month, day) {
  const data = await call('updateMyBirthday', { year, month, day });
  const dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!mock && currentUid) putOwn({ dob });
  mineCache = null;
  resetLists();
  if (currentUid) { forget(mineKey()); forget(topKey()); }
  emit();
  return { ...data, dob };
}
