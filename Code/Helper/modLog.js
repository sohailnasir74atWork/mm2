/**
 * modLog.js — moderation audit log (Firestore `mod_actions`).
 *
 * WHY THIS EXISTS
 * RTDB keeps ONE live record per restricted email
 * (banned_users_by_email/{encodedEmail}), written with set(). Every mute,
 * strike and ban overwrites the last one, and an unban deletes it. That
 * record is the ENFORCEMENT state — "what is in force right now" — and it
 * stays exactly as it is, because old builds in the field read it. What it
 * can never be is a history, which is why the dashboard used to show a
 * single "Strike History" row and went blank the moment someone was unbanned.
 *
 * This module is the history side. Adopt Me keeps it in Supabase; MM2 is
 * Firebase-only by standing decision (HANDOFF.md), so it lives in Firestore:
 *
 *   mod_actions/{autoId}
 *     action         'mute' | 'strike' | 'ban' | 'unban' | 'review_delete' | 'status_delete' | 'post_delete'
 *     targetEmail    lowercased, decoded ("a@b.com", never "a@b(dot)com")
 *     targetUid      may be null on old records
 *     targetName     denormalised — rendering a timeline costs no profile reads
 *     reason         string or null, ≤ 500 chars
 *     strikeCount, durationMinutes, bannedUntilMs, isPermanent
 *     actorUid, actorName, actorRole ('admin' | 'moderator' | 'baby_mod' | 'system')
 *     source         'admin_dashboard' | 'group_chat' | 'feed' | 'report' | 'auto'
 *     meta           free-form extras (e.g. the deleted review's text and rating)
 *     createdAt      server timestamp — the sort key everywhere
 *
 * COST RULES
 *  - No listeners. Staff pull this when they open a tab.
 *  - Every list read is bounded and keyset-paginated on createdAt.
 *  - Per-user tallies use getCountFromServer — Firestore counts server-side,
 *    so opening a profile never downloads a timeline to count it.
 *  - The leaderboard reads at most LEADERBOARD_SCAN rows of the window and
 *    aggregates on the device. Moderation volume is tens per day; that cap
 *    is a ceiling, not an expectation.
 *  - logModAction NEVER throws and is never awaited on the moderation path:
 *    a log failure must not fail or slow down a real ban.
 *
 * Indexes (firestore.indexes.json): targetEmail+createdAt, targetUid+createdAt,
 * action+createdAt, actorUid+createdAt, action+actorUid+createdAt. Equality-
 * only count queries merge single-field indexes and need nothing extra.
 *
 * Firestore rules today are the stage-1 catch-all (any signed-in user may
 * write anything), so append-only is a convention here, not a guarantee.
 * The stage-2 draft in firestore.rules records the intended rule.
 */

import {
  getFirestore, collection, addDoc, getDocs, query, where, orderBy, limit,
  startAfter, serverTimestamp, getCountFromServer,
} from '@react-native-firebase/firestore';

const MOD_ACTIONS = 'mod_actions';
export const ACTIONS = ['mute', 'strike', 'ban', 'unban', 'review_delete', 'status_delete', 'post_delete'];
const LEADERBOARD_SCAN = 500;

// RTDB stores emails as `name(dot)domain(dot)tld`, and some writers lowercase
// while others do not. One canonical form so a row written from any call
// site is findable from any other.
export const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  const clean = email.replace(/\(dot\)/g, '.').trim().toLowerCase();
  return clean.length > 0 ? clean : null;
};

export const resolveActorRole = ({ isAdmin, isModerator, isBabyMod } = {}) => {
  if (isAdmin) return 'admin';
  if (isModerator) return 'moderator';
  if (isBabyMod) return 'baby_mod';
  return null;
};

const toMillis = (v) => {
  if (!v) return null;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  const s = v?.seconds ?? v?._seconds;
  if (typeof s === 'number') return Math.round(s * 1000 + ((v?.nanoseconds ?? v?._nanoseconds ?? 0) / 1e6));
  if (typeof v === 'number') return v;
  return null;
};

/**
 * Append one moderation action. Fire-and-forget: resolves true/false and
 * never rejects, so an offline device or a rules refusal degrades to "the
 * ban worked but was not recorded" rather than "the ban failed".
 */
export const logModAction = async (entry = {}) => {
  try {
    const action = entry.action;
    const targetEmail = normalizeEmail(entry.targetEmail);
    const targetUid = entry.targetUid || null;
    if (!ACTIONS.includes(action) || (!targetEmail && !targetUid)) {
      console.warn('[modLog] skipped — invalid entry', { action, targetEmail, targetUid });
      return false;
    }

    // `reason` has arrived as a boolean from miswired call sites before
    // (isStaff passed into the customReason slot). Coerce so the log can
    // never inherit that shape.
    const rawReason = entry.reason;
    const reason = typeof rawReason === 'string' && rawReason.trim() ? rawReason.trim().slice(0, 500) : null;

    const row = {
      action,
      targetEmail,
      targetUid,
      targetName: entry.targetName || null,
      reason,
      strikeCount: Number.isFinite(entry.strikeCount) ? entry.strikeCount : null,
      durationMinutes: Number.isFinite(entry.durationMinutes) ? entry.durationMinutes : null,
      bannedUntilMs: typeof entry.bannedUntil === 'number' && Number.isFinite(entry.bannedUntil) ? Math.round(entry.bannedUntil) : null,
      isPermanent: entry.bannedUntil === 'permanent',
      actorUid: entry.actorUid || null,
      actorName: entry.actorName || null,
      actorRole: entry.actorRole || null,
      source: entry.source || 'unknown',
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : null,
      createdAt: serverTimestamp(),
      // Client clock, for display only. createdAt is the sort key; this lets
      // a row render a time before the server stamp round-trips.
      createdAtMs: Date.now(),
    };

    await addDoc(collection(getFirestore(), MOD_ACTIONS), row);
    return true;
  } catch (err) {
    console.warn('[modLog] insert failed:', err?.message);
    return false;
  }
};

const mapAction = (d) => {
  const r = d.data() || {};
  return {
    id: d.id,
    action: r.action,
    targetUid: r.targetUid || null,
    targetEmail: r.targetEmail || null,
    targetName: r.targetName || null,
    reason: typeof r.reason === 'string' ? r.reason : null,
    strikeCount: r.strikeCount ?? null,
    durationMinutes: r.durationMinutes ?? null,
    bannedUntilMs: r.bannedUntilMs ?? null,
    isPermanent: !!r.isPermanent,
    actorUid: r.actorUid || null,
    actorName: r.actorName || null,
    actorRole: r.actorRole || null,
    source: r.source || 'unknown',
    meta: r.meta || null,
    createdAt: toMillis(r.createdAt) || r.createdAtMs || null,
    _doc: d, // keyset cursor
  };
};

// The subject filter. Email is the key every writer has; uid is the
// fallback for rows written before the user had one on file.
const subjectWhere = ({ email, uid }) => {
  const e = normalizeEmail(email);
  if (e) return where('targetEmail', '==', e);
  if (uid) return where('targetUid', '==', uid);
  return null;
};

/** One user's timeline, newest first, keyset-paginated. */
export const fetchUserModHistory = async ({ email, uid, cursor = null, limit: lim = 25 } = {}) => {
  const empty = { items: [], hasMore: false, cursor: null };
  try {
    const subj = subjectWhere({ email, uid });
    if (!subj) return empty;
    const parts = [collection(getFirestore(), MOD_ACTIONS), subj, orderBy('createdAt', 'desc')];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(lim));
    const snap = await getDocs(query(...parts));
    const items = snap.docs.map(mapAction);
    return { items, hasMore: items.length >= lim, cursor: items.length ? items[items.length - 1]._doc : null };
  } catch (err) {
    console.warn('[modLog] fetchUserModHistory failed:', err?.message);
    return { ...empty, error: err?.message || 'failed' };
  }
};

/**
 * Aggregate tallies for one user, counted server-side. Four count queries
 * in parallel; each is an equality-only filter, so no composite index.
 */
export const fetchUserModCounts = async ({ email, uid } = {}) => {
  const empty = { muteCount: 0, strikeCount: 0, banCount: 0, unbanCount: 0, reviewDeleteCount: 0, totalCount: 0 };
  try {
    const subj = subjectWhere({ email, uid });
    if (!subj) return empty;
    const fs = getFirestore();
    const countFor = async (action) => {
      const agg = await getCountFromServer(query(collection(fs, MOD_ACTIONS), subj, where('action', '==', action)));
      return agg.data().count || 0;
    };
    const [muteCount, strikeCount, banCount, unbanCount, reviewDeleteCount] = await Promise.all(
      ['mute', 'strike', 'ban', 'unban', 'review_delete'].map(countFor),
    );
    return {
      muteCount, strikeCount, banCount, unbanCount, reviewDeleteCount,
      totalCount: muteCount + strikeCount + banCount + unbanCount + reviewDeleteCount,
    };
  } catch (err) {
    console.warn('[modLog] fetchUserModCounts failed:', err?.message);
    return { ...empty, error: err?.message || 'failed' };
  }
};

/**
 * Per-moderator totals over a window — "who banned how many people".
 * `distinctTargets` is reported next to `totalCount` on purpose: ten mutes
 * on one repeat offender is not ten people moderated.
 */
export const fetchModLeaderboard = async ({ days = 30 } = {}) => {
  try {
    const since = new Date(Date.now() - days * 86400000);
    const snap = await getDocs(query(
      collection(getFirestore(), MOD_ACTIONS),
      where('createdAt', '>=', since),
      orderBy('createdAt', 'desc'),
      limit(LEADERBOARD_SCAN),
    ));
    const byActor = new Map();
    snap.docs.forEach((d) => {
      const r = d.data() || {};
      const key = r.actorUid || r.actorName || 'unknown';
      let row = byActor.get(key);
      if (!row) {
        row = {
          actorUid: r.actorUid || null, actorName: r.actorName || 'Unknown', actorRole: r.actorRole || null,
          banCount: 0, strikeCount: 0, muteCount: 0, unbanCount: 0, reviewDeleteCount: 0, totalCount: 0,
          targets: new Set(), lastActionAt: null,
        };
        byActor.set(key, row);
      }
      if (r.action === 'ban') row.banCount++;
      else if (r.action === 'strike') row.strikeCount++;
      else if (r.action === 'mute') row.muteCount++;
      else if (r.action === 'unban') row.unbanCount++;
      else if (r.action === 'review_delete') row.reviewDeleteCount++;
      row.totalCount++;
      row.targets.add(r.targetEmail || r.targetUid || d.id);
      const t = toMillis(r.createdAt) || r.createdAtMs || 0;
      if (t > (row.lastActionAt || 0)) row.lastActionAt = t;
    });
    const rows = [...byActor.values()]
      .map(({ targets, ...r }) => ({ ...r, distinctTargets: targets.size }))
      .sort((a, b) => b.totalCount - a.totalCount);
    return { rows, truncated: snap.docs.length >= LEADERBOARD_SCAN, scanned: snap.docs.length };
  } catch (err) {
    console.warn('[modLog] fetchModLeaderboard failed:', err?.message);
    return { rows: [], truncated: false, scanned: 0, error: err?.message || 'failed' };
  }
};

/** Global recent-actions feed, filters applied in the query. */
export const fetchRecentModActions = async ({ action = null, actorUid = null, days = 30, cursor = null, limit: lim = 30 } = {}) => {
  const empty = { items: [], hasMore: false, cursor: null };
  try {
    const parts = [collection(getFirestore(), MOD_ACTIONS)];
    if (action) parts.push(where('action', '==', action));
    if (actorUid) parts.push(where('actorUid', '==', actorUid));
    // The window is a range on the same field we order by, so it costs
    // nothing extra and keeps every page served by one index.
    parts.push(where('createdAt', '>=', new Date(Date.now() - days * 86400000)));
    parts.push(orderBy('createdAt', 'desc'));
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(lim));
    const snap = await getDocs(query(...parts));
    const items = snap.docs.map(mapAction);
    return { items, hasMore: items.length >= lim, cursor: items.length ? items[items.length - 1]._doc : null };
  } catch (err) {
    console.warn('[modLog] fetchRecentModActions failed:', err?.message);
    return { ...empty, error: err?.message || 'failed' };
  }
};
