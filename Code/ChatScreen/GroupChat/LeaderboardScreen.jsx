import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline } from '../utils';
import UserBadgePill, { CustomBadgePills } from '../../Helper/UserBadgePill';
import { getRoster, useRoleRosterVersion } from '../../Helper/roleRoster';
import { normalizeWorn } from '../../Helper/customBadges';
import { getOrFetchProfile, getCachedProfile } from '../../Helper/profileCache';

// Role tabs read the live rosters (Code/Helper/roleRoster.js: /trusted, /cmsr,
// /helper, kept by functions/syncRoleRosters.js) and the Custom tab the live
// worn_badges node (Code/Helper/customBadges.js) — no extra reads beyond the
// listeners the chat already keeps. 2026-10-31.
const TABS = [
  { key: 'topRated', labelKey: 'leaderboard.tab_top_rated', icon: 'medal',            color: '#F59E0B' },
  { key: 'trusted',  labelKey: 'badges.role_trusted',       icon: 'checkmark-circle', color: '#10B981', type: 'trusted' },
  { key: 'cmsr',     labelKey: 'badges.role_cmsr',          icon: 'briefcase',        color: '#F97316', type: 'cmsr' },
  { key: 'helper',   labelKey: 'badges.role_helper',        icon: 'hand-left',        color: '#14B8A6', type: 'helper' },
  { key: 'custom',   labelKey: 'leaderboard.tab_custom',    icon: 'sparkles',         color: '#A855F7' },
];

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds (local app cache)
// Note: Leaderboard data is pre-computed daily by Cloud Function with rating >= 3.7

const LeaderboardScreen = ({ route }) => {
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('topRated');
  // Re-render when a roster / worn_badges changes; also names for the Custom tab.
  const rosterVersion = useRoleRosterVersion(appdatabase);
  const [, setNamesVersion] = useState(0);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [bannedUsers] = useState(Array.isArray(localState.bannedUsers) ? localState.bannedUsers : []);
  // Guards against a repeat fetch while this screen stays focused
  const fetchedRef = useRef(false);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Check if cached data is still valid (less than 2 days old)
  const isCacheValid = useCallback((cachedData) => {
    if (!cachedData || !cachedData.timestamp) return false;
    
    // ✅ Ensure timestamp is a number (handle cases where it might be stored as string)
    const timestamp = typeof cachedData.timestamp === 'number' 
      ? cachedData.timestamp 
      : typeof cachedData.timestamp === 'string' 
        ? parseInt(cachedData.timestamp, 10) 
        : null;
    
    if (!timestamp || isNaN(timestamp)) return false;
    
    const now = Date.now();
    const cacheAge = now - timestamp;
    
    // ✅ Cache is valid only if less than 2 days old
    const isValid = cacheAge >= 0 && cacheAge < CACHE_DURATION_MS;
    
    // ✅ Debug: Log cache status if needed (commented out for production)
    // console.log('📊 [Leaderboard] Cache check:', {
    //   cacheAge: `${Math.floor(cacheAge / (1000 * 60 * 60))}h ${Math.floor((cacheAge % (1000 * 60 * 60)) / (1000 * 60))}m`,
    //   isValid,
    //   timestamp: new Date(timestamp).toISOString(),
    //   now: new Date(now).toISOString(),
    // });
    
    return isValid;
  }, []);

  // ✅ OPTIMIZED: Fetch pre-computed leaderboard from cached collection
  // Uses Cloud Function that runs daily to pre-compute top 50 users
  // Priority #1: NUMBER OF REVIEWS (most reviewed first)
  // Filter: Rating >= 3.7 (applied in Cloud Function)
  // 
  // Strategy: Read from leaderboard_cache/top50 document (pre-computed daily)
  // Cost: ONLY 1 Firestore read (most cost-effective!)
  // 
  // Benefits:
  // - Pre-computed: No querying/filtering on app load
  // - Fast: Single document read (very fast)
  // - Accurate: Shows most reviewed users with >= 3.7 rating
  const fetchLeaderboard = useCallback(async () => {
    if (!firestoreDB || !user?.id) {
      return;
    }

    setLoading(true);
    try {
      // ✅ OPTIMIZED: Read from pre-computed cached leaderboard
      // Cloud Function runs daily to update this document
      // This is a single document read - very fast and cheap!
      const cacheDocRef = doc(firestoreDB, 'leaderboard_cache', 'top50');
      const cacheDocSnap = await getDoc(cacheDocRef);
      
      // ✅ Firestore: exists is a property, not a function
      if (!cacheDocSnap.exists()) {
        // Cache not initialized yet — Cloud Function hasn't run
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      const cacheData = cacheDocSnap.data();
      const cachedUsers = cacheData?.users || [];
      
      if (cachedUsers.length === 0) {
        // Cache is empty — waiting for Cloud Function
        setLeaderboardData([]);
        setLoading(false);
        return;
      }
      
      // ✅ Users are already sorted by review count (desc), then rating (desc)
      // Users are already filtered for rating >= 3.7
      // Users already have displayName and avatar included
      // Just assign ranks (they should already have ranks, but we ensure consistency)
      const leaderboardWithDetails = cachedUsers.map((user, index) => ({
        userId: user.userId,
        ratingCount: user.ratingCount || 0,
        averageRating: user.averageRating || 0,
        displayName: user.displayName || t('private_chat.anonymous'),
        avatar: user.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        rank: index + 1, // Ensure rank is 1-based (though it should already be set)
        updatedAt: user.updatedAt || Date.now(),
      }));

      // ✅ Save to local cache (2-day caching)
      // Cache includes the timestamp from Cloud Function's lastUpdated field
      // ⚠️ `timestamp` MUST be when *we* fetched, not the server doc's
      // lastUpdated. It drives a LOCAL 2-day TTL, and this write is in the
      // focus effect's dep list — stamping an already-stale server time made
      // the freshly written cache instantly invalid, so the effect re-ran and
      // re-fetched in an unbounded loop for as long as the screen was focused.
      // The server's time is kept separately for display/debugging.
      const localCacheData = {
        data: leaderboardWithDetails,
        timestamp: Date.now(),
        lastFetched: cacheData.lastUpdated?.toDate?.()?.toISOString() || new Date().toISOString(),
        cloudFunctionUpdated: cacheData.lastUpdated?.toDate?.()?.toISOString() || null,
      };
      updateLocalState('leaderboardTop50', localCacheData);

      setLeaderboardData(leaderboardWithDetails);
    } catch (error) {
      // Cache fetch failed — expected if Cloud Function hasn't run yet
      
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, user?.id, updateLocalState]);

  // ✅ Load leaderboard data (check cache first) - using useFocusEffect like InboxScreen
  useFocusEffect(
    useCallback(() => {
      const cachedData = localState.leaderboardTop50;

      // ✅ Check if cache is valid (less than 2 days old)
      if (cachedData && cachedData.data && cachedData.data.length > 0 && isCacheValid(cachedData)) {
        // ✅ Use cached data (still fresh, less than 2 days old)
        setLeaderboardData(cachedData.data);
        setLoading(false);
      } else if (!fetchedRef.current) {
        // Cache expired or missing — fetch once per focus. The ref guard is a
        // belt-and-braces stop against this effect re-triggering itself via
        // the cache it writes.
        fetchedRef.current = true;
        fetchLeaderboard();
      }
      return () => { fetchedRef.current = false; };
    }, [localState.leaderboardTop50, isCacheValid, fetchLeaderboard])
  );

  // ✅ Handle user click - open BottomDrawer
  const handleUserClick = useCallback(async (item) => {
    triggerHapticFeedback('impactLight');
    
    const selectedUserData = {
      senderId: item.userId,
      sender: item.displayName,
      avatar: item.avatar,
    };

    setSelectedUser(selectedUserData);

    // ✅ Check if user is online
    try {
      const online = await isUserOnline(item.userId);
      setIsOnline(online);
    } catch (error) {
      // silent
      setIsOnline(false);
    }

    setIsDrawerVisible(true);
  }, [triggerHapticFeedback]);

  // ✅ Handle start chat from BottomDrawer
  const handleStartChat = useCallback(() => {
    if (!selectedUser) return;

    setIsDrawerVisible(false);
    setTimeout(() => {
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: selectedUser.senderId,
            sender: selectedUser.sender,
            avatar: selectedUser.avatar,
          },
        });
      }
    }, 300);
  }, [selectedUser, navigation]);

  // Role rosters: { uid: { displayName, avatar, updatedAt } }, newest first.
  const rosterRows = useMemo(() => {
    if (activeTab === 'topRated' || activeTab === 'custom') return [];
    const node = getRoster(activeTab);
    return Object.keys(node)
      .map((uid) => ({ userId: uid, displayName: node[uid]?.displayName || 'Unknown', avatar: node[uid]?.avatar || null, updatedAt: Number(node[uid]?.updatedAt) || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeTab, rosterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom tab: everyone with a custom badge in worn_badges; names and avatars
  // from the profile cache (warmed here for anyone missing, one read each).
  const customRows = useMemo(() => {
    if (activeTab !== 'custom') return [];
    const node = getRoster('worn_badges');
    return Object.keys(node)
      .map((uid) => ({ uid, worn: normalizeWorn(node[uid]), updatedAt: Number(node[uid]?.updatedAt) || 0 }))
      .filter((r) => Object.keys(r.worn.custom).length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => {
        const p = getCachedProfile(r.uid);
        return { userId: r.uid, displayName: p?.displayName || null, avatar: p?.avatar || null, customBadges: r.worn.custom, badgeStyles: r.worn.styles };
      });
  }, [activeTab, rosterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== 'custom' || !appdatabase) return;
    const missing = customRows.filter((r) => !r.displayName).map((r) => r.userId).slice(0, 100);
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(missing.map((uid) => getOrFetchProfile(appdatabase, uid).catch(() => null)))
      .then(() => { if (alive) setNamesVersion((v) => v + 1); });
    return () => { alive = false; };
  }, [activeTab, customRows, appdatabase]);

  const renderRosterItem = useCallback(({ item }) => {
    const meta = TABS.find((tb) => tb.key === activeTab);
    return (
      <TouchableOpacity style={styles.userItem} onPress={() => handleUserClick(item)} activeOpacity={0.7}>
        <Image resizeMethod="resize"
          source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={styles.avatar}
        />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName || t('private_chat.anonymous')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {activeTab === 'custom'
              ? <CustomBadgePills roles={item} size="sm" isDarkMode={isDarkMode} />
              : <UserBadgePill type={meta.type} size="sm" isDarkMode={isDarkMode} />}
          </View>
        </View>
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick, activeTab, isDarkMode, t]);

  // ✅ Render leaderboard item
  const renderLeaderboardItem = useCallback(({ item, index }) => {
    const rank = index + 1;
    const rankColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : config.colors.primary;

    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => handleUserClick(item)}
        activeOpacity={0.7}
      >
        {/* Rank Badge */}
        <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>

        {/* Avatar */}
        <Image resizeMethod="resize"
          source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={styles.avatar}
        />

        {/* User Info */}
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.displayName || t('private_chat.anonymous')}
          </Text>
          <View style={styles.ratingInfo}>
            <Icon name="star" size={12} color="#FFD700" />
            <Text style={styles.ratingText}>
              {item.ratingCount === 1 ? t('leaderboard.rating_info_singular', { avg: item.averageRating.toFixed(1), count: item.ratingCount }) : t('leaderboard.rating_info_plural', { avg: item.averageRating.toFixed(1), count: item.ratingCount })}
            </Text>
          </View>
        </View>

        {/* Chat Icon */}
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick]);

  const activeMeta = TABS.find((tb) => tb.key === activeTab);
  const rosterData = activeTab === 'custom' ? customRows : rosterRows;

  return (
    <>
      <View style={styles.container}>
        {/* Tab bar: Top Rated + the role rosters + custom badges (2026-10-31). */}
        <View style={styles.tabBar}>
          {TABS.map((tb) => {
            const on = tb.key === activeTab;
            return (
              <TouchableOpacity key={tb.key} style={[styles.tab, on && { borderBottomColor: tb.color }]} onPress={() => { triggerHapticFeedback('impactLight'); setActiveTab(tb.key); }} activeOpacity={0.7}>
                <Icon name={tb.icon} size={15} color={on ? tb.color : (isDarkMode ? '#94a3b8' : '#64748b')} />
                <Text style={[styles.tabLabel, { color: on ? tb.color : (isDarkMode ? '#94a3b8' : '#64748b'), fontWeight: on ? '700' : '500' }]} numberOfLines={1}>
                  {t(tb.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {activeTab !== 'topRated' ? (
          rosterData.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name={activeMeta.icon} size={48} color={config.colors.primary} />
              <Text style={styles.emptyText}>{activeTab === 'custom' ? t('leaderboard.empty_custom') : t('leaderboard.empty_roster')}</Text>
            </View>
          ) : (
            <FlatList removeClippedSubviews={false}
              data={rosterData}
              renderItem={renderRosterItem}
              keyExtractor={(item) => item.userId}
              extraData={rosterVersion}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )
        ) : loading && leaderboardData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={config.colors.primary} />
            <Text style={styles.loadingText}>{t('leaderboard.loading_text')}</Text>
            <Text style={styles.loadingSubtext}>{t('leaderboard.loading_subtext')}</Text>
          </View>
        ) : leaderboardData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="trophy-outline" size={48} color={config.colors.primary} />
            <Text style={styles.emptyText}>{t('leaderboard.empty_text')}</Text>
            <Text style={styles.emptySubtext}>{t('leaderboard.empty_subtext')}</Text>
          </View>
        ) : (
          <FlatList removeClippedSubviews={false}
            data={leaderboardData}
            renderItem={renderLeaderboardItem}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Cache Info */}
        {activeTab === 'topRated' && localState.leaderboardTop50?.lastFetched && !loading && (
          <Text style={styles.cacheInfo}>
            {t('leaderboard.last_updated', { date: new Date(localState.leaderboardTop50.lastFetched).toLocaleDateString() })}
          </Text>
        )}
      </View>

      {/* BottomDrawer for user profile */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChat}
        selectedUser={selectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
      />
    </>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f2f2f7',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0',
    backgroundColor: isDarkMode ? config.colors.backgroundDark : '#fff',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 11,
    flexShrink: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#999' : '#666',
    fontFamily: 'Lato-Regular',
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
    fontFamily: 'Lato-Regular',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: isDarkMode ? '#999' : '#666',
    fontFamily: 'Lato-Regular',
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
    fontFamily: 'Lato-Regular',
  },
  listContent: {
    padding: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#f5f5f5',
    borderRadius: 12,
    marginHorizontal: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#e0e0e0',
  },
  userInfo: {
    flex: 1,
    marginRight: 8,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#fff' : '#000',
    marginBottom: 4,
  },
  ratingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 12,
    color: isDarkMode ? '#999' : '#666',
    fontFamily: 'Lato-Regular',
    marginLeft: 4,
  },
  cacheInfo: {
    fontSize: 10,
    color: isDarkMode ? '#666' : '#999',
    textAlign: 'center',
    padding: 8,
    fontFamily: 'Lato-Regular',
  },
});

export default LeaderboardScreen;

