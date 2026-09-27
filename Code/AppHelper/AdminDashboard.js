/**
 * AdminDashboard.js — moderation console.
 *
 * Ported from adoptme-jan7 (2026-09-06, brought level with its 2026-09-20
 * dashboard on 2026-09-23) and rewritten for Firebase only. Adopt Me reaches
 * for Supabase in four places — user search, the private-chat viewer, the
 * per-user chat list and the moderation audit log — and MM2 has no Supabase
 * (standing decision, HANDOFF.md), so each one is a different query here:
 *
 *   name search   → RTDB users.orderByChild('displayName') prefix range
 *   email search  → RTDB users_private.orderByChild('email').equalTo
 *                   (staff-only node; emails are no longer on users/{uid})
 *   chat viewer   → RTDB private_messages/{chatKey}/messages, paged
 *   user chats    → RTDB chat_meta_data/{uid}, paged on timestamp
 *   audit log     → Firestore mod_actions (Code/Helper/modLog.js)
 *
 * Two data sources, and the distinction matters everywhere on this screen:
 *   · what is in force RIGHT NOW  → RTDB banned_users_by_email (one record)
 *   · what has EVER been done     → Firestore mod_actions (append-only)
 *
 * Every list is bounded and paged. Nothing here downloads a whole node.
 *
 * Permissions:
 *   admin      everything
 *   moderator  ban / mute / strike (unless an admin flips the kill switch),
 *              Trusted / CMSR / Helper badges, delete reviews and statuses
 *              (not reviews written by staff), read the mod log
 *   junior mod mute only, capped at 2h; read the mod log
 * Enforcement lives in database.rules.json; this screen only decides what to
 * show. A gate here is a courtesy, not a security boundary.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image, Modal,
  ActivityIndicator, StyleSheet, ScrollView, RefreshControl, Alert,
  Switch, Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  getDatabase, ref, get, set, update, query,
  orderByChild, orderByKey, startAt, endAt, limitToFirst, limitToLast,
} from '@react-native-firebase/database';
import {
  getFirestore, collection, addDoc, deleteDoc, updateDoc, doc as fsDoc, getDoc,
  getDocs, query as fsQuery, where as fsWhere, orderBy as fsOrderBy, limit as fsLimit,
  startAfter as fsStartAfter, runTransaction, Timestamp,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import {
  unbanUserWithEmail, banUserwithEmail, setUserStrike, muteUser, canStaffBanMute,
  makeModerator, removeModerator, makeBabyMod, removeBabyMod,
  makeTrusted, removeTrusted, makeCMSR, removeCMSR, makeHelper, removeHelper,
  encodeEmailForBan,
} from '../ChatScreen/utils';
import { getOrFetchFullProfile, getOrFetchProfile, invalidateFullProfile } from '../Helper/profileCache';
import { getUserEmail, getUserEmails, findUidsByEmail } from '../Helper/privateProfile';
import {
  logModAction, fetchUserModHistory, fetchUserModCounts, fetchModLeaderboard, fetchRecentModActions,
} from '../Helper/modLog';
import UserBadgePill from '../Helper/UserBadgePill';

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const BAN_PAGE = 40;
const SEARCH_LIMIT = 25;
const CHAT_PAGE = 100;
const REVIEW_PAGE = 5;
const STATUS_PAGE = 10;
const USER_CHATS_PAGE = 20;
const HISTORY_PAGE = 25;
const FEED_PAGE = 30;

// Keys that accumulated in banned_users_by_email from older buggy writes.
const BAD_KEYS = new Set(['undefined', 'null', 'onloaduser', '']);

const decodeEmail = (k) => (k ? String(k).replace(/\(dot\)/g, '.') : '');
// RTDB rejects these in a key, and a stray one turns a query into an error.
const sanitize = (q) => String(q || '').replace(/[.#$[\]/\\]/g, '');
const looksLikeUid = (v) => typeof v === 'string' && v.length >= 15 && /^[A-Za-z0-9]+$/.test(v);
const looksLikeEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const avatarOf = (o) => (o && (o.avatar || o.userAvatar)) || DEFAULT_AVATAR;
const strOr = (v, fb) => (typeof v === 'string' && v.trim() ? v.trim() : fb);

// Firestore Timestamp / {seconds} / millis / ISO string → millis.
const toMillis = (v) => {
  if (!v) return null;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  const s = v?.seconds ?? v?._seconds;
  if (typeof s === 'number') return Math.round(s * 1000 + ((v?.nanoseconds ?? v?._nanoseconds ?? 0) / 1e6));
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
};

const timeAgo = (v) => {
  const ms = toMillis(v);
  if (!ms) return '';
  const d = Math.max(0, Date.now() - ms);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtDate = (v) => { const ms = toMillis(v); return ms ? new Date(ms).toLocaleDateString() : ''; };

const banRemaining = (bannedUntil) => {
  if (bannedUntil === 'permanent') return 'Permanent';
  if (typeof bannedUntil !== 'number') return '—';
  const diff = bannedUntil - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const isActiveUntil = (until) => until === 'permanent' || (typeof until === 'number' && until > Date.now());

// Semantic hues — identical in both themes so a status always reads the
// same colour. Chips are tinted rather than filled: a list of solid red
// badges is hard to scan because every row shouts equally loudly.
const HUE = {
  danger: '#FF3B30', warn: '#FF9500', warnMid: '#FF6B00', success: '#34C759',
  mute: '#5856D6', gold: '#FFC93C', accent: '#0A84FF',
};
const tint = (hex, a = '1F') => `${hex}${a}`;

// `label` heads a single entry ("Muted · 10 min"); `noun` is the counting
// form used in tallies ("3 mutes").
const ACTION_META = {
  mute: { label: 'Muted', noun: 'Mutes', icon: 'volume-mute', color: HUE.mute },
  strike: { label: 'Strike', noun: 'Strikes', icon: 'warning', color: HUE.warn },
  ban: { label: 'Banned', noun: 'Bans', icon: 'ban', color: HUE.danger },
  unban: { label: 'Unbanned', noun: 'Unbans', icon: 'checkmark-circle', color: HUE.success },
  review_delete: { label: 'Review removed', noun: 'Reviews', icon: 'star-half', color: HUE.gold },
  status_delete: { label: 'Status removed', noun: 'Statuses', icon: 'image', color: HUE.accent },
};
const SOURCE_LABEL = {
  admin_dashboard: 'Dashboard', group_chat: 'Chat', feed: 'Feed', report: 'Auto (reports)', auto: 'Auto', unknown: '—',
};

// The ACTUAL durations setUserStrike applies (utils.js STRIKE_LADDER is
// 3h / 3d / permanent). Kept next to each other so the label can never
// drift from the behaviour without someone seeing both.
const STRIKE_TIERS = [
  { count: 1, label: 'Strike 1', duration: '3 hours', color: HUE.warn },
  { count: 2, label: 'Strike 2', duration: '3 days', color: HUE.warnMid },
  { count: 3, label: 'Strike 3', duration: 'Permanent', color: HUE.danger },
];
const QUICK_REASONS = ['Spam', 'Scamming', 'Harassment', 'Inappropriate content', 'Ban evasion', 'Fake reviews'];

const TABS = [
  { key: 'banned', label: 'Restrictions' },
  { key: 'search', label: 'Users' },
  { key: 'modLog', label: 'Mod Log' },
  { key: 'chats', label: 'Chats', adminOnly: true },
  { key: 'userChats', label: 'User Chats', adminOnly: true },
  { key: 'polls', label: 'Polls' },
  { key: 'statuses', label: 'Statuses' },
  { key: 'access', label: 'Access', adminOnly: true },
];

const confirm = (title, message, okText = 'Confirm', destructive = false) => new Promise((res) => Alert.alert(title, message, [
  { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
  { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => res(true) },
]));

const AdminDashboard = () => {
  const { theme, user, isAdmin, modControlsEnabled, canGrantJmd } = useGlobalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const insets = useSafeAreaInsets();
  const db = useMemo(() => getDatabase(), []);
  const fs = useMemo(() => getFirestore(), []);

  const isModerator = !!user?.isModerator;
  const isBabyMod = !!user?.isBabyMod;
  const isStaff = isAdmin || isModerator || isBabyMod;
  const isJuniorOnly = isBabyMod && !isAdmin && !isModerator;
  const canBanMute = canStaffBanMute({ isAdmin, isModerator, isBabyMod, modControlsEnabled });
  // Reviews and statuses: admins and moderators. Junior mods are a mute-only rank.
  const canRemoveContent = isAdmin || isModerator;

  // Identity of whoever is acting, stamped onto the RTDB record and the
  // audit row. `role` records the authority the action was taken under.
  const actorInfo = useMemo(() => ({
    id: user?.id, displayName: user?.displayName || 'Admin', avatar: user?.avatar,
    role: isAdmin ? 'admin' : (isModerator ? 'moderator' : (isBabyMod ? 'baby_mod' : null)),
  }), [user?.id, user?.displayName, user?.avatar, isAdmin, isModerator, isBabyMod]);

  const visibleTabs = useMemo(() => TABS.filter((t) => !t.adminOnly || isAdmin), [isAdmin]);
  const [tab, setTab] = useState('banned');

  // ── Restrictions ─────────────────────────────────────────────────────
  const [bans, setBans] = useState([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [bansMoreLoading, setBansMoreLoading] = useState(false);
  const [bansHasMore, setBansHasMore] = useState(true);
  const banCursorRef = useRef(null);
  const [banQuery, setBanQuery] = useState('');
  const [restrictFilter, setRestrictFilter] = useState('all');
  const [searching, setSearching] = useState(false);

  // Rows from a snapshot. Expiry decides visibility, not strike count — a
  // mute never carries a strike, so filtering on strikeCount hid every mute.
  const rowsFromSnapshot = useCallback((snap) => {
    const out = [];
    if (!snap.exists()) return out;
    snap.forEach((child) => {
      const key = child.key;
      if (BAD_KEYS.has(key)) return;
      const v = child.val() || {};
      const until = v.bannedUntil;
      if (!isActiveUntil(until)) return;
      const strikes = v.strikeCount || 0;
      out.push({
        encodedEmail: key,
        email: v.email || decodeEmail(key),
        id: v.userId || null,
        displayName: v.displayName || 'Unknown',
        avatar: avatarOf(v),
        strikeCount: strikes,
        isMute: strikes < 1,
        bannedUntil: until ?? null,
        // Reason has been written as the boolean `true` by an older miswired
        // call; only render an actual string.
        reason: strOr(v.reason, '—'),
        bannedAt: v.bannedAt || v.appliedAt || null,
        bannedBy: typeof v.bannedBy === 'string' ? v.bannedBy : (v.bannedBy?.displayName || 'Unknown'),
        isBanned: true,
      });
    });
    return out.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
  }, []);

  // Paged on bannedAt: each page ends just before the oldest row loaded.
  // Needs .indexOn ["bannedAt"] on banned_users_by_email (declared).
  const loadBans = useCallback(async (reset = true) => {
    if (reset) { setBansLoading(true); banCursorRef.current = null; setBansHasMore(true); }
    else setBansMoreLoading(true);
    try {
      const cursor = reset ? null : banCursorRef.current;
      const q = cursor == null
        ? query(ref(db, 'banned_users_by_email'), orderByChild('bannedAt'), limitToLast(BAN_PAGE))
        : query(ref(db, 'banned_users_by_email'), orderByChild('bannedAt'), endAt(cursor - 1), limitToLast(BAN_PAGE));
      const snap = await get(q);
      // Oldest bannedAt from the RAW page — otherwise a page of all-expired
      // rows would leave the cursor unmoved and fetch the same page forever.
      let oldest = null; let rawCount = 0;
      snap.forEach((ch) => {
        rawCount++;
        const t = ch.val()?.bannedAt;
        if (typeof t === 'number' && (oldest === null || t < oldest)) oldest = t;
      });
      const rows = rowsFromSnapshot(snap);
      setBans((prev) => {
        const merged = reset ? rows : [...prev, ...rows];
        const seen = new Set();
        return merged.filter((r) => { if (seen.has(r.encodedEmail)) return false; seen.add(r.encodedEmail); return true; })
          .sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
      });
      banCursorRef.current = oldest;
      setBansHasMore(rawCount >= BAN_PAGE && oldest !== null);
    } catch (e) {
      Alert.alert('Error', 'Could not load restrictions. Check your permissions.');
    } finally {
      setBansLoading(false);
      setBansMoreLoading(false);
    }
  }, [db, rowsFromSnapshot]);

  const searchBans = useCallback(async (prefix) => {
    const p = String(prefix || '').trim().toLowerCase();
    if (!p) return loadBans(true);
    setBansLoading(true);
    try {
      // Keys ARE the encoded email, so a key range is a prefix match for free.
      const enc = encodeEmailForBan(p);
      const snap = await get(query(ref(db, 'banned_users_by_email'), orderByKey(), startAt(enc), endAt(`${enc}`), limitToFirst(50)));
      setBans(rowsFromSnapshot(snap));
      setBansHasMore(false);
    } catch (e) {
      Alert.alert('Error', 'Search failed.');
    } finally {
      setBansLoading(false);
    }
  }, [db, rowsFromSnapshot, loadBans]);

  useEffect(() => { loadBans(true); }, [loadBans]);

  useEffect(() => {
    const t = banQuery.trim();
    if (!t) {
      if (searching) { setSearching(false); loadBans(true); }
      return undefined;
    }
    setSearching(true);
    const h = setTimeout(() => searchBans(t), 300);
    return () => clearTimeout(h);
  }, [banQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshBans = useCallback(() => {
    const t = banQuery.trim();
    if (t) searchBans(t); else loadBans(true);
  }, [banQuery, searchBans, loadBans]);

  const filteredBans = useMemo(() => {
    if (restrictFilter === 'all') return bans;
    if (restrictFilter === 'mute') return bans.filter((b) => b.isMute);
    if (restrictFilter === '3+') return bans.filter((b) => b.strikeCount >= 3);
    return bans.filter((b) => b.strikeCount === Number(restrictFilter));
  }, [bans, restrictFilter]);

  // ── Live restriction cache (Users tab chips) ─────────────────────────
  // Checked in an effect, batched, and a miss is cached as null — a real
  // answer, not the absence of one — so a search never re-queries on render.
  const banStatusRef = useRef(new Map());
  const [banStatusTick, setBanStatusTick] = useState(0);
  const pendingChecks = useRef(new Set());

  const readLiveRestriction = useCallback(async (email) => {
    if (!email) return null;
    try {
      const snap = await get(ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`));
      if (!snap.exists()) return null;
      const v = snap.val() || {};
      return { ...v, isActive: isActiveUntil(v.bannedUntil), isMute: (v.strikeCount || 0) < 1 };
    } catch { return null; }
  }, [db]);

  const setLiveRestriction = useCallback((email, data) => {
    if (!email) return;
    banStatusRef.current.set(email.toLowerCase(), data);
    setBanStatusTick((n) => n + 1);
  }, []);
  const getLiveRestriction = (email) => (email ? banStatusRef.current.get(email.toLowerCase()) : undefined);

  // ── Users ────────────────────────────────────────────────────────────
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // `email` is never read off users/{uid} — it lives in users_private now.
  // resolveUsers fills it in from there (getUserEmail).
  const userFromRecord = (id, u) => ({
    id,
    displayName: u.displayName || u.userName || 'Unknown',
    email: null,
    avatar: avatarOf(u),
    isAdmin: !!u.admin || !!u.isAdmin,
    isModerator: !!u.isModerator,
    isBabyMod: !!u.isBabyMod,
    isTrusted: !!u.isTrusted,
    isCMSR: !!u.isCMSR,
    isHelper: !!u.isHelper,
    isPro: !!u.isPro,
    createdAt: u.createdAt || null,
    robloxUsername: u.robloxUsername || null,
  });

  // Resolves free text to users, for every people-picker on this screen.
  // uid → direct read. email → indexed equalTo on users_private.email (falls
  // back to the ban record, which carries userId). name → indexed prefix
  // range, two casings because RTDB orders by byte value. Emails are then
  // filled in from users_private (staff-only), never read off users/{uid}.
  const resolveUsers = useCallback(async (raw, max = SEARCH_LIMIT) => {
    const text = String(raw || '').trim();
    if (!text) return [];
    const results = []; const seen = new Set();
    const push = (id, u, email = null) => {
      if (!id || seen.has(id) || BAD_KEYS.has(id)) return;
      seen.add(id); results.push({ ...userFromRecord(id, u || {}), email });
    };
    // One users_private leaf per row (plus the legacy leaves until the
    // migration has run), in parallel. Bounded by `max`.
    const withEmails = async (list) => {
      const missing = list.filter((u) => !u.email).map((u) => u.id);
      if (missing.length === 0) return list;
      const emails = await getUserEmails(db, missing);
      return list.map((u) => (u.email ? u : { ...u, email: emails[u.id] || null }));
    };

    if (looksLikeUid(text)) {
      const snap = await get(ref(db, `users/${text}`));
      if (snap.exists()) push(text, snap.val());
      return withEmails(results);
    }

    if (looksLikeEmail(text)) {
      const email = text.toLowerCase();
      const uids = await findUidsByEmail(db, email);
      const records = await Promise.all(uids.map((id) => get(ref(db, `users/${id}`))));
      records.forEach((snap, i) => push(uids[i], snap.exists() ? snap.val() : {}, email));
      if (results.length === 0) {
        // Ban records are keyed by email and carry the uid.
        const ban = await get(ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`));
        const v = ban.exists() ? ban.val() : null;
        if (v?.userId) {
          const us = await get(ref(db, `users/${v.userId}`));
          push(v.userId, us.exists() ? us.val() : { displayName: v.displayName, avatar: v.avatar }, email);
        }
      }
      return results;
    }

    const name = sanitize(text);
    const variants = [...new Set([name, name.toLowerCase(), name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()])];
    for (const v of variants) {
      if (!v || results.length >= max) break;
      const snap = await get(query(ref(db, 'users'), orderByChild('displayName'), startAt(v), endAt(`${v}`), limitToFirst(max)));
      if (snap.exists()) snap.forEach((ch) => push(ch.key, ch.val() || {}));
    }
    return withEmails(results.slice(0, max));
  }, [db]);

  const searchUsers = useCallback(async () => {
    const raw = userQuery.trim();
    if (!raw) return;
    Keyboard.dismiss();
    setUsersLoading(true);
    setHasSearched(true);
    try {
      setUsers(await resolveUsers(raw));
    } catch (e) {
      Alert.alert('Search failed', e?.message || 'Try a display name, an email or a user ID.');
    } finally {
      setUsersLoading(false);
    }
  }, [userQuery, resolveUsers]);

  useEffect(() => {
    if (tab !== 'search' || users.length === 0) return undefined;
    const toCheck = users.map((u) => u.email).filter((e) => e && getLiveRestriction(e) === undefined && !pendingChecks.current.has(e));
    if (toCheck.length === 0) return undefined;
    toCheck.forEach((e) => pendingChecks.current.add(e));
    let cancelled = false;
    Promise.all(toCheck.map((e) => readLiveRestriction(e).then((d) => [e, d]))).then((pairs) => {
      toCheck.forEach((e) => pendingChecks.current.delete(e));
      if (cancelled) return;
      pairs.forEach(([e, d]) => banStatusRef.current.set(e.toLowerCase(), d));
      setBanStatusTick((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [tab, users, readLiveRestriction]);

  // ── Selected user (profile sheet) ────────────────────────────────────
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customMute, setCustomMute] = useState('');

  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsHasMore, setReviewsHasMore] = useState(false);
  const reviewCursorRef = useRef(null);
  const [ratingSummary, setRatingSummary] = useState(null);

  const [sanction, setSanction] = useState(null);
  const [modCounts, setModCounts] = useState(null);
  const [modHistory, setModHistory] = useState([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);
  const [modHistoryHasMore, setModHistoryHasMore] = useState(false);
  const [modHistoryError, setModHistoryError] = useState(null);
  const historyCursorRef = useRef(null);

  const fetchReviews = useCallback(async (uid, reset) => {
    if (!uid) return;
    setReviewsLoading(true);
    try {
      const parts = [collection(fs, 'reviews'), fsWhere('toUserId', '==', uid), fsOrderBy('updatedAt', 'desc')];
      if (!reset && reviewCursorRef.current) parts.push(fsStartAfter(reviewCursorRef.current));
      parts.push(fsLimit(REVIEW_PAGE + 1));
      const snap = await getDocs(fsQuery(...parts));
      const docs = snap.docs.slice(0, REVIEW_PAGE);
      const rows = docs.map((d) => ({ id: d.id, ...d.data() }));
      reviewCursorRef.current = docs[docs.length - 1] || reviewCursorRef.current;
      setReviewsHasMore(snap.docs.length > REVIEW_PAGE);
      setReviews((prev) => (reset ? rows : [...prev, ...rows]));
    } catch (e) {
      if (reset) setReviews([]);
      setReviewsHasMore(false);
    } finally {
      setReviewsLoading(false);
    }
  }, [fs]);

  // Summary first; if there is none (or it says 0 while reviews exist) count
  // from the reviews themselves, capped, and do NOT persist — the dashboard
  // reads summaries, it does not own them.
  const fetchRatingSummary = useCallback(async (uid) => {
    if (!uid) { setRatingSummary(null); return; }
    try {
      const snap = await getDoc(fsDoc(fs, 'user_ratings_summary', uid));
      let average = 0; let count = 0;
      if (snap.exists()) {
        const s = snap.data() || {};
        average = Number(s.averageRating) || 0;
        count = Number(s.count) || 0;
      }
      if (count === 0) {
        const rs = await getDocs(fsQuery(collection(fs, 'reviews'), fsWhere('toUserId', '==', uid), fsLimit(100)));
        let sum = 0; let n = 0;
        rs.docs.forEach((d) => { const r = Number(d.data()?.rating); if (r > 0) { sum += r; n++; } });
        if (n > 0) { average = sum / n; count = n; }
      }
      setRatingSummary({ average, count });
    } catch { setRatingSummary(null); }
  }, [fs]);

  // The LIVE record: exactly one thing, the most recent mute/strike/ban.
  const fetchSanction = useCallback(async (email) => {
    if (!email) { setSanction(null); return; }
    try {
      const snap = await get(ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`));
      if (!snap.exists()) { setSanction(null); return; }
      const v = snap.val() || {};
      let by = typeof v.bannedBy === 'string' ? v.bannedBy : (v.bannedBy?.displayName || null);
      if (by && looksLikeUid(by)) {
        try { const p = await getOrFetchProfile(db, by); by = p?.displayName || by; } catch { /* keep uid */ }
      }
      setSanction({
        kind: (v.strikeCount || 0) > 0 ? 'strike' : 'mute',
        isActive: isActiveUntil(v.bannedUntil),
        strikeCount: v.strikeCount || 0,
        reason: strOr(v.reason, null),
        appliedAt: v.bannedAt || v.appliedAt || null,
        appliedBy: by,
        bannedUntil: v.bannedUntil ?? null,
      });
    } catch { setSanction(null); }
  }, [db]);

  const fetchModRecord = useCallback(async (email, uid, reset) => {
    if (!email && !uid) return;
    setModHistoryLoading(true);
    try {
      const [counts, page] = await Promise.all([
        reset ? fetchUserModCounts({ email, uid }) : Promise.resolve(null),
        fetchUserModHistory({ email, uid, cursor: reset ? null : historyCursorRef.current, limit: HISTORY_PAGE }),
      ]);
      if (counts) setModCounts(counts);
      setModHistory((prev) => (reset ? page.items : [...prev, ...page.items]));
      historyCursorRef.current = page.cursor;
      setModHistoryHasMore(page.hasMore);
      setModHistoryError(page.error || null);
    } finally {
      setModHistoryLoading(false);
    }
  }, []);

  const openUser = useCallback(async (u) => {
    if (!u) return;
    setSelected(u);
    setDetail(null);
    setReviews([]); setReviewsHasMore(false); reviewCursorRef.current = null;
    setRatingSummary(null); setSanction(null); setModCounts(null);
    setModHistory([]); setModHistoryHasMore(false); setModHistoryError(null); historyCursorRef.current = null;
    if (!u.id && !u.email) return;
    setDetailLoading(true);
    try {
      // The email comes from users_private (staff-only) unless the row that
      // opened the sheet already carried one (ban list, mod log, search).
      const [record, privateEmail] = await Promise.all([
        u.id ? getOrFetchFullProfile(db, u.id) : Promise.resolve(null),
        !u.email && u.id ? getUserEmail(db, u.id) : Promise.resolve(null),
      ]);
      const email = u.email || privateEmail || null;
      setDetail({ record: record || null, email });
      await Promise.all([
        fetchSanction(email),
        fetchReviews(u.id, true),
        fetchRatingSummary(u.id),
        fetchModRecord(email, u.id, true),
      ]);
    } catch {
      setDetail({ record: null });
    } finally {
      setDetailLoading(false);
    }
  }, [db, fetchSanction, fetchReviews, fetchRatingSummary, fetchModRecord]);

  const merged = useMemo(() => {
    if (!selected) return null;
    const r = detail?.record || {};
    return {
      ...selected,
      displayName: selected.displayName || r.displayName || 'Unknown',
      avatar: selected.avatar || avatarOf(r),
      email: selected.email || detail?.email || null,
      isAdmin: selected.isAdmin ?? (!!r.admin || !!r.isAdmin),
      isModerator: selected.isModerator ?? !!r.isModerator,
      isBabyMod: selected.isBabyMod ?? !!r.isBabyMod,
      isTrusted: selected.isTrusted ?? !!r.isTrusted,
      isCMSR: selected.isCMSR ?? !!r.isCMSR,
      isHelper: selected.isHelper ?? !!r.isHelper,
      isPro: selected.isPro ?? !!r.isPro,
      createdAt: selected.createdAt || r.createdAt || null,
      robloxUsername: selected.robloxUsername || r.robloxUsername || null,
    };
  }, [selected, detail]);

  // Re-read both sides after a write so the open sheet reflects it without
  // the admin closing and reopening it.
  const afterModAction = useCallback(async (target) => {
    const t = target || merged;
    if (t?.id) invalidateFullProfile(t.id);
    refreshBans();
    if (t?.email) {
      fetchSanction(t.email);
      readLiveRestriction(t.email).then((d) => setLiveRestriction(t.email, d));
    }
    if (t?.email || t?.id) fetchModRecord(t.email, t.id, true);
  }, [merged, refreshBans, fetchSanction, readLiveRestriction, setLiveRestriction, fetchModRecord]);

  // ── Reason prompt + punitive actions ─────────────────────────────────
  const [pendingAction, setPendingAction] = useState(null); // { type, value, target }
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const requestAction = useCallback((type, value, target) => {
    if (type !== 'unban' && !canBanMute) {
      Alert.alert('Disabled', 'An admin has turned moderator ban & mute off.');
      return;
    }
    // Only an admin may sanction staff.
    if (type !== 'unban' && !isAdmin && (target?.isAdmin || target?.isModerator || target?.isBabyMod)) {
      Alert.alert('Not allowed', 'This user is a staff member. Only an admin can ban, strike or mute them.');
      return;
    }
    if (!target?.email) {
      Alert.alert('No email on record', 'Restrictions are keyed by email, and this account has none.');
      return;
    }
    setActionReason('');
    setPendingAction({ type, value, target });
  }, [canBanMute, isAdmin]);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingAction || actionBusy) return;
    const { type, value, target } = pendingAction;
    const reason = actionReason.trim() || null;
    const userInfo = { id: target.id, displayName: target.displayName, avatar: target.avatar, email: target.email };
    Keyboard.dismiss();
    setActionBusy(true);
    try {
      let ok = false;
      if (type === 'ban') ok = await banUserwithEmail(target.email, isAdmin, target.id, userInfo, actorInfo, reason, 'admin_dashboard');
      else if (type === 'strike') ok = await setUserStrike(target.email, value, target.id, true, actorInfo, userInfo, reason, 'admin_dashboard');
      else if (type === 'mute') {
        // Junior mods are capped at two hours. The rules do not enforce this;
        // it is a UI convention and is labelled as such in the sheet.
        const mins = isJuniorOnly ? Math.min(value, 120) : value;
        ok = await muteUser(target.email, mins, userInfo, actorInfo, true, reason, 'admin_dashboard');
      } else if (type === 'unban') ok = await unbanUserWithEmail(target.email, true, actorInfo, reason, 'admin_dashboard');
      setPendingAction(null);
      setActionReason('');
      if (ok) afterModAction(target);
    } finally {
      setActionBusy(false);
    }
  }, [pendingAction, actionBusy, actionReason, isAdmin, isJuniorOnly, actorInfo, afterModAction]);

  const doRole = useCallback(async (fn, label) => {
    if (!merged?.id) return;
    if (!(await confirm(label, `${label} for ${merged.displayName}?`))) return;
    if (await fn(merged.id)) {
      invalidateFullProfile(merged.id);
      const record = await getOrFetchFullProfile(db, merged.id).catch(() => null);
      setSelected((prev) => (prev ? { ...prev, ...userFromRecord(merged.id, record || {}), email: prev.email || merged.email || null } : prev));
      setDetail((prev) => ({ record, email: prev?.email || null }));
    }
  }, [merged, db]);

  // ── Review removal ───────────────────────────────────────────────────
  // Admins delete any review. Moderators delete any review except one
  // written by staff. The rating summary is adjusted in the same transaction
  // that deletes the document, so the two can never disagree.
  const deleteReview = useCallback(async (review) => {
    if (!review?.id || !merged?.id || !canRemoveContent) return;
    if (!isAdmin && review.fromUserId) {
      try {
        const rv = await getOrFetchFullProfile(db, review.fromUserId);
        if (rv && (rv.admin || rv.isAdmin || rv.isModerator)) {
          Alert.alert('Restricted', 'Moderators cannot delete reviews written by moderators or admins.');
          return;
        }
      } catch { /* proceed */ }
    }
    const reviewer = strOr(review.userName, null) || strOr(review.reviewerName, null);
    const text = strOr(review.review, null) || strOr(review.comment, null) || strOr(review.text, null);
    const ok = await confirm(
      'Remove review',
      `Remove this ${Number(review.rating) || 0}-star review${reviewer ? ` by ${reviewer}` : ''} from ${merged.displayName}'s profile?\n\nTheir average rating is recalculated. This cannot be undone.`,
      'Remove', true,
    );
    if (!ok) return;
    try {
      const ratingToRemove = Number(review.rating) || 0;
      const reviewRef = fsDoc(fs, 'reviews', review.id);
      const summaryRef = fsDoc(fs, 'user_ratings_summary', merged.id);
      await runTransaction(fs, async (tx) => {
        const [rSnap, sSnap] = await Promise.all([tx.get(reviewRef), tx.get(summaryRef)]);
        if (!rSnap.exists()) return; // already gone
        if (sSnap.exists()) {
          const s = sSnap.data() || {};
          const oldAvg = Number(s.averageRating) || 0;
          const oldCount = Number(s.count) || 0;
          if (oldCount <= 1 || ratingToRemove <= 0) {
            tx.set(summaryRef, { averageRating: oldCount <= 1 ? 0 : oldAvg, count: Math.max(0, oldCount - 1), updatedAt: Timestamp.now() }, { merge: true });
          } else {
            const newCount = oldCount - 1;
            const newAvg = Math.max(0, Math.min(5, ((oldAvg * oldCount) - ratingToRemove) / newCount));
            tx.set(summaryRef, { averageRating: parseFloat(newAvg.toFixed(2)), count: newCount, updatedAt: Timestamp.now() }, { merge: true });
          }
        }
        tx.delete(reviewRef);
      });
      logModAction({
        action: 'review_delete', targetUid: merged.id, targetEmail: merged.email, targetName: merged.displayName,
        reason: `Removed a ${ratingToRemove}-star review${reviewer ? ` by ${reviewer}` : ''}${text ? `: "${text.slice(0, 140)}"` : ''}`,
        source: 'admin_dashboard', actorUid: actorInfo.id, actorName: actorInfo.displayName, actorRole: actorInfo.role,
        meta: { reviewId: review.id, fromUserId: review.fromUserId || null, reviewerName: reviewer, rating: ratingToRemove, text },
      });
      setReviews((prev) => prev.filter((r) => r.id !== review.id));
      fetchRatingSummary(merged.id);
      fetchModRecord(merged.email, merged.id, true);
      Alert.alert('Removed', 'The review is gone and the rating has been recalculated.');
    } catch (e) {
      Alert.alert('Error', 'Could not remove the review.');
    }
  }, [merged, canRemoveContent, isAdmin, db, fs, actorInfo, fetchRatingSummary, fetchModRecord]);

  // ── Mod Log ──────────────────────────────────────────────────────────
  const [modLogView, setModLogView] = useState('leaderboard');
  const [modLogDays, setModLogDays] = useState(30);
  const [leaderboard, setLeaderboard] = useState({ rows: [], truncated: false, scanned: 0 });
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedError, setFeedError] = useState(null);
  const feedCursorRef = useRef(null);
  const [feedAction, setFeedAction] = useState(null);
  const [feedActor, setFeedActor] = useState(null); // { uid, name }

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try { setLeaderboard(await fetchModLeaderboard({ days: modLogDays })); }
    finally { setLeaderboardLoading(false); }
  }, [modLogDays]);

  const loadFeed = useCallback(async (reset) => {
    setFeedLoading(true);
    try {
      const page = await fetchRecentModActions({
        action: feedAction, actorUid: feedActor?.uid || null, days: modLogDays,
        cursor: reset ? null : feedCursorRef.current, limit: FEED_PAGE,
      });
      setFeed((prev) => (reset ? page.items : [...prev, ...page.items]));
      feedCursorRef.current = page.cursor;
      setFeedHasMore(page.hasMore);
      setFeedError(page.error || null);
    } finally {
      setFeedLoading(false);
    }
  }, [feedAction, feedActor, modLogDays]);

  useEffect(() => {
    if (tab !== 'modLog') return;
    if (modLogView === 'leaderboard') loadLeaderboard(); else loadFeed(true);
  }, [tab, modLogView, modLogDays, feedAction, feedActor]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFromAction = useCallback((a) => {
    openUser({ id: a.targetUid || null, email: a.targetEmail || null, displayName: a.targetName || a.targetEmail || 'Unknown', avatar: DEFAULT_AVATAR });
  }, [openUser]);

  // ── Polls ────────────────────────────────────────────────────────────
  // Firestore polls/{id}: { question, options:[{text,votes}], totalVotes,
  // voters:{uid:index}, active, createdAt, createdBy } — the shape
  // Code/Engagement/PollCard.jsx reads and writes. `active` is the switch
  // the feed filters on, so retiring a poll hides it without deleting votes.
  const [polls, setPolls] = useState([]);
  const [pollsLoading, setPollsLoading] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);

  const loadPolls = useCallback(async () => {
    setPollsLoading(true);
    try {
      const snap = await getDocs(fsQuery(collection(fs, 'polls'), fsOrderBy('createdAt', 'desc'), fsLimit(20)));
      setPolls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      Alert.alert('Error', 'Could not load polls.');
    } finally {
      setPollsLoading(false);
    }
  }, [fs]);

  useEffect(() => { if (tab === 'polls') loadPolls(); }, [tab, loadPolls]);

  const createPoll = useCallback(async () => {
    const question = pollQ.trim();
    const options = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!question) { Alert.alert('Error', 'Enter a question.'); return; }
    if (options.length < 2) { Alert.alert('Error', 'Add at least two options.'); return; }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      Alert.alert('Error', 'Options must be different from each other.'); return;
    }
    if (polls.filter((p) => p.active).length >= 3) {
      Alert.alert('Limit reached', 'Three active polls at a time. Deactivate one first.');
      return;
    }
    setCreatingPoll(true);
    try {
      await addDoc(collection(fs, 'polls'), {
        question,
        options: options.map((text) => ({ text, votes: 0 })),
        totalVotes: 0, voters: {}, active: true,
        createdAt: Timestamp.now(), createdBy: user?.id || null,
      });
      setPollQ(''); setPollOpts(['', '']);
      Keyboard.dismiss();
      loadPolls();
      Alert.alert('Published', 'The poll is now live in the feed.');
    } catch (e) {
      Alert.alert('Error', 'Could not create the poll.');
    } finally {
      setCreatingPoll(false);
    }
  }, [fs, pollQ, pollOpts, polls, user, loadPolls]);

  const togglePoll = useCallback(async (p) => {
    if (!p.active && polls.filter((x) => x.active).length >= 3) {
      Alert.alert('Limit reached', 'Three active polls at a time.');
      return;
    }
    try {
      await updateDoc(fsDoc(fs, 'polls', p.id), { active: !p.active });
      setPolls((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
    } catch (e) {
      Alert.alert('Error', 'Could not update the poll.');
    }
  }, [fs, polls]);

  const deletePoll = useCallback(async (p) => {
    const ok = await confirm('Delete poll', `Delete "${p.question}"? Its ${p.totalVotes || 0} vote(s) go with it. This cannot be undone.`, 'Delete', true);
    if (!ok) return;
    try {
      await deleteDoc(fsDoc(fs, 'polls', p.id));
      setPolls((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      Alert.alert('Error', 'Could not delete the poll.');
    }
  }, [fs]);

  // ── Statuses ─────────────────────────────────────────────────────────
  const [statuses, setStatuses] = useState([]);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [statusesMore, setStatusesMore] = useState(false);
  const statusCursorRef = useRef(null);

  const loadStatuses = useCallback(async (reset) => {
    setStatusesLoading(true);
    try {
      const parts = [collection(fs, 'statuses'), fsOrderBy('createdAt', 'desc')];
      if (!reset && statusCursorRef.current) parts.push(fsStartAfter(statusCursorRef.current));
      parts.push(fsLimit(STATUS_PAGE));
      const snap = await getDocs(fsQuery(...parts));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (snap.docs.length) statusCursorRef.current = snap.docs[snap.docs.length - 1];
      setStatusesMore(snap.docs.length >= STATUS_PAGE);
      setStatuses((prev) => {
        const all = reset ? rows : [...prev, ...rows];
        const seen = new Set();
        return all.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
      });
    } catch (e) {
      Alert.alert('Error', 'Could not load statuses.');
    } finally {
      setStatusesLoading(false);
    }
  }, [fs]);

  useEffect(() => { if (tab === 'statuses' && statuses.length === 0) loadStatuses(true); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteStatus = useCallback(async (st) => {
    if (!canRemoveContent) return;
    const ok = await confirm('Delete status', `Delete ${st.userName || 'this user'}'s status permanently?`, 'Delete', true);
    if (!ok) return;
    try {
      await deleteDoc(fsDoc(fs, 'statuses', st.id));
      setStatuses((prev) => prev.filter((x) => x.id !== st.id));
      logModAction({
        action: 'status_delete', targetUid: st.userId || null, targetName: st.userName || null,
        reason: st.caption ? `Removed status: "${String(st.caption).slice(0, 140)}"` : 'Removed an image status',
        source: 'admin_dashboard', actorUid: actorInfo.id, actorName: actorInfo.displayName, actorRole: actorInfo.role,
        meta: { statusId: st.id, type: st.type || null, imageUrl: st.imageUrl || null },
      });
    } catch (e) {
      Alert.alert('Error', 'Could not delete the status.');
    }
  }, [fs, canRemoveContent, actorInfo]);

  // ── Chat viewer (admin) ──────────────────────────────────────────────
  const [person, setPerson] = useState([null, null]);
  const [personQuery, setPersonQuery] = useState(['', '']);
  const [personResults, setPersonResults] = useState([[], []]);
  const [personSearching, setPersonSearching] = useState([false, false]);
  const [chatRows, setChatRows] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOlderLoading, setChatOlderLoading] = useState(false);
  const [chatHasOlder, setChatHasOlder] = useState(false);
  const chatCursorRef = useRef(null);
  const [previewImage, setPreviewImage] = useState(null);

  const setSlot = (setter, i, v) => setter((prev) => { const n = [...prev]; n[i] = v; return n; });

  const searchPerson = useCallback(async (i) => {
    const text = personQuery[i].trim();
    if (!text) { setSlot(setPersonResults, i, []); return; }
    Keyboard.dismiss();
    setSlot(setPersonSearching, i, true);
    try { setSlot(setPersonResults, i, await resolveUsers(text, 10)); }
    catch { setSlot(setPersonResults, i, []); }
    finally { setSlot(setPersonSearching, i, false); }
  }, [personQuery, resolveUsers]);

  const chatKeyOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  const loadChat = useCallback(async (reset = true) => {
    const [a, b] = person;
    if (!a?.id || !b?.id) { Alert.alert('Pick two users', 'Choose both people first.'); return; }
    if (a.id === b.id) { Alert.alert('Error', 'Pick two different users.'); return; }
    if (!reset && (chatOlderLoading || !chatHasOlder)) return;
    Keyboard.dismiss();
    if (reset) { setChatLoading(true); chatCursorRef.current = null; setChatHasOlder(false); }
    else setChatOlderLoading(true);
    try {
      const base = ref(db, `private_messages/${chatKeyOf(a.id, b.id)}/messages`);
      const cursor = reset ? null : chatCursorRef.current;
      const q = cursor == null
        ? query(base, orderByChild('timestamp'), limitToLast(CHAT_PAGE))
        : query(base, orderByChild('timestamp'), endAt(cursor - 1), limitToLast(CHAT_PAGE));
      const snap = await get(q);
      const rows = []; let oldest = null;
      if (snap.exists()) snap.forEach((ch) => {
        const v = ch.val() || {};
        rows.push({ id: ch.key, ...v });
        if (typeof v.timestamp === 'number' && (oldest === null || v.timestamp < oldest)) oldest = v.timestamp;
      });
      chatCursorRef.current = oldest;
      setChatHasOlder(rows.length >= CHAT_PAGE && oldest !== null);
      setChatRows((prev) => {
        const all = reset ? rows : [...(prev?.rows || []), ...rows];
        const seen = new Set();
        const dedup = all.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
          .sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
        return { a, b, rows: dedup };
      });
    } catch (e) {
      Alert.alert('Error', 'Could not load that conversation.');
      if (reset) setChatRows(null);
    } finally {
      setChatLoading(false);
      setChatOlderLoading(false);
    }
  }, [db, person, chatOlderLoading, chatHasOlder]);

  // Drops the thread and both inbox rows in one atomic multi-path write.
  const deleteConversation = useCallback(async () => {
    const [a, b] = person;
    if (!isAdmin || !a?.id || !b?.id || a.id === b.id) return;
    const ok = await confirm(
      'Delete conversation',
      `Permanently delete every message between "${a.displayName}" and "${b.displayName}", plus both inbox entries?\n\nThis cannot be undone.`,
      'Delete', true,
    );
    if (!ok) return;
    setChatLoading(true);
    try {
      await update(ref(db), {
        [`private_messages/${chatKeyOf(a.id, b.id)}`]: null,
        [`chat_meta_data/${a.id}/${b.id}`]: null,
        [`chat_meta_data/${b.id}/${a.id}`]: null,
      });
      setChatRows({ a, b, rows: [] });
      setChatHasOlder(false);
      Alert.alert('Deleted', 'The conversation has been removed for both users.');
    } catch (e) {
      Alert.alert('Error', 'Could not delete the conversation.');
    } finally {
      setChatLoading(false);
    }
  }, [db, person, isAdmin]);

  // ── User chats (admin) ───────────────────────────────────────────────
  const [ucInput, setUcInput] = useState('');
  const [ucTarget, setUcTarget] = useState(null);
  const [ucPick, setUcPick] = useState([]);
  const [ucList, setUcList] = useState([]);
  const [ucLoading, setUcLoading] = useState(false);
  const [ucHasMore, setUcHasMore] = useState(false);
  const ucCursorRef = useRef(null);

  const loadUserChats = useCallback(async (target, reset) => {
    if (!target?.id) return;
    setUcLoading(true);
    try {
      const base = ref(db, `chat_meta_data/${target.id}`);
      const cursor = reset ? null : ucCursorRef.current;
      const q = cursor == null
        ? query(base, orderByChild('timestamp'), limitToLast(USER_CHATS_PAGE))
        : query(base, orderByChild('timestamp'), endAt(cursor - 1), limitToLast(USER_CHATS_PAGE));
      const snap = await get(q);
      const rows = []; let oldest = null;
      if (snap.exists()) snap.forEach((ch) => {
        const v = ch.val() || {};
        const t = typeof v.timestamp === 'number' ? v.timestamp : 0;
        rows.push({
          partnerId: ch.key, lastMessage: v.lastMessage || '', timestamp: t, unreadCount: v.unreadCount || 0,
          partnerName: v.receiverName || 'Unknown', partnerAvatar: v.receiverAvatar || DEFAULT_AVATAR,
        });
        if (oldest === null || t < oldest) oldest = t;
      });
      rows.sort((x, y) => y.timestamp - x.timestamp);
      ucCursorRef.current = oldest;
      setUcHasMore(rows.length >= USER_CHATS_PAGE && oldest !== null && oldest > 0);
      setUcList((prev) => {
        const all = reset ? rows : [...prev, ...rows];
        const seen = new Set();
        return all.filter((r) => { if (seen.has(r.partnerId)) return false; seen.add(r.partnerId); return true; });
      });
    } catch (e) {
      Alert.alert('Error', 'Could not load that user\'s chats.');
    } finally {
      setUcLoading(false);
    }
  }, [db]);

  const pickUcTarget = useCallback((t) => {
    setUcPick([]); setUcInput(''); setUcTarget(t); setUcList([]); ucCursorRef.current = null;
    loadUserChats(t, true);
  }, [loadUserChats]);

  const findUcTarget = useCallback(async () => {
    const raw = ucInput.trim();
    if (!raw) return;
    Keyboard.dismiss();
    setUcLoading(true);
    try {
      const matches = await resolveUsers(raw, 10);
      if (matches.length === 0) Alert.alert('Not found', 'No user matches that name, email or ID.');
      else if (matches.length === 1) pickUcTarget(matches[0]);
      else setUcPick(matches);
    } catch { Alert.alert('Error', 'Could not look up that user.'); }
    finally { setUcLoading(false); }
  }, [ucInput, resolveUsers, pickUcTarget]);

  const openChatFromUserChats = useCallback((entry) => {
    if (!ucTarget?.id) return;
    setPerson([ucTarget, { id: entry.partnerId, displayName: entry.partnerName, avatar: entry.partnerAvatar, email: null }]);
    setPersonQuery(['', '']); setPersonResults([[], []]);
    setChatRows(null);
    setTab('chats');
  }, [ucTarget]);

  useEffect(() => {
    if (tab === 'chats' && person[0]?.id && person[1]?.id && chatRows === null && !chatLoading) loadChat(true);
  }, [tab, person]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Access (admin) ───────────────────────────────────────────────────
  const [granters, setGranters] = useState([]);
  const [grantersLoading, setGrantersLoading] = useState(false);
  const [grantQuery, setGrantQuery] = useState('');
  const [grantResults, setGrantResults] = useState([]);

  const loadGranters = useCallback(async () => {
    setGrantersLoading(true);
    try {
      const snap = await get(ref(db, 'jmd_granters'));
      const v = snap.exists() ? snap.val() || {} : {};
      setGranters(Object.entries(v)
        .filter(([uid, val]) => uid && !BAD_KEYS.has(uid) && val !== false && val != null)
        .map(([uid, val]) => ({
          id: uid,
          displayName: (typeof val === 'object' && val.displayName) || uid,
          avatar: (typeof val === 'object' && val.avatar) || DEFAULT_AVATAR,
          grantedAt: (typeof val === 'object' && val.grantedAt) || null,
        }))
        .sort((x, y) => (y.grantedAt || 0) - (x.grantedAt || 0)));
    } catch (e) {
      Alert.alert('Error', 'Could not load JMD access list.');
    } finally {
      setGrantersLoading(false);
    }
  }, [db]);

  useEffect(() => { if (tab === 'access' && isAdmin) loadGranters(); }, [tab, isAdmin, loadGranters]);

  const searchGrant = useCallback(async () => {
    const raw = grantQuery.trim();
    if (!raw) { setGrantResults([]); return; }
    Keyboard.dismiss();
    try { setGrantResults(await resolveUsers(raw, 10)); }
    catch { setGrantResults([]); }
  }, [grantQuery, resolveUsers]);

  const grantJmd = useCallback(async (u) => {
    if (!u?.id) return;
    if (granters.some((g) => g.id === u.id)) { Alert.alert('Already granted', `${u.displayName} can already make Junior Mods.`); return; }
    if (!(await confirm('Grant JMD access', `Allow ${u.displayName} to make and remove Junior Mods?\n\nThis gives them no other staff power.`, 'Grant'))) return;
    try {
      await set(ref(db, `jmd_granters/${u.id}`), {
        displayName: u.displayName || 'Unknown', avatar: u.avatar || DEFAULT_AVATAR,
        grantedAt: Date.now(), grantedBy: user?.id || null,
      });
      setGrantQuery(''); setGrantResults([]);
      loadGranters();
    } catch (e) {
      Alert.alert('Error', 'Could not grant access. Only admins may write this.');
    }
  }, [db, user, granters, loadGranters]);

  const revokeJmd = useCallback(async (g) => {
    if (!(await confirm('Revoke', `Remove ${g.displayName}'s Junior Mod permission?`, 'Revoke', true))) return;
    try { await set(ref(db, `jmd_granters/${g.id}`), null); loadGranters(); }
    catch (e) { Alert.alert('Error', 'Could not revoke.'); }
  }, [db, loadGranters]);

  const toggleModControls = useCallback(async (next) => {
    try { await set(ref(db, 'mod_controls_enabled'), next); }
    catch (e) { Alert.alert('Error', 'Only admins can change this.'); }
  }, [db]);

  // ── render helpers ───────────────────────────────────────────────────
  const s = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  const statusChip = (hue, label) => (
    <View style={[s.chip, { backgroundColor: tint(hue), borderColor: tint(hue, '40') }]}>
      <Text style={[s.chipText, { color: hue }]}>{label}</Text>
    </View>
  );

  const restrictionChip = (row) => {
    if (row.isMute) return statusChip(HUE.mute, 'MUTED');
    return statusChip(row.strikeCount >= 3 ? HUE.danger : HUE.warn, `STRIKE ${row.strikeCount}`);
  };

  const pills = (items, value, onChange) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={s.pillRow}>
      {items.map(([k, l]) => (
        <TouchableOpacity key={String(k)} onPress={() => onChange(k)} style={[s.pill, value === k && s.pillActive]}>
          <Text style={[s.pillText, value === k && s.pillTextActive]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const personPicker = (i, label) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.sectionLabel}>{label}</Text>
      {person[i] ? (
        <View style={s.card}>
          <Image source={{ uri: avatarOf(person[i]) }} style={s.avatar} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.name} numberOfLines={1}>{person[i].displayName}</Text>
            <Text style={s.sub} numberOfLines={1}>{person[i].email || person[i].id}</Text>
          </View>
          <TouchableOpacity onPress={() => { setSlot(setPerson, i, null); setChatRows(null); }}>
            <Icon name="close-circle" size={22} color={c.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={[s.searchRow, { paddingHorizontal: 0 }]}>
            <TextInput value={personQuery[i]} onChangeText={(t) => setSlot(setPersonQuery, i, t)}
              placeholder="Name, email or user ID" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search"
              onSubmitEditing={() => searchPerson(i)} style={s.input} />
            <TouchableOpacity onPress={() => searchPerson(i)} style={s.searchBtn}>
              {personSearching[i] ? <ActivityIndicator color="#fff" /> : <Icon name="search" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
          {personResults[i].map((u) => (
            <TouchableOpacity key={u.id} style={s.card} onPress={() => { setSlot(setPerson, i, u); setSlot(setPersonResults, i, []); setChatRows(null); }}>
              <Image source={{ uri: avatarOf(u) }} style={s.avatar} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.name} numberOfLines={1}>{u.displayName}</Text>
                <Text style={s.sub} numberOfLines={1}>{u.email || u.id}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );

  const actionRow = (a, showTarget, onPress) => {
    const meta = ACTION_META[a.action] || { label: a.action, color: c.textMuted };
    return (
      <TouchableOpacity key={a.id} activeOpacity={0.7} onPress={onPress} style={s.timelineRow}>
        <View style={[s.dot, { backgroundColor: meta.color }]} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: meta.color, fontWeight: '700', fontSize: 12 }}>
              {meta.label}
              {a.action === 'mute' && a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
              {a.action === 'strike' && a.strikeCount ? ` ${a.strikeCount}` : ''}
              {a.isPermanent ? ' · permanent' : ''}
            </Text>
            <Text style={[s.sub, { marginLeft: 'auto', fontSize: 10.5 }]}>{timeAgo(a.createdAt)}</Text>
          </View>
          {showTarget && (
            <Text style={[s.name, { fontSize: 13, marginTop: 2 }]} numberOfLines={1}>{a.targetName || a.targetEmail || a.targetUid || 'Unknown user'}</Text>
          )}
          <Text style={{ color: c.text, marginTop: 3, fontSize: 12.5, lineHeight: 17 }}>{a.reason || 'No reason recorded'}</Text>
          <Text style={[s.sub, { fontSize: 10.5, marginTop: 3 }]}>
            {`${a.actorName || 'Unknown'}${a.actorRole ? ` · ${a.actorRole.replace('_', ' ')}` : ''} · ${SOURCE_LABEL[a.source] || a.source}`}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!isStaff) {
    return (
      <View style={[s.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="lock-closed-outline" size={44} color={c.textMuted} />
        <Text style={[s.sub, { marginTop: 12 }]}>Staff only.</Text>
      </View>
    );
  }

  const listBottom = { paddingBottom: 60 + insets.bottom };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={s.tabBar}>
        {visibleTabs.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[s.tab, tab === t.key && s.tabActive]}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* admin-only kill switch. An OFF state is a live restriction on the
          whole mod team, so it is tinted rather than left looking idle. */}
      {isAdmin && (
        <View style={[s.switchRow, modControlsEnabled === false && { backgroundColor: tint(HUE.warn, '14'), borderColor: tint(HUE.warn, '55') }]}>
          <Icon name={modControlsEnabled === false ? 'shield-outline' : 'shield-checkmark'} size={18}
            color={modControlsEnabled === false ? HUE.warn : HUE.success} style={{ marginRight: 10 }} />
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.name}>Moderator ban &amp; mute</Text>
            <Text style={s.sub}>{modControlsEnabled !== false ? 'On — moderators can ban and mute' : 'Off — admins only'}</Text>
          </View>
          <Switch value={modControlsEnabled !== false} onValueChange={toggleModControls}
            trackColor={{ false: '#767577', true: HUE.success }} thumbColor="#fff" />
        </View>
      )}

      {/* ── RESTRICTIONS ── */}
      {tab === 'banned' && (
        <View style={{ flex: 1 }}>
          <View style={s.searchRow}>
            <TextInput value={banQuery} onChangeText={setBanQuery}
              placeholder="Search by email prefix…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} style={s.input} />
          </View>
          {pills([['all', 'All'], ['mute', 'Muted'], ['1', 'Strike 1'], ['2', 'Strike 2'], ['3+', 'Permanent']], restrictFilter, setRestrictFilter)}
          <Text style={s.sectionLabel}>
            {searching ? `Search results · ${filteredBans.length}` : `Active restrictions · ${filteredBans.length}${bansHasMore ? '+' : ''}`}
          </Text>
          <FlatList
            data={filteredBans}
            keyExtractor={(i) => i.encodedEmail}
            contentContainerStyle={[s.list, listBottom]}
            refreshControl={<RefreshControl refreshing={bansLoading} onRefresh={refreshBans} tintColor={c.text} />}
            onEndReachedThreshold={0.4}
            onEndReached={() => { if (!searching && bansHasMore && !bansMoreLoading && !bansLoading) loadBans(false); }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.card} onPress={() => openUser(item)} activeOpacity={0.7}>
                <Image source={{ uri: avatarOf(item) }} style={s.avatar} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
                  <Text style={s.sub} numberOfLines={1}>{item.email}</Text>
                  <Text style={[s.sub, { marginTop: 2 }]} numberOfLines={1}>{item.reason}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {restrictionChip(item)}
                  <Text style={[s.sub, { marginTop: 4 }]}>{banRemaining(item.bannedUntil)}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListFooterComponent={bansMoreLoading ? <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} /> : null}
            ListEmptyComponent={!bansLoading && (
              <View style={s.empty}>
                <Icon name="shield-checkmark-outline" size={44} color={c.textMuted} />
                <Text style={s.sub}>{searching ? 'No match for that prefix' : 'No active restrictions'}</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* ── USERS ── */}
      {tab === 'search' && (
        <View style={{ flex: 1 }}>
          <View style={s.searchRow}>
            <TextInput value={userQuery} onChangeText={setUserQuery}
              placeholder="Display name, email or user ID…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search"
              onSubmitEditing={searchUsers} style={s.input} />
            <TouchableOpacity onPress={searchUsers} style={s.searchBtn}>
              <Icon name="search" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          {usersLoading ? <ActivityIndicator style={{ marginTop: 30 }} color={c.primary} /> : (
            <FlatList
              data={users}
              extraData={banStatusTick}
              keyExtractor={(i) => i.id}
              contentContainerStyle={[s.list, listBottom]}
              renderItem={({ item }) => {
                const live = getLiveRestriction(item.email);
                const chip = live?.isActive
                  ? (live.isMute ? statusChip(HUE.mute, 'MUTED') : statusChip(HUE.danger, 'BANNED'))
                  : (live === null || live?.isActive === false ? statusChip(HUE.success, 'ACTIVE') : null);
                return (
                  <TouchableOpacity style={s.card} onPress={() => openUser(item)} activeOpacity={0.7}>
                    <Image source={{ uri: avatarOf(item) }} style={s.avatar} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
                      <Text style={s.sub} numberOfLines={1}>{item.email || item.id || '—'}</Text>
                    </View>
                    {chip}
                    <Icon name="chevron-forward" size={18} color={c.textMuted} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={(
                <View style={s.empty}>
                  <Icon name="search-outline" size={44} color={c.textMuted} />
                  <Text style={s.sub}>{hasSearched ? 'No users found' : 'Search by display name, exact email, or paste a user ID'}</Text>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* ── MOD LOG ── */}
      {tab === 'modLog' && (
        <View style={{ flex: 1 }}>
          {pills([['leaderboard', 'By moderator'], ['feed', 'Recent actions']], modLogView, setModLogView)}
          {pills([[7, '7 days'], [30, '30 days'], [90, '90 days']], modLogDays, setModLogDays)}

          {modLogView === 'leaderboard' ? (
            <FlatList
              data={leaderboard.rows}
              keyExtractor={(r, i) => r.actorUid || `${r.actorName}-${i}`}
              contentContainerStyle={[s.list, listBottom]}
              refreshControl={<RefreshControl refreshing={leaderboardLoading} onRefresh={loadLeaderboard} tintColor={c.text} />}
              ListHeaderComponent={(
                <Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>
                  {`Who moderated how much · last ${modLogDays} days${leaderboard.truncated ? ` · latest ${leaderboard.scanned} actions` : ''}`}
                </Text>
              )}
              renderItem={({ item, index }) => (
                <TouchableOpacity style={s.card} activeOpacity={0.7}
                  onPress={() => { setFeedActor(item.actorUid ? { uid: item.actorUid, name: item.actorName } : null); setModLogView('feed'); }}>
                  <Text style={[s.title, { width: 28, color: c.textMuted }]}>{index + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{item.actorName}{item.actorRole ? `  ·  ${item.actorRole.replace('_', ' ')}` : ''}</Text>
                    <Text style={s.sub}>
                      {`${item.banCount} bans · ${item.strikeCount} strikes · ${item.muteCount} mutes · ${item.unbanCount} unbans${item.reviewDeleteCount ? ` · ${item.reviewDeleteCount} reviews` : ''}`}
                    </Text>
                    <Text style={[s.sub, { marginTop: 2 }]}>{`${item.distinctTargets} user${item.distinctTargets === 1 ? '' : 's'} touched · last ${timeAgo(item.lastActionAt)}`}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.title, { color: c.primary }]}>{item.totalCount}</Text>
                    <Text style={[s.sub, { fontSize: 10 }]}>actions</Text>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={!leaderboardLoading && (
                <View style={s.empty}>
                  <Icon name="analytics-outline" size={44} color={c.textMuted} />
                  <Text style={[s.sub, { textAlign: 'center', paddingHorizontal: 30 }]}>
                    {leaderboard.error ? `Could not load the log.\n${leaderboard.error}` : 'No moderation actions recorded in this window.\nHistory starts from the build that added the audit log.'}
                  </Text>
                </View>
              )}
            />
          ) : (
            <View style={{ flex: 1 }}>
              {pills([[null, 'All'], ['ban', 'Bans'], ['strike', 'Strikes'], ['mute', 'Mutes'], ['unban', 'Unbans'], ['review_delete', 'Reviews'], ['status_delete', 'Statuses']], feedAction, setFeedAction)}
              {feedActor && (
                <TouchableOpacity onPress={() => setFeedActor(null)} style={[s.chipRow]}>
                  <Icon name="person" size={12} color={c.primary} />
                  <Text style={{ color: c.primary, fontSize: 12, fontWeight: '600', marginLeft: 5 }}>{`By ${feedActor.name}`}</Text>
                  <Icon name="close-circle" size={14} color={c.primary} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}
              <FlatList
                data={feed}
                keyExtractor={(a) => a.id}
                contentContainerStyle={[s.list, listBottom]}
                refreshControl={<RefreshControl refreshing={feedLoading && feed.length === 0} onRefresh={() => loadFeed(true)} tintColor={c.text} />}
                onEndReachedThreshold={0.4}
                onEndReached={() => { if (feedHasMore && !feedLoading) loadFeed(false); }}
                renderItem={({ item }) => (
                  <View style={s.panel}>{actionRow(item, true, () => openFromAction(item))}</View>
                )}
                ListFooterComponent={feedLoading && feed.length > 0 ? <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} /> : null}
                ListEmptyComponent={!feedLoading && (
                  <View style={s.empty}>
                    <Icon name="list-outline" size={44} color={c.textMuted} />
                    <Text style={[s.sub, { textAlign: 'center', paddingHorizontal: 30 }]}>
                      {feedError ? `Could not load the log.\n${feedError}` : 'Nothing recorded for these filters.'}
                    </Text>
                  </View>
                )}
              />
            </View>
          )}
        </View>
      )}

      {/* ── POLLS ── */}
      {tab === 'polls' && (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 + insets.bottom }} keyboardShouldPersistTaps="handled"
          // iOS half of keyboard handling; Android resizes the window (adjustResize).
          automaticallyAdjustKeyboardInsets>
          <View style={s.panel}>
            <Text style={[s.name, { marginBottom: 10 }]}>New poll</Text>
            <TextInput value={pollQ} onChangeText={setPollQ}
              placeholder="Question — e.g. Which is worth more?" placeholderTextColor={c.textMuted} multiline
              style={[s.input, { height: 64, paddingTop: 10, textAlignVertical: 'top' }]} />
            <Text style={[s.sectionLabel, { paddingHorizontal: 0 }]}>Options</Text>
            {pollOpts.map((opt, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <TextInput value={opt} onChangeText={(t) => setPollOpts((prev) => prev.map((v, ix) => (ix === i ? t : v)))}
                  placeholder={`Option ${i + 1}`} placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} />
                {pollOpts.length > 2 && (
                  <TouchableOpacity onPress={() => setPollOpts((prev) => prev.filter((_, ix) => ix !== i))}>
                    <Icon name="close-circle" size={22} color={HUE.danger} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {/* Six is PollCard's colour palette length. */}
            {pollOpts.length < 6 && (
              <TouchableOpacity onPress={() => setPollOpts((prev) => [...prev, ''])}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
                <Icon name="add-circle" size={20} color={c.primary} />
                <Text style={{ color: c.primary, fontSize: 13, fontWeight: '600' }}>Add option</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={createPoll} disabled={creatingPoll} style={[s.primaryBtn, { marginTop: 10, opacity: creatingPoll ? 0.6 : 1 }]}>
              {creatingPoll ? <ActivityIndicator color="#fff" /> : (<><Icon name="megaphone" size={17} color="#fff" /><Text style={s.primaryBtnText}>Publish to feed</Text></>)}
            </TouchableOpacity>
          </View>

          <Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>{`Polls · ${polls.length}`}</Text>
          {pollsLoading && <ActivityIndicator color={c.primary} style={{ marginTop: 12 }} />}
          {!pollsLoading && polls.length === 0 && <Text style={[s.sub, { textAlign: 'center', paddingVertical: 20 }]}>No polls yet.</Text>}
          {polls.map((p) => (
            <View key={p.id} style={s.panel}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <View style={[s.statusDot, { backgroundColor: p.active ? HUE.success : '#8E8E93' }]} />
                <Text style={[s.sub, { fontWeight: '700', color: p.active ? HUE.success : c.textMuted }]}>{p.active ? 'LIVE IN FEED' : 'HIDDEN'}</Text>
                <Text style={[s.sub, { marginLeft: 'auto' }]}>{`${p.totalVotes || 0} vote(s)`}</Text>
              </View>
              <Text style={s.name} numberOfLines={2}>{p.question}</Text>
              <View style={{ marginTop: 8, gap: 5 }}>
                {(p.options || []).map((o, i) => {
                  const pct = p.totalVotes > 0 ? Math.round(((o.votes || 0) / p.totalVotes) * 100) : 0;
                  return (
                    <View key={i}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={s.sub} numberOfLines={1}>{o.text}</Text>
                        <Text style={s.sub}>{`${pct}%`}</Text>
                      </View>
                      <View style={s.barTrack}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
                    </View>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity onPress={() => togglePoll(p)} style={[s.smallBtn, { backgroundColor: p.active ? tint(HUE.warn, '18') : tint(HUE.success, '18') }]}>
                  <Icon name={p.active ? 'eye-off' : 'eye'} size={15} color={p.active ? HUE.warn : HUE.success} />
                  <Text style={[s.smallBtnText, { color: p.active ? HUE.warn : HUE.success }]}>{p.active ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deletePoll(p)} style={[s.smallBtn, { backgroundColor: tint(HUE.danger, '18') }]}>
                  <Icon name="trash-outline" size={15} color={HUE.danger} />
                  <Text style={[s.smallBtnText, { color: HUE.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── STATUSES ── */}
      {tab === 'statuses' && (
        <FlatList
          data={statuses}
          keyExtractor={(st) => st.id}
          contentContainerStyle={[s.list, listBottom, { paddingTop: 6 }]}
          refreshControl={<RefreshControl refreshing={statusesLoading && statuses.length === 0} onRefresh={() => loadStatuses(true)} tintColor={c.text} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (statusesMore && !statusesLoading) loadStatuses(false); }}
          renderItem={({ item: st }) => {
            const expired = toMillis(st.expiresAt) && toMillis(st.expiresAt) < Date.now();
            return (
              <View style={s.panel}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                    onPress={() => openUser({ id: st.userId, displayName: st.userName || 'Unknown', avatar: avatarOf(st) })}>
                    <Image source={{ uri: avatarOf(st) }} style={[s.avatar, { width: 34, height: 34, borderRadius: 17 }]} />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>{st.userName || 'Unknown'}</Text>
                      <Text style={s.sub}>{`${timeAgo(st.createdAt)}${expired ? ' · expired' : ''}`}</Text>
                    </View>
                  </TouchableOpacity>
                  {canRemoveContent && (
                    <TouchableOpacity onPress={() => deleteStatus(st)} style={{ padding: 6 }}>
                      <Icon name="trash-outline" size={18} color={HUE.danger} />
                    </TouchableOpacity>
                  )}
                </View>
                {!!st.caption && <Text style={{ color: c.text, marginTop: 8, fontSize: 14, lineHeight: 19 }}>{st.caption}</Text>}
                {!!st.imageUrl && (
                  <TouchableOpacity onPress={() => setPreviewImage(st.imageUrl)} activeOpacity={0.85}>
                    <Image source={{ uri: st.imageUrl }} style={s.statusImage} resizeMode="cover" />
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListFooterComponent={statusesLoading && statuses.length > 0 ? <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} /> : null}
          ListEmptyComponent={!statusesLoading && (
            <View style={s.empty}>
              <Icon name="images-outline" size={44} color={c.textMuted} />
              <Text style={s.sub}>No statuses.</Text>
            </View>
          )}
        />
      )}

      {/* ── CHATS ── */}
      {tab === 'chats' && isAdmin && (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 + insets.bottom }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {personPicker(0, 'User 1')}
          {personPicker(1, 'User 2')}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => loadChat(true)} style={[s.primaryBtn, { flex: 1 }]}>
              <Icon name="chatbubbles" size={16} color="#fff" />
              <Text style={s.primaryBtnText}>View conversation</Text>
            </TouchableOpacity>
            {chatRows && (
              <TouchableOpacity onPress={deleteConversation} style={[s.primaryBtn, { backgroundColor: HUE.danger, paddingHorizontal: 14 }]}>
                <Icon name="trash-outline" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {chatLoading && <ActivityIndicator style={{ marginTop: 20 }} color={c.primary} />}

          {chatRows && !chatLoading && (
            <View style={{ marginTop: 8 }}>
              {chatHasOlder ? (
                <TouchableOpacity onPress={() => loadChat(false)} disabled={chatOlderLoading} style={{ alignItems: 'center', paddingVertical: 10 }}>
                  {chatOlderLoading ? <ActivityIndicator color={c.primary} /> : <Text style={{ color: c.primary, fontWeight: '600', fontSize: 12.5 }}>Load older messages</Text>}
                </TouchableOpacity>
              ) : chatRows.rows.length > 0 && (
                <Text style={[s.sub, { textAlign: 'center', paddingVertical: 8 }]}>Beginning of conversation</Text>
              )}
              {chatRows.rows.length === 0 && (
                <Text style={[s.sub, { textAlign: 'center', marginTop: 24 }]}>No messages between these two users.</Text>
              )}
              {chatRows.rows.map((m) => {
                const mine = m.senderId === chatRows.a.id;
                const who = mine ? chatRows.a.displayName : chatRows.b.displayName;
                const imgs = Array.isArray(m.imageUrls) && m.imageUrls.length ? m.imageUrls : (m.imageUrl ? [m.imageUrl] : []);
                const quoted = m.replyTo && (m.replyTo.text || m.replyTo.message);
                return (
                  <View key={m.id} style={[s.bubble, mine ? s.bubbleA : s.bubbleB]}>
                    <Text style={s.bubbleWho}>{who}</Text>
                    {!!quoted && (
                      <View style={s.quote}><Text style={[s.sub, { fontStyle: 'italic' }]} numberOfLines={2}>{quoted}</Text></View>
                    )}
                    {!!m.text && <Text style={s.bubbleText}>{m.text}</Text>}
                    {imgs.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {imgs.map((url) => (
                          <TouchableOpacity key={url} onPress={() => setPreviewImage(url)} activeOpacity={0.85}>
                            <Image source={{ uri: url }} style={{ width: imgs.length > 1 ? 90 : 180, height: imgs.length > 1 ? 90 : 180, borderRadius: 8, backgroundColor: c.border }} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {Array.isArray(m.fruits) && m.fruits.length > 0 && <Text style={s.sub}>{`[${m.fruits.length} item(s) attached]`}</Text>}
                    <Text style={s.bubbleTime}>{m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── USER CHATS ── */}
      {tab === 'userChats' && isAdmin && (
        <View style={{ flex: 1 }}>
          {ucTarget ? (
            <View style={[s.card, { marginHorizontal: 12 }]}>
              <Image source={{ uri: avatarOf(ucTarget) }} style={s.avatar} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.name} numberOfLines={1}>{ucTarget.displayName}</Text>
                <Text style={s.sub} numberOfLines={1}>{ucTarget.email || ucTarget.id}</Text>
              </View>
              <TouchableOpacity onPress={() => { setUcTarget(null); setUcList([]); }}>
                <Icon name="close-circle" size={22} color={c.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.searchRow}>
              <TextInput value={ucInput} onChangeText={setUcInput} placeholder="Name, email or user ID…"
                placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
                onSubmitEditing={findUcTarget} style={s.input} />
              <TouchableOpacity onPress={findUcTarget} style={s.searchBtn}><Icon name="search" size={18} color="#fff" /></TouchableOpacity>
            </View>
          )}
          {ucPick.length > 0 && !ucTarget && (
            <FlatList data={ucPick} keyExtractor={(u) => u.id} contentContainerStyle={s.list}
              ListHeaderComponent={<Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>Which one?</Text>}
              renderItem={({ item: u }) => (
                <TouchableOpacity style={s.card} onPress={() => pickUcTarget(u)}>
                  <Image source={{ uri: avatarOf(u) }} style={s.avatar} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.name} numberOfLines={1}>{u.displayName}</Text>
                    <Text style={s.sub} numberOfLines={1}>{u.email || u.id}</Text>
                  </View>
                </TouchableOpacity>
              )} />
          )}
          {ucTarget && (
            <FlatList
              data={ucList}
              keyExtractor={(r) => r.partnerId}
              contentContainerStyle={[s.list, listBottom]}
              refreshControl={<RefreshControl refreshing={ucLoading && ucList.length === 0} onRefresh={() => loadUserChats(ucTarget, true)} tintColor={c.text} />}
              onEndReachedThreshold={0.4}
              onEndReached={() => { if (ucHasMore && !ucLoading) loadUserChats(ucTarget, false); }}
              ListHeaderComponent={<Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>{`Conversations · ${ucList.length}${ucHasMore ? '+' : ''}`}</Text>}
              renderItem={({ item: r }) => (
                <TouchableOpacity style={s.card} onPress={() => openChatFromUserChats(r)} activeOpacity={0.7}>
                  <Image source={{ uri: r.partnerAvatar }} style={s.avatar} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.name} numberOfLines={1}>{r.partnerName}</Text>
                    <Text style={s.sub} numberOfLines={1}>{r.lastMessage || '—'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.sub}>{timeAgo(r.timestamp)}</Text>
                    {r.unreadCount > 0 && <Text style={[s.sub, { color: c.primary, fontWeight: '700' }]}>{`${r.unreadCount} unread`}</Text>}
                  </View>
                </TouchableOpacity>
              )}
              ListFooterComponent={ucLoading && ucList.length > 0 ? <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} /> : null}
              ListEmptyComponent={!ucLoading && <View style={s.empty}><Text style={s.sub}>No private chats.</Text></View>}
            />
          )}
          {!ucTarget && ucPick.length === 0 && (
            <View style={s.empty}>
              <Icon name="chatbox-ellipses-outline" size={44} color={c.textMuted} />
              <Text style={[s.sub, { textAlign: 'center', paddingHorizontal: 30 }]}>Find a user to list every private conversation they have. Tap one to read it.</Text>
              {ucLoading && <ActivityIndicator color={c.primary} />}
            </View>
          )}
        </View>
      )}

      {/* ── ACCESS ── */}
      {tab === 'access' && isAdmin && (
        <View style={{ flex: 1 }}>
          <Text style={[s.sub, { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8 }]}>
            Anyone listed here can make and remove Junior Mods. It grants no other power.
          </Text>
          <View style={s.searchRow}>
            <TextInput value={grantQuery} onChangeText={setGrantQuery}
              placeholder="Name, email or user ID to grant…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={searchGrant} style={s.input} />
            <TouchableOpacity onPress={searchGrant} style={s.searchBtn}><Icon name="search" size={18} color="#fff" /></TouchableOpacity>
          </View>
          <FlatList
            data={granters}
            keyExtractor={(i) => i.id}
            contentContainerStyle={[s.list, listBottom]}
            refreshControl={<RefreshControl refreshing={grantersLoading} onRefresh={loadGranters} tintColor={c.text} />}
            ListHeaderComponent={grantResults.length > 0 ? (
              <View>
                <Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>Matches</Text>
                {grantResults.map((u) => (
                  <View key={u.id} style={s.card}>
                    <Image source={{ uri: avatarOf(u) }} style={s.avatar} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.name} numberOfLines={1}>{u.displayName}</Text>
                      <Text style={s.sub} numberOfLines={1}>{u.email || u.id}</Text>
                    </View>
                    <TouchableOpacity onPress={() => grantJmd(u)} style={[s.revokeBtn, { backgroundColor: tint(HUE.success, '15'), borderColor: tint(HUE.success, '40') }]}>
                      <Text style={[s.revokeText, { color: HUE.success }]}>Grant</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <Text style={[s.sectionLabel, { paddingHorizontal: 2 }]}>Granted</Text>
              </View>
            ) : null}
            renderItem={({ item }) => (
              <View style={s.card}>
                <Image source={{ uri: avatarOf(item) }} style={s.avatar} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
                  <Text style={s.sub} numberOfLines={1}>{item.grantedAt ? `Granted ${timeAgo(item.grantedAt)}` : item.id}</Text>
                </View>
                <TouchableOpacity onPress={() => revokeJmd(item)} style={s.revokeBtn}><Text style={s.revokeText}>Revoke</Text></TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={!grantersLoading && grantResults.length === 0 && (
              <View style={s.empty}><Text style={s.sub}>Nobody has this permission yet.</Text></View>
            )}
          />
        </View>
      )}

      {/* ── USER PROFILE SHEET ── */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}
        presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}>
        <View style={[s.root, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top }]}>
          {merged && (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
              <View style={s.modalHead}>
                <Text style={s.title}>User</Text>
                <TouchableOpacity onPress={() => setSelected(null)}><Icon name="close-circle" size={28} color={c.textMuted} /></TouchableOpacity>
              </View>

              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <Image source={{ uri: avatarOf(merged) }} style={s.avatarLarge} />
                <Text style={[s.title, { marginTop: 10 }]}>{merged.displayName}</Text>
                <Text style={s.sub}>{merged.email || 'no email on record'}</Text>
                <View style={s.pillWrap}>
                  {merged.isAdmin && <UserBadgePill type="admin" size="sm" isDarkMode={isDark} />}
                  {!merged.isAdmin && merged.isModerator && <UserBadgePill type="mod" size="sm" isDarkMode={isDark} />}
                  {!merged.isAdmin && !merged.isModerator && merged.isBabyMod && <UserBadgePill type="jmd" size="sm" isDarkMode={isDark} />}
                  {merged.isTrusted && <UserBadgePill type="trusted" size="sm" isDarkMode={isDark} />}
                  {merged.isCMSR && <UserBadgePill type="cmsr" size="sm" isDarkMode={isDark} />}
                  {merged.isHelper && <UserBadgePill type="helper" size="sm" isDarkMode={isDark} />}
                  {merged.isPro && statusChip(HUE.gold, 'PRO')}
                </View>
                {!!merged.id && (
                  <TouchableOpacity style={s.copyRow} onPress={() => { Clipboard.setString(merged.id); Alert.alert('Copied', 'User ID copied.'); }}>
                    <Icon name="copy-outline" size={13} color={c.textMuted} />
                    <Text style={[s.sub, { marginLeft: 6 }]} numberOfLines={1}>{merged.id}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {detailLoading && <ActivityIndicator color={c.primary} style={{ marginBottom: 12 }} />}

              {/* facts strip */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {[
                  { icon: 'calendar-outline', hue: c.textMuted, value: merged.createdAt ? new Date(toMillis(merged.createdAt) || merged.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—', label: 'Member since' },
                  { icon: 'star', hue: HUE.gold, value: ratingSummary ? ratingSummary.average.toFixed(1) : '—', label: `${ratingSummary?.count || 0} review${(ratingSummary?.count || 0) === 1 ? '' : 's'}` },
                  { icon: 'game-controller-outline', hue: c.textMuted, value: merged.robloxUsername || '—', label: 'Roblox' },
                ].map((f) => (
                  <View key={f.label} style={s.fact}>
                    <Icon name={f.icon} size={14} color={f.hue} />
                    <Text style={[s.name, { fontSize: 13, marginTop: 5 }]} numberOfLines={1}>{f.value}</Text>
                    <Text style={[s.sub, { fontSize: 10, marginTop: 1 }]} numberOfLines={1}>{f.label}</Text>
                  </View>
                ))}
              </View>

              {/* reviews */}
              <View style={s.panel}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: reviews.length ? 10 : 0 }}>
                  <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 0, paddingHorizontal: 0, flex: 1 }]}>Reviews received</Text>
                  {reviews.length === 0 && !reviewsLoading && <Text style={s.sub}>None</Text>}
                </View>
                {reviews.map((rv) => {
                  const rating = Number(rv.rating) || 0;
                  const text = strOr(rv.review, null) || strOr(rv.comment, null) || strOr(rv.text, null);
                  const reviewer = strOr(rv.userName, null) || strOr(rv.reviewerName, null);
                  return (
                    <View key={rv.id} style={s.reviewCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: HUE.gold, fontSize: 13, fontWeight: '700' }}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(rating))))}<Text style={{ color: c.textMuted }}>{'☆'.repeat(Math.max(0, 5 - Math.round(rating)))}</Text></Text>
                        <Text style={[s.sub, { marginLeft: 6 }]}>{rating}</Text>
                        <Text style={[s.sub, { marginLeft: 'auto', fontSize: 11 }]}>{fmtDate(rv.updatedAt) || fmtDate(rv.createdAt) || ''}</Text>
                        {canRemoveContent && (
                          <TouchableOpacity onPress={() => deleteReview(rv)} style={{ marginLeft: 10, padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Icon name="trash-outline" size={17} color={HUE.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={{ color: c.text, marginTop: 5, fontSize: 13, lineHeight: 18 }}>{text || 'No comment'}</Text>
                      <TouchableOpacity disabled={!rv.fromUserId} onPress={() => openUser({ id: rv.fromUserId, displayName: reviewer || 'Reviewer', avatar: DEFAULT_AVATAR })}>
                        <Text style={[s.sub, { marginTop: 4, color: rv.fromUserId ? c.primary : c.textMuted }]}>{`— ${reviewer || 'Unknown reviewer'}`}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {reviewsLoading && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
                {reviewsHasMore && !reviewsLoading && (
                  <TouchableOpacity onPress={() => fetchReviews(merged.id, false)} style={{ alignItems: 'center', paddingTop: 10 }}>
                    <Text style={{ color: c.primary, fontWeight: '600', fontSize: 12.5 }}>Load more reviews</Text>
                  </TouchableOpacity>
                )}
                {!canRemoveContent && reviews.length > 0 && (
                  <Text style={[s.sub, { marginTop: 8, fontSize: 10.5 }]}>Only admins and moderators can remove reviews.</Text>
                )}
              </View>

              {/* moderation record */}
              <View style={s.panel}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={[s.sectionLabel, { marginTop: 0, marginBottom: 0, paddingHorizontal: 0, flex: 1 }]}>Moderation record</Text>
                  {modCounts?.totalCount > 0 && <Text style={s.sub}>{`${modCounts.totalCount} action${modCounts.totalCount === 1 ? '' : 's'}`}</Text>}
                </View>

                {sanction && (() => {
                  const hue = !sanction.isActive ? HUE.success : sanction.kind === 'mute' ? HUE.mute : sanction.strikeCount >= 3 ? HUE.danger : sanction.strikeCount === 2 ? HUE.warnMid : HUE.warn;
                  return (
                    <View style={[s.sanctionBox, { backgroundColor: tint(hue, '12'), borderColor: tint(hue, '33') }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[s.chip, { backgroundColor: hue, borderColor: hue }]}>
                          <Text style={[s.chipText, { color: '#fff' }]}>{!sanction.isActive ? 'EXPIRED' : sanction.kind === 'mute' ? 'MUTED' : `STRIKE ${sanction.strikeCount}`}</Text>
                        </View>
                        <Text style={[s.name, { fontSize: 12, marginLeft: 8, flex: 1 }]} numberOfLines={1}>
                          {sanction.bannedUntil === 'permanent' ? 'Permanent' : sanction.isActive ? `Until ${new Date(sanction.bannedUntil).toLocaleString()}` : `Ended ${timeAgo(sanction.bannedUntil)}`}
                        </Text>
                      </View>
                      <Text style={{ color: c.text, marginTop: 6, fontSize: 13, lineHeight: 18 }}>{sanction.reason || 'No reason recorded'}</Text>
                      <Text style={[s.sub, { marginTop: 3 }]}>{`${sanction.appliedBy ? `By ${sanction.appliedBy}` : 'Applied by unknown'}${sanction.appliedAt ? ` · ${timeAgo(sanction.appliedAt)}` : ''}`}</Text>
                    </View>
                  );
                })()}

                {modCounts && (
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                    {[
                      ['Mutes', modCounts.muteCount, HUE.mute], ['Strikes', modCounts.strikeCount, HUE.warn],
                      ['Bans', modCounts.banCount, HUE.danger], ['Unbans', modCounts.unbanCount, HUE.success],
                      ['Reviews', modCounts.reviewDeleteCount, HUE.gold],
                    ].map(([label, value, hue]) => (
                      <View key={label} style={[s.tally, value > 0 && { backgroundColor: tint(hue, '12'), borderColor: tint(hue, '33') }]}>
                        <Text style={{ fontSize: 16, fontWeight: '800', color: value > 0 ? hue : c.textMuted }}>{value}</Text>
                        <Text style={[s.sub, { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' }]}>{label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {modHistoryLoading && modHistory.length === 0 ? (
                  <ActivityIndicator color={c.primary} style={{ marginVertical: 10 }} />
                ) : modHistoryError ? (
                  <Text style={[s.sub, { textAlign: 'center', paddingVertical: 10 }]}>{`Could not load history.\n${modHistoryError}`}</Text>
                ) : modHistory.length === 0 ? (
                  <Text style={[s.sub, { textAlign: 'center', paddingVertical: 10, lineHeight: 17 }]}>
                    No recorded actions yet.{'\n'}History starts from the build that added the audit log.
                  </Text>
                ) : (
                  <>
                    {modHistory.map((a) => actionRow(a, false, () => {}))}
                    {modHistoryHasMore && (
                      <TouchableOpacity onPress={() => fetchModRecord(merged.email, merged.id, false)} disabled={modHistoryLoading} style={{ alignItems: 'center', paddingTop: 10 }}>
                        {modHistoryLoading ? <ActivityIndicator color={c.primary} /> : <Text style={{ color: c.primary, fontWeight: '600', fontSize: 12.5 }}>Load older actions</Text>}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>

              {/* actions — reading first, acting last */}
              <View style={s.panel}>
                <Text style={[s.sectionLabel, { marginTop: 0, paddingHorizontal: 0 }]}>Moderation actions</Text>

                {sanction?.isActive ? (
                  <TouchableOpacity style={[s.primaryBtn, { backgroundColor: HUE.success }]} onPress={() => requestAction('unban', null, merged)}>
                    <Icon name="checkmark-circle-outline" size={17} color="#fff" />
                    <Text style={s.primaryBtnText}>{sanction.kind === 'mute' ? 'Remove mute' : 'Unban'}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.primaryBtn, { backgroundColor: HUE.danger }]} onPress={() => requestAction('ban', null, merged)}>
                    <Icon name="ban-outline" size={17} color="#fff" />
                    <Text style={s.primaryBtnText}>Ban</Text>
                  </TouchableOpacity>
                )}

                {(isAdmin || isModerator) && (
                  <>
                    <Text style={[s.sectionLabel, { paddingHorizontal: 0 }]}>Apply strike — escalates the ladder</Text>
                    <View style={s.rowGap}>
                      {STRIKE_TIERS.map((t) => (
                        <TouchableOpacity key={t.count} style={[s.strikeBtn, { backgroundColor: t.color }]} onPress={() => requestAction('strike', t.count, merged)}>
                          <Text style={s.strikeText}>{t.label}</Text>
                          <Text style={s.strikeSub}>{t.duration}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <Text style={[s.sectionLabel, { paddingHorizontal: 0 }]}>
                  {isJuniorOnly ? 'Mute (capped at 2h for Junior Mods) — adds no strike' : 'Mute — temporary silence, adds no strike'}
                </Text>
                <View style={s.wrapRow}>
                  {[5, 15, 30, 60, 120, 360].map((m) => (
                    <TouchableOpacity key={m} style={s.muteChip} onPress={() => requestAction('mute', m, merged)}>
                      <Text style={s.muteText}>{m >= 60 ? `${m / 60}h` : `${m}m`}</Text>
                    </TouchableOpacity>
                  ))}
                  <View style={[s.muteChip, { flexDirection: 'row', alignItems: 'center' }]}>
                    <TextInput value={customMute} onChangeText={setCustomMute} placeholder="min"
                      placeholderTextColor={c.textMuted} keyboardType="number-pad" maxLength={4}
                      style={{ color: c.text, minWidth: 34, padding: 0 }} />
                    <TouchableOpacity onPress={() => { const n = parseInt(customMute, 10); if (n > 0) { requestAction('mute', n, merged); setCustomMute(''); } }}>
                      <Icon name="arrow-forward-circle" size={18} color={c.primary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {(isAdmin || isModerator || canGrantJmd) && (
                  <>
                    <Text style={[s.sectionLabel, { paddingHorizontal: 0 }]}>Roles</Text>
                    <View style={s.wrapRow}>
                      {isAdmin && (
                        <RoleChip label={merged.isModerator ? 'Remove Mod' : 'Make Mod'} color="#8B5CF6" s={s}
                          onPress={() => doRole(merged.isModerator ? removeModerator : makeModerator, merged.isModerator ? 'Remove Moderator' : 'Make Moderator')} />
                      )}
                      {(isAdmin || canGrantJmd) && (
                        <RoleChip label={merged.isBabyMod ? 'Remove JMD' : 'Make JMD'} color="#F59E0B" s={s}
                          onPress={() => doRole(merged.isBabyMod ? removeBabyMod : makeBabyMod, merged.isBabyMod ? 'Remove Junior Mod' : 'Make Junior Mod')} />
                      )}
                      {(isAdmin || isModerator) && (
                        <>
                          <RoleChip label={merged.isTrusted ? 'Remove Trusted' : 'Make Trusted'} color="#10B981" s={s}
                            onPress={() => doRole(merged.isTrusted ? removeTrusted : makeTrusted, merged.isTrusted ? 'Remove Trusted' : 'Make Trusted')} />
                          <RoleChip label={merged.isCMSR ? 'Remove CMSR' : 'Make CMSR'} color="#F97316" s={s}
                            onPress={() => doRole(merged.isCMSR ? removeCMSR : makeCMSR, merged.isCMSR ? 'Remove CMSR' : 'Make CMSR')} />
                          <RoleChip label={merged.isHelper ? 'Remove Helper' : 'Make Helper'} color="#14B8A6" s={s}
                            onPress={() => doRole(merged.isHelper ? removeHelper : makeHelper, merged.isHelper ? 'Remove Helper' : 'Make Helper')} />
                        </>
                      )}
                    </View>
                  </>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── REASON PROMPT ── every punitive action passes through here. */}
      <Modal visible={!!pendingAction} transparent animationType="fade" onRequestClose={() => setPendingAction(null)}>
        <View style={[s.overlay, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}>
          <View style={s.dialog}>
            {pendingAction && (() => {
              const { type, value, target } = pendingAction;
              const title = type === 'ban' ? 'Ban user' : type === 'unban' ? 'Lift restriction' : type === 'mute' ? `Mute for ${value} min` : `Apply strike ${value}`;
              const consequence = type === 'strike' ? (STRIKE_TIERS.find((t) => t.count === value)?.duration || '')
                : type === 'ban' ? 'Escalates on the strike ladder (3h → 3d → permanent)'
                  : type === 'mute' ? `Silenced for ${value} minute${value === 1 ? '' : 's'}, no strike`
                    : 'Clears the current ban or mute';
              return (
                <>
                  <Text style={s.title}>{title}</Text>
                  <Text style={[s.sub, { marginTop: 4 }]} numberOfLines={1}>{`${target?.displayName || 'User'} · ${target?.email || '—'}`}</Text>
                  <Text style={[s.sub, { marginTop: 8 }]}>{consequence}</Text>
                  <TextInput value={actionReason} onChangeText={setActionReason}
                    placeholder="Reason (shown in this user's history)" placeholderTextColor={c.textMuted}
                    multiline maxLength={300}
                    style={[s.input, { marginTop: 14, minHeight: 72, height: undefined, paddingTop: 10, textAlignVertical: 'top' }]} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {QUICK_REASONS.map((r) => (
                      <TouchableOpacity key={r} onPress={() => setActionReason(r)} style={[s.pill, actionReason === r && s.pillActive]}>
                        <Text style={[s.pillText, actionReason === r && s.pillTextActive]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                    <TouchableOpacity disabled={actionBusy} onPress={() => { setPendingAction(null); setActionReason(''); }} style={[s.dialogBtn, { backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border }]}>
                      <Text style={{ fontWeight: '600', color: c.text }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={actionBusy} onPress={confirmPendingAction} style={[s.dialogBtn, { backgroundColor: type === 'unban' ? HUE.success : HUE.danger, opacity: actionBusy ? 0.7 : 1 }]}>
                      {actionBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ fontWeight: '700', color: '#fff' }}>Confirm</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── IMAGE PREVIEW ── */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setPreviewImage(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
          {!!previewImage && <Image source={{ uri: previewImage }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
          <TouchableOpacity onPress={() => setPreviewImage(null)} style={{ position: 'absolute', top: 16 + insets.top, right: 20, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 }}>
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const RoleChip = ({ label, color, onPress, s }) => (
  <TouchableOpacity onPress={onPress} style={[s.roleChip, { backgroundColor: `${color}18`, borderColor: `${color}55` }]}>
    <Text style={[s.roleChipText, { color }]}>{label}</Text>
  </TouchableOpacity>
);

const makeStyles = (c, isDark) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  tabBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.border },
  tabActive: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border },
  searchRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, backgroundColor: c.bgAlt, color: c.text, borderWidth: 1, borderColor: c.border },
  searchBtn: { width: 44, height: 42, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: c.border },
  pillActive: { backgroundColor: c.primary, borderColor: c.primary },
  pillText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  pillTextActive: { color: '#fff' },
  chipRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: `${c.primary}18` },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: c.textMuted, marginTop: 14, marginBottom: 8, paddingHorizontal: 14 },
  list: { paddingHorizontal: 12 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, marginBottom: 8, backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border },
  panel: { padding: 14, borderRadius: 14, backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.border },
  avatarLarge: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.border },
  name: { fontSize: 15, fontWeight: '600', color: c.text },
  sub: { fontSize: 12, color: c.textMuted },
  title: { fontSize: 19, fontWeight: '700', color: c.text },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  empty: { alignItems: 'center', marginTop: 60, gap: 10 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center', marginTop: 8, alignItems: 'center' },
  copyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: c.bgAlt, maxWidth: '90%' },
  fact: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border },
  reviewCard: { padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  sanctionBox: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  tally: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  timelineRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 12, backgroundColor: c.primary },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowGap: { flexDirection: 'row', gap: 8 },
  strikeBtn: { flex: 1, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  strikeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  strikeSub: { color: '#fff', fontSize: 10, opacity: 0.9 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  muteChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border },
  muteText: { fontSize: 13, fontWeight: '600', color: c.text },
  roleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  roleChipText: { fontSize: 12, fontWeight: '700' },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#FF3B3015', borderWidth: 1, borderColor: '#FF3B3040' },
  revokeText: { fontSize: 12, fontWeight: '700', color: '#FF3B30' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: c.border, marginTop: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: c.primary },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  smallBtnText: { fontSize: 12, fontWeight: '700' },
  statusImage: { width: '100%', height: 220, borderRadius: 10, marginTop: 8, backgroundColor: c.border },
  bubble: { maxWidth: '85%', padding: 10, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: c.border },
  bubbleA: { alignSelf: 'flex-end', backgroundColor: isDark ? '#0A3D62' : '#DCF8C6' },
  bubbleB: { alignSelf: 'flex-start', backgroundColor: c.bgAlt },
  bubbleWho: { fontSize: 10, fontWeight: '700', color: c.textMuted, marginBottom: 3 },
  bubbleText: { fontSize: 14, color: c.text, lineHeight: 19 },
  bubbleTime: { fontSize: 10, color: c.textMuted, marginTop: 5, textAlign: 'right' },
  quote: { borderLeftWidth: 3, borderLeftColor: c.primary, paddingLeft: 8, marginBottom: 6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 },
  dialog: { backgroundColor: c.bg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: c.border },
  dialogBtn: { flex: 1, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
});

export default AdminDashboard;
