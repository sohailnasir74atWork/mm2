/**
 * tradeMatch.js — Trade Match index + dream-item alerts (2026-10-13).
 *
 * Firebase port of Adopt Me's Trade Match (adoptme-jan7: supabase/032 +
 * 033 + 053, functions/notifyTradeMatch.js). Data layout and the reasons for
 * it are in tradeMatchCore.js; the rules are in the rules hand-off note.
 *
 *   tradeMatchIndex        v1 Firestore onWrite reviews/{uid}
 *       Keeps trade_index/* in step with the lists every MM2 build already
 *       saves (ownedPets / wishlistPets). Old builds feed it without an app
 *       update. Most writes to reviews/{uid} are not list changes (bio,
 *       ratings): the before/after signature is compared first and those
 *       return with no reads. A real change costs 1 Firestore read (the
 *       CURRENT document, so out-of-order events cannot index stale lists),
 *       1 RTDB read (what is indexed now) and 1 multi-path RTDB update.
 *
 *   tradeMatchDreamAlerts  v1 RTDB onWrite trade_index/user/{uid}
 *       "Someone listed your dream item": when a player's For Trade list
 *       gains an item, push the players whose dream it is. Same limits as
 *       Adopt Me, plus the dedupe its 2026-10-01 audit asked for:
 *         - at most 50 recipients per burst, dreams set in the last 30 days;
 *         - a lister causes at most one burst per hour;
 *         - the same (lister, item) pair alerts at most once per 7 days, so
 *           flipping For Trade on and off cannot spam strangers;
 *         - a recipient gets at most one Trade Match push per 20 hours;
 *         - opt-out: users/{uid}/notificationSettings/tradeMatchAlerts false;
 *         - banned listers alert nobody.
 *       A summary's FIRST write (backfill, or a player's first indexed edit)
 *       never alerts, so the backfill cannot set off a push storm.
 *       Deploy it separately, once the app routes data.route 'TradeMatch'
 *       (Code/Helper/valueUpdateNotifications.js ALLOWED_ROUTES); until then
 *       a tap only opens the app.
 *
 * Deploy (no app release needed for the index; old builds feed it):
 *   firebase deploy --only functions:tradeMatchIndex --project mm2vlaues-ed80c
 *   node scripts/trade-match/backfillIndex.js --prod            # dry run
 *   node scripts/trade-match/backfillIndex.js --prod --apply
 *   firebase deploy --only functions:tradeMatchDreamAlerts --project mm2vlaues-ed80c
 * Rules first: the trade_index block in the rules hand-off note (index on
 * .value is what keeps the app's per-item queries cheap).
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const core = require('./tradeMatchCore');
const { banEmailFor, encodeEmailForBan } = require('./_userEmail');

if (!admin.apps.length) {
  admin.initializeApp();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_RECIPIENTS = 50;
const MAX_KEYS_PER_BURST = 10;
const LISTER_GAP_MS = HOUR;
const PAIR_GAP_MS = 7 * DAY;
const RECIPIENT_GAP_MS = 20 * HOUR;
const DREAM_FRESH_MS = 30 * DAY;
const FOUND_DAYS_KEPT = 14;
const FOUND_REPEAT_MS = 60 * DAY;

// Lazy, so the CLI can load this file without FIREBASE_CONFIG; tests swap
// `now` and `send`.
const io = {
  db: () => admin.database(),
  fs: () => admin.firestore(),
  now: () => Date.now(),
  send: (msg) => admin.messaging().send(msg),
};

// ── Index ────────────────────────────────────────────────────────────────

/**
 * Bring trade_index in line with `data` (a reviews/{uid} document, or null
 * when it was deleted). Shared by the trigger and the backfill.
 *   ts            the freshness stamp written on every entry
 *   v             the document's updateTime (ms): a summary already holding
 *                 a newer version is never overwritten with an older one
 *   skipSameVersion  backfill re-runs skip documents already indexed
 *   countTraders  false = the caller adds `delta` to stats.traders itself
 *                 (the backfill does one transaction, not thousands)
 */
async function reindexUser(uid, data, opts) {
  const { ts, v = 0, skipSameVersion = false, countTraders = true } = opts;
  if (!core.okUid(uid)) return { skipped: 'uid' };
  const db = io.db();
  const old = core.decodeSummary((await db.ref(`trade_index/user/${uid}`).once('value')).val());
  if (old && v && (old.v > v || (skipSameVersion && old.v === v))) return { skipped: 'version' };
  const lists = core.buildLists(data);
  if (!old && core.isEmpty(lists)) return { skipped: 'empty' };

  const up = core.buildIndexUpdate(uid, old, lists, { t: ts, v, l: data && data.tradeMatchLang });
  await db.ref('trade_index').update(up);

  const delta = core.traderDelta(old, lists);
  if (delta && countTraders) {
    await db.ref('trade_index/stats/traders').transaction((n) => Math.max(0, (Number(n) || 0) + delta));
  }
  return { have: lists.have.length, want: lists.want.length, dream: lists.dream, delta, created: !old };
}

/** "I got it!": one count per player per item per 60 days (stats.found). */
async function countDreamFound(uid, key, now) {
  if (!core.okKey(key)) return false;
  const db = io.db();
  const mark = db.ref(`trade_alerts/${uid}/found/${key}`);
  const prev = Number((await mark.once('value')).val()) || 0;
  if (prev && now - prev < FOUND_REPEAT_MS) return false;
  await mark.set(now);
  await db.ref(`trade_index/stats/found/${core.dayKey(now)}`).transaction((n) => (Number(n) || 0) + 1);
  // Keep two weeks of day buckets (the screen shows the last 7 days).
  const days = (await db.ref('trade_index/stats/found').once('value')).val() || {};
  const oldest = core.dayKey(now - FOUND_DAYS_KEPT * DAY);
  const prune = {};
  for (const d of Object.keys(days)) if (d < oldest) prune[d] = null;
  if (Object.keys(prune).length) await db.ref('trade_index/stats/found').update(prune);
  return true;
}

exports.tradeMatchIndex = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('reviews/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    // reviews/ also holds the reviews themselves ("{toUid}_{fromUid}").
    if (!core.okUid(uid)) return null;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    // Bio edits, ratings, anything that is not the lists: no reads at all.
    if (core.signature(before) === core.signature(after)) return null;

    try {
      const snap = await io.fs().collection('reviews').doc(uid).get();
      const data = snap.exists ? snap.data() : null;
      const v = snap.exists ? core.ms(snap.updateTime) : io.now();
      const now = io.now();
      await reindexUser(uid, data, { ts: now, v });

      const foundAt = core.ms(after && after.dreamFoundAt);
      if (foundAt && foundAt !== core.ms(before && before.dreamFoundAt)) {
        await countDreamFound(uid, after.dreamFoundKey, now);
      }
    } catch (err) {
      // Never rethrow: the next list write re-syncs this player anyway.
      console.error(`[tradeMatchIndex] ${uid} failed:`, err.message);
    }
    return null;
  });

// ── Dream alerts ─────────────────────────────────────────────────────────

// Written per market, not translated word for word. Item names stay as the
// catalogue spells them. es-ES shares es.
const COPY = {
  en: { title: '🎯 Your dream item is up for trade!', body: '{name} has {item} for trade. Tap to see your match.', someone: 'A trader' },
  es: { title: '🎯 ¡Tu ítem soñado está en tradeo!', body: '{name} tiene {item} para tradear. Toca para ver tu match.', someone: 'Alguien' },
  pt: { title: '🎯 Seu item dos sonhos está pra troca!', body: '{name} tem {item} pra trocar. Toque pra ver seu match.', someone: 'Um trader' },
  fr: { title: '🎯 Ton item de rêve est à échanger !', body: '{name} propose {item} en échange. Touche pour voir ton match.', someone: 'Un joueur' },
  de: { title: '🎯 Dein Traum-Item ist zum Traden da!', body: '{name} hat {item} zum Traden. Tipp hier und sieh dir den Match an.', someone: 'Jemand' },
  ru: { title: '🎯 Твой предмет мечты выставили на трейд!', body: 'У {name} есть {item} на трейд. Жми, чтобы посмотреть.', someone: 'Один трейдер' },
  ja: { title: '🎯 欲しかったアイテムがトレードに出たよ！', body: '{name}が{item}をトレードに出しています。タップしてマッチを確認。', someone: 'トレーダー' },
  ar: { title: '🎯 العنصر الذي تحلم به متاح للتبادل!', body: '{name} يعرض {item} للتبادل. اضغط لترى التطابق.', someone: 'أحد التجار' },
};

const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function buildMessage(lang, fromName, itemName) {
  const copy = COPY[lang === 'es-ES' ? 'es' : lang] || COPY.en;
  const name = clean(fromName, 40) || copy.someone;
  const item = clean(itemName, 60) || '🔪';
  return { title: copy.title, body: copy.body.replace('{name}', name).replace('{item}', item) };
}

async function isBanned(uid, now) {
  try {
    const email = await banEmailFor(uid);
    if (!email) return false;
    const ban = (await io.db().ref(`banned_users_by_email/${encodeEmailForBan(email)}`).once('value')).val();
    if (!ban || typeof ban !== 'object') return false;
    return ban.bannedUntil === 'permanent' || Number(ban.bannedUntil) > now;
  } catch (e) {
    return false;
  }
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Push the dreamers of `keys` that `uid` just listed. Returns a summary. */
async function sendDreamAlerts(uid, keys) {
  const db = io.db();
  const now = io.now();
  const me = db.ref(`trade_alerts/${uid}`);
  const [sentSnap, pairsSnap] = await Promise.all([me.child('sent').once('value'), me.child('pairs').once('value')]);
  if (now - (Number(sentSnap.val()) || 0) < LISTER_GAP_MS) return { skipped: 'lister_rate' };
  const pairs = pairsSnap.val() || {};
  const fresh = keys.filter((k) => now - (Number(pairs[k]) || 0) >= PAIR_GAP_MS).slice(0, MAX_KEYS_PER_BURST);
  if (!fresh.length) return { skipped: 'pairs' };

  const recipients = new Map(); // uid -> item key
  for (const k of fresh) {
    const snap = await db.ref(`trade_index/dream/${k}`)
      .orderByValue().startAt(now - DREAM_FRESH_MS).limitToLast(MAX_RECIPIENTS)
      .once('value');
    const rows = [];
    snap.forEach((c) => { rows.push([c.key, Number(c.val()) || 0]); });
    rows.sort((a, b) => b[1] - a[1]);
    for (const [rid] of rows) {
      if (recipients.size >= MAX_RECIPIENTS) break;
      if (rid !== uid && core.okUid(rid) && !recipients.has(rid)) recipients.set(rid, k);
    }
  }

  // The pairs are spent whether or not anyone is waiting: re-listing the
  // same item within a week never alerts.
  // Expired pairs are dropped on the way, so the node stays small.
  const pairUpdate = {};
  for (const [k, at] of Object.entries(pairs)) if (now - (Number(at) || 0) >= PAIR_GAP_MS) pairUpdate[`pairs/${k}`] = null;
  for (const k of fresh) pairUpdate[`pairs/${k}`] = now;

  if (!recipients.size || await io.isBanned(uid, now)) {
    await me.update(pairUpdate);
    return { sent: 0, recipients: recipients.size };
  }

  const [nameSnap, docSnap] = await Promise.all([
    db.ref(`users/${uid}/displayName`).once('value'),
    io.fs().collection('reviews').doc(uid).get(),
  ]);
  const itemNames = {};
  const owned = docSnap.exists ? (docSnap.data() || {}).ownedPets : null;
  for (const it of Array.isArray(owned) ? owned : []) {
    const k = core.itemKey(it);
    if (k && !itemNames[k]) itemNames[k] = it.name || it.Name;
  }

  let sent = 0;
  await mapLimit([...recipients.entries()], 10, async ([rid, key]) => {
    try {
      const [recvSnap, tokenSnap, optSnap, langSnap] = await Promise.all([
        db.ref(`trade_alerts/${rid}/recv`).once('value'),
        db.ref(`users/${rid}/fcmToken`).once('value'),
        db.ref(`users/${rid}/notificationSettings/tradeMatchAlerts`).once('value'),
        db.ref(`trade_index/user/${rid}/l`).once('value'),
      ]);
      if (now - (Number(recvSnap.val()) || 0) < RECIPIENT_GAP_MS) return;
      if (optSnap.val() === false) return;
      const token = tokenSnap.val();
      if (!token || typeof token !== 'string') return;
      const { title, body } = buildMessage(langSnap.val(), nameSnap.val(), itemNames[key] || key);
      try {
        await io.send({
          token,
          notification: { title, body },
          data: { type: 'trade_match', route: 'TradeMatch', itemKey: key, fromUid: uid },
          android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag: 'trade_match' } },
          apns: { headers: { 'apns-collapse-id': 'trade_match' }, payload: { aps: { sound: 'default' } } },
        });
        sent += 1;
        await db.ref(`trade_alerts/${rid}/recv`).set(now);
      } catch (error) {
        if (error.code === 'messaging/invalid-registration-token'
          || error.code === 'messaging/registration-token-not-registered') {
          console.log(`[tradeMatchDreamAlerts] stale token for ${rid}`);
        } else {
          console.error('[tradeMatchDreamAlerts] send failed:', error.code || error.message);
        }
      }
    } catch (e) {
      console.error(`[tradeMatchDreamAlerts] recipient ${rid}:`, e.message);
    }
  });

  if (sent) pairUpdate.sent = now;
  await me.update(pairUpdate);
  return { sent, recipients: recipients.size };
}

exports.tradeMatchDreamAlerts = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .database.ref('/trade_index/user/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    // First index (backfill, first edit after deploy) or removal: no alerts.
    if (!change.before.exists() || !change.after.exists()) return null;
    const fresh = core.newHaveKeys(core.decodeSummary(change.before.val()), core.decodeSummary(change.after.val()));
    if (!fresh.length) return null;
    try {
      const r = await sendDreamAlerts(uid, fresh);
      if (r.sent) console.log(`[tradeMatchDreamAlerts] ${uid}: ${r.sent}/${r.recipients} pushed`);
    } catch (err) {
      console.error(`[tradeMatchDreamAlerts] ${uid} failed:`, err.message);
    }
    return null;
  });

io.isBanned = isBanned;

exports._internal = { io, reindexUser, countDreamFound, sendDreamAlerts, buildMessage };
