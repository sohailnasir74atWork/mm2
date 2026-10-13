/**
 * TradeMatchScreen — "Get your dream item". Port of Adopt Me's
 * Code/TradeMatch/TradeMatchScreen.jsx onto MM2's Firebase backend.
 *
 * 1. The player picks a dream item (knife, gun or pet) from My Goals.
 * 2. "Have what I want": players who list For Trade something on the
 *    player's goals; "perfect" when they also want something the player
 *    lists. Dream holders first.
 * 3. "Want my items": the other way round (Adopt Me 053): players whose
 *    goals include an item the player lists For Trade, their dream first,
 *    and what they could give.
 * 4. Message opens a private chat; the avatar opens the profile sheet.
 * 5. "I got it! 🎉" moves the dream item to My Items and makes a share card.
 *
 * Data: the player's own reviews/{uid} document (live listener, so lists
 * edited in My Stuff are current when coming back) and the RTDB index
 * trade_index/* (Code/Helper/tradeMatch.js), cached 10 minutes. The index is
 * written only by functions/tradeMatch.js; this screen never writes it.
 * Signed-in players only (the More hub asks to sign in first).
 *
 * Root-stack route `TradeMatch` (App.js); params: { tab: 'wanters' }.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, onSnapshot, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage } from '../Helper/MessageHelper';
import config from '../Helper/Environment';
import { flipInRTL } from '../Helper/rtl';
import {
  buildItemPool, unwrapFeed, priceOf, resolveItemImage, DEFAULT_VALUE_SOURCE,
} from '../Helper/valueSources';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import SignInDrawer from '../Firebase/SigninDrawer';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { MyDarkTheme, MyLightTheme } from '../AppHelper/AppHelperFunction';
import {
  buildLists, itemKey, getDreamKey, setDreamKeyLocal, saveDreamKey, touchTradeMatch,
  getAlertsEnabled, setAlertsEnabled, fetchTradeMatches, fetchItemWanters,
  fetchTradeMatchStats, invalidateTradeMatch,
} from '../Helper/tradeMatch';

const ACCENT = config.colors.primary;
const GREEN = '#10B981';
const GOLD = '#F59E0B';
const SITE = 'mm2values.app';
const BRAND = 'MM2 Values';
const FALLBACK_IMG = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const CHIPS_SHOWN = 6;
const ON_ACCENT = '#FFFFFF';
const DREAM_BG_DARK = '#1E1A3A';
const DREAM_BG_LIGHT = '#F3F1FC';

const parseFeed = (raw) => {
  try {
    if (!raw) return null;
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return p && typeof p === 'object' ? unwrapFeed(p) : null;
  } catch (e) {
    return null;
  }
};

// Unique goals (one per item key) for the dream picker.
const goalChoices = (wishlist) => {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(wishlist) ? wishlist : []) {
    const k = itemKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, item: it });
  }
  return out;
};

const ItemChip = React.memo(function ItemChip(props) {
  const { k, info, highlight, c } = props;
  const name = info?.name || k;
  return (
    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: highlight ? GOLD : c.border }]}>
      {info?.image
        ? <Image resizeMethod="resize" source={{ uri: info.image }} style={styles.chipImg} />
        : <Text style={styles.chipImgFallback}>🔪</Text>}
      <Text style={[styles.chipText, { color: c.text }]} numberOfLines={1}>{name}</Text>
    </View>
  );
});

const Chips = ({ keys, catalog, c, highlight }) => (
  <View style={styles.chips}>
    {keys.slice(0, CHIPS_SHOWN).map((k) => (
      <ItemChip key={k} k={k} info={catalog.get(k)} highlight={highlight ? highlight(k) : false} c={c} />
    ))}
  </View>
);

// Avatar (opens the profile), name, the gold "dream" pill, the green
// "perfect match" pill, Message.
const CardHead = ({ m, c, dreamText, onMessage, onProfile }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.cardHead}>
      <TouchableOpacity
        onPress={() => onProfile(m)}
        style={styles.cardWho}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('trade_match.view_profile')}
      >
        {m.avatar
          ? <Image resizeMethod="resize" source={{ uri: m.avatar }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback]}><Icon name="person" size={18} color="#fff" /></View>}
        <View style={styles.flex1}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{m.name || t('trade_match.anonymous')}</Text>
            {m.verified && <Icon name="checkmark-circle" size={14} color="#3B82F6" style={styles.ms4} />}
            {m.isPro && <Text style={styles.proTag}>PRO</Text>}
          </View>
          <View style={[styles.row, styles.pillRow]}>
            {!!m.dream && (
              <View style={[styles.pill, { backgroundColor: GOLD + '22' }]}>
                <Text style={[styles.pillText, { color: GOLD }]} numberOfLines={1}>⭐ {dreamText}</Text>
              </View>
            )}
            {!!m.full && (
              <View style={[styles.pill, { backgroundColor: GREEN + '22' }]}>
                <Text style={[styles.pillText, { color: GREEN }]}>🤝 {t('trade_match.perfect_match')}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.msgBtn} onPress={() => onMessage(m)} activeOpacity={0.85} accessibilityRole="button">
        <Icon name="chatbubble-ellipses" size={16} color="#fff" />
        <Text style={styles.msgText}>{t('trade_match.message')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const MatchCard = React.memo(function MatchCard(props) {
  const { m, dreamKey, catalog, c, onMessage, onProfile } = props;
  const { t } = useTranslation();
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: m.dream ? GOLD : c.border }]}>
      <CardHead m={m} c={c} dreamText={t('trade_match.has_dream')} onMessage={onMessage} onProfile={onProfile} />
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.has_label')}</Text>
      <Chips keys={m.gives || []} catalog={catalog} c={c} highlight={(k) => k === dreamKey} />
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.wants_label')}</Text>
      {m.full && m.wants?.length
        ? <Chips keys={m.wants} catalog={catalog} c={c} />
        : <Text style={[styles.muted, { color: c.textMuted }]}>{t('trade_match.wants_other')}</Text>}
    </View>
  );
});

// "Want my items": what of mine they want (their dream first) and what they could give.
const WanterCard = React.memo(function WanterCard(props) {
  const { m, catalog, c, onMessage, onProfile } = props;
  const { t } = useTranslation();
  const dreamName = m.dreamKey ? (catalog.get(m.dreamKey)?.name || m.dreamKey) : '';
  const gives = (m.gives || []).slice(0, CHIPS_SHOWN);
  const more = Math.max(0, (m.givesCount || 0) - gives.length);
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: m.dream ? GOLD : c.border }]}>
      <CardHead m={m} c={c} dreamText={t('trade_match.their_dream', { item: dreamName })} onMessage={onMessage} onProfile={onProfile} />
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.wants_label')}</Text>
      <Chips keys={m.wants || []} catalog={catalog} c={c} highlight={(k) => k === m.dreamKey} />
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.could_give')}</Text>
      {gives.length ? (
        <View style={styles.chips}>
          {gives.map((g) => (
            <ItemChip key={g.k} k={g.k} info={catalog.get(g.k)} highlight={g.w} c={c} />
          ))}
          {more > 0 && (
            <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
              <Text style={[styles.chipText, { color: c.textSecondary }]}>{t('trade_match.more_count', { count: more })}</Text>
            </View>
          )}
        </View>
      ) : (
        <Text style={[styles.muted, { color: c.textMuted }]}>{t('trade_match.wants_other')}</Text>
      )}
    </View>
  );
});

export default function TradeMatchScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { user, theme, firestoreDB, appdatabase } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const selectedTheme = isDark ? MyDarkTheme : MyLightTheme;
  const uid = user?.id || null;
  const blocked = useMemo(
    () => (Array.isArray(localState?.bannedUsers) ? localState.bannedUsers : []),
    [localState?.bannedUsers],
  );
  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;

  const [owned, setOwned] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [dreamKey, setDreamKey] = useState(() => getDreamKey(uid));
  const [docLoaded, setDocLoaded] = useState(false);
  const [matches, setMatches] = useState(null);     // null = not loaded yet
  const [wanters, setWanters] = useState(null);
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [wantersError, setWantersError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(true);
  const [proofItem, setProofItem] = useState(null);
  const [tab, setTab] = useState(route.params?.tab === 'wanters' ? 'wanters' : 'matches');
  const [profileUser, setProfileUser] = useState(null);
  const [signinOpen, setSigninOpen] = useState(false);
  const shotRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ── The player's own lists, live (My Stuff edits arrive while away) ──
  useEffect(() => {
    if (!uid || !firestoreDB) { setDocLoaded(true); return undefined; }
    setDocLoaded(false);
    const unsub = onSnapshot(doc(firestoreDB, 'reviews', uid), (snap) => {
      const data = snap?.data() || {};
      setOwned(Array.isArray(data.ownedPets) ? data.ownedPets : []);
      setWishlist(Array.isArray(data.wishlistPets) ? data.wishlistPets : []);
      // The document wins when it has the field (it follows the player across phones).
      const d = 'dreamItemKey' in data ? (data.dreamItemKey || null) : getDreamKey(uid);
      setDreamKeyLocal(uid, d);
      setDreamKey(d);
      setDocLoaded(true);
    }, (e) => {
      console.warn('[TradeMatch] lists failed:', e?.message);
      setLoadError(true);
      setDocLoaded(true);
    });
    return () => unsub();
  }, [uid, firestoreDB]);

  useEffect(() => {
    if (!uid || !appdatabase) return;
    getAlertsEnabled(appdatabase, uid).then((on) => { if (mounted.current) setAlertsOn(on); });
  }, [uid, appdatabase]);

  // ── Catalogue: names, images and values by item key ──
  const catalog = useMemo(() => {
    const m = new Map();
    const pool = buildItemPool(parseFeed(localState?.data), parseFeed(localState?.suprime));
    for (const it of pool) {
      const k = itemKey(it);
      if (!k || m.has(k)) continue;
      const priced = priceOf(it, valueSource);
      m.set(k, { name: it.name, image: resolveItemImage(it) || null, value: priced.value || priced.referenceValue || 0 });
    }
    // The player's own saved items cover names the catalogue no longer lists.
    for (const it of [...owned, ...wishlist]) {
      const k = itemKey(it);
      if (k && !m.has(k)) m.set(k, { name: it.name || it.Name, image: it.imageUrl || null, value: Number(it.value) || 0 });
    }
    return m;
  }, [localState?.data, localState?.suprime, valueSource, owned, wishlist]);
  const rank = useCallback((k) => catalog.get(k)?.value || 0, [catalog]);

  const lists = useMemo(() => buildLists(owned, wishlist, dreamKey), [owned, wishlist, dreamKey]);
  const listsSig = useMemo(() => JSON.stringify(lists), [lists]);
  const choices = useMemo(() => goalChoices(wishlist), [wishlist]);
  const dreamItem = useMemo(() => choices.find((x) => x.key === dreamKey)?.item || null, [choices, dreamKey]);
  const forTradeCount = lists.have.length;
  const wantCount = lists.want.length;

  const loadMatches = useCallback(async (force) => {
    if (!uid || !appdatabase) return;
    setLoadError(false);
    try {
      const [list, st] = await Promise.all([
        fetchTradeMatches(appdatabase, uid, lists, { blocked, rank, force }),
        fetchTradeMatchStats(appdatabase, { force }).catch(() => null),
      ]);
      if (!mounted.current) return;
      setMatches(list);
      if (st) setStats(st);
    } catch (e) {
      console.warn('[TradeMatch] matches failed:', e?.message);
      if (mounted.current) { setLoadError(true); setMatches((m) => m || []); }
    }
    // listsSig stands in for lists (same content, stable identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, appdatabase, listsSig, blocked, rank]);

  const loadWanters = useCallback(async (force) => {
    if (!uid || !appdatabase) return;
    setWantersError(false);
    try {
      const list = await fetchItemWanters(appdatabase, uid, lists, { blocked, rank, force });
      if (mounted.current) setWanters(list);
    } catch (e) {
      console.warn('[TradeMatch] wanters failed:', e?.message);
      if (mounted.current) { setWantersError(true); setWanters((w) => w || []); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, appdatabase, listsSig, blocked, rank]);

  // Lists loaded or changed: refresh what is on screen (cache-aware).
  useEffect(() => {
    if (!docLoaded || !uid) return;
    loadMatches(false);
    touchTradeMatch(firestoreDB, uid, lists, i18n.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docLoaded, uid, listsSig, loadMatches]);

  // "Want my items" loads only when its tab is open, and only with something For Trade.
  useEffect(() => {
    if (!docLoaded || !uid) return;
    if (tab === 'wanters' && forTradeCount > 0) loadWanters(false);
  }, [tab, docLoaded, uid, forTradeCount, loadWanters]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await (tab === 'wanters' ? loadWanters(true) : loadMatches(true));
    if (mounted.current) setRefreshing(false);
  }, [tab, loadMatches, loadWanters]);

  // First visit with goals but nothing to search for: open the dream picker
  // once, so "add a goal, then see matches" just works.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (!docLoaded || loadError || autoPickedRef.current) return;
    if (!dreamKey && wantCount === 0 && choices.length > 0) {
      autoPickedRef.current = true;
      setPickerOpen(true);
    }
  }, [docLoaded, loadError, dreamKey, wantCount, choices.length]);

  const saveDream = useCallback(async (key) => {
    try {
      await saveDreamKey(firestoreDB, uid, key, i18n.language);
      setDreamKey(key);
    } catch (e) {
      console.warn('[TradeMatch] save dream failed:', e?.message);
      showErrorMessage(t('home.alert.error'), t('trade_match.error_save'));
    }
  }, [firestoreDB, uid, i18n.language, t]);

  const pickDream = useCallback((choice) => {
    setPickerOpen(false);
    // iOS drops an Alert presented while a Modal is still animating out.
    setTimeout(() => {
      Alert.alert(
        t('trade_match.dream_confirm_title'),
        t('trade_match.dream_confirm_body', { item: choice.item.name || choice.item.Name }),
        [
          { text: t('trade_match.cancel'), style: 'cancel' },
          { text: t('trade_match.dream_confirm_yes'), onPress: () => saveDream(choice.key) },
        ],
      );
    }, 400);
  }, [saveDream, t]);

  const toggleAlerts = useCallback(async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    try {
      await setAlertsEnabled(appdatabase, uid, next);
    } catch (e) {
      if (mounted.current) setAlertsOn(!next);
      showErrorMessage(t('home.alert.error'), t('trade_match.error_save'));
    }
  }, [alertsOn, appdatabase, uid, t]);

  const openChat = useCallback((m) => {
    navigation.navigate('PrivateChatRoot', {
      selectedUser: { senderId: m.uid, sender: m.name || t('trade_match.anonymous'), avatar: m.avatar || null },
    });
  }, [navigation, t]);

  const openProfile = useCallback((m) => {
    setProfileUser({
      senderId: m.uid,
      sender: m.name || t('trade_match.anonymous'),
      avatar: m.avatar || null,
      isPro: !!m.isPro,
      robloxUsernameVerified: !!m.verified,
    });
  }, [t]);

  const startChatFromProfile = useCallback(() => {
    const u = profileUser;
    setProfileUser(null);
    if (!u) return;
    setTimeout(() => {
      navigation.navigate('PrivateChatRoot', { selectedUser: { senderId: u.senderId, sender: u.sender, avatar: u.avatar } });
    }, 300);
  }, [profileUser, navigation]);

  const shareProof = useCallback(async () => {
    try {
      if (!shotRef.current) return;
      await new Promise((r) => setTimeout(r, 150));
      const uri = await shotRef.current.capture();
      await Share.open({
        url: uri,
        type: 'image/png',
        message: t('trade_match.proof_share_message', { item: proofItem?.name || '', url: `https://${SITE}` }),
        failOnCancel: false,
      });
    } catch (e) {
      if (e?.message !== 'User did not share') console.warn('[TradeMatch] share failed:', e?.message);
    }
  }, [proofItem, t]);

  const markGotIt = useCallback(async () => {
    const idx = wishlist.findIndex((it) => itemKey(it) === dreamKey);
    if (idx < 0) return;
    const got = wishlist[idx];
    const newWishlist = wishlist.filter((_, i) => i !== idx);
    // Just traded for: Private until the player chooses to list it.
    const newOwned = [...owned, { ...got, availableForTrade: false }];
    try {
      await setDoc(doc(firestoreDB, 'reviews', uid), {
        ownedPets: newOwned,
        wishlistPets: newWishlist,
        dreamItemKey: null,
        dreamFoundKey: dreamKey,
        dreamFoundAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      updateLocalState('ownedPets', newOwned);
      updateLocalState('wishlistPets', newWishlist);
      setDreamKeyLocal(uid, null);
      setDreamKey(null);
      invalidateTradeMatch(uid);
      setProofItem({
        name: got.name || got.Name,
        image: catalog.get(dreamKey)?.image || got.imageUrl || null,
      });
    } catch (e) {
      console.warn('[TradeMatch] got-it failed:', e?.message);
      showErrorMessage(t('home.alert.error'), t('trade_match.error_save'));
    }
  }, [wishlist, owned, dreamKey, firestoreDB, uid, updateLocalState, catalog, t]);

  const confirmGotIt = useCallback(() => {
    const name = dreamItem?.name || dreamItem?.Name || '';
    Alert.alert(
      t('trade_match.got_it_confirm_title', { item: name }),
      t('trade_match.got_it_confirm_body'),
      [
        { text: t('trade_match.cancel'), style: 'cancel' },
        { text: t('trade_match.got_it_yes'), onPress: markGotIt },
      ],
    );
  }, [dreamItem, markGotIt, t]);

  const openMyStuff = useCallback((initialTab) => navigation.navigate('MyStuff', { initialTab }), [navigation]);
  const openPickerOrGoals = useCallback(
    () => (choices.length ? setPickerOpen(true) : openMyStuff('goals')),
    [choices.length, openMyStuff],
  );

  const dreamInfo = dreamKey ? catalog.get(dreamKey) : null;
  const dreamImage = dreamInfo?.image || dreamItem?.imageUrl || null;

  const renderHeader = () => (
    <View>
      {/* Have what I want / Want my items */}
      <View style={[styles.tabs, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        {[['matches', t('trade_match.tab_have')], ['wanters', t('trade_match.tab_wanters')]].map(([k, label]) => (
          <TouchableOpacity
            key={k}
            style={[styles.tab, tab === k && { backgroundColor: ACCENT }]}
            onPress={() => setTab(k)}
            activeOpacity={0.85}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
          >
            <Text style={[styles.tabText, { color: tab === k ? ON_ACCENT : c.textSecondary }]} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'matches' ? (
        <View style={[styles.dreamCard, { backgroundColor: isDark ? DREAM_BG_DARK : DREAM_BG_LIGHT, borderColor: ACCENT + '55' }]}>
          {dreamItem ? (
            <>
              <Text style={[styles.dreamLabel, { color: ACCENT }]}>⭐ {t('trade_match.dream_label')}</Text>
              <View style={[styles.row, styles.mt8]}>
                {dreamImage
                  ? <Image resizeMethod="resize" source={{ uri: dreamImage }} style={styles.dreamImg} />
                  : <Text style={styles.bigEmoji}>🔪</Text>}
                <View style={styles.dreamText}>
                  <Text style={[styles.dreamName, { color: c.text }]} numberOfLines={2}>{dreamItem.name || dreamItem.Name}</Text>
                  <TouchableOpacity onPress={() => setPickerOpen(true)}>
                    <Text style={[styles.link, { color: ACCENT }]}>{t('trade_match.dream_change')}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.gotBtn} onPress={confirmGotIt} activeOpacity={0.85}>
                  <Text style={styles.gotText}>{t('trade_match.got_it')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.dreamName, { color: c.text }]}>🎯 {t('trade_match.dream_pick')}</Text>
              <Text style={[styles.muted, styles.mt6, { color: c.textSecondary }]}>{t('trade_match.dream_pick_hint')}</Text>
              <TouchableOpacity style={[styles.primaryBtn, styles.mt12]} onPress={openPickerOrGoals} activeOpacity={0.85}>
                <Text style={styles.primaryText}>{choices.length ? t('trade_match.dream_pick') : t('trade_match.open_goals')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <Text style={[styles.muted, { color: c.textSecondary }]}>{t('trade_match.wanters_hint')}</Text>
      )}

      {/* Social proof */}
      {!!stats && (stats.traders > 0 || stats.found7d > 0) && (
        <View style={[styles.row, styles.statsRow]}>
          {stats.traders > 0 && (
            <Text style={[styles.statText, { color: c.textSecondary }]}>👥 {t('trade_match.stats_traders', { count: stats.traders })}</Text>
          )}
          {stats.found7d > 0 && (
            <Text style={[styles.statText, { color: c.textSecondary }]}>🎉 {t('trade_match.stats_found', { count: stats.found7d })}</Text>
          )}
        </View>
      )}

      {/* What is missing for good matches */}
      {docLoaded && forTradeCount === 0 && (
        <TouchableOpacity
          style={[styles.tip, { backgroundColor: c.bgAlt, borderColor: c.border }]}
          onPress={() => openMyStuff('items')}
          activeOpacity={0.8}
        >
          <Icon name="swap-horizontal" size={18} color={GREEN} />
          <Text style={[styles.tipText, { color: c.text }]}>{t('trade_match.need_for_trade')}</Text>
          <Text style={[styles.link, { color: ACCENT }]}>{t('trade_match.open_my_items')}</Text>
        </TouchableOpacity>
      )}

      {tab === 'matches' && matches?.length > 0 && (
        <Text style={[styles.listTitle, { color: c.text }]}>{t('trade_match.matches_title')}</Text>
      )}
      {tab === 'wanters' && wanters?.length > 0 && (
        <Text style={[styles.listTitle, { color: c.text }]}>{t('trade_match.wanters_title')}</Text>
      )}
    </View>
  );

  const spinner = <ActivityIndicator style={styles.mt40} color={ACCENT} />;

  const renderEmpty = () => {
    if (!docLoaded) return spinner;
    if (!loadError && wantCount === 0) {
      // Nothing to search for yet: say so instead of "No matches".
      return (
        <View style={styles.empty}>
          <Text style={styles.bigEmoji}>🎯</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.dream_pick')}</Text>
          <Text style={[styles.muted, styles.center, { color: c.textSecondary }]}>{t('trade_match.dream_pick_hint')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.mt8]} onPress={openPickerOrGoals} activeOpacity={0.85}>
            <Text style={styles.primaryText}>{choices.length ? t('trade_match.dream_pick') : t('trade_match.open_goals')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (matches === null && !loadError) return spinner;
    return (
      <View style={styles.empty}>
        <Text style={styles.bigEmoji}>{loadError ? '⚠️' : '🔍'}</Text>
        <Text style={[styles.emptyTitle, { color: c.text }]}>
          {loadError ? t('trade_match.error_load') : t('trade_match.empty_title')}
        </Text>
        {!loadError && <Text style={[styles.muted, styles.center, { color: c.textSecondary }]}>{t('trade_match.empty_body')}</Text>}
      </View>
    );
  };

  const renderWantersEmpty = () => {
    if (!docLoaded) return spinner;
    if (forTradeCount === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.bigEmoji}>🏷️</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.wanters_need_title')}</Text>
          <Text style={[styles.muted, styles.center, { color: c.textSecondary }]}>{t('trade_match.need_for_trade')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.mt8]} onPress={() => openMyStuff('items')} activeOpacity={0.85}>
            <Text style={styles.primaryText}>{t('trade_match.open_my_items')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (wanters === null && !wantersError) return spinner;
    if (wantersError) {
      return (
        <View style={styles.empty}>
          <Text style={styles.bigEmoji}>⚠️</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.error_load')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <Text style={styles.bigEmoji}>🔍</Text>
        <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.wanters_empty_title')}</Text>
        <Text style={[styles.muted, styles.center, { color: c.textSecondary }]}>{t('trade_match.wanters_empty_body')}</Text>
      </View>
    );
  };

  const renderItem = useCallback(({ item }) => (tab === 'matches'
    ? <MatchCard m={item} dreamKey={dreamKey} catalog={catalog} c={c} onMessage={openChat} onProfile={openProfile} />
    : <WanterCard m={item} catalog={catalog} c={c} onMessage={openChat} onProfile={openProfile} />
  ), [tab, dreamKey, catalog, c, openChat, openProfile]);

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('birthdays.back')}>
          <Icon name="arrow-back" size={22} color={c.text} style={flipInRTL} />
        </TouchableOpacity>
        <View style={styles.flex1}>
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('trade_match.title')}</Text>
          <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{t('trade_match.subtitle')}</Text>
        </View>
        {!!uid && (
          <TouchableOpacity
            onPress={toggleAlerts}
            style={styles.iconBtn}
            accessibilityRole="switch"
            accessibilityState={{ checked: alertsOn }}
            accessibilityLabel={alertsOn ? t('trade_match.alerts_on') : t('trade_match.alerts_off')}
          >
            <Icon name={alertsOn ? 'notifications' : 'notifications-off-outline'} size={22} color={alertsOn ? ACCENT : c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!uid ? (
        <View style={[styles.empty, styles.flex1]}>
          <Text style={styles.bigEmoji}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.sign_in')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.mt8]} onPress={() => setSigninOpen(true)} activeOpacity={0.85}>
            <Text style={styles.primaryText}>{t('mystuff.sign_in')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          removeClippedSubviews={false}
          data={tab === 'matches' ? (matches || []) : (wanters || [])}
          keyExtractor={(m) => m.uid}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader()}
          ListEmptyComponent={tab === 'matches' ? renderEmpty() : renderWantersEmpty()}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          initialNumToRender={6}
          windowSize={7}
        />
      )}
      <ScreenBottomBanner background={c.bg} />

      {/* Dream item picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 12 }]}>
            <View style={[styles.row, styles.sheetHead]}>
              <Text style={[styles.listTitle, styles.mt0, { color: c.text }]}>{t('trade_match.dream_pick')}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('trade_match.close')}>
                <Icon name="close" size={22} color={c.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              removeClippedSubviews={false}
              data={choices}
              keyExtractor={(x) => x.key}
              numColumns={3}
              renderItem={({ item }) => {
                const uri = catalog.get(item.key)?.image || item.item.imageUrl || FALLBACK_IMG;
                return (
                  <TouchableOpacity
                    style={[styles.pickCell, { backgroundColor: c.bgAlt, borderColor: item.key === dreamKey ? GOLD : c.border }]}
                    onPress={() => pickDream(item)}
                    activeOpacity={0.8}
                  >
                    <Image resizeMethod="resize" source={{ uri }} style={styles.pickImg} />
                    <Text style={[styles.pickName, { color: c.text }]} numberOfLines={2}>{item.item.name || item.item.Name}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* "I got it!" proof card */}
      <Modal visible={!!proofItem} transparent animationType="fade" onRequestClose={() => setProofItem(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.proofWrap}>
            <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
              <View style={styles.proofCard}>
                <Text style={styles.proofConfetti}>🎉 ✨ 🎉</Text>
                <Text style={styles.proofTitle}>{t('trade_match.proof_title')}</Text>
                <View style={styles.proofImgWrap}>
                  {proofItem?.image
                    ? <Image resizeMethod="resize" source={{ uri: proofItem.image }} style={styles.proofImg} />
                    : <Text style={styles.proofEmoji}>🔪</Text>}
                </View>
                <Text style={styles.proofItem} numberOfLines={2}>{proofItem?.name}</Text>
                <View style={styles.proofBadge}>
                  <Text style={styles.proofBadgeText}>🎯 {t('trade_match.proof_found_with')}</Text>
                </View>
                {!!user?.displayName && <Text style={styles.proofUser}>@{user.displayName}</Text>}
                <View style={styles.flex1} />
                <Text style={styles.proofFooter}>{BRAND} · {SITE}</Text>
              </View>
            </ViewShot>
            <View style={[styles.row, styles.proofBtns]}>
              <TouchableOpacity style={[styles.primaryBtn, styles.flex1]} onPress={shareProof} activeOpacity={0.85}>
                <Icon name="share-social" size={16} color="#fff" />
                <Text style={styles.primaryText}>{t('trade_match.share')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, styles.flex1]} onPress={() => setProofItem(null)} activeOpacity={0.85}>
                <Text style={styles.secondaryText}>{t('trade_match.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {!!profileUser && (
        <ProfileBottomDrawer
          isVisible={!!profileUser}
          toggleModal={() => setProfileUser(null)}
          startChat={startChatFromProfile}
          selectedUser={profileUser}
          isOnline={false}
          bannedUsers={blocked}
          fromPvtChat={false}
        />
      )}

      <SignInDrawer
        visible={signinOpen}
        onClose={() => setSigninOpen(false)}
        selectedTheme={selectedTheme}
        screen="TradeMatch"
        message={t('trade_match.sign_in')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  center: { textAlign: 'center' },
  ms4: { marginStart: 4 },
  mt0: { marginTop: 0 },
  mt6: { marginTop: 6 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  mt40: { marginTop: 40 },
  bigEmoji: { fontSize: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontFamily: 'Lato-Bold' },
  headerSub: { fontSize: 12, marginTop: 1, fontFamily: 'Lato-Regular' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 24 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 4, marginBottom: 12 },
  tab: { flex: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center' },
  tabText: { fontSize: 13, fontWeight: '800' },
  dreamCard: { borderRadius: 16, borderWidth: 1, padding: 14 },
  dreamLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  dreamImg: { width: 64, height: 64, resizeMode: 'contain' },
  dreamText: { flex: 1, marginStart: 12 },
  dreamName: { fontSize: 17, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  gotBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginStart: 8 },
  gotText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  statsRow: { flexWrap: 'wrap', gap: 12, marginTop: 12 },
  statText: { fontSize: 12, fontWeight: '600' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },
  listTitle: { fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  proTag: { marginStart: 6, fontSize: 9, fontWeight: '900', color: '#B45309', backgroundColor: '#FDE68A', borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
  pillRow: { marginTop: 4, flexWrap: 'wrap', gap: 6 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, maxWidth: '100%' },
  pillText: { fontSize: 11, fontWeight: '800' },
  msgBtn: { backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  msgText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, maxWidth: '100%' },
  chipImg: { width: 24, height: 24, resizeMode: 'contain', marginEnd: 4 },
  chipImgFallback: { fontSize: 16, marginEnd: 4 },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  muted: { fontSize: 13, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '75%' },
  sheetHead: { justifyContent: 'space-between', marginBottom: 10 },
  pickCell: { flex: 1 / 3, margin: 4, borderWidth: 1, borderRadius: 12, alignItems: 'center', padding: 8 },
  pickImg: { width: 56, height: 56, resizeMode: 'contain' },
  pickName: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  proofWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  proofCard: { width: 270, height: 480, borderRadius: 20, backgroundColor: '#2E2566', alignItems: 'center', padding: 18, overflow: 'hidden' },
  proofConfetti: { fontSize: 22, marginTop: 6 },
  proofTitle: { color: '#FDE68A', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  proofImgWrap: { width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  proofImg: { width: 140, height: 140, resizeMode: 'contain' },
  proofEmoji: { fontSize: 80 },
  proofItem: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  proofBadge: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  proofBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  proofUser: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700', marginTop: 10 },
  proofFooter: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  proofBtns: { gap: 10, marginTop: 14 },
});
