import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, Animated, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
import { FilterMenu } from './tradeHelpers';
import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { isUserOnline } from '../ChatScreen/utils';
import { useHaptic } from '../Helper/HepticFeedBack';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  Timestamp,
  where,
  query,
  startAfter,
  updateDoc,
} from '@react-native-firebase/firestore';

// Initialize dayjs plugins
dayjs.extend(relativeTime);


const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  // const [isAdVisible, setIsAdVisible] = useState(true);
  const { selectedTheme } = route.params
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

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

  useEffect(() => {
    const lowerCaseQuery = searchQuery.trim().toLowerCase();
    const bannedUsersList = Array.isArray(bannedUsers) ? bannedUsers : [];

    setFilteredTrades(
      trades.filter((trade) => {
        // ✅ Filter out trades from blocked users (client-side only)
        if (bannedUsersList.includes(trade.userId)) {
          return false;
        }

        // If no filters selected, show all trades
        if (selectedFilters.length === 0) return true;

        // ✅ Separate filter types
        const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
        const hasMyTradesFilter = selectedFilters.includes("myTrades");
        const hasSearchFilters = lowerCaseQuery && (selectedFilters.includes("has") || selectedFilters.includes("wants"));

        // ✅ Check status filter match
        let matchesStatus = true;
        if (statusFilters.length > 0) {
          const statusMap = { win: 'w', lose: 'l', fair: 'f' };
          const statusValues = statusFilters.map(f => statusMap[f]);
          matchesStatus = trade.status && statusValues.includes(trade.status);
        }

        // ✅ Check myTrades filter match
        let matchesMyTrades = true;
        if (hasMyTradesFilter) {
          matchesMyTrades = trade.userId === user.id;
        }

        // ✅ Check search filter match
        let matchesSearch = true;
        if (hasSearchFilters) {
          matchesSearch = false;
          if (selectedFilters.includes("has")) {
            matchesSearch = matchesSearch || trade.hasItems?.some((item) =>
              item.name.toLowerCase().includes(lowerCaseQuery)
            );
          }
          if (selectedFilters.includes("wants")) {
            matchesSearch = matchesSearch || trade.wantsItems?.some((item) =>
              item.name.toLowerCase().includes(lowerCaseQuery)
            );
          }
        }

        // ✅ All selected filters must match (AND logic)
        return matchesStatus && matchesMyTrades && matchesSearch;
      })
    );
  }, [searchQuery, trades, selectedFilters, user.id, bannedUsers]);

  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);

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
      // ✅ Get status filters and map to status values
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0 
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for more normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', false),
          where('status', 'in', statusValues),
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

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
      // ✅ If error is about missing index, log helpful message
      if (error.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
      }
    }
  }, [lastDoc, hasMore, remainingFeaturedTrades, firestoreDB, selectedFilters]);



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
    

    const callbackfunction = () => {
      mixpanel.track("Inbox Trade");
      navigation.navigate('PrivateChatTrade', {
        selectedUser: selectedUser,
        item:selectedTrade,
        
      });
    };

    try {
      // const isOnline = await isUserOnline(item.userId)


      if (!localState.isPro) { InterstitialAdManager.showAd(callbackfunction); }
      else { callbackfunction() }


    } catch (error) {
      console.error('Error navigating to PrivateChat:', error);
      Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
    }
  };




  const handleEndReached = () => {
    if (!hasMore || loading) return; // ✅ Prevents unnecessary calls
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
    }
    else { fetchMoreTrades(); }
  };

  // console.log(trades)

  // import firestore from '@react-native-firebase/firestore'; // Ensure this import

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Get status filters (win, lose, fair) and map to status values (w, l, f)
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0 
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', false),
          where('status', 'in', statusValues),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE)
        );
      }

      const normalTradesQuerySnap = await getDocs(normalQuery);
  
      const normalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
  

      // ✅ Build query for featured trades
      let featuredQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', true),
        where('featuredUntil', '>', Timestamp.now()),
        orderBy('featuredUntil', 'desc')
      );

      // ✅ Add status filter to featured trades if status filters are selected
      if (statusValues && statusValues.length > 0) {
        featuredQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', true),
          where('featuredUntil', '>', Timestamp.now()),
          where('status', 'in', statusValues),
          orderBy('featuredUntil', 'desc')
        );
      }

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
            const fallbackQuery = statusValues && statusValues.length > 0
              ? query(
                  collection(firestoreDB, 'trades_new'),
                  where('isFeatured', '==', true),
                  where('status', 'in', statusValues)
                )
              : query(
                  collection(firestoreDB, 'trades_new'),
                  where('isFeatured', '==', true)
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
  }, [firestoreDB, selectedFilters]);


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



  // ✅ Track status filters separately for refetch trigger
  const statusFiltersString = useMemo(() => {
    const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
    return statusFilters.sort().join(',');
  }, [selectedFilters]);

  // ✅ Refetch when user changes
  useEffect(() => {
    fetchInitialTrades();
    isInitialMountRef.current = false; // ✅ Mark initial mount as complete
    // updateLatest50TradesWithoutIsFeatured()

    if (!user?.id) {
      setTrades((prev) => prev.slice(0, PAGE_SIZE)); // Keep only 20 trades for logged-out users
    }
  }, [user?.id]);

  // ✅ Refetch when status filters change (for database-level filtering)
  useEffect(() => {
    // Skip refetch on initial mount (user?.id effect handles that)
    if (isInitialMountRef.current) return;
    
    // Refetch when status filters change to apply database-level filtering
    if (user?.id) {
      fetchInitialTrades();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltersString]); // ✅ Only refetch when status filters change

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
    await fetchInitialTrades();
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
    // ✅ Migration: Normalize totals to handle both old (object.value) and new (number) formats
    const hasTotalValue = normalizeTotal(item.hasTotal);
    const wantsTotalValue = normalizeTotal(item.wantsTotal);

    const isProfit = hasTotalValue > wantsTotalValue; // Profit if trade ratio > 1
    const neutral = hasTotalValue === wantsTotalValue; // Exactly 1:1 trade
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Anonymous";

    // if ((index + 1) % 10 === 0 && !isProStatus) {
    //   return <MyNativeAdComponent />;
    // }
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

      try {
        // const isOnline = await isUserOnline(item.userId)


        if (!localState.isPro) { InterstitialAdManager.showAd(callbackfunction); }
        else { callbackfunction() }


      } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
      }
    };
    return (
      <View style={[styles.tradeItem, item.isFeatured && styles.featuredTradeItem]}>
        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={()=>handleOpenProfile(item)}>
            <Image source={{ uri: item.avatar }} style={styles.itemImageUser} />

            <View style={{ justifyContent: 'center', marginLeft: 10 }}>
              <Text style={styles.traderName}>
                {item.traderName}{' '}
                {item.isPro && (
                  <Image
                    source={require('../../assets/pro.png')} 
                    style={{ width: 10, height: 10 }}
                  />
                )}{' '}
                {item.robloxUsernameVerified && (
                  <Image
                    source={require('../../assets/verification.png')} 
                    style={{ width: 10, height: 10 }} 
                  />
                )}{' '}
                {(() => {
                  const hasRecentWin =
                    !!item?.hasRecentGameWin ||
                    (typeof item?.lastGameWinAt === 'number' &&
                      Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
                  return hasRecentWin ? (
                    <Image
                      source={require('../../assets/trophy.webp')}
                      style={{ width: 10, height: 10 }}
                    />
                  ) : null;
                })()}{' '}
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: config.colors.warning, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 5 }}>
                    <Icon name="star" size={8} color={config.colors.white} style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: config.colors.white }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: config.colors.textTertiaryDark, borderRadius: 5, paddingHorizontal: 2, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star-outline" size={8} color={config.colors.white} style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: config.colors.white }}>N/A</Text>
                  </View>
                )}


              </Text>

              {/* Rating Info */}


              <Text style={styles.tradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row' }}>
            {/* Featured Badge - Show on left side before status badges */}
            {item.isFeatured && (
              <View style={[
                styles.dealContainer, 
                { 
                  backgroundColor: '#ffd700', // Golden color
                  marginRight: 5,
                }
              ]}>
                <Text style={styles.dealText}>
                  FEATURED
                </Text>
              </View>
            )}
            {/* Status Badge (Win/Lose/Fair) - Only show if status field exists */}
            {item.status && (
              <View style={[
                styles.dealContainer, 
                { 
                  backgroundColor: item.status === 'w' ? config.colors.success : // Green for win
                                  item.status === 'f' ? config.colors.secondary : // Blue for fair
                                  config.colors.error, // Red for lose
                  marginRight: 5,
                }
              ]}>
                <Text style={styles.dealText}>
                  {item.status === 'w' ? 'Win' : item.status === 'f' ? 'Fair' : 'Lose'}
                </Text>
              </View>
            )}
            {/* ✅ MM2: Removed Shark/Frost/GG Badge - MM2 doesn't use these modes */}
            <FontAwesome
              name='message'
              size={18}
              color={config.colors.primary}
              onPress={()=>handleOpenProfile(item)}
              solid={false}
            />
            {/* <Icon
              name="chatbox-outline"
              size={18}
              color={config.colors.secondary}
              onPress={handleChatNavigation}
            /> */}
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
                // console.log(`${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${item.image?.replace(/^\//, "")}`)
                return (
                  <View key={idx} style={styles.gridCell}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getImageUrl(tradeItem) }}
                          style={styles.gridItemImage}
                          onError={(e) => {
                            // ✅ Fallback: Try to use image directly if getImageUrl fails
                            console.warn('Image load error for item:', tradeItem);
                          }}
                        />
                        {/* ✅ Display item name and deprecated names like old app */}
                        <View style={{ alignItems: 'center', marginTop: 2 }}>
                          <Text style={styles.itemName}>
                            {tradeItem.name?.length > 8 ? tradeItem.name.slice(0, 7) + '...' : tradeItem.name}
                          </Text>
                          {/* ✅ Display deprecated names if available */}
                          {tradeItem.deprecatedNames && Array.isArray(tradeItem.deprecatedNames) && tradeItem.deprecatedNames.length > 0 && (
                            <Text style={styles.deprecatedName}>
                              {tradeItem.deprecatedNames[0]?.length > 8 ? tradeItem.deprecatedNames[0].slice(0, 7) + '...' : tradeItem.deprecatedNames[0]}
                            </Text>
                          )}
                          {/* ✅ Also check for deprecatedName (singular) or deprecated_name */}
                          {!tradeItem.deprecatedNames && (tradeItem.deprecatedName || tradeItem.deprecated_name) && (
                            <Text style={styles.deprecatedName}>
                              {(tradeItem.deprecatedName || tradeItem.deprecated_name)?.length > 8 
                                ? (tradeItem.deprecatedName || tradeItem.deprecated_name).slice(0, 7) + '...' 
                                : (tradeItem.deprecatedName || tradeItem.deprecated_name)}
                            </Text>
                          )}
                        </View>
                        {/* ✅ MM2: Removed badges (Fly/Ride/ValueType) - MM2 doesn't use these */}
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={()=>handleOpenProfile(item)}>
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
                            // ✅ Fallback: Try to use image directly if getImageUrl fails
                            console.warn('Image load error for item:', tradeItem);
                          }}
                        />
                        {/* ✅ Display item name and deprecated names like old app */}
                        <View style={{ alignItems: 'center', marginTop: 2 }}>
                          <Text style={styles.itemName}>
                            {tradeItem.name?.length > 8 ? tradeItem.name.slice(0, 7) + '...' : tradeItem.name}
                          </Text>
                          {/* ✅ Display deprecated names if available */}
                          {tradeItem.deprecatedNames && Array.isArray(tradeItem.deprecatedNames) && tradeItem.deprecatedNames.length > 0 && (
                            <Text style={styles.deprecatedName}>
                              {tradeItem.deprecatedNames[0]?.length > 8 ? tradeItem.deprecatedNames[0].slice(0, 7) + '...' : tradeItem.deprecatedNames[0]}
                            </Text>
                          )}
                          {/* ✅ Also check for deprecatedName (singular) or deprecated_name */}
                          {!tradeItem.deprecatedNames && (tradeItem.deprecatedName || tradeItem.deprecated_name) && (
                            <Text style={styles.deprecatedName}>
                              {(tradeItem.deprecatedName || tradeItem.deprecated_name)?.length > 8 
                                ? (tradeItem.deprecatedName || tradeItem.deprecated_name).slice(0, 7) + '...' 
                                : (tradeItem.deprecatedName || tradeItem.deprecated_name)}
                            </Text>
                          )}
                        </View>
                        {/* ✅ MM2: Removed badges (Fly/Ride/ValueType) - MM2 doesn't use these */}
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={()=>handleOpenProfile(item)}>
              <Text style={styles.dealText}>Give offer</Text>
            </TouchableOpacity>
          )}
        </View>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-up-outline"
                      size={12}
                      color={'green'}
                      style={styles.icon}
                    />
                    <Text style={[styles.priceText, { color: 'green', }]}>
                      {formatValue(hasTotalValue - wantsTotalValue)}
                    </Text>
                  </View>
                )}
                {hasTotalValue < wantsTotalValue && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-down-outline"
                      size={12}
                      color={config.colors.hasBlockGreen}
                      style={styles.icon}
                    />
                    <Text style={[styles.priceText, { color: config.colors.hasBlockGreen }]}>
                      {formatValue(wantsTotalValue - hasTotalValue)}
                    </Text>
                  </View>
                )}
                {hasTotalValue === wantsTotalValue && (
                  <Text style={[styles.priceText, { color: config.colors.primary }]}>-</Text>
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
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}
        </Text>}
        {item.userId === user.id && (<View style={styles.footer}>
          {!item.isFeatured && 
          <TouchableOpacity  onPress={() => handleMakeFeatureTrade(item)} style={[styles.boost, {backgroundColor:'purple'}]}>
          <Text
           
           
            
           
            style={{  color:'white', fontFamily:'Lato-Regular' }}
          >BOOST IT</Text>
          </TouchableOpacity>}
 <TouchableOpacity  onPress={() => handleDelete(item)} style={[styles.boost, {backgroundColor:'black'}]}>
 <Text
           
           
           color={config.colors.secondary}
          
           style={{ color:'white', fontFamily:'Lato-Regular' }}
         >DELETE IT</Text>
          </TouchableOpacity>
          {/* <Icon
            name="share-social"
            size={24}
            color={config.colors.primary}
            onPress={() => {
              setSelectedTrade(item); // ✅ Set the selected trade
              setOpenShareModel(true); // ✅ Then open the modal
            }}
          /> */}



        </View>)}
        {/* <ShareTradeModal
          visible={openShareModel}
          onClose={() => setOpenShareModel(false)}
          tradeData={selectedTrade}
        /> */}
 
      </View>
    );
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color={config.colors.primary} />;
  }


  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>

        <TextInput
          style={styles.searchInput}
          placeholder={t("trade.search_placeholder")}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={isDarkMode ? 'white' : '#aaa'}
        />
        <FilterMenu selectedFilters={selectedFilters} setSelectedFilters={setSelectedFilters} analytics={analytics} platform={platform} />
      </View>
      <FlatList
        ref={flatListRef}
        data={filteredTrades}
        renderItem={renderTrade}
        keyExtractor={(item) => item.isFeatured ? `featured-${item.id}` : item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
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
          // ✅ Check if user is at top (within 60px from top)
          const atTop = contentOffset.y <= 60;
          setIsAtTop(atTop);
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

      {!localState.isPro && <BannerAdComponent />}

      {/* {!isProStatus && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
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
      padding: 10,
      marginBottom: 10,
      // marginHorizontal: 10,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,

      borderRadius: 10, // Smooth rounded corners
      borderWidth: !config.isNoman ? 3 : 0,
      borderColor: config.colors.hasBlockGreen,
    },
    featuredTradeItem: {
      backgroundColor: isDarkMode ? '#3d2f1f' : '#fff8e1', // Light golden background
      borderColor: '#ffd700', // Golden border
      borderWidth: 2,
      shadowColor: '#ffd700',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },

    searchInput: {
      height: 40,
      borderColor: isDarkMode ? config.colors.primary : config.colors.borderLight,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,

      borderWidth: 1,
      borderRadius: 5,
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
      // marginBottom: 10,
      // paddingBottom: 10,
      // borderBottomWidth: 1,
      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    },
    traderName: {
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,

    },
    tradeTime: {
      fontSize: 8,
      color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
      // color: config.colors.textSecondaryDark

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
      // paddingHorizontal: 30,
      paddingTop: 5,
      marginTop: 10,
      borderTopColor: config.colors.hasBlockGreen
    },
    tag: {
      backgroundColor: config.colors.hasBlockGreen,
      position: 'absolute',
      top: 0,
      left: 0,
      height: 15, // Increased height for a better rounded effect
      width: 15,  // Increased width for proportion
      borderTopLeftRadius: 10,  // Increased to make it more curved
      borderBottomRightRadius: 30, // Further increased for more curve
    },
    icon: {
      // marginRight: 1,
      fontSize: 12,
    },
    boost:{
      justifyContent:'flex-start', paddingVertical:2, paddingHorizontal:5, borderRadius:3, alignItems:'center', margin:4
    },
    scrollToTopButton: {
      position: 'absolute',
      bottom: 60, // Position above the bottom ad banner
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