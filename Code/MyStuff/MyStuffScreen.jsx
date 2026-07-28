/**
 * MyStuffScreen — "My Items" + "My Goals" inventory manager
 * Compact 4-col grid for items, intelligent goal cards with progress bars.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Dimensions, ActivityIndicator, Animated, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import {
  doc, onSnapshot, setDoc, serverTimestamp,
  collection, query, orderBy, limit, startAfter, getDocs,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { syncValueAlertTopics } from '../Helper/valueAlerts';
import { getJournalRevision, clearJournal, deleteJournalEntry } from '../Engagement/journalUtils';

const { width: W } = Dimensions.get('window');
const GRID_COLS = 4;
const CARD_GAP = 8;
const CARD_W = (W - 32 - CARD_GAP * (GRID_COLS - 1)) / GRID_COLS;

const fmt = (v) => {
  if (!v || typeof v !== 'number') return '0';
  const smart = (n, u) => { const s = n.toFixed(1); return (s.endsWith('.0') ? n.toFixed(0) : s) + u; };
  if (v >= 1e9) return smart(v / 1e9, 'B');
  if (v >= 1e6) return smart(v / 1e6, 'M');
  if (v >= 1e3) return smart(v / 1e3, 'K');
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(1);
};

const TABS = [
  { key: 'items',   label: 'My Items',  icon: 'box-open',          emoji: '📦', labelKey: 'mystuff.my_items' },
  { key: 'goals',   label: 'My Goals',  icon: 'bullseye',          emoji: '🎯', labelKey: 'mystuff.my_goals' },
  { key: 'history', label: 'History',   icon: 'clock-rotate-left', emoji: '📋', labelKey: 'mystuff.history' },
];

// Trade-result palette, shared with the calculator's Log Trade flow
const RESULT_META = {
  win:  { emoji: '🏆', label: 'Win',  color: '#10B981' },
  fair: { emoji: '🤝', label: 'Fair', color: '#F59E0B' },
  loss: { emoji: '📉', label: 'Loss', color: '#EF4444' },
};

const HISTORY_PAGE = 15;

const MyStuffScreen = ({ selectedTheme }) => {
  const { user, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const C = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('items');
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [petModalOwned, setPetModalOwned] = useState(true);
  const [signinVisible, setSigninVisible] = useState(false);

  // ── Trade history (logged from the calculator) ──
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLastDoc, setHistoryLastDoc] = useState(null);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [clearingHistory, setClearingHistory] = useState(false);
  // Journal revision this screen's data was fetched at — see the focus effect
  const historyRevisionRef = useRef(-1);

  // Tab indicator animation
  const tabAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const idx = Math.max(0, TABS.findIndex(tb => tb.key === activeTab));
    Animated.spring(tabAnim, {
      toValue: idx,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [activeTab]);

  // Load from Firestore
  useEffect(() => {
    if (!user?.id || !firestoreDB) {
      setOwnedPets([]);
      setWishlistPets([]);
      setLoading(false);
      return;
    }

    const userReviewRef = doc(firestoreDB, 'reviews', user.id);
    const unsubscribe = onSnapshot(userReviewRef, (snap) => {
      const data = snap.data();
      const owned = data && Array.isArray(data.ownedPets) ? data.ownedPets : [];
      const wishlist = data && Array.isArray(data.wishlistPets) ? data.wishlistPets : [];
      setOwnedPets(owned);
      setWishlistPets(wishlist);
      // Mirror into localState (MMKV) — the calculator INVENTORY tab and the
      // chat item picker read from there, so all surfaces share ONE list.
      updateLocalState('ownedPets', owned);
      updateLocalState('wishlistPets', wishlist);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.id, firestoreDB]);

  // Parse values data for lookups (merge regular + supreme)
  const parsedData = useMemo(() => {
    const parse = (raw) => {
      try {
        if (!raw) return [];
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!p || typeof p !== 'object') return [];
        // MM2 data is nested: {category: {tier: [{name, value, ...}]}}
        const items = [];
        for (const tiers of Object.values(p)) {
          if (tiers && typeof tiers === 'object') {
            for (const arr of Object.values(tiers)) {
              if (Array.isArray(arr)) {
                items.push(...arr);
              }
            }
          }
        }
        return items;
      } catch { return []; }
    };
    return [...parse(localState?.data), ...parse(localState?.suprime)];
  }, [localState?.data, localState?.suprime]);

  const lookupVal = useCallback((item) => {
    if (!item?.name || !parsedData.length) return Number(String(item?.value || 0).replace(/,/g, '')) || 0;
    const n = (item.name || '').toLowerCase().trim();
    const f = parsedData.find(d => (d?.name || '').toLowerCase().trim() === n);
    if (f) {
      const v = Number(String(f.value || 0).replace(/,/g, ''));
      if (v) return v;
      const rv = Number(String(f.rvalue || 0).replace(/,/g, ''));
      if (rv) return rv;
    }
    return Number(String(item?.value || 0).replace(/,/g, '')) || 0;
  }, [parsedData]);

  // Portfolio stats
  const stats = useMemo(() => {
    const items = activeTab === 'items' ? ownedPets : wishlistPets;
    const total = items.reduce((s, p) => s + lookupVal(p), 0);
    return { count: items.length, total };
  }, [activeTab, ownedPets, wishlistPets, lookupVal]);

  // Goal progress stats
  const goalStats = useMemo(() => {
    if (wishlistPets.length === 0 || ownedPets.length === 0) return { reachable: 0, total: wishlistPets.length };
    const ownedSorted = ownedPets.map(p => lookupVal(p)).sort((a, b) => b - a);
    const bestVal = ownedSorted[0] || 0;
    let reachable = 0;
    wishlistPets.forEach(p => {
      const v = lookupVal(p);
      if (v > 0 && bestVal >= v) reachable++;
    });
    return { reachable, total: wishlistPets.length };
  }, [wishlistPets, ownedPets, lookupVal]);

  // Save to Firestore
  const savePetsToReviews = useCallback(async (newOwned, newWishlist) => {
    if (!user?.id || !firestoreDB) return;
    const userReviewRef = doc(firestoreDB, 'reviews', user.id);
    await setDoc(
      userReviewRef,
      { ownedPets: newOwned, wishlistPets: newWishlist, updatedAt: serverTimestamp() },
      { merge: true },
    );
    setOwnedPets(newOwned);
    setWishlistPets(newWishlist);
  }, [user?.id, firestoreDB]);

  // Keep FCM value-alert topics in sync with the portfolio: one topic per
  // owned/wishlist item. Runs on initial Firestore load and after every
  // add/remove (both paths land in these two states). Diffed in MMKV, so
  // repeat renders are no-ops.
  useEffect(() => {
    const names = [...ownedPets, ...wishlistPets].map((p) => p?.name).filter(Boolean);
    syncValueAlertTopics(names);
  }, [ownedPets, wishlistPets]);

  const handleAddItems = useCallback((forOwned) => {
    if (!user?.id) { setSigninVisible(true); return; }
    setPetModalOwned(forOwned);
    setPetModalVisible(true);
  }, [user?.id]);

  const removeOwnedPet = useCallback((index) => {
    const newOwned = ownedPets.filter((_, i) => i !== index);
    setOwnedPets(newOwned);
    savePetsToReviews(newOwned, wishlistPets);
  }, [ownedPets, wishlistPets, savePetsToReviews]);

  const removeWishlistPet = useCallback((index) => {
    const newWishlist = wishlistPets.filter((_, i) => i !== index);
    setWishlistPets(newWishlist);
    savePetsToReviews(ownedPets, newWishlist);
  }, [ownedPets, wishlistPets, savePetsToReviews]);

  const currentList = activeTab === 'items' ? ownedPets : wishlistPets;

  // Render compact item card
  const renderItem = useCallback(({ item, index }) => {
    const val = lookupVal(item);
    return (
      <View style={[$.card, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
        {/* Remove button */}
        <TouchableOpacity
          onPress={() => removeOwnedPet(index)}
          style={$.cardRemoveBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <FontAwesome name="xmark" size={9} color="#fff" />
        </TouchableOpacity>
        <Image
          source={{ uri: item.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={$.cardImage}
          resizeMode="contain"
        />
        <Text style={[$.cardName, { color: C.text }]} numberOfLines={1}>
          {item.name || t('mystuff.unknown')}
        </Text>
        {val > 0 && (
          <View style={[$.cardValueBadge, { backgroundColor: config.colors.primary + '18' }]}>
            <Text style={[$.cardValueText, { color: config.colors.primary }]}>
              {fmt(val)}
            </Text>
          </View>
        )}
      </View>
    );
  }, [lookupVal, C, removeOwnedPet]);

  // ── Intelligent Goal Card ──
  const renderGoalCard = useCallback(({ item, index }) => {
    const petVal = lookupVal(item);
    const ownedSorted = ownedPets.map(p => ({ name: p.name, value: lookupVal(p) }))
      .filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    const bestOwnedValue = ownedSorted.length > 0 ? ownedSorted[0].value : 0;

    // Progress
    const progress = petVal > 0 && bestOwnedValue > 0
      ? Math.min(1, bestOwnedValue / petVal) : 0;
    const canAfford = petVal > 0 && bestOwnedValue >= petVal;
    const pct = Math.round(progress * 100);

    // Difficulty
    let difficulty;
    if (canAfford) {
      difficulty = { label: t('mystuff.reachable'), color: '#10B981', bg: '#D1FAE5', emoji: '✅' };
    } else if (progress >= 0.7) {
      difficulty = { label: t('mystuff.almost'), color: '#3B82F6', bg: '#DBEAFE', emoji: '🎯' };
    } else if (progress >= 0.3) {
      difficulty = { label: t('mystuff.building'), color: '#F59E0B', bg: '#FEF3C7', emoji: '⚡' };
    } else {
      difficulty = { label: t('mystuff.dreaming'), color: '#94a3b8', bg: '#F1F5F9', emoji: '💭' };
    }

    // Smart tip
    const closestPet = ownedSorted.find(op => op.value >= petVal * 0.7 && op.value <= petVal * 2.5);
    let tip = null;
    if (canAfford && closestPet) {
      tip = { emoji: '🎉', text: t('mystuff.tip_trade', { name: closestPet.name }), color: '#10B981' };
    } else if (closestPet && closestPet.value >= petVal * 0.7 && closestPet.value < petVal) {
      const gap = petVal - closestPet.value;
      tip = { emoji: '🤏', text: t('mystuff.tip_close', { name: closestPet.name, gap: fmt(gap) }), color: '#3B82F6' };
    } else if (ownedPets.length === 0) {
      tip = { emoji: '📦', text: t('mystuff.tip_add_first'), color: '#F59E0B' };
    } else if (petVal > 0 && bestOwnedValue > 0 && bestOwnedValue < petVal * 0.3) {
      tip = { emoji: '📈', text: t('mystuff.tip_keep_going'), color: '#F59E0B' };
    } else if (petVal > 0 && bestOwnedValue >= petVal * 0.3) {
      tip = { emoji: '💪', text: t('mystuff.tip_getting_closer'), color: '#3B82F6' };
    }

    return (
      <View style={[$.goalCard, {
        backgroundColor: C.bgAlt,
        borderLeftWidth: 3,
        borderLeftColor: difficulty.color,
      }]}>
        {/* Row: Image + Info + Delete */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            source={{ uri: item.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
            style={$.goalImage}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }}>
            <Text style={[$.goalName, { color: C.text }]} numberOfLines={1}>{item.name || t('mystuff.unknown')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
              {petVal > 0 && (
                <View style={[$.pill, { backgroundColor: C.bg }]}>
                  <Text style={[$.pillText, { color: '#3B82F6' }]}>💎 {fmt(petVal)}</Text>
                </View>
              )}
              <View style={[$.pill, { backgroundColor: difficulty.bg }]}>
                <Text style={[$.pillText, { color: difficulty.color }]}>{difficulty.emoji} {difficulty.label}</Text>
              </View>
              {petVal > 0 && ownedPets.length > 0 && (
                <View style={[$.pill, { backgroundColor: C.bg }]}>
                  <Text style={[$.pillText, { color: canAfford ? '#10B981' : C.textSecondary }]}>{pct}%</Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={() => removeWishlistPet(index)} style={{ padding: 6 }}>
            <FontAwesome name="xmark" size={12} color="#cbd5e1" />
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        {petVal > 0 && ownedPets.length > 0 && (
          <View style={[$.progressBg, { backgroundColor: C.bg, marginTop: 8 }]}>
            <View style={[$.progressFill, {
              width: `${Math.max(3, pct)}%`,
              backgroundColor: canAfford ? '#10B981' : progress >= 0.7 ? '#3B82F6' : '#94a3b8',
            }]} />
          </View>
        )}

        {/* Smart tip */}
        {tip && (
          <Text style={{ fontSize: 10, color: tip.color, fontWeight: '600', marginTop: 6 }}>
            {tip.emoji} {tip.text}
          </Text>
        )}
      </View>
    );
  }, [lookupVal, ownedPets, C, removeWishlistPet, t]);

  // ── Trade history: Firestore trade_journal/{uid}/trades, newest first ──
  const fetchHistory = useCallback(async (reset = false) => {
    if (!user?.id || !firestoreDB) { setHistoryLoaded(true); return; }
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const base = collection(firestoreDB, 'trade_journal', user.id, 'trades');
      const q = (!reset && historyLastDoc)
        ? query(base, orderBy('createdAt', 'desc'), startAfter(historyLastDoc), limit(HISTORY_PAGE))
        : query(base, orderBy('createdAt', 'desc'), limit(HISTORY_PAGE));
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (reset) historyRevisionRef.current = getJournalRevision();
      setHistory(prev => (reset ? rows : [...prev, ...rows]));
      setHistoryLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setHistoryHasMore(snap.docs.length >= HISTORY_PAGE);
    } catch (e) {
      console.warn('[MyStuff] history error:', e?.message);
    } finally {
      setHistoryLoading(false);
      setHistoryLoaded(true);
    }
  }, [user?.id, firestoreDB, historyLastDoc, historyLoading]);

  // Load lazily — only when the tab is first opened
  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded) fetchHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, historyLoaded]);

  const invalidateHistory = useCallback(() => {
    setHistory([]);
    setHistoryLastDoc(null);
    setHistoryHasMore(true);
    setHistoryLoaded(false);
  }, []);

  // Reset when the signed-in user changes
  useEffect(() => { invalidateHistory(); }, [user?.id, invalidateHistory]);

  // Re-fetch on focus ONLY when a trade was actually logged since the last
  // fetch. Blindly invalidating here would re-read 15 docs (and discard any
  // pages already scrolled) every single time this screen regains focus.
  useFocusEffect(useCallback(() => {
    if (getJournalRevision() !== historyRevisionRef.current) invalidateHistory();
  }, [invalidateHistory]));

  const historyStats = useMemo(() => {
    const s = { total: history.length, win: 0, fair: 0, loss: 0, given: 0, received: 0 };
    history.forEach(h => {
      if (s[h.result] !== undefined) s[h.result]++;
      s.given += Number(h.givenValue) || 0;
      s.received += Number(h.receivedValue) || 0;
    });
    s.net = s.received - s.given;
    return s;
  }, [history]);

  // Remove a single logged trade. Optimistic: the row disappears immediately
  // and is restored if the delete fails, so the list never lies about what's
  // actually stored.
  const handleDeleteEntry = useCallback((entry) => {
    if (!user?.id || !firestoreDB || !entry?.id) return;
    Alert.alert(
      t('mystuff.delete_entry_title', { defaultValue: 'Delete this trade?' }),
      t('mystuff.delete_entry_msg', { defaultValue: 'It will be removed from your history. This cannot be undone.' }),
      [
        { text: t('mystuff.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('mystuff.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            const snapshot = history;
            setHistory(prev => prev.filter(h => h.id !== entry.id));
            try {
              await deleteJournalEntry(firestoreDB, user.id, entry.id);
              historyRevisionRef.current = getJournalRevision();
            } catch (e) {
              console.warn('[MyStuff] delete entry error:', e?.message);
              setHistory(snapshot); // put it back — the delete didn't happen
              Alert.alert(t('mystuff.delete_failed', { defaultValue: 'Could not delete that trade' }), e?.message || '');
            }
          },
        },
      ],
    );
  }, [user?.id, firestoreDB, history, t]);

  // Destructive and irreversible — always confirm, and name the count so the
  // user knows exactly what they're about to lose.
  const handleClearHistory = useCallback(() => {
    if (!user?.id || !firestoreDB || clearingHistory) return;
    Alert.alert(
      t('mystuff.clear_history_title', { defaultValue: 'Clear trade history?' }),
      t('mystuff.clear_history_msg', {
        defaultValue: 'This permanently deletes every logged trade. Your items and goals are not affected. This cannot be undone.',
      }),
      [
        { text: t('mystuff.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('mystuff.clear_history', { defaultValue: 'Clear History' }),
          style: 'destructive',
          onPress: async () => {
            setClearingHistory(true);
            try {
              await clearJournal(firestoreDB, user.id);
              setHistory([]);
              setHistoryLastDoc(null);
              setHistoryHasMore(false);
              historyRevisionRef.current = getJournalRevision();
            } catch (e) {
              console.warn('[MyStuff] clear history error:', e?.message);
              Alert.alert(
                t('mystuff.clear_failed', { defaultValue: 'Could not clear history' }),
                e?.message || ''
              );
            } finally {
              setClearingHistory(false);
            }
          },
        },
      ],
    );
  }, [user?.id, firestoreDB, clearingHistory, t]);

  // Stats panel above the timeline — result mix, win rate, value flow.
  // Reflects the rows loaded so far, so it grows as more pages are pulled in.
  const historyHeader = useMemo(() => {
    const { total, win, fair, loss, given, received, net } = historyStats;
    if (!total) return null;
    const winRate = Math.round((win / total) * 100);
    const legend = [
      { key: 'win', n: win, color: RESULT_META.win.color, label: t('mystuff.wins', { defaultValue: 'Wins' }) },
      { key: 'fair', n: fair, color: RESULT_META.fair.color, label: t('mystuff.fair', { defaultValue: 'Fair' }) },
      { key: 'loss', n: loss, color: RESULT_META.loss.color, label: t('mystuff.losses', { defaultValue: 'Losses' }) },
    ];

    return (
      <View style={[$.statsPanel, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
        <View style={$.statsTopRow}>
          <Text style={[$.statsTitle, { color: C.text }]}>
            📊 {t('mystuff.trade_results', { defaultValue: 'Trade Results' })}
          </Text>
          <Text style={[$.winRate, { color: config.colors.primary }]}>
            {winRate}% {t('mystuff.win_rate', { defaultValue: 'win rate' })}
          </Text>
        </View>

        {/* Stacked result bar — segments sized by share of trades */}
        <View style={[$.resultBar, { backgroundColor: C.border }]}>
          {legend.map(seg => seg.n > 0 && (
            <View key={seg.key} style={{ flex: seg.n, backgroundColor: seg.color }} />
          ))}
        </View>

        <View style={$.legendRow}>
          {legend.map(seg => (
            <View key={seg.key} style={$.legendItem}>
              <View style={[$.legendDot, { backgroundColor: seg.color }]} />
              <Text style={[$.legendText, { color: C.textSecondary }]}>{seg.label} {seg.n}</Text>
            </View>
          ))}
        </View>

        <View style={[$.statsDivider, { backgroundColor: C.border }]} />

        <View style={$.statsValueRow}>
          <Text style={[$.statsValueLabel, { color: C.textSecondary }]}>{t('mystuff.value_given', { defaultValue: 'Value Given' })}</Text>
          <Text style={[$.statsValueNum, { color: '#EF4444' }]}>{fmt(given)}</Text>
        </View>
        <View style={$.statsValueRow}>
          <Text style={[$.statsValueLabel, { color: C.textSecondary }]}>{t('mystuff.value_received', { defaultValue: 'Value Received' })}</Text>
          <Text style={[$.statsValueNum, { color: '#10B981' }]}>{fmt(received)}</Text>
        </View>
        <View style={$.statsValueRow}>
          <Text style={[$.statsValueLabel, { color: C.text, fontWeight: '800' }]}>{t('mystuff.net', { defaultValue: 'Net' })}</Text>
          <Text style={[$.statsValueNum, { color: net >= 0 ? '#10B981' : '#EF4444', fontWeight: '900' }]}>
            {net >= 0 ? '+' : '−'}{fmt(Math.abs(net))}
          </Text>
        </View>

        {historyHasMore && (
          <Text style={[$.statsFootnote, { color: C.textSecondary }]}>
            {t('mystuff.stats_partial', { defaultValue: 'Based on trades loaded so far — scroll for more.' })}
          </Text>
        )}

        <TouchableOpacity
          style={[$.clearBtn, { borderColor: '#EF444455' }]}
          onPress={handleClearHistory}
          disabled={clearingHistory}
          activeOpacity={0.7}
        >
          {clearingHistory
            ? <ActivityIndicator size="small" color="#EF4444" />
            : (
              <>
                <FontAwesome name="trash-can" size={11} color="#EF4444" solid />
                <Text style={$.clearBtnText}>
                  {t('mystuff.clear_history', { defaultValue: 'Clear History' })}
                </Text>
              </>
            )}
        </TouchableOpacity>
      </View>
    );
  }, [historyStats, historyHasMore, C, t, handleClearHistory, clearingHistory]);

  const renderHistoryCard = useCallback(({ item }) => {
    const meta = RESULT_META[item.result] || RESULT_META.fair;
    const date = item.createdAt?.toDate
      ? item.createdAt.toDate().toLocaleDateString()
      : '';
    return (
      <View style={[$.histCard, { backgroundColor: C.bgAlt, borderLeftColor: meta.color }]}>
        <View style={$.histTop}>
          <View style={[$.histBadge, { backgroundColor: meta.color + '1F' }]}>
            <Text style={{ fontSize: 11 }}>{meta.emoji}</Text>
            <Text style={[$.histBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[$.histDate, { color: C.textSecondary }]}>{date}</Text>
            <TouchableOpacity
              onPress={() => handleDeleteEntry(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name="trash-can" size={12} color={C.textSecondary} solid />
            </TouchableOpacity>
          </View>
        </View>

        <View style={$.histBody}>
          <View style={{ flex: 1 }}>
            <Text style={[$.histSideLabel, { color: C.textSecondary }]}>{t('mystuff.gave', { defaultValue: 'Gave' })}</Text>
            <Text style={[$.histItems, { color: C.text }]} numberOfLines={2}>{item.given || '—'}</Text>
            <Text style={[$.histValue, { color: '#EF4444' }]}>{fmt(Number(item.givenValue) || 0)}</Text>
          </View>
          <FontAwesome name="right-left" size={12} color={C.textSecondary} solid style={{ alignSelf: 'center', marginHorizontal: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={[$.histSideLabel, { color: C.textSecondary }]}>{t('mystuff.got', { defaultValue: 'Got' })}</Text>
            <Text style={[$.histItems, { color: C.text }]} numberOfLines={2}>{item.received || '—'}</Text>
            <Text style={[$.histValue, { color: '#10B981' }]}>{fmt(Number(item.receivedValue) || 0)}</Text>
          </View>
        </View>

        {!!item.note && (
          <Text style={[$.histNote, { color: C.textSecondary }]} numberOfLines={2}>📝 {item.note}</Text>
        )}
      </View>
    );
  }, [C, t, handleDeleteEntry]);

  const tabWidth = (W - 32) / TABS.length;
  const indicatorTranslateX = tabAnim.interpolate({
    inputRange: TABS.map((_, i) => i),
    outputRange: TABS.map((_, i) => i * tabWidth),
  });

  if (loading) {
    return (
      <View style={[$.root, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 80 }} />
      </View>
    );
  }

  return (
    <View style={[$.root, { backgroundColor: C.bg }]}>
      {/* Portfolio Summary Card — on History it summarizes logged trades */}
      {activeTab === 'history' ? (
        <View style={[$.summaryCard, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
          <View style={$.summaryLeft}>
            <Text style={[$.summaryLabel, { color: C.textSecondary }]}>
              {t('mystuff.net_gain', { defaultValue: 'Net Gain' })}
            </Text>
            <Text style={[$.summaryValue, { color: historyStats.net >= 0 ? '#10B981' : '#EF4444' }]}>
              {historyStats.net >= 0 ? '+' : '−'}{fmt(Math.abs(historyStats.net))}
            </Text>
          </View>
          <View style={[$.summaryDivider, { backgroundColor: C.border }]} />
          <View style={$.summaryRight}>
            <Text style={[$.summaryLabel, { color: C.textSecondary }]}>
              {t('mystuff.record', { defaultValue: 'W / F / L' })}
            </Text>
            <Text style={[$.summaryCount, { color: C.text }]}>
              {historyStats.win}/{historyStats.fair}/{historyStats.loss}
            </Text>
          </View>
        </View>
      ) : (
        <View style={[$.summaryCard, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
          <View style={$.summaryLeft}>
            <Text style={[$.summaryLabel, { color: C.textSecondary }]}>
              {activeTab === 'items' ? t('mystuff.inventory_value') : t('mystuff.goals_value')}
            </Text>
            <Text style={[$.summaryValue, { color: C.text }]}>
              💎 {stats.total.toLocaleString()}
            </Text>
          </View>
          <View style={[$.summaryDivider, { backgroundColor: C.border }]} />
          <View style={$.summaryRight}>
            <Text style={[$.summaryLabel, { color: C.textSecondary }]}>
              {activeTab === 'goals' ? t('mystuff.reachable_label') : t('mystuff.items_count')}
            </Text>
            <Text style={[$.summaryCount, { color: C.text }]}>
              {activeTab === 'goals'
                ? `${goalStats.reachable}/${goalStats.total}`
                : stats.count}
            </Text>
          </View>
        </View>
      )}

      {/* Tab Switcher */}
      <View style={[$.tabBar, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
        <Animated.View
          style={[
            $.tabIndicator,
            {
              width: tabWidth,
              backgroundColor: config.colors.primary + '18',
              borderColor: config.colors.primary + '40',
              transform: [{ translateX: indicatorTranslateX }],
            },
          ]}
        />
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={$.tabBtn}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16 }}>{tab.emoji}</Text>
              <Text
                style={[
                  $.tabLabel,
                  { color: active ? config.colors.primary : C.textSecondary },
                  active && { fontWeight: '800' },
                ]}
              >
                {t(tab.labelKey, { defaultValue: tab.label })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── HISTORY TAB ── */}
      {activeTab === 'history' && (
        historyLoading && history.length === 0 ? (
          <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 60 }} />
        ) : history.length === 0 ? (
          <View style={$.emptyWrap}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📋</Text>
            <Text style={[$.emptyTitle, { color: C.text }]}>
              {t('mystuff.no_history_yet', { defaultValue: 'No trades logged yet' })}
            </Text>
            <Text style={[$.emptySubtitle, { color: C.textSecondary }]}>
              {user?.id
                ? t('mystuff.history_desc', { defaultValue: 'Calculate a trade, then tap "Log Trade" to record it here.' })
                : t('mystuff.sign_in_desc')}
            </Text>
          </View>
        ) : (
          <FlatList
            key="history-list"
            data={history}
            keyExtractor={(item, i) => `hist-${item.id || i}`}
            renderItem={renderHistoryCard}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 180 }}
            showsVerticalScrollIndicator={false}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (historyHasMore && !historyLoading) fetchHistory(false); }}
            ListHeaderComponent={historyHeader}
            ListFooterComponent={
              historyLoading && history.length > 0
                ? <ActivityIndicator color={config.colors.primary} style={{ marginVertical: 16 }} />
                : null
            }
          />
        )
      )}

      {/* ── ITEMS TAB ── */}
      {activeTab === 'items' && (
        currentList.length === 0 ? (
          <View style={$.emptyWrap}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📦</Text>
            <Text style={[$.emptyTitle, { color: C.text }]}>
              {t('mystuff.no_items_yet')}
            </Text>
            <Text style={[$.emptySubtitle, { color: C.textSecondary }]}>
              {user?.id ? t('mystuff.add_items_desc') : t('mystuff.sign_in_desc')}
            </Text>
            <TouchableOpacity
              style={[$.addBtn, { backgroundColor: config.colors.primary }]}
              onPress={() => handleAddItems(true)}
              activeOpacity={0.8}
            >
              <FontAwesome name="plus" size={14} color="#fff" solid />
              <Text style={$.addBtnText}>
                {user?.id ? t('mystuff.add_items') : t('mystuff.sign_in')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            key="items-grid"
            data={currentList}
            keyExtractor={(item, i) => `${item.id || item.name || i}-${i}`}
            renderItem={renderItem}
            numColumns={GRID_COLS}
            columnWrapperStyle={$.gridRow}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 180 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <TouchableOpacity
                style={[$.addBarBtn, { borderColor: config.colors.primary + '50' }]}
                onPress={() => handleAddItems(true)}
                activeOpacity={0.7}
              >
                <FontAwesome name="pen-to-square" size={12} color={config.colors.primary} solid />
                <Text style={[$.addBarText, { color: config.colors.primary }]}>
                  {t('mystuff.edit_items')}
                </Text>
              </TouchableOpacity>
            }
          />
        )
      )}

      {/* ── GOALS TAB ── */}
      {activeTab === 'goals' && (
        wishlistPets.length === 0 ? (
          <View style={$.emptyWrap}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🎯</Text>
            <Text style={[$.emptyTitle, { color: C.text }]}>
              {t('mystuff.no_goals_yet')}
            </Text>
            <Text style={[$.emptySubtitle, { color: C.textSecondary }]}>
              {user?.id ? t('mystuff.add_goals_desc') : t('mystuff.sign_in_desc')}
            </Text>
            <TouchableOpacity
              style={[$.addBtn, { backgroundColor: '#F59E0B' }]}
              onPress={() => handleAddItems(false)}
              activeOpacity={0.8}
            >
              <FontAwesome name="plus" size={14} color="#fff" solid />
              <Text style={$.addBtnText}>
                {user?.id ? t('mystuff.add_items') : t('mystuff.sign_in')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            key="goals-list"
            data={wishlistPets}
            keyExtractor={(item, i) => `goal-${item.name || i}-${i}`}
            renderItem={renderGoalCard}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 180 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <TouchableOpacity
                style={[$.addBarBtn, { borderColor: '#F59E0B50' }]}
                onPress={() => handleAddItems(false)}
                activeOpacity={0.7}
              >
                <FontAwesome name="pen-to-square" size={12} color="#F59E0B" solid />
                <Text style={[$.addBarText, { color: '#F59E0B' }]}>
                  {t('mystuff.edit_goals')}
                </Text>
              </TouchableOpacity>
            }
          />
        )
      )}

      {/* PetModal */}
      <PetModal
        fromSetting={true}
        ownedPets={ownedPets}
        setOwnedPets={setOwnedPets}
        wishlistPets={wishlistPets}
        setWishlistPets={setWishlistPets}
        onClose={async () => {
          setPetModalVisible(false);
          await savePetsToReviews(ownedPets, wishlistPets);
        }}
        visible={petModalVisible}
        owned={petModalOwned}
      />

      {/* Sign In Drawer */}
      <SignInDrawer
        visible={signinVisible}
        onClose={() => setSigninVisible(false)}
        selectedTheme={selectedTheme}
        screen="MyStuff"
        message={t('mystuff.sign_in_manage')}
      />
    </View>
  );
};

const $ = StyleSheet.create({
  root: { flex: 1 },

  // Summary Card
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 8,
    marginBottom: 10,
  },
  summaryLeft: { flex: 1 },
  summaryRight: { alignItems: 'center', paddingLeft: 16 },
  summaryDivider: { width: 1, height: 32, marginHorizontal: 0 },
  summaryLabel: { fontSize: 10, fontWeight: '600', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 20, fontWeight: '900' },
  summaryCount: { fontSize: 20, fontWeight: '900' },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    zIndex: 2,
  },
  tabLabel: { fontSize: 12, fontWeight: '700' },
  tabIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 10,
    borderWidth: 1.5,
    zIndex: 1,
  },

  // Grid — compact 4-col
  gridRow: { gap: CARD_GAP, marginBottom: CARD_GAP },
  card: {
    width: CARD_W,
    borderRadius: 10,
    borderWidth: 1,
    padding: 6,
    alignItems: 'center',
    position: 'relative',
  },
  cardRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 5,
    backgroundColor: '#EF4444',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImage: {
    width: CARD_W - 20,
    height: CARD_W - 20,
    borderRadius: 8,
    marginBottom: 4,
  },
  cardName: {
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  cardValueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cardValueText: {
    fontSize: 8,
    fontWeight: '800',
  },

  // Goal Card
  // Trade history stats panel
  statsPanel: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  statsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  statsTitle: { fontSize: 13, fontWeight: '800' },
  winRate: { fontSize: 12, fontWeight: '800' },
  resultBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: '600' },
  statsDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  statsValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  statsValueLabel: { fontSize: 11, fontWeight: '600' },
  statsValueNum: { fontSize: 12, fontWeight: '800' },
  statsFootnote: { fontSize: 9, fontWeight: '500', marginTop: 10, fontStyle: 'italic' },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1,
  },
  clearBtnText: { fontSize: 11, fontWeight: '800', color: '#EF4444' },

  // Trade history rows — left rail coloured by result, matching goalCard metrics
  histCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  histTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  histBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  histBadgeText: { fontSize: 10, fontWeight: '800' },
  histDate: { fontSize: 10, fontWeight: '600' },
  histBody: { flexDirection: 'row', alignItems: 'flex-start' },
  histSideLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  histItems: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  histValue: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  histNote: { fontSize: 11, fontWeight: '500', marginTop: 8, fontStyle: 'italic' },

  goalCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  goalImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  goalName: {
    fontSize: 13,
    fontWeight: '700',
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pillText: {
    fontSize: 9,
    fontWeight: '700',
  },
  progressBg: {
    height: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 3,
  },

  // Empty
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Add bar
  addBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  addBarText: { fontSize: 12, fontWeight: '700' },
});

export default MyStuffScreen;
