/**
 * birthdays/core.js — the Birthdays feature's server logic (BIRTHDAYS_PLAN.md).
 *
 * Firebase port of Blox Fruit's Supabase birthdays (036 + 037 + 041) and its
 * push functions. Everything here is plain async functions over the admin
 * SDK, reached through `io` so the tests can run it against the emulators
 * with FCM stubbed. birthdays/index.js wraps them as Cloud Functions;
 * scripts/birthdays/backfillIndex.js reuses reindexBirthday.
 *
 * Owner rules that shape it:
 *   - Only MONTH and DAY ever leave the server; never a year or an age.
 *   - Players under 13 are never listed and get no wishes and no gift.
 *   - Birthdays are shown unless birthday_prefs/{uid}/show === false.
 *   - 100 wishes per sender per UTC day; one wish per sender per birthday.
 *
 * RTDB (all server-written unless noted; access in database.rules.json):
 *   users_private/{uid}/dateOfBirth      canonical DOB 'YYYY-MM-DD' (owner write-once)
 *   email_prefs/{uid}/dob                fallback DOB (email opt-in flow)
 *   birthday_prefs/{uid}                 { show } — owner
 *   birthday_index/{MMDD}/{uid}          true — shown, 13+
 *   birthday_counts/{MMDD}               entries under that key
 *   birthday_server/index_key/{uid}      the key the uid is indexed under
 *   birthday_server/pending_key/{uid}    the key of an under-13 DOB
 *   birthday_server/pending13/{MMDD}/{uid}  under-13s, re-checked on their birthday
 *   birthday_server/hidden_key/{uid}     the key of a 13+ player who hid their birthday
 *   birthday_server/hidden13/{MMDD}/{uid}  13+ players who hid it (birthday email only:
 *                                        never listed, never wished; 2026-10-13)
 *   birthday_server/email_sent/{year}/{uid}, email_day   birthday email claims
 *                                        (notifyBirthdayEmails.js)
 *   birthday_server/edits/{uid}          ms of the one-time correction
 *   birthday_server/sent_day/{uid}/{YYYY-MM-DD}  wishes sent that UTC day
 *   birthday_server/bday_pushed/{year}/{uid}, first_pushed/{year}/{uid},
 *   birthday_server/thank_pushed/{YYYY-MM-DD}/{uid}   push claims
 *   birthday_wishes/{year}/{to}/{from}   { t, at, n, a, th? }
 *   birthday_sent/{uid}/{year}/{to}      true
 *   birthday_wish_counts/{year}/{uid}    number
 *   birthday_wished_by/{uid}/{from}      true (any year)
 *   birthday_gifts/{uid}/{year}          { stars, at }
 */

const admin = require('firebase-admin');
const D = require('./dates');

if (!admin.apps.length) {
  admin.initializeApp();
}

const MIN_AGE = 13;
const MIN_EDIT_AGE = 4;
const GIFT_STARS = 15;
const DAILY_WISH_LIMIT = 100;
const ACTIVE_DAYS = 30;
const ACCOUNT_MIN_DAYS = 30;
const TEMPLATES = ['hbd', 'party', 'cake', 'gift'];
const DEFAULT_TOP_LIMIT = 6;
const MAX_TOP_LIMIT = 200;
const MAX_RECEIVED = 100;
const MAX_GROUPS = 100;
const MAX_BLOCKED = 5000;
const FCM_CHUNK = 500;
const READ_CONCURRENCY = 100;

// Everything that leaves the process. Tests replace messaging (and now).
const io = {
  db: () => admin.database(),
  fs: () => admin.firestore(),
  messaging: () => admin.messaging(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  now: () => Date.now(),
  log: (...a) => console.log(...a),
};

class BirthdayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => { throw new BirthdayError(code, status); };

// Firebase uids; also keeps anything that is not a legal RTDB key out of paths.
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const okUid = (u) => typeof u === 'string' && UID_RE.test(u);

const ref = (path) => io.db().ref(path);
const val = async (path) => (await ref(path).once('value')).val();
const exists = async (path) => (await ref(path).once('value')).exists();

// Promise.all with a cap on reads in flight.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Create-once claim: true if this call created `path`, false if it already existed. */
async function claimOnce(path, value = true) {
  const res = await ref(path).transaction((cur) => (cur == null ? value : undefined), undefined, false);
  return res.committed;
}

const cleanName = (n) => {
  const s = typeof n === 'string' ? n.replace(/[\r\n\t]+/g, ' ').trim() : '';
  return s ? s.slice(0, 40) : 'Player';
};
const cleanAvatar = (a) => (typeof a === 'string' && /^https?:\/\//.test(a) ? a.slice(0, 500) : null);

// lastActivity is an ISO string in current builds; tolerate ms numbers.
const activityMs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
};

// ─── Date of birth + index ──────────────────────────────────────────────────

/** The effective DOB: users_private, else email_prefs. { y, m, d } or null. */
async function effectiveDob(uid) {
  const [priv, emailDob] = await Promise.all([
    val(`users_private/${uid}/dateOfBirth`),
    val(`email_prefs/${uid}/dob`),
  ]);
  return D.parseDate(priv) || D.parseDate(emailDob);
}

/**
 * Add or remove one index entry, keeping birthday_counts right. The count
 * moves only when presence actually changed, so a re-run is a no-op.
 */
async function setPresence(key, uid, present) {
  let was = null;
  const res = await ref(`birthday_index/${key}/${uid}`).transaction((cur) => {
    was = cur;
    return present ? true : null;
  }, undefined, false);
  if (!res.committed) return false;
  const changed = (was != null) !== present;
  if (changed) {
    await ref(`birthday_counts/${key}`).transaction(
      (n) => Math.max(0, (Number(n) || 0) + (present ? 1 : -1)),
      undefined,
      false,
    );
  }
  return changed;
}

/**
 * Put `uid` where it belongs in birthday_index: under its DOB's 'MMDD' iff
 * the DOB is valid, the player is 13+ today (UTC) and has not hidden their
 * birthday. Under-13s go on the pending13 list for their birthday instead;
 * 13+ players who hid it go on hidden13 (read only by notifyBirthdayEmails).
 * Idempotent; safe to run any number of times. Resolves { key, pending }.
 */
async function reindexBirthday(uid) {
  if (!okUid(uid)) return { key: null, pending: null };
  const today = D.utcToday(io.now());
  const [dob, show, oldKey, oldPending, oldHidden] = await Promise.all([
    effectiveDob(uid),
    val(`birthday_prefs/${uid}/show`),
    val(`birthday_server/index_key/${uid}`),
    val(`birthday_server/pending_key/${uid}`),
    val(`birthday_server/hidden_key/${uid}`),
  ]);
  const age = D.ageOn(dob, today);
  const dobKey = dob && age != null ? D.keyOf(dob.m, dob.d) : null;
  const key = dobKey && age >= MIN_AGE && show !== false ? dobKey : null;
  const pending = dobKey && age < MIN_AGE ? dobKey : null;
  // 13+ but hidden: kept out of birthday_index (nobody sees or wishes them),
  // listed server-side only so the birthday email still reaches them.
  const hidden = dobKey && age >= MIN_AGE && show === false ? dobKey : null;

  if (typeof oldKey === 'string' && D.parseKey(oldKey) && oldKey !== key) await setPresence(oldKey, uid, false);
  if (key) await setPresence(key, uid, true);

  const updates = {
    [`birthday_server/index_key/${uid}`]: key,
    [`birthday_server/pending_key/${uid}`]: pending,
  };
  if (typeof oldPending === 'string' && D.parseKey(oldPending) && oldPending !== pending) {
    updates[`birthday_server/pending13/${oldPending}/${uid}`] = null;
  }
  if (pending) updates[`birthday_server/pending13/${pending}/${uid}`] = true;
  updates[`birthday_server/hidden_key/${uid}`] = hidden;
  if (typeof oldHidden === 'string' && D.parseKey(oldHidden) && oldHidden !== hidden) {
    updates[`birthday_server/hidden13/${oldHidden}/${uid}`] = null;
  }
  if (hidden) updates[`birthday_server/hidden13/${hidden}/${uid}`] = true;
  await ref('/').update(updates);
  return { key, pending };
}

// ─── Who has a birthday today, ranked for one viewer ────────────────────────

async function followingSet(caller) {
  try {
    const snap = await io.fs().collection('following')
      .where('followerId', '==', caller)
      .select('followingId')
      .get();
    return new Set(snap.docs.map((d) => d.get('followingId')).filter(okUid));
  } catch (e) {
    io.log('[birthdays] following query failed:', e.message);
    return new Set();
  }
}

async function groupMateSet(caller) {
  try {
    const meta = await val(`group_meta_data/${caller}`);
    const ids = Object.keys(meta || {}).filter((g) => /^[A-Za-z0-9_-]{1,128}$/.test(g)).slice(0, MAX_GROUPS);
    if (!ids.length) return new Set();
    const fs = io.fs();
    const docs = await fs.getAll(...ids.map((g) => fs.collection('groups').doc(g)), { fieldMask: ['memberIds'] });
    const out = new Set();
    docs.forEach((d) => {
      const members = d.exists ? d.get('memberIds') : null;
      if (Array.isArray(members)) members.forEach((m) => { if (okUid(m)) out.add(m); });
    });
    return out;
  } catch (e) {
    io.log('[birthdays] group lookup failed:', e.message);
    return new Set();
  }
}

const REASONS = [['dm', 4], ['follow', 3], ['group', 2], ['wished_you', 1]];

/**
 * Today's shown players for `caller`, people they know first.
 * Resolves { today, year, rows: [{ uid, key, active, score, reason, wished }] }
 * sorted by score, then most recent activity, then uid.
 */
async function rankedToday(caller, localDate, blocked) {
  const now = io.now();
  const today = D.clampLocalDate(localDate, now);
  const year = today.y;
  const keys = D.keysForDate(today);
  const blockedSet = new Set(
    (Array.isArray(blocked) ? blocked.slice(0, MAX_BLOCKED) : [])
      .map((b) => (typeof b === 'string' ? b : b && b.id))
      .filter(okUid),
  );

  const nodes = await Promise.all(keys.map((k) => val(`birthday_index/${k}`)));
  const seen = new Set();
  const cands = [];
  keys.forEach((k, i) => {
    Object.keys(nodes[i] || {}).forEach((uid) => {
      if (uid === caller || blockedSet.has(uid) || !okUid(uid) || seen.has(uid)) return;
      seen.add(uid);
      cands.push({ uid, key: k });
    });
  });
  if (!cands.length) return { today, year, rows: [] };

  // Round 1: blocks both ways + activity.
  const cutoff = now - ACTIVE_DAYS * D.DAY_MS;
  const checked = await mapLimit(cands, READ_CONCURRENCY, async (c) => {
    const [blockedMe, iBlocked, act] = await Promise.all([
      exists(`bannedUsers/${c.uid}/${caller}`),
      exists(`bannedUsers/${caller}/${c.uid}`),
      val(`users/${c.uid}/lastActivity`),
    ]);
    if (blockedMe || iBlocked) return null;
    let active = activityMs(act);
    if (active == null) active = activityMs(await val(`users/${c.uid}/lastactivity`));
    // No activity on record = listed, ranked last. The app wrote lastActivity
    // only before the user loaded (2026-10-14: none of the indexed players had
    // one), so requiring it emptied the list while Home counted them.
    if (active != null && active < cutoff) return null;
    return { ...c, active: active ?? 0 };
  });
  const live = checked.filter(Boolean);
  if (!live.length) return { today, year, rows: [] };

  // Round 2: what the caller knows about them, and whether they wished them yet.
  const [follows, mates, perCand] = await Promise.all([
    followingSet(caller),
    groupMateSet(caller),
    mapLimit(live, READ_CONCURRENCY, (c) => Promise.all([
      exists(`chat_meta_data/${caller}/${c.uid}`),
      exists(`birthday_wished_by/${caller}/${c.uid}`),
      exists(`birthday_sent/${caller}/${year}/${c.uid}`),
    ])),
  ]);

  const rows = live.map((c, i) => {
    const [dm, wishedYou, wished] = perCand[i];
    const has = { dm, follow: follows.has(c.uid), group: mates.has(c.uid), wished_you: wishedYou };
    let score = 0;
    let reason = null;
    REASONS.forEach(([name, pts]) => {
      if (!has[name]) return;
      score += pts;
      if (!reason) reason = name;
    });
    return { ...c, score, reason, wished };
  });
  rows.sort((a, b) => b.score - a.score || b.active - a.active || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return { today, year, rows };
}

const sumCounts = async (keys) =>
  (await Promise.all(keys.map((k) => val(`birthday_counts/${k}`)))).reduce((s, n) => s + (Number(n) || 0), 0);

/**
 * birthdayTop { localDate, limit, blocked } → { rows, total, unwished, tomorrow }.
 * rows: [{ uid, name, avatar, month, day, wishes, wished, reason }].
 */
async function birthdayTop({ uid, body = {} }) {
  const raw = Number(body.limit);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_TOP_LIMIT) : DEFAULT_TOP_LIMIT;
  const ranked = await rankedToday(uid, body.localDate, body.blocked);
  const top = ranked.rows.slice(0, limit);

  const tomorrowKeys = D.keysForDate(D.addDays(ranked.today, 1));
  const [rows, tomorrowAll, myKey] = await Promise.all([
    mapLimit(top, READ_CONCURRENCY, async (r) => {
      const [name, avatar, wishes] = await Promise.all([
        val(`users/${r.uid}/displayName`),
        val(`users/${r.uid}/avatar`),
        val(`birthday_wish_counts/${ranked.year}/${r.uid}`),
      ]);
      const md = D.parseKey(r.key);
      return {
        uid: r.uid,
        name: cleanName(name),
        avatar: cleanAvatar(avatar),
        month: md.m,
        day: md.d,
        wishes: Number(wishes) || 0,
        wished: r.wished,
        reason: r.reason,
      };
    }),
    sumCounts(tomorrowKeys),
    val(`birthday_server/index_key/${uid}`),
  ]);
  return {
    rows,
    total: ranked.rows.length,
    unwished: ranked.rows.filter((r) => !r.wished).length,
    tomorrow: Math.max(0, tomorrowAll - (tomorrowKeys.includes(myKey) ? 1 : 0)),
  };
}

// ─── Pushes ─────────────────────────────────────────────────────────────────

const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const COPY = {
  birthday: (name) => ({
    title: name ? `🎉 Happy birthday, ${name}!` : '🎉 Happy birthday!',
    body: 'Open MM2 Values for your birthday stars',
  }),
  wish: (name) => ({ title: `🎂 ${name} wished you a happy birthday!`, body: 'Tap to see your birthday wishes.' }),
  thanks: (name) => ({ title: `💖 ${name} thanked you for the birthday wish!`, body: 'Your wish made their day.' }),
};
const TAGS = { birthday: 'birthday', birthday_wish: 'birthday-wish', birthday_thanks: 'birthday-thanks' };

const buildMessage = (token, type, notification) => ({
  token,
  notification,
  data: { type, route: 'Birthdays' },
  android: { priority: 'high', notification: { sound: 'default', tag: TAGS[type] } },
  apns: { headers: { 'apns-collapse-id': TAGS[type] }, payload: { aps: { sound: 'default' } } },
});

/**
 * Push to players by uid: [{ uid, type, notification }]. Reads each
 * users/{uid}/fcmToken, sends in chunks of 500 (sendEach), and clears
 * tokens FCM calls dead the way chatMaintenance.js does. Resolves the
 * number delivered.
 */
async function pushTo(items) {
  if (!items.length) return 0;
  const tokens = await mapLimit(items, READ_CONCURRENCY, (it) => val(`users/${it.uid}/fcmToken`));
  const ready = [];
  items.forEach((it, i) => {
    if (typeof tokens[i] === 'string' && tokens[i]) ready.push({ ...it, token: tokens[i] });
  });
  let sent = 0;
  for (let i = 0; i < ready.length; i += FCM_CHUNK) {
    const chunk = ready.slice(i, i + FCM_CHUNK);
    let res;
    try {
      res = await io.messaging().sendEach(chunk.map((it) => buildMessage(it.token, it.type, it.notification)));
    } catch (e) {
      io.log('[birthdays] sendEach failed:', e.message);
      continue;
    }
    const dead = [];
    res.responses.forEach((r, j) => {
      if (r.success) sent += 1;
      else if (r.error && DEAD_TOKEN.has(r.error.code)) dead.push(chunk[j].uid);
    });
    await Promise.all(dead.map((u) => ref(`users/${u}`).update({ fcmToken: null, isTokenInvalid: true }).catch(() => {})));
  }
  return sent;
}

// ─── Wishes ─────────────────────────────────────────────────────────────────

/**
 * Take up to `want` of today's (UTC) wish allowance. Resolves how many were
 * granted (0 = limit reached). Old days are dropped from the node as it goes.
 */
async function takeDaily(uid, day, want) {
  let granted = 0;
  const res = await ref(`birthday_server/sent_day/${uid}`).transaction((cur) => {
    const n = Number(cur && cur[day]) || 0;
    granted = Math.min(want, DAILY_WISH_LIMIT - n);
    if (granted <= 0) return undefined;
    return { [day]: n + granted };
  }, undefined, false);
  return res.committed ? granted : 0;
}

async function giveBackDaily(uid, day, k) {
  if (k <= 0) return;
  await ref(`birthday_server/sent_day/${uid}/${day}`).transaction((n) => Math.max(0, (Number(n) || 0) - k), undefined, false);
}

/**
 * Write the wishes `from` → each of `tos` (already claimed in birthday_sent),
 * then send the first-wish push to every recipient whose first wish this is.
 */
async function writeWishes(from, tos, template, year, now) {
  if (!tos.length) return;
  const [name, avatar] = await Promise.all([val(`users/${from}/displayName`), val(`users/${from}/avatar`)]);
  const n = cleanName(name);
  const updates = {};
  tos.forEach((to) => {
    updates[`birthday_wishes/${year}/${to}/${from}`] = { t: template, at: now, n, a: cleanAvatar(avatar) };
    updates[`birthday_sent/${from}/${year}/${to}`] = true;
    updates[`birthday_wish_counts/${year}/${to}`] = admin.database.ServerValue.increment(1);
    updates[`birthday_wished_by/${to}/${from}`] = true;
  });
  await ref('/').update(updates);
  const firsts = await Promise.all(tos.map((to) => claimOnce(`birthday_server/first_pushed/${year}/${to}`, now)));
  const pushes = tos.filter((_, i) => firsts[i]).map((to) => ({ uid: to, type: 'birthday_wish', notification: COPY.wish(n) }));
  await pushTo(pushes);
}

/** sendBirthdayWish { to, template, localDate } → { wishes } */
async function sendBirthdayWish({ uid, body = {} }) {
  const { to, template } = body;
  if (!TEMPLATES.includes(template)) fail('generic');
  if (!okUid(to) || to === uid) fail('cannot_wish');
  const now = io.now();
  const [key, blockedMe, iBlocked] = await Promise.all([
    val(`birthday_server/index_key/${to}`),
    exists(`bannedUsers/${to}/${uid}`),
    exists(`bannedUsers/${uid}/${to}`),
  ]);
  const md = typeof key === 'string' ? D.parseKey(key) : null;
  if (!md || blockedMe || iBlocked) fail('cannot_wish');
  const near = D.nearDate(md.m, md.d, D.utcToday(now));
  if (!near) fail('not_today');
  const year = near.y;

  if (!(await claimOnce(`birthday_sent/${uid}/${year}/${to}`))) fail('already_wished', 409);
  const day = D.isoOf(D.utcToday(now));
  if (!(await takeDaily(uid, day, 1))) {
    await ref(`birthday_sent/${uid}/${year}/${to}`).remove();
    fail('limit', 429);
  }
  await writeWishes(uid, [to], template, year, now);
  return { wishes: Number(await val(`birthday_wish_counts/${year}/${to}`)) || 1 };
}

/** wishAllBirthdays { localDate, template = 'party', blocked } → { sent, left, limited } */
async function wishAllBirthdays({ uid, body = {} }) {
  const template = body.template == null ? 'party' : body.template;
  if (!TEMPLATES.includes(template)) fail('generic');
  const now = io.now();
  const ranked = await rankedToday(uid, body.localDate, body.blocked);
  const todo = ranked.rows.filter((r) => !r.wished);
  if (!todo.length) return { sent: 0, left: 0, limited: false };

  const day = D.isoOf(D.utcToday(now));
  const granted = await takeDaily(uid, day, todo.length);
  const pick = todo.slice(0, granted);
  const claimed = await mapLimit(pick, READ_CONCURRENCY, (r) => claimOnce(`birthday_sent/${uid}/${ranked.year}/${r.uid}`));
  const won = pick.filter((_, i) => claimed[i]).map((r) => r.uid);
  await giveBackDaily(uid, day, granted - won.length);
  await writeWishes(uid, won, template, ranked.year, now);
  // Rows lost to a parallel call were wished meanwhile: not "left".
  const left = Math.max(0, todo.length - pick.length);
  return { sent: won.length, left, limited: granted < todo.length };
}

/** The caller's birthday year if their birthday is today (±1 day, UTC), else null. */
const birthdayYear = (dob, now) => {
  if (!dob) return null;
  const near = D.nearDate(dob.m, dob.d, D.utcToday(now));
  return near ? { near, year: near.y } : null;
};

/** thankBirthdayWishers {} → { thanked } */
async function thankBirthdayWishers({ uid }) {
  const now = io.now();
  const b = birthdayYear(await effectiveDob(uid), now);
  if (!b) fail('not_today');
  const wishes = (await val(`birthday_wishes/${b.year}/${uid}`)) || {};
  const todo = Object.keys(wishes).filter((from) => okUid(from) && wishes[from] && !wishes[from].th);
  if (!todo.length) return { thanked: 0 };
  const updates = {};
  todo.forEach((from) => { updates[`birthday_wishes/${b.year}/${uid}/${from}/th`] = now; });
  await ref('/').update(updates);

  // One thank-you push per wisher per UTC day, however many players thank them.
  const day = D.isoOf(D.utcToday(now));
  const [claims, myName] = await Promise.all([
    mapLimit(todo, READ_CONCURRENCY, (from) => claimOnce(`birthday_server/thank_pushed/${day}/${from}`, now)),
    val(`users/${uid}/displayName`),
  ]);
  const name = cleanName(myName);
  await pushTo(todo.filter((_, i) => claims[i]).map((from) => ({ uid: from, type: 'birthday_thanks', notification: COPY.thanks(name) })));
  return { thanked: todo.length };
}

// ─── Gift ───────────────────────────────────────────────────────────────────

const accountOldEnough = (createdAt, now) => {
  const c = Number(createdAt);
  return !c || c <= now - ACCOUNT_MIN_DAYS * D.DAY_MS;
};

/** The gift's year if the caller may claim it now (ignoring whether they already did), else null. */
const giftYear = (dob, createdAt, now) => {
  const b = birthdayYear(dob, now);
  if (!b) return null;
  const age = D.ageOn(dob, b.near);   // the age this birthday makes them
  if (age == null || age < MIN_AGE) return null;
  return accountOldEnough(createdAt, now) ? b.year : null;
};

/** claimBirthdayGift {} → { stars } */
async function claimBirthdayGift({ uid }) {
  const now = io.now();
  const [dob, createdAt] = await Promise.all([effectiveDob(uid), val(`users/${uid}/createdAt`)]);
  const year = giftYear(dob, createdAt, now);
  if (year == null) fail('gift_unavailable');
  const giftPath = `birthday_gifts/${uid}/${year}`;
  if (!(await claimOnce(giftPath, { stars: GIFT_STARS, at: now }))) fail('gift_unavailable');
  try {
    // Same fields as the daily stars (Code/Engagement/starUtils.js). An old
    // account with no starBalance yet starts from totalStarsEarned, as
    // getStarBalance would seed it.
    await ref(`users/${uid}/dailyStars`).transaction((cur) => {
      const s = cur && typeof cur === 'object' ? cur : {};
      const earned = Number(s.totalStarsEarned) || 0;
      const balance = s.starBalance === undefined || s.starBalance === null ? earned : Number(s.starBalance) || 0;
      return { ...s, starBalance: balance + GIFT_STARS, totalStarsEarned: earned + GIFT_STARS };
    }, undefined, false);
  } catch (e) {
    await ref(giftPath).remove().catch(() => {});
    throw e;
  }
  return { stars: GIFT_STARS };
}

// ─── Own birthday ───────────────────────────────────────────────────────────

/** updateMyBirthday { year, month, day } → { month, day } (once ever). */
async function updateMyBirthday({ uid, body = {} }) {
  const y = Number(body.year);
  const m = Number(body.month);
  const d = Number(body.day);
  if (!D.isRealDate(y, m, d)) fail('bad_date');
  const now = io.now();
  const today = D.utcToday(now);
  const next = { y, m, d };
  const nextAge = D.ageOn(next, today);
  if (nextAge == null || nextAge < MIN_EDIT_AGE) fail('bad_date');

  const cur = await effectiveDob(uid);
  if (!cur) fail('bad_date');          // nothing to correct: the app adds a first DOB itself
  if (D.sameDate(cur, next)) return { month: m, day: d };
  const curAge = D.ageOn(cur, today);
  if ((curAge != null && curAge < MIN_AGE) !== (nextAge < MIN_AGE)) fail('age_change');

  if (!(await claimOnce(`birthday_server/edits/${uid}`, now))) fail('already_edited', 409);
  try {
    await ref(`users_private/${uid}/dateOfBirth`).set(D.isoOf(next));
  } catch (e) {
    await ref(`birthday_server/edits/${uid}`).remove().catch(() => {});
    throw e;
  }
  // The trigger does this too; doing it here makes the move immediate.
  await reindexBirthday(uid);
  return { month: m, day: d };
}

/**
 * myBirthday {} → { month, day, show, minor, canEdit, wishes: [{ name, avatar,
 * template }], wishCount, thankPending, giftReady, giftOpened }. The caller's
 * own data; no year, no age (`minor` only says whether the under-13 rules apply).
 */
async function myBirthday({ uid }) {
  const now = io.now();
  const today = D.utcToday(now);
  const [dob, show, edited, createdAt] = await Promise.all([
    effectiveDob(uid),
    val(`birthday_prefs/${uid}/show`),
    exists(`birthday_server/edits/${uid}`),
    val(`users/${uid}/createdAt`),
  ]);
  const empty = {
    month: null, day: null, show: show !== false, minor: false, canEdit: false,
    wishes: [], wishCount: 0, thankPending: 0, giftReady: false, giftOpened: false,
  };
  if (!dob) return empty;
  const age = D.ageOn(dob, today);
  const minor = age != null && age < MIN_AGE;
  const out = { ...empty, month: dob.m, day: dob.d, show: show !== false && !minor, minor, canEdit: !edited };

  const b = birthdayYear(dob, now);
  if (!b) return out;
  const [received, gift] = await Promise.all([
    val(`birthday_wishes/${b.year}/${uid}`),
    val(`birthday_gifts/${uid}/${b.year}`),
  ]);
  const list = Object.entries(received || {})
    .filter(([from, w]) => okUid(from) && w && typeof w === 'object')
    .sort((a, b2) => (Number(b2[1].at) || 0) - (Number(a[1].at) || 0));
  out.wishCount = list.length;
  out.thankPending = list.filter(([, w]) => !w.th).length;
  out.wishes = list.slice(0, MAX_RECEIVED).map(([, w]) => ({
    name: cleanName(w.n),
    avatar: cleanAvatar(w.a),
    template: TEMPLATES.includes(w.t) ? w.t : 'hbd',
  }));
  out.giftOpened = !!gift;
  out.giftReady = !gift && giftYear(dob, createdAt, now) === b.year;
  return out;
}

// ─── Scheduled ──────────────────────────────────────────────────────────────

const indexedOn = async (keys) => {
  const nodes = await Promise.all(keys.map((k) => val(`birthday_index/${k}`)));
  return [...new Set(nodes.flatMap((n) => Object.keys(n || {})).filter(okUid))];
};

/**
 * notifyBirthdays (daily, 14:00 UTC): "🎉 Happy birthday, {name}!" to every
 * indexed player whose birthday is today (UTC) and whose account is 30+ days
 * old (the gift's rule, so the push never promises stars they can't claim).
 * Claimed per year in birthday_server/bday_pushed, so a rerun sends nothing twice.
 */
async function runNotifyBirthdays() {
  const now = io.now();
  const today = D.utcToday(now);
  const uids = await indexedOn(D.keysForDate(today));
  const due = await mapLimit(uids, READ_CONCURRENCY, async (uid) => {
    const [createdAt, name] = await Promise.all([val(`users/${uid}/createdAt`), val(`users/${uid}/displayName`)]);
    if (!accountOldEnough(createdAt, now)) return null;
    if (!(await claimOnce(`birthday_server/bday_pushed/${today.y}/${uid}`, now))) return null;
    return { uid, type: 'birthday', notification: COPY.birthday(typeof name === 'string' && name.trim() ? cleanName(name) : '') };
  });
  const items = due.filter(Boolean);
  const sent = await pushTo(items);
  io.log(`[notifyBirthdays] ${uids.length} today, claimed ${items.length}, pushed ${sent}`);
  return { today: uids.length, claimed: items.length, sent };
}

/**
 * refreshBirthdayAges (daily, 03:30 UTC): players who were under 13 when
 * last indexed are re-checked on their birthday (yesterday's and today's
 * keys, so a missed run and 29 Feb in non-leap years are covered). Also
 * drops thank-push claims older than two days.
 */
async function runRefreshBirthdayAges() {
  const now = io.now();
  const today = D.utcToday(now);
  const keys = [...new Set([...D.keysForDate(D.addDays(today, -1)), ...D.keysForDate(today)])];
  let checked = 0;
  let indexed = 0;
  for (const key of keys) {
    const pending = Object.keys((await val(`birthday_server/pending13/${key}`)) || {}).filter(okUid);
    await mapLimit(pending, 20, async (uid) => {
      const r = await reindexBirthday(uid);
      checked += 1;
      if (r.key) indexed += 1;
      // A stale entry (the DOB moved since): reindex no longer points here.
      if (r.pending !== key) await ref(`birthday_server/pending13/${key}/${uid}`).remove();
    });
  }
  await Promise.all([2, 3].map((n) => ref(`birthday_server/thank_pushed/${D.isoOf(D.addDays(today, -n))}`).remove()));
  io.log(`[refreshBirthdayAges] checked ${checked}, now indexed ${indexed}`);
  return { checked, indexed };
}

module.exports = {
  io,
  BirthdayError,
  constants: { MIN_AGE, GIFT_STARS, DAILY_WISH_LIMIT, ACTIVE_DAYS, ACCOUNT_MIN_DAYS, TEMPLATES, DEFAULT_TOP_LIMIT, MAX_TOP_LIMIT },
  COPY,
  okUid,
  accountOldEnough,
  effectiveDob,
  reindexBirthday,
  rankedToday,
  birthdayTop,
  sendBirthdayWish,
  wishAllBirthdays,
  thankBirthdayWishers,
  claimBirthdayGift,
  updateMyBirthday,
  myBirthday,
  runNotifyBirthdays,
  runRefreshBirthdayAges,
  pushTo,
};
