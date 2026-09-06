/**
 * AdminDashboard.js — moderation console.
 *
 * Ported from adoptme-jan7 2026-09-06 (PLAN_2026-09.md P8/P9) and rewritten
 * for RTDB. Adopt Me's version reaches for Supabase in three places — user
 * search by name, the private-chat viewer, and the per-user chat list — and
 * MM2 has no Supabase, so each one is a different query here:
 *
 *   name search   → RTDB users.orderByChild('displayName') prefix range
 *   chat viewer   → RTDB private_messages/{chatKey}/messages
 *   user chats    → RTDB chat_meta_data/{uid}
 *
 * Every list is bounded. The banned list is the 25 most recent rather than
 * the whole node, and search is a server-side range query rather than a
 * download-and-filter, because /banned_users_by_email and /users are large
 * enough that "just fetch it all" is how you get a surprise egress bill.
 *
 * Permissions:
 *   admin      everything
 *   moderator  ban / mute / strike (unless an admin flips the kill switch),
 *              plus Trusted / CMSR / Helper badges
 *   junior mod mute only, capped at 2h
 * Enforcement lives in database.rules.json; this screen only decides what to
 * show. A gate here is a courtesy, not a security boundary.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image, Modal,
  ActivityIndicator, StyleSheet, ScrollView, RefreshControl, Alert,
  Switch, Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  getDatabase, ref, get, set, query,
  orderByChild, orderByKey, startAt, endAt, limitToFirst, limitToLast,
} from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import {
  unbanUserWithEmail, banUserwithEmail, setUserStrike, muteUser, canStaffBanMute,
  makeModerator, removeModerator, makeBabyMod, removeBabyMod,
  makeTrusted, removeTrusted, makeCMSR, removeCMSR, makeHelper, removeHelper,
  encodeEmailForBan,
} from '../ChatScreen/utils';
import { getOrFetchFullProfile, invalidateFullProfile } from '../Helper/profileCache';
import UserBadgePill from '../Helper/UserBadgePill';

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const RECENT_BANS = 25;
const SEARCH_LIMIT = 25;
const CHAT_PAGE = 200;

// Keys that accumulated in banned_users_by_email from older buggy writes.
const BAD_KEYS = new Set(['undefined', 'null', 'onloaduser', '']);

const decodeEmail = (k) => (k ? String(k).replace(/\(dot\)/g, '.') : '');
// RTDB rejects these in a key, and a stray one turns a query into an error.
const sanitize = (q) => String(q || '').replace(/[.#$[\]/\\]/g, '');
const looksLikeUid = (v) => typeof v === 'string' && v.length >= 15 && /^[A-Za-z0-9]+$/.test(v);
const avatarOf = (o) => (o && o.avatar) || DEFAULT_AVATAR;

const timeAgo = (ms) => {
  if (!ms) return '';
  const d = Date.now() - Number(ms);
  if (d < 0) return '';
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const banRemaining = (bannedUntil) => {
  if (bannedUntil === 'permanent') return 'Permanent';
  if (typeof bannedUntil !== 'number') return '—';
  const diff = bannedUntil - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const TABS = [
  { key: 'banned', label: 'Banned', adminOnly: false },
  { key: 'search', label: 'Users', adminOnly: false },
  { key: 'chats', label: 'Chats', adminOnly: true },
  { key: 'access', label: 'Access', adminOnly: true },
];

const AdminDashboard = () => {
  const { theme, user, isAdmin, modControlsEnabled, canGrantJmd } = useGlobalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const insets = useSafeAreaInsets();
  const db = useMemo(() => getDatabase(), []);

  const isModerator = !!user?.isModerator;
  const isBabyMod = !!user?.isBabyMod;
  const isStaff = isAdmin || isModerator || isBabyMod;
  const canBanMute = canStaffBanMute({ isAdmin, isModerator, isBabyMod, modControlsEnabled });

  const visibleTabs = useMemo(() => TABS.filter((t) => !t.adminOnly || isAdmin), [isAdmin]);
  const [tab, setTab] = useState('banned');

  // ── Banned list ──────────────────────────────────────────────────────
  const [bans, setBans] = useState([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banQuery, setBanQuery] = useState('');
  const [strikeFilter, setStrikeFilter] = useState('all');
  const [searching, setSearching] = useState(false);

  const rowsFromSnapshot = useCallback((snap) => {
    if (!snap.exists()) return [];
    const out = [];
    const now = Date.now();
    snap.forEach((child) => {
      const key = child.key;
      if (BAD_KEYS.has(key)) return;
      const v = child.val() || {};
      const strikes = v.strikeCount || 0;
      const until = v.bannedUntil;
      // An expired temporary ban is not an active one; showing it makes the
      // list mostly noise.
      if (until !== 'permanent' && typeof until === 'number' && until < now) return;
      out.push({
        encodedEmail: key,
        email: v.email || decodeEmail(key),
        id: v.userId || null,
        displayName: v.displayName || 'Unknown',
        avatar: avatarOf(v),
        strikeCount: strikes,
        bannedUntil: until ?? null,
        reason: v.reason || '—',
        bannedAt: v.bannedAt || null,
        bannedBy: typeof v.bannedBy === 'string' ? v.bannedBy : (v.bannedBy?.displayName || 'Unknown'),
        isBanned: true,
      });
    });
    return out.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
  }, []);

  const loadRecentBans = useCallback(async () => {
    setBansLoading(true);
    try {
      // Needs .indexOn ["bannedAt"] on banned_users_by_email, which
      // database.rules.json now declares. Without it RTDB sorts the whole
      // node in memory on every open.
      const snap = await get(query(ref(db, 'banned_users_by_email'), orderByChild('bannedAt'), limitToLast(RECENT_BANS)));
      setBans(rowsFromSnapshot(snap));
    } catch (e) {
      Alert.alert('Error', 'Could not load bans. Check your permissions.');
    } finally {
      setBansLoading(false);
    }
  }, [db, rowsFromSnapshot]);

  const searchBans = useCallback(async (prefix) => {
    const p = String(prefix || '').trim().toLowerCase();
    if (!p) return loadRecentBans();
    setBansLoading(true);
    try {
      // Keys ARE the encoded email, so a key range gives a prefix match for
      // free — no scan, no client-side filter.
      const enc = encodeEmailForBan(p);
      const snap = await get(query(
        ref(db, 'banned_users_by_email'),
        orderByKey(), startAt(enc), endAt(`${enc}`), limitToFirst(50),
      ));
      setBans(rowsFromSnapshot(snap));
    } catch (e) {
      Alert.alert('Error', 'Search failed.');
    } finally {
      setBansLoading(false);
    }
  }, [db, rowsFromSnapshot, loadRecentBans]);

  useEffect(() => { loadRecentBans(); }, [loadRecentBans]);

  useEffect(() => {
    const t = banQuery.trim();
    if (!t) {
      if (searching) { setSearching(false); loadRecentBans(); }
      return;
    }
    setSearching(true);
    const h = setTimeout(() => searchBans(t), 300);
    return () => clearTimeout(h);
  }, [banQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBans = useMemo(() => {
    if (strikeFilter === 'all') return bans;
    if (strikeFilter === '3+') return bans.filter((b) => b.strikeCount >= 3);
    return bans.filter((b) => b.strikeCount === Number(strikeFilter));
  }, [bans, strikeFilter]);

  // ── User search ──────────────────────────────────────────────────────
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchUsers = useCallback(async () => {
    const raw = userQuery.trim();
    if (!raw) return;
    Keyboard.dismiss();
    setUsersLoading(true);
    setHasSearched(true);
    try {
      const results = [];
      const seen = new Set();

      const push = (id, u) => {
        if (!id || seen.has(id) || BAD_KEYS.has(id)) return;
        seen.add(id);
        results.push({
          id,
          displayName: u.displayName || u.userName || 'Unknown',
          email: u.email || u.decodedEmail || null,
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
      };

      if (looksLikeUid(raw)) {
        // Direct key lookup — one read, no query.
        const snap = await get(ref(db, `users/${raw}`));
        if (snap.exists()) push(raw, snap.val());
      }

      if (results.length === 0) {
        // Indexed prefix range on displayName. Two casings because RTDB
        // orders by byte value, so 'ab' and 'Ab' sit in different places.
        const name = sanitize(raw);
        const variants = [...new Set([name.toLowerCase(), name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(), name])];
        for (const v of variants) {
          if (!v || results.length >= SEARCH_LIMIT) break;
          const snap = await get(query(
            ref(db, 'users'), orderByChild('displayName'),
            startAt(v), endAt(`${v}`), limitToFirst(SEARCH_LIMIT),
          ));
          if (snap.exists()) snap.forEach((ch) => push(ch.key, ch.val() || {}));
        }
      }

      setUsers(results.slice(0, SEARCH_LIMIT));
    } catch (e) {
      Alert.alert('Search failed', e?.message || 'Try a display name or a user ID.');
    } finally {
      setUsersLoading(false);
    }
  }, [db, userQuery]);

  // ── Selected user + actions ──────────────────────────────────────────
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customMute, setCustomMute] = useState('');

  const openUser = useCallback(async (u) => {
    setSelected(u);
    setDetail(null);
    if (!u?.id && !u?.email) return;
    setDetailLoading(true);
    try {
      const [record, banSnap] = await Promise.all([
        u.id ? getOrFetchFullProfile(db, u.id) : Promise.resolve(null),
        u.email ? get(ref(db, `banned_users_by_email/${encodeEmailForBan(u.email)}`)) : Promise.resolve(null),
      ]);
      setDetail({
        record: record || null,
        ban: banSnap && banSnap.exists() ? banSnap.val() : null,
      });
    } catch (e) {
      setDetail({ record: null, ban: null });
    } finally {
      setDetailLoading(false);
    }
  }, [db]);

  const merged = useMemo(() => {
    if (!selected) return null;
    const r = detail?.record || {};
    return {
      ...selected,
      email: selected.email || r.email || r.decodedEmail || null,
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

  const afterModAction = useCallback(async () => {
    if (selected?.id) invalidateFullProfile(selected.id);
    await loadRecentBans();
    if (selected) openUser({ ...selected });
  }, [selected, loadRecentBans, openUser]);

  const requireBanPower = () => {
    if (canBanMute) return true;
    Alert.alert('Disabled', 'An admin has turned moderator ban & mute off.');
    return false;
  };

  const bannerInfo = useMemo(() => ({
    id: user?.id, displayName: user?.displayName || 'Admin', avatar: user?.avatar,
  }), [user]);

  const doStrike = useCallback(async (n) => {
    if (!requireBanPower() || !merged?.email) return;
    if (await setUserStrike(merged.email, n, merged.id, true, bannerInfo, merged)) afterModAction();
  }, [merged, bannerInfo, afterModAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const doMute = useCallback(async (mins) => {
    if (!requireBanPower() || !merged?.email) return;
    // Junior mods are capped at two hours; the rules do not enforce this, so
    // it is a UI convention and is labelled as such in the panel.
    const capped = isBabyMod && !isAdmin && !isModerator ? Math.min(mins, 120) : mins;
    if (await muteUser(merged.email, capped, merged, bannerInfo, true)) afterModAction();
  }, [merged, bannerInfo, afterModAction, isBabyMod, isAdmin, isModerator]); // eslint-disable-line react-hooks/exhaustive-deps

  const doBan = useCallback(async () => {
    if (!requireBanPower() || !merged?.email) return;
    if (await banUserwithEmail(merged.email, isAdmin, merged.id, merged, bannerInfo)) afterModAction();
  }, [merged, isAdmin, bannerInfo, afterModAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const doUnban = useCallback(async () => {
    if (!merged?.email) return;
    if (await unbanUserWithEmail(merged.email)) afterModAction();
  }, [merged, afterModAction]);

  const doRole = useCallback(async (fn, label) => {
    if (!merged?.id) return;
    const ok = await new Promise((res) => Alert.alert(label, `${label} for ${merged.displayName}?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
      { text: 'Confirm', onPress: () => res(true) },
    ]));
    if (!ok) return;
    if (await fn(merged.id)) afterModAction();
  }, [merged, afterModAction]);

  // ── Chat viewer ──────────────────────────────────────────────────────
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [chatMsgs, setChatMsgs] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);

  const loadChat = useCallback(async () => {
    const a = p1.trim(); const b = p2.trim();
    if (!looksLikeUid(a) || !looksLikeUid(b)) {
      Alert.alert('Two user IDs needed', 'Paste both user IDs. Copy one from a profile in the Users tab.');
      return;
    }
    if (a === b) { Alert.alert('Error', 'Pick two different users.'); return; }
    Keyboard.dismiss();
    setChatLoading(true);
    try {
      // The chat key is the two uids sorted, which is how the app builds it.
      const chatKey = a < b ? `${a}_${b}` : `${b}_${a}`;
      const snap = await get(query(ref(db, `private_messages/${chatKey}/messages`), orderByChild('timestamp'), limitToLast(CHAT_PAGE)));
      const rows = [];
      if (snap.exists()) snap.forEach((ch) => rows.push({ id: ch.key, ...(ch.val() || {}) }));
      setChatMsgs({ a, b, rows: rows.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0)) });
    } catch (e) {
      Alert.alert('Error', 'Could not load that conversation.');
      setChatMsgs(null);
    } finally {
      setChatLoading(false);
    }
  }, [db, p1, p2]);

  // ── Access tab ───────────────────────────────────────────────────────
  const [granters, setGranters] = useState([]);
  const [grantersLoading, setGrantersLoading] = useState(false);
  const [grantQuery, setGrantQuery] = useState('');

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

  const grantJmd = useCallback(async (uid) => {
    const id = uid.trim();
    if (!looksLikeUid(id)) { Alert.alert('Error', 'That is not a valid user ID.'); return; }
    try {
      const snap = await get(ref(db, `users/${id}`));
      if (!snap.exists()) { Alert.alert('Not found', 'No user with that ID.'); return; }
      const u = snap.val() || {};
      await set(ref(db, `jmd_granters/${id}`), {
        displayName: u.displayName || 'Unknown',
        avatar: avatarOf(u),
        grantedAt: Date.now(),
        grantedBy: user?.id || null,
      });
      setGrantQuery('');
      loadGranters();
      Alert.alert('Granted', `${u.displayName || id} can now make Junior Mods.`);
    } catch (e) {
      Alert.alert('Error', 'Could not grant access. Only admins may write this.');
    }
  }, [db, user, loadGranters]);

  const revokeJmd = useCallback(async (g) => {
    const ok = await new Promise((res) => Alert.alert('Revoke', `Remove ${g.displayName}'s Junior Mod permission?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
      { text: 'Revoke', style: 'destructive', onPress: () => res(true) },
    ]));
    if (!ok) return;
    try { await set(ref(db, `jmd_granters/${g.id}`), null); loadGranters(); }
    catch (e) { Alert.alert('Error', 'Could not revoke.'); }
  }, [db, loadGranters]);

  const toggleModControls = useCallback(async (next) => {
    try { await set(ref(db, 'mod_controls_enabled'), next); }
    catch (e) { Alert.alert('Error', 'Only admins can change this.'); }
  }, [db]);

  // ── render helpers ───────────────────────────────────────────────────
  const s = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  const UserRow = ({ item, onPress, right }) => (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.7}>
      <Image source={{ uri: avatarOf(item) }} style={s.avatar} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
        <Text style={s.sub} numberOfLines={1}>{item.email || item.id || '—'}</Text>
      </View>
      {right}
    </TouchableOpacity>
  );

  if (!isStaff) {
    return (
      <View style={[s.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="lock-closed-outline" size={44} color={c.textMuted} />
        <Text style={[s.sub, { marginTop: 12 }]}>Staff only.</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }} contentContainerStyle={s.tabBar}>
        {visibleTabs.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)}
            style={[s.tab, tab === t.key && s.tabActive]}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* admin-only kill switch */}
      {isAdmin && (
        <View style={s.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.name}>Moderator ban &amp; mute</Text>
            <Text style={s.sub}>
              {modControlsEnabled ? 'On — moderators can ban and mute' : 'Off — admins only'}
            </Text>
          </View>
          <Switch value={modControlsEnabled !== false} onValueChange={toggleModControls}
            trackColor={{ false: '#767577', true: '#34C759' }} thumbColor="#fff" />
        </View>
      )}

      {/* ── BANNED ── */}
      {tab === 'banned' && (
        <View style={{ flex: 1 }}>
          <View style={s.searchRow}>
            <TextInput value={banQuery} onChangeText={setBanQuery}
              placeholder="Search by email prefix…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} style={s.input} />
          </View>
          <View style={s.pillRow}>
            {[['all', 'All'], ['1', 'Strike 1'], ['2', 'Strike 2'], ['3+', 'Permanent']].map(([k, l]) => (
              <TouchableOpacity key={k} onPress={() => setStrikeFilter(k)}
                style={[s.pill, strikeFilter === k && s.pillActive]}>
                <Text style={[s.pillText, strikeFilter === k && s.pillTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.sectionLabel}>
            {searching ? `Search results · ${filteredBans.length}` : `Active bans · ${filteredBans.length}`}
          </Text>
          <FlatList
            data={filteredBans}
            keyExtractor={(i) => i.encodedEmail}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={bansLoading} onRefresh={loadRecentBans} tintColor={c.text} />}
            renderItem={({ item }) => (
              <UserRow item={item} onPress={() => openUser(item)} right={
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={s.banBadge}><Text style={s.banBadgeText}>{`STRIKE ${item.strikeCount}`}</Text></View>
                  <Text style={[s.sub, { marginTop: 4 }]}>{banRemaining(item.bannedUntil)}</Text>
                </View>
              } />
            )}
            ListEmptyComponent={!bansLoading && (
              <View style={s.empty}>
                <Icon name="shield-checkmark-outline" size={44} color={c.textMuted} />
                <Text style={s.sub}>{searching ? 'No match for that prefix' : 'No active bans'}</Text>
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
              placeholder="Display name or user ID…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search"
              onSubmitEditing={searchUsers} style={s.input} />
            <TouchableOpacity onPress={searchUsers} style={s.searchBtn}>
              <Icon name="search" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          {usersLoading ? <ActivityIndicator style={{ marginTop: 30 }} color={c.primary} /> : (
            <FlatList
              data={users}
              keyExtractor={(i) => i.id}
              contentContainerStyle={s.list}
              renderItem={({ item }) => (
                <UserRow item={item} onPress={() => openUser(item)} right={
                  <Icon name="chevron-forward" size={18} color={c.textMuted} />
                } />
              )}
              ListEmptyComponent={(
                <View style={s.empty}>
                  <Icon name="search-outline" size={44} color={c.textMuted} />
                  <Text style={s.sub}>{hasSearched ? 'No users found' : 'Search by display name or paste a user ID'}</Text>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* ── CHATS ── */}
      {tab === 'chats' && isAdmin && (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionLabel}>Private conversation between two users</Text>
          <TextInput value={p1} onChangeText={setP1} placeholder="User ID 1"
            placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} style={[s.input, { marginBottom: 8 }]} />
          <TextInput value={p2} onChangeText={setP2} placeholder="User ID 2"
            placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} style={[s.input, { marginBottom: 10 }]} />
          <TouchableOpacity onPress={loadChat} style={s.primaryBtn}>
            <Icon name="chatbubbles" size={16} color="#fff" />
            <Text style={s.primaryBtnText}>View conversation</Text>
          </TouchableOpacity>

          {chatLoading && <ActivityIndicator style={{ marginTop: 20 }} color={c.primary} />}

          {chatMsgs && !chatLoading && (
            chatMsgs.rows.length === 0 ? (
              <Text style={[s.sub, { textAlign: 'center', marginTop: 24 }]}>
                No messages between these two users.
              </Text>
            ) : chatMsgs.rows.map((m) => {
              const mine = m.senderId === chatMsgs.a;
              return (
                <View key={m.id} style={[s.bubble, mine ? s.bubbleA : s.bubbleB]}>
                  <Text style={s.bubbleWho}>{mine ? 'User 1' : 'User 2'}</Text>
                  {!!m.text && <Text style={s.bubbleText}>{m.text}</Text>}
                  {!!m.imageUrl && <Text style={s.sub}>[image]</Text>}
                  {Array.isArray(m.fruits) && m.fruits.length > 0 && (
                    <Text style={s.sub}>{`[${m.fruits.length} item(s)]`}</Text>
                  )}
                  <Text style={s.bubbleTime}>
                    {m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── ACCESS ── */}
      {tab === 'access' && isAdmin && (
        <View style={{ flex: 1 }}>
          <Text style={[s.sub, { paddingHorizontal: 14, paddingTop: 8 }]}>
            Anyone listed here can make and remove Junior Mods. It grants no other power.
          </Text>
          <View style={s.searchRow}>
            <TextInput value={grantQuery} onChangeText={setGrantQuery}
              placeholder="Paste a user ID to grant…" placeholderTextColor={c.textMuted}
              autoCapitalize="none" autoCorrect={false} style={s.input} />
            <TouchableOpacity onPress={() => grantJmd(grantQuery)} style={s.searchBtn}>
              <Icon name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={granters}
            keyExtractor={(i) => i.id}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={grantersLoading} onRefresh={loadGranters} tintColor={c.text} />}
            renderItem={({ item }) => (
              <UserRow item={item} onPress={() => {}} right={
                <TouchableOpacity onPress={() => revokeJmd(item)} style={s.revokeBtn}>
                  <Text style={s.revokeText}>Revoke</Text>
                </TouchableOpacity>
              } />
            )}
            ListEmptyComponent={!grantersLoading && (
              <View style={s.empty}>
                <Text style={s.sub}>Nobody has this permission yet.</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* ── USER DETAIL ── */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}
        presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}>
        <View style={[s.root, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top }]}>
          {merged && (
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 50 }}>
              <View style={s.modalHead}>
                <Text style={s.title}>User</Text>
                <TouchableOpacity onPress={() => setSelected(null)}><Icon name="close-circle" size={28} color={c.textMuted} /></TouchableOpacity>
              </View>

              <View style={{ alignItems: 'center', marginVertical: 16 }}>
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
                </View>

                {!!merged.id && (
                  <TouchableOpacity style={s.copyRow}
                    onPress={() => { Clipboard.setString(merged.id); Alert.alert('Copied', 'User ID copied.'); }}>
                    <Icon name="copy-outline" size={13} color={c.textMuted} />
                    <Text style={[s.sub, { marginLeft: 6 }]} numberOfLines={1}>{merged.id}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {detailLoading && <ActivityIndicator color={c.primary} />}

              {detail?.ban && (
                <View style={s.banBox}>
                  <Text style={s.banBoxTitle}>{`Strike ${detail.ban.strikeCount} · ${banRemaining(detail.ban.bannedUntil)}`}</Text>
                  <Text style={s.sub}>{detail.ban.reason || '—'}</Text>
                  <Text style={s.sub}>{`by ${typeof detail.ban.bannedBy === 'string' ? detail.ban.bannedBy : 'Unknown'} · ${timeAgo(detail.ban.bannedAt)}`}</Text>
                </View>
              )}

              {/* ban / unban */}
              <View style={{ marginTop: 14 }}>
                {detail?.ban ? (
                  <TouchableOpacity style={[s.primaryBtn, { backgroundColor: '#34C759' }]} onPress={doUnban}>
                    <Icon name="checkmark-circle-outline" size={17} color="#fff" />
                    <Text style={s.primaryBtnText}>Unban</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.primaryBtn, { backgroundColor: '#FF3B30' }]} onPress={doBan}>
                    <Icon name="ban-outline" size={17} color="#fff" />
                    <Text style={s.primaryBtnText}>Ban</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* strikes — not available to junior mods */}
              {(isAdmin || isModerator) && (
                <>
                  <Text style={s.sectionLabel}>Apply strike</Text>
                  <View style={s.rowGap}>
                    {[[1, '3 hours', '#FF9500'], [2, '3 days', '#FF6B00'], [3, 'Permanent', '#FF3B30']].map(([n, sub, col]) => (
                      <TouchableOpacity key={n} style={[s.strikeBtn, { backgroundColor: col }]} onPress={() => doStrike(n)}>
                        <Text style={s.strikeText}>{`Strike ${n}`}</Text>
                        <Text style={s.strikeSub}>{sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* mutes */}
              <Text style={s.sectionLabel}>
                {isBabyMod && !isAdmin && !isModerator ? 'Mute (capped at 2h for Junior Mods)' : 'Mute'}
              </Text>
              <View style={s.wrapRow}>
                {[5, 15, 30, 60, 120, 360].map((m) => (
                  <TouchableOpacity key={m} style={s.muteChip} onPress={() => doMute(m)}>
                    <Text style={s.muteText}>{m >= 60 ? `${m / 60}h` : `${m}m`}</Text>
                  </TouchableOpacity>
                ))}
                <View style={[s.muteChip, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput value={customMute} onChangeText={setCustomMute} placeholder="min"
                    placeholderTextColor={c.textMuted} keyboardType="number-pad" maxLength={4}
                    style={{ color: c.text, minWidth: 34, padding: 0 }} />
                  <TouchableOpacity onPress={() => { const n = parseInt(customMute, 10); if (n > 0) { doMute(n); setCustomMute(''); } }}>
                    <Icon name="arrow-forward-circle" size={18} color={c.primary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* roles */}
              {(isAdmin || isModerator || canGrantJmd) && (
                <>
                  <Text style={s.sectionLabel}>Roles</Text>
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

              {!!merged.createdAt && (
                <Text style={[s.sub, { marginTop: 18, textAlign: 'center' }]}>
                  {`Joined ${new Date(Number(merged.createdAt)).toLocaleDateString()}`}
                </Text>
              )}
            </ScrollView>
          )}
        </View>
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
  switchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: c.bgAlt },
  searchRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, backgroundColor: c.bgAlt, color: c.text, borderWidth: 1, borderColor: c.border },
  searchBtn: { width: 44, height: 42, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: c.border },
  pillActive: { backgroundColor: c.primary, borderColor: c.primary },
  pillText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  pillTextActive: { color: '#fff' },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: c.textMuted, marginTop: 14, marginBottom: 8, paddingHorizontal: 14 },
  list: { paddingHorizontal: 12, paddingBottom: 60 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, marginBottom: 8, backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.border },
  avatarLarge: { width: 84, height: 84, borderRadius: 42, backgroundColor: c.border },
  name: { fontSize: 15, fontWeight: '600', color: c.text },
  sub: { fontSize: 12, color: c.textMuted },
  title: { fontSize: 19, fontWeight: '700', color: c.text },
  banBadge: { backgroundColor: '#FF3B30', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  banBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60, gap: 10 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'center', marginTop: 8 },
  copyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: c.bgAlt, maxWidth: '90%' },
  banBox: { padding: 12, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,59,48,0.12)' : '#FFF5F5', borderWidth: 1, borderColor: '#FF3B3033', marginTop: 8 },
  banBoxTitle: { fontSize: 13, fontWeight: '700', color: '#FF3B30', marginBottom: 4 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 12, backgroundColor: c.primary },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowGap: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  strikeBtn: { flex: 1, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  strikeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  strikeSub: { color: '#fff', fontSize: 10, opacity: 0.9 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  muteChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.bgAlt, borderWidth: 1, borderColor: c.border },
  muteText: { fontSize: 13, fontWeight: '600', color: c.text },
  roleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  roleChipText: { fontSize: 12, fontWeight: '700' },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#FF3B3015', borderWidth: 1, borderColor: '#FF3B3040' },
  revokeText: { fontSize: 12, fontWeight: '700', color: '#FF3B30' },
  bubble: { maxWidth: '85%', padding: 10, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: c.border },
  bubbleA: { alignSelf: 'flex-end', backgroundColor: isDark ? '#0A3D62' : '#DCF8C6' },
  bubbleB: { alignSelf: 'flex-start', backgroundColor: c.bgAlt },
  bubbleWho: { fontSize: 10, fontWeight: '700', color: c.textMuted, marginBottom: 3 },
  bubbleText: { fontSize: 14, color: c.text, lineHeight: 19 },
  bubbleTime: { fontSize: 10, color: c.textMuted, marginTop: 5, textAlign: 'right' },
});

export default AdminDashboard;
