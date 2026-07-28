import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, Animated, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useNavigation } from '@react-navigation/native';

import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import NativeAdCard from '../Ads/NativeAdCard';
import { releaseByPrefix as releaseNativeAds } from '../Ads/NativeAdManager';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getCachedProfile, warmProfileCache } from '../Helper/profileCache';
import { isUserOnline } from '../ChatScreen/utils';
import { useHaptic } from '../Helper/HepticFeedBack';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  Timestamp,
  where,
  query,
  startAfter,
  updateDoc,
} from '@react-native-firebase/firestore';
import { saveTrade, unsaveTrade, fetchSavedTradeRefs } from './tradeHelpers';

// Initialize dayjs plugins
dayjs.extend(relativeTime);


const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInHas, setSearchInHas] = useState(true); // ✅ Search in "ME" side (hasItems)
  const [searchInWants, setSearchInWants] = useState(true); // ✅ Search in "YOU" side (wantsItems)
  const [isSearching, setIsSearching] = useState(false); // ✅ Loading state for search
  const [isSearchMode, setIsSearchMode] = useState(false); // ✅ Track if we're in search mode
  const [searchLastDoc, setSearchLastDoc] = useState(null); // ✅ Pagination cursor for search
  const [searchHasMore, setSearchHasMore] = useState(true); // ✅ More results available for search
  const SEARCH_PAGE_SIZE = 5; // ✅ Fetch 5 items at a time for search
  // const [isAdVisible, setIsAdVisible] = useState(true);
  const { selectedTheme, showMyTradesOnly = false } = route.params || {}
  const { user, analytics, updateLocalStateAndDatabase, appdatabase } = useGlobalState()
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [showofferwall, setShowofferwall] = useState(false);
  const [remainingFeaturedTrades, setRemainingFeaturedTrades] = useState([]);
  // const [openShareModel, setOpenShareModel] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const insets = useSafeAreaInsets();
  const bannerBottomPos = 0; // tab bar is docked (in layout flow), so screen bottom == tab bar top; banner sits flush above it
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState, updateLocalState } = useLocalState()
  const navigation = useNavigation()
  const { theme, firestoreDB } = useGlobalState()
  const [isProStatus, setIsProStatus] = useState(localState.isPro);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const isInitialMountRef = useRef(true); // ✅ Track initial mount to prevent double fetch
  const flatListRef = useRef(null);
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);
  const { triggerHapticFeedback } = useHaptic();
  const [isAtTop, setIsAtTop] = useState(true);
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };


  // console.log(trades, 'trades')

  const [selectedFilters, setSelectedFilters] = useState([]); // ✅ Default: no filters (show all)
  const isMyTradesActive = selectedFilters.includes('myTrades');
  const isSavedActive = selectedFilters.includes('saved');
  // { [tradeId]: { type: 'saved', ... } } — mirrors savedTrades/<uid> in RTDB
  const [savedTradeRefs, setSavedTradeRefs] = useState({});
  // Firestore docs already fetched for the Saved tab, keyed by the id-set they
  // were built from, so re-opening the tab costs nothing.
  const savedCacheRef = useRef({ sig: '', rows: [] });

  // ── Load the user's saved-trade pointers once ──
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    fetchSavedTradeRefs(appdatabase, user.id).then(refs => setSavedTradeRefs(refs || {}));
  }, [user?.id, appdatabase]);

  // ── "My Trades" / "Saved" filter buttons in the navigation header ──
  useEffect(() => {
    // Mode filters are mutually exclusive — turning one on clears the other.
    const MODE_KEYS = ['myTrades', 'saved'];
    const toggleFilter = (key) => {
      triggerHapticFeedback('impactLight');
      if (!user?.id) {
        setIsSigninDrawerVisible(true);
        return;
      }
      setSelectedFilters(prev =>
        prev.includes(key)
          ? prev.filter(f => f !== key)
          : [...prev.filter(f => !MODE_KEYS.includes(f)), key]
      );
    };
    const pillStyle = (active, color) => ({
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: active ? color : (isDarkMode ? config.colors.surfaceDark : '#f1f5f9'),
      borderWidth: 1.5,
      borderColor: active ? color : (isDarkMode ? '#334155' : '#e2e8f0'),
      gap: 4,
    });
    const pillFg = (active) => active ? '#fff' : (isDarkMode ? '#94a3b8' : '#64748b');

    navigation.setOptions({
      // Title reflects the active filter
      title: isMyTradesActive
        ? t('trade.my_trades_title', { defaultValue: 'My Trades' })
        : isSavedActive
          ? t('trade.saved_trades_title', { defaultValue: 'Saved Trades' })
          : t('tabs.trade', { defaultValue: 'Trades' }),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 4 }}>
          <TouchableOpacity
            onPress={() => toggleFilter('myTrades')}
            activeOpacity={0.75}
            style={pillStyle(isMyTradesActive, config.colors.primary)}
          >
            <Icon name={isMyTradesActive ? 'person' : 'person-outline'} size={14} color={pillFg(isMyTradesActive)} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: pillFg(isMyTradesActive) }}>
              {t("trade.my_trades") || "My Trades"}
            </Text>
          </TouchableOpacity>

          {/* Saved — icon only, keeps the header from overflowing */}
          <TouchableOpacity
            onPress={() => toggleFilter('saved')}
            activeOpacity={0.75}
            style={[pillStyle(isSavedActive, '#F59E0B'), { paddingHorizontal: 8 }]}
          >
            <Icon name={isSavedActive ? 'bookmark' : 'bookmark-outline'} size={15} color={pillFg(isSavedActive)} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, isMyTradesActive, isSavedActive, isDarkMode, user?.id, t, triggerHapticFeedback]);

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

  // ✅ Client-side filtering for non-search scenarios (banned users, my trades)
  useEffect(() => {
    const bannedUsersList = Array.isArray(bannedUsers) ? bannedUsers : [];

    setFilteredTrades(
      trades.filter((trade) => {
        // ✅ Filter out trades from blocked users
        if (bannedUsersList.includes(trade.userId)) {
          return false;
        }

        // ✅ Check "My Trades" filter
        if ((showMyTradesOnly || isMyTradesActive) && trade.userId !== user?.id) {
          return false;
        }

        // ✅ Check "Saved" filter — masks locally so an unsave drops the card
        // immediately without waiting for a refetch.
        if (isSavedActive && !savedTradeRefs[trade.id]) {
          return false;
        }

        return true;
      })
    );
  }, [trades, showMyTradesOnly, isMyTradesActive, isSavedActive, savedTradeRefs, user?.id, bannedUsers]);

  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);

  // Free this list's native ad handles on unmount (keys prefixed 'trade-ad-').
  useEffect(() => {
    return () => releaseNativeAds('trade-ad-');
  }, []);

  // Interleave a native ad every TRADE_AD_FREQUENCY trades (non-Pro only).
  // Unfilled slots collapse to nothing via NativeAdCard, so the list never
  // shows a blank gap.
  const TRADE_AD_FREQUENCY = 8;
  const tradesWithAds = useMemo(() => {
    if (isProStatus || !Array.isArray(filteredTrades)) return filteredTrades;
    const out = [];
    let real = 0;
    for (let i = 0; i < filteredTrades.length; i++) {
      out.push(filteredTrades[i]);
      real++;
      if (real % TRADE_AD_FREQUENCY === 0) {
        out.push({ __type: 'ad', id: `trade-ad-${i}` });
      }
    }
    return out;
  }, [filteredTrades, isProStatus]);

  // const getTradeDeal = (hasTotal, wantsTotal) => {
  //   if (hasTotal.value <= 0) {
  //     return { label: "trade.unknown_deal", color: "#8E8E93" }; // ⚠️ Unknown deal (invalid input)
  //   }

  //   const tradeRatio = wantsTotal.value / hasTotal.value;
  //   let deal;

  //   if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
  //     deal = { label: "trade.best_deal", color: "#34C759" }; // ✅ Best Deal
  //   } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
  //     deal = { label: "trade.great_deal", color: "#32D74B" }; // 🟢 Great Deal
  //   } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
  //     deal = { label: "trade.fair_deal", color: "#FFCC00" }; // ⚖️ Fair Deal
  //   } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
  //     deal = { label: "trade.decent_deal", color: "#FF9F0A" }; // 🟠 Decent Deal
  //   } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
  //     deal = { label: "trade.weak_deal", color: "#D65A31" }; // 🔴 Weak Deal
  //   } else {
  //     deal = { label: "trade.risky_deal", color: "#7D1128" }; // ❌ Risky Deal (Missing in your original code)
  //   }

  //   return { deal, tradeRatio };
  // };
  // console.log(localState.featuredCount, 'featu')
  const handleDelete = useCallback((item) => {
    Alert.alert(
      t("trade.delete_confirmation_title"),
      t("trade.delete_confirmation_message"),
      [
        { text: t("trade.cancel"), style: "cancel" },
        {
          text: t("trade.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              const tradeId = item.id.startsWith("featured-") ? item.id.replace("featured-", "") : item.id;

              await deleteDoc(doc(firestoreDB, "trades_new", tradeId));


              if (item.isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);

                await updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setTrades((prev) => prev.filter((trade) => trade.id !== item.id));
              setFilteredTrades((prev) => prev.filter((trade) => trade.id !== item.id));

              showSuccessMessage(t("trade.delete_success"), t("trade.delete_success_message"));

            } catch (error) {
              console.error("🔥 [handleDelete] Error deleting trade:", error);
              showErrorMessage(t("trade.delete_error"), t("trade.delete_error_message"));
            }
          },
        },
      ]
    );
  }, [t, localState.featuredCount, firestoreDB]);







  // console.log(isProStatus, 'from trade model')

  const handleMakeFeatureTrade = async (item) => {
    if (!isProStatus) {
      Alert.alert(
        t("trade.feature_pro_only_title"),
        t("trade.feature_pro_only_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("trade.upgrade"),
            onPress: () => setShowofferwall(true),
          },
        ]
      );
      return;
    }

    try {
      // 🔐 Check from Firestore how many featured trades user already has
      const oneDayAgo = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      
      let featuredSnapshot;
      let limitChecked = false;
      
      try {
        featuredSnapshot = await getDocs(
        query(
          collection(firestoreDB, "trades_new"),
          where("userId", "==", user.id),
          where("isFeatured", "==", true),
          where("featuredUntil", ">", oneDayAgo)
        )
      );
      } catch (queryError) {
        // Handle missing Firestore index error
        if (queryError?.code === 'failed-precondition' || queryError?.message?.includes('index')) {
          // ✅ Extract index URL from error message
          let indexUrl = null;
          const errorMessage = queryError?.message || '';
          
          const urlPatterns = [
            /https:\/\/console\.firebase\.google\.com[^\s\)]+/,
            /https:\/\/[^\s\)]*firebase[^\s\)]*index[^\s\)]*/,
            /https?:\/\/[^\s\)]+/,
          ];
          
          for (const pattern of urlPatterns) {
            const match = errorMessage.match(pattern);
            if (match) {
              indexUrl = match[0];
              console.log('🔗 INDEX CREATION URL:', indexUrl);
              break;
            }
          }
          
          const alertMessage = indexUrl 
            ? 'A Firestore index is required to boost trades. Click "Open Link" to create it automatically.\n\nError: ' + (queryError?.message || 'Index missing')
            : 'A Firestore index is required to boost trades.\n\nError: ' + (queryError?.message || 'Index missing') + '\n\nPlease check the console for the index creation URL.';
          
          Alert.alert(
            'Index Required - Boost Trade',
            alertMessage,
            [
              { text: 'OK', style: 'cancel' },
              ...(indexUrl ? [{
                text: 'Open Link',
                onPress: () => {
                  Linking.openURL(indexUrl).catch(err => {
                    Clipboard.setString(indexUrl);
                    showSuccessMessage('Link Copied', 'Index creation link copied to clipboard');
                  });
                }
              }] : [{
                text: 'Copy Error',
                onPress: () => {
                  Clipboard.setString(errorMessage);
                  showSuccessMessage('Copied', 'Error message copied to clipboard');
                }
              }])
            ]
          );
          
          return;
        }
        // For other query errors, try a simpler query without the date filter
        try {
          featuredSnapshot = await getDocs(
            query(
              collection(firestoreDB, "trades_new"),
              where("userId", "==", user.id),
              where("isFeatured", "==", true)
            )
          );
          
          // Filter client-side for featuredUntil > oneDayAgo
          const now = Date.now();
          const oneDayAgoMs = now - 24 * 60 * 60 * 1000;
          const validFeaturedTrades = featuredSnapshot.docs.filter(doc => {
            const data = doc.data();
            if (!data.featuredUntil) return false;
            const featuredUntilMs = data.featuredUntil.toMillis ? data.featuredUntil.toMillis() : data.featuredUntil;
            return featuredUntilMs > oneDayAgoMs;
          });
          
          if (validFeaturedTrades.length >= 2) {
            Alert.alert(
              "Limit Reached",
              "You can only feature 2 trades every 24 hours."
            );
            return;
          }
          limitChecked = true; // Mark that we already checked the limit
        } catch (fallbackError) {
          throw queryError; // Throw original error if fallback also fails
        }
      }
  
      // Check limit only if we didn't already check in fallback
      if (!limitChecked && featuredSnapshot && featuredSnapshot.size >= 2) {
        Alert.alert(
          "Limit Reached",
          "You can only feature 2 trades every 24 hours."
        );
        return;
      }

      // ✅ Proceed with confirmation
      Alert.alert(
        t("trade.feature_confirmation_title"),
        t("trade.feature_confirmation_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("feature"),
            onPress: async () => {
              try {
                await updateDoc(
                  doc(firestoreDB, "trades_new", item.id),
                  {
                    isFeatured: true,
                    featuredUntil: Timestamp.fromDate(
                      new Date(Date.now() + 24 * 60 * 60 * 1000)
                    ),
                  }
                );

                const newFeaturedCount = (localState.featuredCount?.count || 0) + 1;
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: new Date().toISOString(),
                });

                setTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );
                setFilteredTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );

                showSuccessMessage(t("trade.feature_success"), t("trade.feature_success_message"));
              } catch (error) {
                // Error handling for making trade featured
                const errorMessage = error?.message || t("trade.feature_error_message");
                console.error('❌ Error updating trade:', errorMessage);
                Alert.alert(
                  t("trade.feature_error"),
                  errorMessage
                );
              }
            },
          },
        ]
      );
    } catch (err) {
      // Error handling for checking featured trades
      const errorMessage = err?.message || "Unable to verify your featured trades. Try again later.";
      const errorCode = err?.code || "";
      
      if (errorCode === 'failed-precondition' || errorMessage.includes('index')) {
        // ✅ Extract index URL from error message
        let indexUrl = null;
        const errMessage = err?.message || '';
        
        const urlPatterns = [
          /https:\/\/console\.firebase\.google\.com[^\s\)]+/,
          /https:\/\/[^\s\)]*firebase[^\s\)]*index[^\s\)]*/,
        ];
        
        for (const pattern of urlPatterns) {
          const match = errMessage.match(pattern);
          if (match) {
            indexUrl = match[0];
            console.log('🔗 INDEX CREATION URL:', indexUrl);
            break;
          }
        }
        
        const alertMsg = indexUrl 
          ? 'A Firestore index is required to boost trades. Click "Open Link" to create it.\n\nError: ' + errorMessage
          : 'A Firestore index is required to boost trades. Please check the console for error details.\n\nError: ' + errorMessage;
        
        Alert.alert(
          'Index Required',
          alertMsg,
          [
            { text: 'OK', style: 'cancel' },
            ...(indexUrl ? [{
              text: 'Open Link',
              onPress: () => {
                Linking.openURL(indexUrl).catch(linkErr => {
                  Clipboard.setString(indexUrl);
                  showSuccessMessage('Link Copied', 'Index creation link copied to clipboard');
                });
              }
            }] : [])
          ]
        );
      } else if (errorCode === 'permission-denied') {
        Alert.alert(
          "Permission Denied",
          "You don't have permission to feature trades. Please check your account status."
        );
      } else {
        Alert.alert("Error", errorMessage);
      }
    }
  };





  const formatValue = (value) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`; // Billions
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`; // Millions
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`; // Thousands
    } else {
      return value?.toLocaleString(); // Default formatting
    }
  };
  const fetchMoreTrades = useCallback(async () => {
    if (!hasMore || !lastDoc) return;

    try {
      // ✅ Build query for more normal trades
      const normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const normalTradesQuerySnap = await getDocs(normalQuery);
  
      const newNormalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
  
      if (newNormalTrades.length === 0) {
        setHasMore(false);
        return;
      }
      // ✅ Get **2 more** featured trades if available
      const newFeaturedTrades = remainingFeaturedTrades.splice(0, 3);
      setRemainingFeaturedTrades([...remainingFeaturedTrades]); // ✅ Update remaining featured

      // ✅ Merge & maintain balance
      const mergedTrades = mergeFeaturedWithNormal(newFeaturedTrades, newNormalTrades);

      setTrades((prevTrades) => [...prevTrades, ...mergedTrades]);
      setLastDoc(
        normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1]
      );      
      setHasMore(newNormalTrades.length === PAGE_SIZE);
    } catch (error) {
      console.error('❌ Error fetching more trades:', error);
      if (error.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required.');
      }
    }
  }, [lastDoc, hasMore, remainingFeaturedTrades, firestoreDB]);



  useEffect(() => {
    const resetFeaturedDataIfExpired = async () => {
      const currentFeaturedData = localState.featuredCount || { count: 0, time: null };

      if (!currentFeaturedData.time) return; // ✅ If no time exists, do nothing

      const featuredTime = new Date(currentFeaturedData.time).getTime();
      const currentTime = Date.now();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      // console.log(currentTime, featuredTime, TWENTY_FOUR_HOURS);

      if (currentTime - featuredTime >= TWENTY_FOUR_HOURS) {
        // console.log("⏳ 24 hours passed! Resetting featuredCount and time...");

        await updateLocalState("featuredCount", { count: 0, time: null });

        // console.log("✅ Featured data reset successfully.");
      }
    };

    resetFeaturedDataIfExpired(); // ✅ Runs once on app load

  }, []); // ✅ Runs only on app load

  const selectedUser = {
    senderId: selectedTrade?.userId,
    sender: selectedTrade?.traderName,
    avatar: selectedTrade?.avatar,
    flage: selectedTrade?.flage ? selectedTrade.flage : null,
    robloxUsername: selectedTrade?.robloxUsername || null,
    robloxUsernameVerified: selectedTrade?.robloxUsernameVerified || false,
  }
  const handleChatNavigation2 = async () => {
    // Close drawer first (iOS doesn't auto-dismiss modals on navigation)
    setIsDrawerVisible(false);
    setTimeout(() => {
      mixpanel.track("Inbox Trade");
      navigation.navigate('PrivateChatTrade', {
        selectedUser: selectedUser,
        item: selectedTrade,
      });
    }, 300);
  };





  const handleEndReached = () => {
    if (loading || isSearching) return; // ✅ Prevents unnecessary calls

    // ✅ Handle search pagination
    if (isSearchMode && searchHasMore) {
      if (!user?.id) {
        setIsSigninDrawerVisible(true);
      } else {
        handleSearchTrades(true); // Load more search results
      }
      return;
    }

    // ✅ Handle normal pagination
    if (!hasMore || loading) return;
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
    } else {
      fetchMoreTrades();
    }
  };

  // console.log(trades)

  // import firestore from '@react-native-firebase/firestore'; // Ensure this import

  // ✅ Firestore search - uses indexed fields (hasItemNames/wantsItemNames) for new trades
  const handleSearchTrades = useCallback(async (isLoadMore = false) => {
    const searchTerm = searchQuery.trim();
    if (!searchTerm) {
      setIsSearchMode(false);
      setSearchLastDoc(null);
      setSearchHasMore(true);
      fetchInitialTrades();
      return;
    }

    if (!searchInHas && !searchInWants) {
      Alert.alert(t("trade.search_error_title") || "Search Error", "You must select at least one side to search");
      return;
    }

    setIsSearching(true);
    try {
      const searchTermLower = searchTerm.toLowerCase().trim();

      const allResults = new Map();
      let lastDocSnapshot = isLoadMore ? searchLastDoc : null;

      // ✅ Search in ME side (hasItemNames) - SERVER-SIDE filtering
      if (searchInHas) {
        try {
          const hasQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              limit(SEARCH_PAGE_SIZE)
            );

          const hasSnapshot = await getDocs(hasQuery);
          hasSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ hasItemNames search error:', error.message);
        }
      }

      // ✅ Search in YOU side (wantsItemNames) - SERVER-SIDE filtering
      if (searchInWants) {
        try {
          const wantsQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              limit(SEARCH_PAGE_SIZE)
            );

          const wantsSnapshot = await getDocs(wantsQuery);
          wantsSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ wantsItemNames search error:', error.message);
        }
      }

      // ✅ Convert to array and sort by timestamp
      let searchedTrades = Array.from(allResults.values())
        .sort((a, b) => {
          const aTime = a.timestamp?.toMillis() || 0;
          const bTime = b.timestamp?.toMillis() || 0;
          return bTime - aTime;
        });

      // ✅ Get last doc for pagination
      if (searchedTrades.length > 0) {
        const lastTrade = searchedTrades[searchedTrades.length - 1];
        lastDocSnapshot = lastTrade._doc || null;
      }

      // ✅ Remove _doc from trades before setting state
      searchedTrades = searchedTrades.map(({ _doc, ...trade }) => trade);

      // ✅ Update state
      if (isLoadMore) {
        setTrades((prev) => {
          const combined = [...prev, ...searchedTrades];
          const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
          return unique.sort((a, b) => {
            const aTime = a.timestamp?.toMillis() || 0;
            const bTime = b.timestamp?.toMillis() || 0;
            return bTime - aTime;
          });
        });
      } else {
        setTrades(searchedTrades);
        setIsSearchMode(true);
      }

      // ✅ Update pagination state
      setSearchLastDoc(lastDocSnapshot);
      setSearchHasMore(searchedTrades.length >= SEARCH_PAGE_SIZE);

    } catch (error) {
      console.error('❌ Error searching trades:', error);
      Alert.alert("Search Error", "Search Failed");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchInHas, searchInWants, firestoreDB, searchLastDoc]);

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Build query for normal trades
      const normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      );

      const normalTradesQuerySnap = await getDocs(normalQuery);
  
      const normalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
  

      // ✅ Build query for featured trades
      const featuredQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', true),
        where('featuredUntil', '>', Timestamp.now()),
        orderBy('featuredUntil', 'desc'),
        limit(12) // UI shows only a few; cap reads (this runs on every load/refresh)
      );

      let featuredTrades = [];
      try {
      const featuredQuerySnapshot = await getDocs(featuredQuery);
  
      if (!featuredQuerySnapshot.empty) {
        featuredTrades = featuredQuerySnapshot.docs.map((docSnap) => ({
          id: `featured-${docSnap.id}`,
          ...docSnap.data(),
        }));
        }
      } catch (featuredError) {
        // ✅ Handle missing index error for featured trades
        if (featuredError?.code === 'failed-precondition' || featuredError?.message?.includes('index')) {
          console.log('⚠️ Index error:', featuredError?.message);
          
          // ✅ Extract index URL from error message if available (try multiple patterns)
          let indexUrl = null;
          const errorMessage = featuredError?.message || '';
          
          // Try different URL patterns
          const urlPatterns = [
            /https:\/\/console\.firebase\.google\.com[^\s\)]+/,
            /https:\/\/[^\s\)]*firebase[^\s\)]*index[^\s\)]*/,
            /https?:\/\/[^\s\)]+/,
          ];
          
          for (const pattern of urlPatterns) {
            const match = errorMessage.match(pattern);
            if (match) {
              indexUrl = match[0];
              console.log('✅ Found index URL:', indexUrl);
              break;
            }
          }
          
          // ✅ Try fallback query without orderBy (client-side sorting)
          try {
            const fallbackQuery = query(
                  collection(firestoreDB, 'trades_new'),
                  where('isFeatured', '==', true),
                  limit(50) // bound the no-index fallback so it can't read every ever-featured trade
                );
            
            const fallbackSnapshot = await getDocs(fallbackQuery);
            
            // ✅ Filter client-side for featuredUntil > now and sort
            const now = Timestamp.now();
            featuredTrades = fallbackSnapshot.docs
              .filter(doc => {
                const data = doc.data();
                if (!data.featuredUntil) return false;
                return data.featuredUntil > now;
              })
              .sort((a, b) => {
                const aTime = a.data().featuredUntil?.toMillis?.() || 0;
                const bTime = b.data().featuredUntil?.toMillis?.() || 0;
                return bTime - aTime; // Descending order
              })
              .map((docSnap) => ({
                id: `featured-${docSnap.id}`,
                ...docSnap.data(),
              }));
            
            // ✅ Always show alert with error details and index creation link
            const alertMessage = indexUrl 
              ? 'A Firestore index is required for featured trades. Click "Open Link" to create it automatically.\n\nError: ' + (featuredError?.message || 'Index missing')
              : 'A Firestore index is required for featured trades.\n\nError: ' + (featuredError?.message || 'Index missing') + '\n\nPlease check the console for the index creation URL.';
            
            if (indexUrl) {
              console.log('🔗 INDEX CREATION URL:', indexUrl);
            }
            
            Alert.alert(
              'Index Required - Featured Trades',
              alertMessage,
              [
                { text: 'OK', style: 'cancel' },
                ...(indexUrl ? [{
                  text: 'Open Link',
                  onPress: () => {
                    console.log('🔗 [USER ACTION] Opening index URL:', indexUrl);
                    Linking.openURL(indexUrl).catch(err => {
                      console.log('❌ Error opening index URL:', err);
                      Clipboard.setString(indexUrl);
                      showSuccessMessage('Link Copied', 'Index creation link copied to clipboard. Check console for details.');
                    });
                  }
                }] : [{
                  text: 'Copy Error',
                  onPress: () => {
                    Clipboard.setString(errorMessage);
                    console.log('📋 [USER ACTION] Error message copied to clipboard');
                    showSuccessMessage('Copied', 'Error message copied to clipboard');
                  }
                }])
              ]
            );
          } catch (fallbackError) {
            console.error('❌ Fallback query failed:', fallbackError?.message);
            // Continue with empty featured trades array
            featuredTrades = [];
          }
        } else {
          // ✅ Re-throw if it's not an index error
          console.error('❌ Non-index error in featured trades query, re-throwing:', featuredError);
          throw featuredError;
        }
      }
      // console.log('✅ Featured trades:', featuredTrades[0]);

      // ✅ Keep some featured trades aside for future loadMore()
      setRemainingFeaturedTrades(featuredTrades);

      // ✅ Merge trades but **reserve** featured trades for later
      const mergedTrades = mergeFeaturedWithNormal(
        featuredTrades.splice(0, 3), // ✅ Only use first 2 featured
        normalTrades
      );

      // ✅ Update state
      setTrades(mergedTrades);

      // Warm the profile cache for these posters so their equipped frames can
      // render on the cards. Fire-and-forget — cards fall back to a plain
      // avatar until it lands.
      const posterIds = [...new Set(mergedTrades.map(t => t.userId).filter(Boolean))];
      if (appdatabase && posterIds.length > 0) {
        warmProfileCache(appdatabase, posterIds);
      }

      setLastDoc(
        normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1]
      );
      setHasMore(normalTrades.length === PAGE_SIZE);
    } catch (error) {
      console.error('❌ Error fetching trades:', error?.message);
      
      // ✅ If error is about missing index, log helpful message and extract URL
      if (error?.code === 'failed-precondition' || error?.message?.includes('index')) {
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
        
        // Try to extract index URL
        const errorMessage = error?.message || '';
        const urlPatterns = [
          /https:\/\/console\.firebase\.google\.com[^\s\)]+/,
          /https:\/\/[^\s\)]*firebase[^\s\)]*index[^\s\)]*/,
        ];
        
        let indexUrl = null;
        for (const pattern of urlPatterns) {
          const match = errorMessage.match(pattern);
          if (match) {
            indexUrl = match[0];
            console.log('🔗 INDEX CREATION URL:', indexUrl);
            break;
          }
        }
        
        // Show alert with index URL if found
        if (indexUrl) {
          Alert.alert(
            'Index Required',
            'A Firestore index is required. Click "Open Link" to create it.\n\nError: ' + (error?.message || 'Index missing'),
            [
              { text: 'OK', style: 'cancel' },
              {
                text: 'Open Link',
                onPress: () => {
                  Linking.openURL(indexUrl).catch(err => {
                    console.error('Error opening index URL:', err);
                    Clipboard.setString(indexUrl);
                    showSuccessMessage('Link Copied', 'Index creation link copied to clipboard');
                  });
                }
              }
            ]
          );
        } else {
          Alert.alert(
            'Index Required',
            'A Firestore index is required. Please check the console for error details.\n\nError: ' + (error?.message || 'Index missing'),
            [{ text: 'OK' }]
          );
        }
      } else {
        // For other errors, show a generic alert
        Alert.alert(
          'Error Loading Trades',
          'Unable to load trades. Please check the console for error details.\n\nError: ' + (error?.message || 'Unknown error'),
          [{ text: 'OK' }]
        );
      }
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, appdatabase]);


  // const captureAndSave = async () => {
  //   if (!viewRef.current) {
  //     console.error('View reference is undefined.');
  //     return;
  //   }

  //   try {
  //     // Capture the view as an image
  //     const uri = await captureRef(viewRef.current, {
  //       format: 'png',
  //       quality: 0.8,
  //     });

  //     // Generate a unique file name
  //     const timestamp = new Date().getTime(); // Use the current timestamp
  //     const uniqueFileName = `screenshot_${timestamp}.png`;

  //     // Determine the path to save the screenshot
  //     const downloadDest = Platform.OS === 'android'
  //       ? `${RNFS.ExternalDirectoryPath}/${uniqueFileName}`
  //       : `${RNFS.DocumentDirectoryPath}/${uniqueFileName}`;

  //     // Save the captured image to the determined path
  //     await RNFS.copyFile(uri, downloadDest);

  //     // console.log(`Screenshot saved to: ${downloadDest}`);

  //     return downloadDest;
  //   } catch (error) {
  //     console.error('Error capturing screenshot:', error);
  //     // Alert.alert(t("home.alert.error"), t("home.screenshot_error"));
  //     showMessage({
  //       message: t("home.alert.error"),
  //       description: t("home.screenshot_error"),
  //       type: "danger",
  //     });
  //   }
  // };

  // const proceedWithScreenshotShare = async () => {
  //   triggerHapticFeedback('impactLight');
  //   try {
  //     const filePath = await captureAndSave();

  //     if (filePath) {
  //       const shareOptions = {
  //         title: t("home.screenshot_title"),
  //         url: `file://${filePath}`,
  //         type: 'image/png',
  //       };

  //       Share.open(shareOptions)
  //         .then((res) => console.log('Share Response:', res))
  //         .catch((err) => console.log('Share Error:', err));
  //     }
  //   } catch (error) {
  //     // console.log('Error sharing screenshot:', error);
  //   }
  // };

  const mergeFeaturedWithNormal = (featuredTrades, normalTrades) => {
    // Input validation
    if (!Array.isArray(featuredTrades) || !Array.isArray(normalTrades)) {
      console.warn('⚠️ Invalid input: featuredTrades or normalTrades is not an array');
      return [];
    }

    let result = [];
    let featuredIndex = 0;
    let normalIndex = 0;
    const featuredCount = featuredTrades.length;
    const normalCount = normalTrades.length;
    const MAX_ITERATIONS = 1000; // Safety limit
    let iterationCount = 0;

    // Add first 4 featured trades (if available)
    for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
      result.push(featuredTrades[featuredIndex]);
      featuredIndex++;
    }

    // Merge in the format of 4 normal trades, then 4 featured trades
    while (normalIndex < normalCount && iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      // Insert up to 4 normal trades
      for (let i = 0; i < 4 && normalIndex < normalCount; i++) {
        result.push(normalTrades[normalIndex]);
        normalIndex++;
      }

      // Insert up to 4 featured trades (if available)
      for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
        result.push(featuredTrades[featuredIndex]);
        featuredIndex++;
      }
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn('⚠️ Maximum iterations reached in mergeFeaturedWithNormal');
    }

    return result;
  };

  // useEffect(() => {
  //   const unsubscribe = firestore()
  //     .collection('trades_new')
  //     .orderBy('timestamp', 'desc')
  //     .limit(PAGE_SIZE)
  //     .onSnapshot(snapshot => {
  //       const newTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  //       setTrades(newTrades);
  //       setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
  //       setHasMore(snapshot.docs.length === PAGE_SIZE);
  //     }, error => console.error('🔥 Firestore error:', error));

  //   return () => unsubscribe(); // ✅ Unsubscribing on unmount
  // }, []);



  // ── Saved tab: RTDB pointers → Firestore trade docs ──
  // Fixed list (capped at MAX_SAVED), so no pagination. Trades the owner has
  // since deleted simply drop out.
  const fetchSavedTrades = useCallback(async (refreshRefs = true) => {
    if (!user?.id || !appdatabase || !firestoreDB) return;
    setLoading(true);
    try {
      // The feed already mirrors savedTrades/<uid> in state and keeps it in
      // step optimistically, so a plain tab toggle can skip re-reading it.
      // Empty state may just mean the mount read hasn't landed yet, so fall
      // back to a read rather than wrongly showing "nothing saved".
      const canReuse = !refreshRefs && Object.keys(savedTradeRefs).length > 0;
      const refs = canReuse
        ? savedTradeRefs
        : await fetchSavedTradeRefs(appdatabase, user.id);
      if (!canReuse) setSavedTradeRefs(refs || {});
      const ids = Object.keys(refs || {});
      if (ids.length === 0) {
        setTrades([]);
        setHasMore(false);
        return;
      }

      // Reuse the docs already fetched for this exact id set — toggling the
      // Saved filter on/off would otherwise cost one Firestore read per saved
      // trade every single time.
      const sig = ids.slice().sort().join(',');
      if (sig === savedCacheRef.current.sig && savedCacheRef.current.rows.length) {
        setTrades(savedCacheRef.current.rows);
        setHasMore(false);
        return;
      }
      const results = await Promise.all(ids.map(async (tradeId) => {
        try {
          const snap = await getDoc(doc(firestoreDB, 'trades_new', tradeId));
          return snap.exists() ? { id: tradeId, ...snap.data() } : null;
        } catch {
          return null;
        }
      }));
      const toMillis = (ts) => ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : 0);
      const rows = results.filter(Boolean).sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
      savedCacheRef.current = { sig, rows };
      setTrades(rows);
      setHasMore(false);
    } catch (e) {
      console.warn('[Trades] fetchSavedTrades error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, appdatabase, firestoreDB, savedTradeRefs]);

  // ✅ Refetch when user changes
  useEffect(() => {
    fetchInitialTrades();
    isInitialMountRef.current = false; // ✅ Mark initial mount as complete

    if (!user?.id) {
      setTrades((prev) => prev.slice(0, PAGE_SIZE)); // Keep only 20 trades for logged-out users
    }
  }, [user?.id]);

  // ✅ Swap the data source when the Saved filter is toggled
  useEffect(() => {
    if (isInitialMountRef.current || !user?.id) return;
    if (isSavedActive) {
      fetchSavedTrades(false); // reuse in-memory refs + cached docs
    } else {
      fetchInitialTrades();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSavedActive]);

  const closeProfileDrawer = async () => {
    setIsDrawerVisible(false);
  };
  const handleOpenProfile = async(item)=>{
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
      return;
    }
    setSelectedTrade(item)
    setIsOnline(false); // Reset online status before checking to prevent stale state
    // console.log(item, selectedTrade)
    try {
      const online = await isUserOnline(item?.userId);
      setIsOnline(online);
    } catch (error) {
      console.error('🔥 Error checking online status:', error);
      setIsOnline(false);
    }
    setIsDrawerVisible(true);
  }
  
  const renderTextWithUsername = (description) => {
    const parts = description.split(/(@\w+)/g); // Split text by @username pattern

    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.slice(1); // Remove @
        return (
          <TouchableOpacity
            style={styles.descriptionclick}
            key={index}
            onPress={() => {
              Clipboard.setString(username);
              // Alert.alert("Copied!", `Username "${username}" copied.`);
            }}
          >
            <Text style={styles.descriptionclick}>{part}</Text>
          </TouchableOpacity>
        );
      } else {
        return <Text key={index} style={styles.description}>{part}</Text>;
      }
    });
  };


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Migration helper: Normalize hasTotal/wantsTotal to handle both old (object.value) and new (number) formats
  const normalizeTotal = (total) => {
    if (total === null || total === undefined) return 0;
    // Old format: { value: number }
    if (typeof total === 'object' && total !== null && 'value' in total) {
      return total.value || 0;
    }
    // New format: number
    if (typeof total === 'number') {
      return total;
    }
    return 0;
  };

  // ✅ MM2: Image URL generation - handles both old and new item structures
  const getImageUrl = (item) => {
    if (!item) return '';

    // ✅ Handle new format: { name, type, value, image }
    if (item.image) {
      // If image is already a full URL, return as is
      if (item.image.startsWith('http://') || item.image.startsWith('https://')) {
        return item.image;
      }
      // Otherwise, use MM2 format: https://mm2values.com/${item.image}
      return `https://mm2values.com/${item.image}`;
    }

    // ✅ Handle old format: { name, image, value } - image might be directly accessible
    // This is a fallback for backward compatibility
    return '';
  };



  const handleRefresh = async () => {
    setRefreshing(true);
    // ✅ Respect the active filter mode when refreshing
    if (isSavedActive) {
      savedCacheRef.current = { sig: '', rows: [] }; // pull-to-refresh must hit the server
      await fetchSavedTrades(true);
    } else {
      await fetchInitialTrades();
    }
    setRefreshing(false);
  };

  // ✅ Scroll to top handler
  const handleScrollToTop = useCallback(() => {
    if (!flatListRef?.current) return;
    
    triggerHapticFeedback('impactLight');
    
    try {
      // Scroll to index 0 (top of list)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtTop(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtTop(true);
    }
  }, [flatListRef, triggerHapticFeedback]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtTop ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtTop, scrollButtonOpacity]);

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  const renderTrade = ({ item, index }) => {
    // Native ad slot interleaved into the list (collapses when unfilled / Pro).
    if (item?.__type === 'ad') {
      return <NativeAdCard adKey={item.id} isDarkMode={isDarkMode} />;
    }

    // ✅ Migration: Normalize totals to handle both old (object.value) and new (number) formats
    const hasTotalValue = normalizeTotal(item.hasTotal);
    const wantsTotalValue = normalizeTotal(item.wantsTotal);

    const isProfit = hasTotalValue > wantsTotalValue; // Profit if trade ratio > 1
    const neutral = hasTotalValue === wantsTotalValue; // Exactly 1:1 trade
    // Guard against non-Timestamp values: some docs store a numeric Date.now()
    // (or migrated/optimistic rows) which have no .toDate() and would crash render.
    const formattedTime = item.timestamp
      ? dayjs(typeof item.timestamp?.toDate === 'function' ? item.timestamp.toDate() : item.timestamp).fromNow()
      : "Anonymous";
    // ✅ Migration helper: Group items and count duplicates - handles both old and new structures
    const groupItems = (items) => {
      const grouped = {};
      items.forEach((item) => {
        if (!item) return;
        
        // ✅ Handle both old format: { name, image, value } and new format: { name, type, value, image }
        const name = item.name || item.Name || '';
        const type = item.type || item.Type || item.Category || '';
        const image = item.image || item.Image || '';
        
        // ✅ Use name+type as key (fallback to name+image for old format)
        const key = type ? `${name}-${type}` : `${name}-${image}`;
        
        if (grouped[key]) {
          grouped[key].count += 1;
        } else {
          grouped[key] = { 
            name, 
            type: type || '', 
            image: image || '',
            count: 1 
          };
        }
      });
      return Object.values(grouped);
    };

    // Group and count duplicate items
    const groupedHasItems = groupItems(item.hasItems || []);
    const groupedWantsItems = groupItems(item.wantsItems || []);
    const selectedUser = {
      senderId: item.userId,
      sender: item.traderName,
      avatar: item.avatar,
      flage: item.flage ? item.flage : null,
      robloxUsername: item?.robloxUsername || null,
      robloxUsernameVerified: item?.robloxUsernameVerified || false,
    }
    const handleChatNavigation = async () => {

      const callbackfunction = () => {
        if (!user?.id) {
          setIsSigninDrawerVisible(true);
          return;
        }
        mixpanel.track("Inbox Trade");
        navigation.navigate('PrivateChatTrade', {
          selectedUser: selectedUser,
          item,
        });
      };

      callbackfunction();
    };
    return (
      <View style={[styles.tradeItem, item.isFeatured && styles.featuredTradeItem]}>

        {/* ── Card Header ── */}
        <View style={styles.cardHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => handleOpenProfile(item)}>
            {/* Frame belongs to the trade's poster, not the viewer — read it
                from the shared profile cache. Falls back to a plain circular
                avatar when they have none equipped. */}
            <View style={styles.avatarWrapper}>
              <FramedAvatar
                avatarUri={item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={getCachedProfile(item.userId)?.profileFrame || null}
                isDarkMode={isDarkMode}
                avatarSize={28}
                forceDetail
              />
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Text style={styles.cardName} numberOfLines={1}>{item.traderName}</Text>
                {item.isPro && (
                  <Image source={require('../../assets/pro.png')} style={{ width: 11, height: 11 }} />
                )}
                {item.robloxUsernameVerified && (
                  <Image source={require('../../assets/verification.png')} style={{ width: 11, height: 11 }} />
                )}
                {(() => {
                  const hasRecentWin =
                    !!item?.hasRecentGameWin ||
                    (typeof item?.lastGameWinAt === 'number' &&
                      Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
                  return hasRecentWin ? (
                    <Image source={require('../../assets/trophy.webp')} style={{ width: 11, height: 11 }} />
                  ) : null;
                })()}
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffb700be', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Icon name="star" size={8} color="white" style={{ marginRight: 2 }} />
                    <Text style={{ fontSize: 8, color: 'white', fontWeight: '600' }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#888', borderRadius: 5, paddingHorizontal: 3, paddingVertical: 1 }}>
                    <Icon name="star-outline" size={8} color="white" style={{ marginRight: 2 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>N/A</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

          {/* Badges: Featured + Win/Lose/Fair */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {item.isFeatured && (
              <View style={[styles.statusBadge, { backgroundColor: '#f59e0b' }]}>
                <Text style={styles.statusBadgeText}>⭐ FEATURED</Text>
              </View>
            )}
            {item.status && (
              <View style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    item.status === 'w' ? '#10B981' :
                    item.status === 'f' ? config.colors.primary :
                    '#EF4444',
                }
              ]}>
                <Text style={styles.statusBadgeText}>
                  {item.status === 'w' ? 'Win' : item.status === 'f' ? 'Fair' : 'Lose'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Trade Items */}
        <View style={styles.tradeDetails}>
          {/* Has Items Grid or Give Offer */}
          {item.hasItems && item.hasItems.length > 0 ? (
            <View style={styles.itemGrid}>
              {Array.from({
                length: Math.max(4, Math.ceil(item.hasItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = item.hasItems[idx];
                return (
                  <View key={idx} style={styles.gridCell}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getImageUrl(tradeItem) }}
                          style={styles.gridItemImage}
                          onError={(e) => {
                            console.warn('Image load error for item:', tradeItem);
                          }}
                        />
                        <View style={{ alignItems: 'center', marginTop: 2 }}>
                          <Text style={styles.itemName}>
                            {tradeItem.name?.length > 8 ? tradeItem.name.slice(0, 7) + '...' : tradeItem.name}
                          </Text>
                          {tradeItem.deprecatedNames && Array.isArray(tradeItem.deprecatedNames) && tradeItem.deprecatedNames.length > 0 && (
                            <Text style={styles.deprecatedName}>
                              {tradeItem.deprecatedNames[0]?.length > 8 ? tradeItem.deprecatedNames[0].slice(0, 7) + '...' : tradeItem.deprecatedNames[0]}
                            </Text>
                          )}
                          {!tradeItem.deprecatedNames && (tradeItem.deprecatedName || tradeItem.deprecated_name) && (
                            <Text style={styles.deprecatedName}>
                              {(tradeItem.deprecatedName || tradeItem.deprecated_name)?.length > 8
                                ? (tradeItem.deprecatedName || tradeItem.deprecated_name).slice(0, 7) + '...'
                                : (tradeItem.deprecatedName || tradeItem.deprecated_name)}
                            </Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleOpenProfile(item)}>
              <Text style={styles.dealText}>Give offer</Text>
            </TouchableOpacity>
          )}
          {/* Transfer Icon */}
          <View style={styles.transfer}>
            <Image source={require('../../assets/left-right.png')} style={styles.transferImage} />
          </View>
          {/* Wants Items Grid or Give Offer */}
          {item.wantsItems && item.wantsItems.length > 0 ? (
            <View style={styles.itemGrid}>
              {Array.from({
                length: Math.max(4, Math.ceil(item.wantsItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = item.wantsItems[idx];
                return (
                  <View key={idx} style={styles.gridCell}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getImageUrl(tradeItem) }}
                          style={styles.gridItemImage}
                          onError={(e) => {
                            console.warn('Image load error for item:', tradeItem);
                          }}
                        />
                        <View style={{ alignItems: 'center', marginTop: 2 }}>
                          <Text style={styles.itemName}>
                            {tradeItem.name?.length > 8 ? tradeItem.name.slice(0, 7) + '...' : tradeItem.name}
                          </Text>
                          {tradeItem.deprecatedNames && Array.isArray(tradeItem.deprecatedNames) && tradeItem.deprecatedNames.length > 0 && (
                            <Text style={styles.deprecatedName}>
                              {tradeItem.deprecatedNames[0]?.length > 8 ? tradeItem.deprecatedNames[0].slice(0, 7) + '...' : tradeItem.deprecatedNames[0]}
                            </Text>
                          )}
                          {!tradeItem.deprecatedNames && (tradeItem.deprecatedName || tradeItem.deprecated_name) && (
                            <Text style={styles.deprecatedName}>
                              {(tradeItem.deprecatedName || tradeItem.deprecated_name)?.length > 8
                                ? (tradeItem.deprecatedName || tradeItem.deprecated_name).slice(0, 7) + '...'
                                : (tradeItem.deprecatedName || tradeItem.deprecated_name)}
                            </Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleOpenProfile(item)}>
              <Text style={styles.dealText}>Give offer</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Trade Totals */}
        <View style={styles.tradeTotals}>
          {item.hasItems && item.hasItems.length > 0 && (
            <Text style={[styles.priceText, styles.hasBackground]}>
              ME: {formatValue(hasTotalValue)}
            </Text>
          )}
          <View style={styles.transfer}>
            {(item.hasItems && item.hasItems.length > 0 && item.wantsItems && item.wantsItems.length > 0) && (
              <>
                {hasTotalValue > wantsTotalValue && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' }} />
                    <Text style={[styles.priceText, { color: '#22c55e', backgroundColor: 'transparent' }]}>
                      +{formatValue(hasTotalValue - wantsTotalValue)}
                    </Text>
                  </View>
                )}
                {hasTotalValue < wantsTotalValue && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' }} />
                    <Text style={[styles.priceText, { color: '#ef4444', backgroundColor: 'transparent' }]}>
                      -{formatValue(wantsTotalValue - hasTotalValue)}
                    </Text>
                  </View>
                )}
                {hasTotalValue === wantsTotalValue && (
                  <Text style={{ fontSize: 10 }}>⚖️</Text>
                )}
              </>
            )}
          </View>
          {item.wantsItems && item.wantsItems.length > 0 && (
            <Text style={[styles.priceText, styles.wantBackground]}>
              YOU: {formatValue(wantsTotalValue)}
            </Text>
          )}
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}</Text>}

        {/* Owner actions (Boost / Delete) */}
        {item.userId === user.id && (
          <View style={styles.ownerActions}>
            {!item.isFeatured && (
              <TouchableOpacity onPress={() => handleMakeFeatureTrade(item)} style={[styles.ownerBtn, { backgroundColor: '#8B5CF6' }]}>
                <Icon name="rocket-outline" size={12} color="white" />
                <Text style={styles.ownerBtnText}>BOOST IT</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.ownerBtn, { backgroundColor: '#EF4444' }]}>
              <Icon name="trash-outline" size={12} color="white" />
              <Text style={styles.ownerBtnText}>DELETE IT</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Social Actions Row */}
        <View style={styles.socialActionsRow}>
          <View style={{ flex: 1 }} />

          {/* Save — only on other people's trades */}
          {item.userId !== user?.id && (
            <TouchableOpacity
              onPress={async () => {
                if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                triggerHapticFeedback('impactLight');
                const tradeId = item.id;
                // Keep the Saved-tab doc cache in step with the toggle. We
                // already hold the full trade here, so opening the Saved tab
                // afterwards needs no Firestore reads at all.
                const reseed = (nextRefs, rows) => {
                  savedCacheRef.current = {
                    sig: Object.keys(nextRefs).sort().join(','),
                    rows,
                  };
                };
                try {
                  if (savedTradeRefs[tradeId]) {
                    await unsaveTrade(appdatabase, user.id, tradeId);
                    const next = { ...savedTradeRefs };
                    delete next[tradeId];
                    setSavedTradeRefs(next);
                    reseed(next, savedCacheRef.current.rows.filter(r => r.id !== tradeId));
                    showSuccessMessage(
                      t('trade.removed', { defaultValue: 'Removed' }),
                      t('trade.trade_unsaved', { defaultValue: 'Trade removed from saved' })
                    );
                  } else {
                    await saveTrade(appdatabase, user.id, item, Object.keys(savedTradeRefs).length);
                    const next = { ...savedTradeRefs, [tradeId]: { type: 'saved' } };
                    setSavedTradeRefs(next);
                    // Only extend a cache that's already complete; otherwise
                    // leave it empty so the tab does a proper first load.
                    if (savedCacheRef.current.rows.length === Object.keys(savedTradeRefs).length) {
                      reseed(next, [item, ...savedCacheRef.current.rows]);
                    }
                    showSuccessMessage(
                      '🔖 ' + t('trade.saved', { defaultValue: 'Trade Saved!' }),
                      t('trade.saved_guide', { defaultValue: 'Tap the bookmark at the top to view your saved trades anytime.' })
                    );
                  }
                } catch (e) {
                  showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                }
              }}
              style={[styles.socialBtn, !!savedTradeRefs[item.id] && { backgroundColor: '#F59E0B20' }]}
              activeOpacity={0.7}
            >
              <Icon name={savedTradeRefs[item.id] ? 'bookmark' : 'bookmark-outline'} size={16} color="#F59E0B" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.chatBtn} onPress={() => handleOpenProfile(item)} activeOpacity={0.8}>
            <Icon name="chatbubble" size={13} color="#fff" />
            <Text style={styles.chatBtnText}>Chat</Text>
          </TouchableOpacity>
        </View>

      </View>
    );
  };




  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color={config.colors.primary} />;
  }


  return (
    <View style={styles.container}>
      {/* ✅ Modern Search Container (Compact) */}
      <View style={{ flexDirection: 'row', marginBottom: 10, marginTop: 10, paddingHorizontal: 16 }}>
        <TextInput
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            paddingHorizontal: 12,
            fontSize: 14,
            backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FFF',
            color: isDarkMode ? '#FFF' : '#000',
            borderWidth: 1,
            borderColor: isDarkMode ? '#475569' : '#E5E5EA'
          }}
          placeholder={t("trade.search_placeholder") || "Search items..."}
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => {
            setSearchLastDoc(null);
            setSearchHasMore(true);
            if (searchQuery.trim()) {
              handleSearchTrades(false);
            }
          }}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={{
            width: 44,
            height: 44,
            backgroundColor: config.colors.primary,
            borderRadius: 10,
            marginLeft: 8,
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onPress={() => {
            setSearchLastDoc(null);
            setSearchHasMore(true);
            if (searchQuery.trim()) {
              handleSearchTrades(false);
            }
          }}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="search" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* ✅ Search Options — Compact single row */}
      {(searchQuery.length > 0) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 6 }}>
          <TouchableOpacity
            style={[{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingVertical: 6, paddingHorizontal: 12,
              borderRadius: 20, borderWidth: 1,
              borderColor: searchInHas ? config.colors.primary : (isDarkMode ? '#475569' : '#E5E5EA'),
              backgroundColor: searchInHas ? config.colors.primary : 'transparent'
            }]}
            onPress={() => {
              triggerHapticFeedback('impactLight');
              if (!searchInHas && !searchInWants) setSearchInWants(true);
              setSearchInHas(!searchInHas);
            }}
            activeOpacity={0.7}
          >
            {searchInHas && <Icon name="checkmark" size={14} color="#fff" />}
            <Text style={[{ fontSize: 13, fontWeight: '600' }, { color: searchInHas ? '#fff' : (isDarkMode ? '#cbd5e1' : '#64748b') }]}>
              {t("trade.search_in_me") || "Me"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingVertical: 6, paddingHorizontal: 12,
              borderRadius: 20, borderWidth: 1,
              borderColor: searchInWants ? config.colors.primary : (isDarkMode ? '#475569' : '#E5E5EA'),
              backgroundColor: searchInWants ? config.colors.primary : 'transparent'
            }]}
            onPress={() => {
              triggerHapticFeedback('impactLight');
              if (!searchInHas && !searchInWants) setSearchInHas(true);
              setSearchInWants(!searchInWants);
            }}
            activeOpacity={0.7}
          >
            {searchInWants && <Icon name="checkmark" size={14} color="#fff" />}
            <Text style={[{ fontSize: 13, fontWeight: '600' }, { color: searchInWants ? '#fff' : (isDarkMode ? '#cbd5e1' : '#64748b') }]}>
              {t("trade.search_in_you") || "You"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setSearchQuery('');
              setIsSearchMode(false);
              setSearchLastDoc(null);
              setSearchHasMore(true);
              fetchInitialTrades();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 'auto',
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 8,
              backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f1f5f9',
            }}
          >
            <Icon name="close-circle" size={14} color={config.colors.primary} style={{ marginRight: 4 }} />
            <Text style={{ color: config.colors.primary, fontSize: 11, fontWeight: '600' }}>{t("trade.clear") || "Clear"}</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={tradesWithAds}
        renderItem={renderTrade}
        keyExtractor={(item) => item?.__type === 'ad' ? item.id : (item.isFeatured ? `featured-${item.id}` : item.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 180 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        removeClippedSubviews={true} // 🚀 Reduce memory usage
        initialNumToRender={10} // 🔹 Render fewer items at start
        maxToRenderPerBatch={10} // 🔹 Load smaller batches
        updateCellsBatchingPeriod={50} // 🔹 Reduce updates per frame
        windowSize={5} // 🔹 Keep only 5 screens worth in memory
        refreshing={refreshing} // Add Pull-to-Refresh
        onRefresh={handleRefresh} // Attach Refresh Handler
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          // ✅ Check if user is at top (within 60px from top). Only update state
          // when the boolean actually flips — otherwise setIsAtTop fires on every
          // scroll frame (~60/s) and re-renders the entire list.
          const atTop = contentOffset.y <= 60;
          setIsAtTop((prev) => (prev === atTop ? prev : atTop));
        }}
        scrollEventThrottle={16}
      />




      <ReportTradePopup
        visible={isReportPopupVisible}
        trade={selectedTrade}
        onClose={() => setReportPopupVisible(false)}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={handleLoginSuccess}
        selectedTheme={selectedTheme}
        message={t("trade.signin_required_message")}
        screen='Trade'

      />

      {!localState.isPro && (
        <View style={{
          position: 'absolute',
          bottom: bannerBottomPos,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 5,
        }}>
          <BannerAdComponent collapsible />
        </View>
      )}

      <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Trade' />
     
      <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={handleChatNavigation2}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />

      {/* ✅ Scroll to Top Button */}
      {!isAtTop && (
        <Animated.View
          style={[
            styles.scrollToTopButton,
            {
              opacity: scrollButtonOpacity,
              transform: [
                {
                  scale: scrollButtonOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleScrollToTop}
            activeOpacity={0.8}
            style={styles.scrollToTopTouchable}
          >
            <Icon
              name="chevron-up-circle"
              size={48}
              color={config.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 8,
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
      flex: 1,
    },
    tradeItem: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginHorizontal: 4,
      marginBottom: 10,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : '#ffffff',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: isDarkMode ? '#243050' : '#f0f4ff',
      shadowColor: isDarkMode ? '#000' : '#1a1a2e',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDarkMode ? 0.3 : 0.07,
      shadowRadius: 10,
      elevation: isDarkMode ? 5 : 3,
    },
    featuredTradeItem: {
      backgroundColor: isDarkMode ? '#2a1f10' : '#fffbeb',
      borderColor: '#f59e0b',
      borderWidth: 1.5,
      shadowColor: '#f59e0b',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 5,
    },

    searchInput: {
      height: 40,
      borderColor: isDarkMode ? config.colors.primary : config.colors.borderLight,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,

      borderWidth: 1,
      marginVertical: 8,
      paddingHorizontal: 10,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      flex: 1,
      borderRadius: 10, // Ensure smooth corners
      // shadowColor: config.colors.shadowDark, // Shadow color for iOS
      // shadowOffset: { width: 0, height: 0 }, // Positioning of the shadow
      // shadowOpacity: 0.2, // Opacity for iOS shadow
      // shadowRadius: 2, // Spread of the shadow
      // elevation: 2, // Elevation for Android (4-sided shadow)
    },
    tradeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    },
    // ── New feed-style card header ──
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    avatarWrapper: {
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
    },
    cardAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 2.5,
      borderColor: config.colors.primary,
    },
    cardName: {
      fontWeight: '800',
      fontSize: 13,
      color: isDarkMode ? '#e2e8f0' : config.colors.backgroundDark,
      letterSpacing: 0.1,
      flexShrink: 1,
    },
    cardTime: {
      fontSize: 11,
      color: isDarkMode ? '#475569' : '#94a3b8',
      marginTop: 2,
    },
    statusBadge: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    statusBadgeText: {
      color: 'white',
      fontWeight: '700',
      fontSize: 9,
    },
    traderName: {
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    },
    tradeTime: {
      fontSize: 8,
      color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
    },
    tradeDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      marginVertical: 10


    },
    itemGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: '48%',
      // alignItems: 'center',
      // justifyContent: 'center',
      // marginVertical: 6,
    },
    gridCell: {
      width: '22%',
      minHeight: 40,
      margin: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
      position: 'relative',
      marginBottom: 10
    },
    gridItemImage: {
      width: 30,
      height: 30,
      borderRadius: 6,
    },
    itemName: {
      fontSize: 7,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      textAlign: 'center',
      marginTop: 2,
    },
    deprecatedName: {
      fontSize: 6,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight,
      textAlign: 'center',
      fontStyle: 'italic',
      marginTop: 1,
    },
    itemBadgesContainer: {
      position: 'absolute',
      bottom: -5,
      right: 0,
      flexDirection: 'row',
      gap: 1,
      padding: 1,
      alignItems: 'center',
      justifyContent: 'center',
      //  backgroundColor: config.colors.error

    },
    itemBadge: {
      color: config.colors.white,
      backgroundColor: config.colors.textTertiaryDark,
      borderRadius: 10, // Make it perfectly round
      width: 10, // Fixed width
      height: 10, // Fixed height
      fontSize: 6,
      textAlign: 'center',
      lineHeight: 10, // Center text vertically
      fontWeight: '600',
      overflow: 'hidden',
      padding: 0,
      margin: 0,
    },
    itemBadgeFly: {
      backgroundColor: config.colors.info,
    },
    itemBadgeRide: {
      backgroundColor: config.colors.error,
    },
    itemBadgeMega: {
      backgroundColor: config.colors.secondary,
    },
    itemBadgeNeon: {
      backgroundColor: config.colors.success,
    },
    itemImage: {
      width: 30,
      height: 30,
      // marginRight: 5,
      // borderRadius: 25,
      marginVertical: 5,
      borderRadius: 5
      // padding:10

    },
    itemImageUser: {
      width: 20,
      height: 20,
      // marginRight: 5,
      borderRadius: 15,
      marginRight: 5,
      backgroundColor: config.colors.white
    },
    transferImage: {
      width: 20,
      height: 20,
      // marginRight: 5,
      borderRadius: 5,
      // width:'4%',
    },
    tradeTotals: {
      flexDirection: 'row',
      justifyContent: 'center',
      // marginTop: 10,
      width: '100%'

    },
    priceText: {
      fontSize: 8,
      fontFamily: 'Lato-Bold',
      color: config.colors.white,
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      marginHorizontal: 'auto',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 6
    },
    priceTextProfit: {
      fontSize: 10,
      lineHeight: 14,
      fontFamily: 'Lato-Regular',
      // color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      // color: isDarkMode ? 'white' : "grey",
      // marginHorizontal: 'auto',
      // paddingHorizontal: 4,
      // paddingVertical: 2,
      // borderRadius: 6
    },
    hasBackground: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantBackground: {
      backgroundColor: config.colors.wantBlockRed,
    },
    tradeActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    transfer: {
      // width: '10%',
      justifyContent: 'center',
      alignItems: 'center'
    },
    actionButtons: {
      flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight, marginTop: 10, paddingTop: 10
    },
    description: {
      color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
      fontFamily: 'Lato-Regular',
      fontSize: 10,
      marginTop: 5,
      lineHeight: 12
    },
    descriptionclick: {
      color: config.colors.secondary,
      fontFamily: 'Lato-Regular',
      fontSize: 10,
      // marginTop: 5,
      // lineHeight:12

    },
    loader: {
      flex: 1
    },
    dealContainer: {
      paddingVertical: 1,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      marginRight: 10
    },
    dealContainerSingle: {
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      // height:30,
      // marginRight: 10,
      backgroundColor: config.colors.backgroundDark,
      // justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: 'auto'
      // flexD1
    },
    dealText: {
      color: config.colors.white,
      fontWeight: 'Lato-Bold',
      fontSize: 8,
      textAlign: 'center',
      // alignItems: 'center',
      // justifyContent: 'center'
      // backgroundColor: config.colors.backgroundDark

    },
    names: {
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      color: isDarkMode ? 'white' : "black",
      marginTop: -3
    },
    tagcount: {
      position: 'absolute',
      backgroundColor: 'purple',
      top: -1,
      left: -1,
      borderRadius: 50,
      paddingHorizontal: 3,
      paddingBottom: 2

    },
    tagcounttext: {
      color: 'white',
      fontFamily: 'Lato-Bold',
      fontSize: 10
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      borderTopWidth: 1,
      backgroundColor: config.colors.warning,
      paddingTop: 5,
      marginTop: 10,
      borderTopColor: config.colors.hasBlockGreen
    },
    // ── New premium action styles ──
    ownerActions: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 8,
    },
    ownerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 8,
    },
    ownerBtnText: {
      color: 'white',
      fontSize: 11,
      fontWeight: '600',
    },
    socialActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#243050' : '#f1f5f9',
    },
    socialBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      borderRadius: 999,
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
    },
    chatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: config.colors.primary,
      gap: 5,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 5,
      elevation: 3,
    },
    chatBtnText: {
      color: '#ffffff',
      fontWeight: '800',
      fontSize: 11,
    },
    boost:{
      justifyContent:'flex-start', paddingVertical:2, paddingHorizontal:5, borderRadius:3, alignItems:'center', margin:4
    },
    scrollToTopButton: {
      position: 'absolute',
      bottom: 150, // Position above the banner ad + floating tab bar
      right: 8,
      zIndex: 1000,
      elevation: 8, // For Android shadow
      shadowColor: config.colors.shadowDark, // For iOS shadow
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    scrollToTopTouchable: {
      borderRadius: 28,
      // backgroundColor: isDarkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      // padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },

  });

export default TradeList;