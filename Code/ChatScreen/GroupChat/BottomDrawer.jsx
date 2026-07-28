import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
  Linking,
  Platform,
  Dimensions,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import ProfileReviewsSection from './ProfileReviewsSection';
import ProfileTradesSection from './ProfileTradesSection';
import ProfilePostsSection from './ProfilePostsSection';
import CompactPortfolio from './CompactPortfolio';

import { getThemeColors } from '../../Helper/themeColors';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,           // ✅ moved here
  setDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer, // ✅ Added for follower count
} from '@react-native-firebase/firestore';
import { ref, get, set } from '@react-native-firebase/database';
import { useOnlineStatus } from '../utils';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import FramedAvatar from './FramedAvatar';
import { getCachedProfile, warmProfileCache } from '../../Helper/profileCache';

dayjs.extend(relativeTime);

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page

// ✅ Helper function to format fruit names for image URLs
const formatName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^\+/, '').replace(/\s+/g, '-');
};

// Helper function to format trade item names
const formatTradeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let formattedName = name.replace(/^\+/, '');
  formattedName = formattedName.replace(/\s+/g, '-');
  return formattedName;
};

// Helper function to format values
const formatTradeValue = (value) => {
  if (!value || typeof value !== 'number') return '0';
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  } else {
    return value.toLocaleString();
  }
};

// Helper function to group items
const groupTradeItems = (items) => {
  if (!Array.isArray(items)) return [];
  const grouped = {};
  items.forEach(({ name, type }) => {
    const key = `${name}-${type}`;
    if (grouped[key]) {
      grouped[key].count += 1;
    } else {
      grouped[key] = { name, type, count: 1 };
    }
  });
  return Object.values(grouped);
};

// Helper function to get trade deal
const getTradeDeal = (hasTotal, wantsTotal) => {
  // Handle both number and object formats
  const hasValue = typeof hasTotal === 'number' ? hasTotal : hasTotal?.value;
  const wantsValue = typeof wantsTotal === 'number' ? wantsTotal : wantsTotal?.value;
  
  if (!hasValue || hasValue <= 0) {
    return { deal: { label: "trade.unknown_deal", color: "#8E8E93" }, tradeRatio: 0 };
  }

  const tradeRatio = wantsValue ? wantsValue / hasValue : 0;
  let deal;

  if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
    deal = { label: "trade.best_deal", color: "#34C759" };
  } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
    deal = { label: "trade.great_deal", color: "#32D74B" };
  } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
    deal = { label: "trade.fair_deal", color: "#FFCC00" };
  } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
    deal = { label: "trade.decent_deal", color: "#FF9F0A" };
  } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
    deal = { label: "trade.weak_deal", color: "#D65A31" };
  } else {
    deal = { label: "trade.risky_deal", color: "#7D1128" };
  }

  return { deal, tradeRatio };
};

const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline: isOnlineProp, // kept for backward compat, overridden by real-time hook
  bannedUsers,
  fromPvtChat,
}) => {
  const { theme, firestoreDB, appdatabase, user } = useGlobalState();
  const { updateLocalState, localState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;

  // ✅ FIXED: Real-time online status listener instead of stale one-shot prop
  const isOnline = useOnlineStatus(isVisible ? selectedUserId : null);
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;

  // 🔒 ban state - ✅ Safety check for array
  const isBlock = Array.isArray(bannedUsers) && bannedUsers.includes(selectedUserId);

  // Cosmetics of the profile being viewed — drives the avatar frame.
  const [drawerCosmetics, setDrawerCosmetics] = useState(null);
  useEffect(() => {
    if (!isVisible || !selectedUserId) return;
    const cached = getCachedProfile(selectedUserId);
    if (cached) { setDrawerCosmetics(cached); return; }
    if (!appdatabase) return;
    let cancelled = false;
    warmProfileCache(appdatabase, [selectedUserId])
      .then(() => { if (!cancelled) setDrawerCosmetics(getCachedProfile(selectedUserId)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isVisible, selectedUserId, appdatabase]);

  // ⭐ rating summary (from Firestore user_ratings_summary - single source of truth)
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [userBio, setUserBio] = useState(null);

  // joined text
  const [createdAtText, setCreatedAtText] = useState(null);

  // 💰 user points and game wins
  const [userPoints, setUserPoints] = useState(null);
  const [gameWins, setGameWins] = useState(null);

  // 📝 reviews list (from Firestore /reviews where toUserId == selectedUserId)
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [lastReviewDoc, setLastReviewDoc] = useState(null);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [starFilter, setStarFilter] = useState(null); // null = All, 1-5 = specific star

  // 🐾 items (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedItems, setOwnedItems] = useState([]);
  const [wishlistItems, setWishlistItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // 💼 trades list (from Firestore /trades_new where userId == selectedUserId)
  const [trades, setTrades] = useState([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [lastTradeDoc, setLastTradeDoc] = useState(null);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);

  // 🖼️ Posts list (from Firestore /designPosts where userId == selectedUserId)
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [lastPostDoc, setLastPostDoc] = useState(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // 👥 Follower Count
  const [followersCount, setFollowersCount] = useState(0);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);


  // ✅ Reset all user-specific state when switching profiles to prevent stale data flash
  useEffect(() => {
    setRatingSummary(null);
    setLoadingRating(false);
    setUserBio(null);
    setCreatedAtText(null);
    setUserPoints(null);
    setGameWins(null);
    setReviews([]);
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setStarFilter(null);
    setOwnedItems([]);
    setWishlistItems([]);
    setTrades([]);
    setLastTradeDoc(null);
    setHasMoreTrades(false);
    setPosts([]);
    setLastPostDoc(null);
    setHasMorePosts(false);
    setSelectedPost(null);
    setLoadDetails(false);
    setUserData(null);
    setFollowersCount(0);
    setIsFollowing(false);

  }, [selectedUserId]);

  // ✅ Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    // isVisible guard: this drawer is MOUNTED by Trades, StatusFeed, PostCard,
    // the chat screens and the leaderboard, so without it these 5 RTDB reads
    // fired on every one of those screens even when the drawer was never
    // opened — which is the common case.
    if (!isVisible || !selectedUserId || !appdatabase) return;

    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null); // Clear fetched data if already in selectedUser
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        const [robloxUsernameSnap, robloxUserIdSnap, robloxUsernameVerifiedSnap, 
               isProSnap, lastGameWinAtSnap] = await Promise.all([
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsername`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUserId`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsernameVerified`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isPro`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
        ]);
        
        if (!isMounted) return;
        
        // ✅ Extract values only if they exist
        setUserData({
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
        });
      } catch (error) {
        console.error('Error fetching user data in BottomDrawer:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();


    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // ✅ Check if current user is following this user (Firestore)
  useEffect(() => {
    // isVisible guard — see the roblox-fields effect above.
    if (!isVisible || !user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) {
      setIsFollowing(false);
      return;
    }

    const checkFollowStatus = async () => {
      try {
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );
        setIsFollowing(!followSnapshot.empty);
      } catch (err) {
        console.error('Error checking follow status:', err);
        setIsFollowing(false);
      }
    };

    checkFollowStatus();
  }, [isVisible, user?.id, selectedUserId, firestoreDB]);

  // ✅ Fetch follower count
  useEffect(() => {
    // isVisible guard — see above. This one is a getCountFromServer aggregation
    // query, billed per call.
    if (!isVisible || !selectedUserId || !firestoreDB) return;

    const fetchFollowerCount = async () => {
      try {
        const q = query(
          collection(firestoreDB, 'following'),
          where('followingId', '==', selectedUserId)
        );
        const snap = await getCountFromServer(q);
        setFollowersCount(snap.data().count || 0);
      } catch (err) {
        console.error('Error fetching follower count:', err);
        setFollowersCount(0);
      }
    };
    fetchFollowerCount();
    // `isFollowing` deliberately NOT a dep: it is set by the follow-status
    // effect above, so including it ran this aggregation query a second time
    // for anyone you already follow. The count is cosmetic and refreshes on
    // the next open; handleFollowToggle adjusts it optimistically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, firestoreDB]);

  // ✅ Follow / Unfollow toggle (Firestore)
  const handleFollowToggle = useCallback(async () => {
    if (!user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        // Unfollow - find and delete the document
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );

        if (!followSnapshot.empty) {
          await Promise.all(followSnapshot.docs.map(docSnap =>
            deleteDoc(doc(firestoreDB, 'following', docSnap.id))
          ));
        }
        setIsFollowing(false);
        // Adjust locally — the follower-count effect no longer re-runs on
        // isFollowing (that cost an extra aggregation query per open).
        setFollowersCount(c => Math.max(0, c - 1));
        triggerHapticFeedback('impactLight');
      } else {
        // Follow - create a new document
        await setDoc(doc(collection(firestoreDB, 'following')), {
          followerId: user.id,
          followingId: selectedUserId,
          createdAt: serverTimestamp(),
        });
        setIsFollowing(true);
        setFollowersCount(c => c + 1);
        triggerHapticFeedback('notificationSuccess');
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
      Alert.alert('Error', 'Could not update follow status.');
    } finally {
      setFollowLoading(false);
    }
  }, [user?.id, selectedUserId, firestoreDB, isFollowing, triggerHapticFeedback]);

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined 
        ? selectedUser.robloxUsernameVerified 
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
    };
  }, [selectedUser, userData]);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), 'Copied to Clipboard');
    mixpanel.track('Code UserName', { UserName: code });
  };

  // ─────────────────────────────────────────────
  // Open Roblox Profile
  const handleOpenRobloxProfile = useCallback(async () => {
    const robloxUsername = mergedUser?.robloxUsername;
    const robloxUserId = mergedUser?.robloxUserId;
    
    if (!robloxUsername && !robloxUserId) {
      return;
    }

    triggerHapticFeedback('impactLight');

    try {
      // Construct URLs
      let robloxAppUrl = null;
      let robloxWebUrl = null;

      if (robloxUserId) {
        // Use userId for app deep link (most reliable)
        robloxAppUrl = `roblox://users/${robloxUserId}`;
        // Use search URL format for web (works with username)
        robloxWebUrl = robloxUsername 
          ? `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`
          : `https://www.roblox.com/users/${robloxUserId}`;
      } else if (robloxUsername) {
        // Use search URL format with username
        robloxWebUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`;
      }

      if (!robloxWebUrl) {
        Alert.alert('Error', 'Could not open Roblox profile. Missing username or user ID.');
        return;
      }

      // Try to open in Roblox app first (only if we have userId)
      if (robloxAppUrl) {
        try {
          const canOpenApp = await Linking.canOpenURL(robloxAppUrl);
          if (canOpenApp) {
            await Linking.openURL(robloxAppUrl);
            return; // Successfully opened in app
          }
        } catch (appError) {
          console.log('Could not open in Roblox app, falling back to browser:', appError);
        }
      }

      // Fallback to browser with search URL
      await Linking.openURL(robloxWebUrl);
    } catch (error) {
      console.error('Error opening Roblox profile:', error);
      Alert.alert('Error', 'Could not open Roblox profile. Please try again.');
    }
  }, [mergedUser?.robloxUsername, mergedUser?.robloxUserId, triggerHapticFeedback]);

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }, []);

  // ✅ Memoize getTimestampMs
  const getTimestampMs = useCallback((ts) => {
    if (!ts) return null;

    // Firestore Timestamp instance
    if (typeof ts.toDate === 'function') {
      return ts.toDate().getTime();
    }

    // { seconds, nanoseconds }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    }

    // already a number?
    if (typeof ts === 'number') return ts;

    return null;
  }, []);

  // ─────────────────────────────────────────────
  // Ban / Unban
  const handleBanToggle = async () => {
    if (!selectedUserId) return;

    const action = isBlock ? t('chat.unblock') : t('chat.block');

    Alert.alert(
      `${action}`,
      `${t('chat.are_you_sure')} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              let updatedBannedUsers;

              // ✅ Safety check for array
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              if (isBlock) {
                updatedBannedUsers = currentBanned.filter(
                  (id) => id !== selectedUserId,
                );
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              setTimeout(() => {
                showSuccessMessage(
                  t('home.alert.success'),
                  isBlock
                    ? `${userName} ${t('chat.user_unblocked')}`
                    : `${userName} ${t('chat.user_blocked')}`,
                );
              }, 100);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ],
    );
  };

  // ─────────────────────────────────────────────
  // Start chat
  const handleStartChat = () => {
    if (startChat) startChat();
  };

  // Reset when drawer closes
  useEffect(() => {
    if (!isVisible) {
      setLoadDetails(false);
      setRatingSummary(null);
      setUserBio(null);
      setOwnedItems([]);
      setWishlistItems([]);
      setReviews([]);
      lastReviewDocRef.current = null;
      isLoadingRef.current = false;
      setLastReviewDoc(null);
      setHasMoreReviews(false);
      setCreatedAtText(null);
      setUserPoints(null);
      setGameWins(null);
      setUserData(null); // ✅ Clear fetched user data
      setTrades([]);
      setLastTradeDoc(null);
      setHasMoreTrades(false);
    }
  }, [isVisible]);

  // ─────────────────────────────────────────────
  // Load rating summary + joined
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadRatingSummary = async () => {
      setLoadingRating(true);
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        // ✅ MIGRATED: Read rating summary from Firestore user_ratings_summary (single source of truth)
        const [summaryDocSnap, createdSnap, rewardPointsSnap, reviewDocSnap] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', selectedUserId)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/rewardPoints`)).catch(() => null),
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)), // ✅ Load bio from Firestore
        ]);

        if (!isMounted) return;

        // ✅ FIRESTORE ONLY: Load rating summary from user_ratings_summary
        if (summaryDocSnap.exists()) {
          const summaryData = summaryDocSnap.data();
          setRatingSummary({
            value: Number(summaryData.averageRating || 0),
            count: Number(summaryData.count || 0),
          });
        } else {
          // ✅ COST-OPTIMIZED: Only recalculate if summary truly missing (one-time per user)
          // Check RTDB first (free) before expensive Firestore query
          const avgSnap = await get(ref(appdatabase, `averageRatings/${selectedUserId}`));
          if (avgSnap.exists()) {
            // ✅ RTDB has data - migrate it (cheap: 1 RTDB read + 1 Firestore write)
            const avgData = avgSnap.val();
            const avgValue = Number(avgData.value || 0);
            const avgCount = Number(avgData.count || 0);
            
            setRatingSummary({
              value: avgValue,
              count: avgCount,
            });
            
            if (avgValue > 0 || avgCount > 0) {
              setDoc(
                doc(firestoreDB, 'user_ratings_summary', selectedUserId),
                {
                  averageRating: avgValue,
                  count: avgCount,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch(err => console.error('Error migrating rating summary to Firestore:', err));
            }
          } else {
            // ✅ Only query Firestore reviews if RTDB also has no data (expensive operation)
            // This ensures we don't waste reads if RTDB migration is possible
            try {
              const reviewsQuery = query(
                collection(firestoreDB, 'reviews'),
                where('toUserId', '==', selectedUserId),
                limit(100) // ✅ COST LIMIT: Max 100 reviews per calculation (prevents huge reads)
              );
              const reviewsSnapshot = await getDocs(reviewsQuery);
              
              if (!reviewsSnapshot.empty) {
                let totalRating = 0;
                let ratingCount = 0;
                
                reviewsSnapshot.docs.forEach((doc) => {
                  const reviewData = doc.data();
                  if (reviewData.rating && typeof reviewData.rating === 'number') {
                    totalRating += reviewData.rating;
                    ratingCount += 1;
                  }
                });
                
                if (ratingCount > 0) {
                  const calculatedAverage = totalRating / ratingCount;
                  
                  setRatingSummary({
                    value: parseFloat(calculatedAverage.toFixed(2)),
                    count: ratingCount,
                  });
                  
                  // ✅ Create summary (prevents future recalculations)
                  await setDoc(
                    doc(firestoreDB, 'user_ratings_summary', selectedUserId),
                    {
                      averageRating: parseFloat(calculatedAverage.toFixed(2)),
                      count: ratingCount,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                } else {
                  setRatingSummary(null);
                }
              } else {
                setRatingSummary(null);
              }
            } catch (error) {
              console.error('Error calculating summary from reviews:', error);
              setRatingSummary(null);
            }
          }
        }

        // ✅ Load bio from Firestore reviews/{userId}
        let bioValue = null;
        if (reviewDocSnap.exists()) { // ✅ Firestore modular API: exists() is a method
          const reviewData = reviewDocSnap.data();
          if (reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim()) {
            bioValue = reviewData.bio.trim();
          }
        }
        // ✅ Set bio value (use default if not found or empty)
        setUserBio(bioValue || 'Hi there, I am new here');

        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }

        // ✅ Load user points (RTDB)
        // ✅ Use rewardPointsSnap instead of full user object
        if (rewardPointsSnap?.exists()) {
          setUserPoints(rewardPointsSnap.val() || 0);
        } else {
          setUserPoints(0);
        }

        // ✅ Load game wins (Firestore game_stats)
        if (firestoreDB && selectedUserId) {
          const statsDoc = await getDoc(doc(firestoreDB, 'game_stats', selectedUserId));
          if (statsDoc.exists()) {
            const stats = statsDoc.data() || {};
            setGameWins(stats.petGameWins || 0);
          } else {
            setGameWins(0);
          }
        } else {
          setGameWins(0);
        }
      } catch (err) {
        console.log('Rating load error:', err);
        if (isMounted) {
          setRatingSummary(null);
          setCreatedAtText(null);
          setUserPoints(null);
          setGameWins(null);
        }
      } finally {
        if (isMounted) setLoadingRating(false);
      }
    };

    loadRatingSummary();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, appdatabase, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load items
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadItems = async () => {
      setLoadingItems(true);
      try {
        const reviewDocSnap = await getDoc(
          doc(firestoreDB, 'reviews', selectedUserId),
        );

        if (!isMounted) return;

        if (reviewDocSnap.exists()) {
          const data = reviewDocSnap.data() || {};
          setOwnedItems(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistItems(
            Array.isArray(data.wishlistPets) ? data.wishlistPets : [],
          );
        } else {
          setOwnedItems([]);
          setWishlistItems([]);
        }
      } catch (err) {
        console.log('Items load error:', err);
        if (isMounted) {
          setOwnedItems([]);
          setWishlistItems([]);
        }
      } finally {
        if (isMounted) setLoadingItems(false);
      }
    };

    loadItems();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load reviews (paged) — ✅ Memoized with useCallback
  // ✅ Use refs to track state and avoid dependency issues
  const lastReviewDocRef = useRef(null);
  const isLoadingRef = useRef(false);
  
  const loadReviews = useCallback(async (reset = false, ratingFilter = null) => {
    if (!firestoreDB || !selectedUserId) return;
    
    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) {
      console.log('🔄 [BottomDrawer] Already loading reviews, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Build query constraints based on filter
      const constraints = [
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', selectedUserId),
      ];

      // ⭐ Add rating filter if active
      if (ratingFilter) {
        constraints.push(where('rating', '==', ratingFilter));
      }

      constraints.push(orderBy('updatedAt', 'desc'));

      if (!reset && lastReviewDocRef.current) {
        constraints.push(startAfter(lastReviewDocRef.current));
      }

      constraints.push(limit(REVIEWS_PAGE_SIZE + 1)); // Fetch one extra to check if more exist

      const q = query(...constraints);
      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > REVIEWS_PAGE_SIZE;
      
      // ✅ Only take REVIEWS_PAGE_SIZE documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, REVIEWS_PAGE_SIZE);
      
      const batch = docsToUse.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
        };
      });

      setReviews((prev) => (reset ? batch : [...prev, ...batch]));

      // ✅ Use the last document from the actual batch (not the extra one)
      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      lastReviewDocRef.current = newLastDoc;
      setLastReviewDoc(newLastDoc);
      
      // ✅ Fix: hasMoreReviews is true only if we got more results than page size
      setHasMoreReviews(hasMoreResults);
    } catch (err) {
      console.log('Reviews load error:', err);
      if (reset) setReviews([]);
      setHasMoreReviews(false);
    } finally {
      isLoadingRef.current = false;
      setLoadingReviews(false);
    }
  }, [firestoreDB, selectedUserId]); // ✅ Removed loadingReviews from deps to prevent re-renders

  // initial reviews load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // reset pagination when details open
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    loadReviews(true, starFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]); // ✅ Removed loadReviews from deps to prevent re-renders

  // ⭐ Re-fetch reviews when star filter changes
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // Reset pagination and re-fetch with new filter
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setReviews([]);
    loadReviews(true, starFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starFilter]);

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false, starFilter);
  }, [hasMoreReviews, loadingReviews, loadReviews, starFilter]);

  // ─────────────────────────────────────────────
  // Load trades (paged) — ✅ Initially show 1, then load 2 by 2
  const INITIAL_TRADES_SIZE = 3; // Show 3 trades initially (like posts)
  const LOAD_MORE_TRADES_SIZE = 3; // Load 3 trades at a time when loading more
  
  const loadTrades = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingTrades) return;

    setLoadingTrades(true);
    try {
      // Determine the limit based on whether it's initial load or load more
      const limitSize = reset ? INITIAL_TRADES_SIZE : LOAD_MORE_TRADES_SIZE;
      
      let q;
      if (!reset && lastTradeDoc) {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          startAfter(lastTradeDoc),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // Check if we got more than page size
      const hasMoreResults = snap.docs.length > limitSize;
      
      // Only take limitSize documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, limitSize);
      
      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setTrades((prev) => (reset ? batch : [...prev, ...batch]));

      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      setLastTradeDoc(newLastDoc);
      setHasMoreTrades(hasMoreResults);
    } catch (err) {
      console.error('Trades load error:', err);
      if (reset) setTrades([]);
      setHasMoreTrades(false);
    } finally {
      setLoadingTrades(false);
    }
  }, [firestoreDB, selectedUserId, lastTradeDoc, loadingTrades]);

  // Initial trades load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastTradeDoc(null);
    setHasMoreTrades(false);
    loadTrades(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  // ✅ Memoize handleLoadMoreTrades
  const handleLoadMoreTrades = useCallback(() => {
    if (!hasMoreTrades || loadingTrades) return;
    loadTrades(false);
  }, [hasMoreTrades, loadingTrades, loadTrades]);

  // ─────────────────────────────────────────────
  // Load Posts (paged) — ✅ Initially show 3, then load 3 by 3
  const INITIAL_POSTS_SIZE = 3;
  const LOAD_MORE_POSTS_SIZE = 3;

  const loadPosts = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingPosts) return;

    setLoadingPosts(true);
    try {
      const limitSize = reset ? INITIAL_POSTS_SIZE : LOAD_MORE_POSTS_SIZE;
      let q;

      if (!reset && lastPostDoc) {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          startAfter(lastPostDoc),
          limit(limitSize + 1)
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          limit(limitSize + 1)
        );
      }

      const snap = await getDocs(q);
      const hasMoreResults = snap.docs.length > limitSize;
      const docsToUse = snap.docs.slice(0, limitSize);

      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setPosts((prev) => (reset ? batch : [...prev, ...batch]));
      setLastPostDoc(docsToUse[docsToUse.length - 1] || null);
      setHasMorePosts(hasMoreResults);
    } catch (err) {
      console.error('Posts load error:', err);
      if (reset) setPosts([]);
      setHasMorePosts(false);
    } finally {
      setLoadingPosts(false);
    }
  }, [firestoreDB, selectedUserId, lastPostDoc, loadingPosts]);

  // Initial posts load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastPostDoc(null);
    setHasMorePosts(false);
    loadPosts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  // Handle Load More Posts
  const handleLoadMorePosts = useCallback(() => {
    if (!hasMorePosts || loadingPosts) return;
    loadPosts(false);
  }, [hasMorePosts, loadingPosts, loadPosts]);

  // ─────────────────────────────────────────────
  // Helpers for rendering - ✅ Memoized

  const renderStars = useCallback((value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: config.colors.warning, fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: config.colors.textTertiaryDark }}>{empty}</Text>
      </Text>
    );
  }, []);

  const renderItemBubble = useCallback((item, index) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    return (
      <View
        key={`${item.id || item.name || index}-${index}`}
        style={{
          width: 42,
          height: 42,
          marginRight: 6,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
        }}
      >
        <Image
          source={{ uri: item.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }, [isDarkMode]);

  // ✅ Parse values data for image lookup
  const parsedValuesData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing data:", error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  // ✅ Render trade item
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : "Unknown";

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    // Helper to get MM2 image URL (matching Trades.jsx getImageUrl)
    const getTradeItemImageUrl = (item) => {
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

    return (
      <View
        key={trade.id}
        style={{
          backgroundColor: isDarkMode ? config.colors.backgroundDark : '#ffffff',
          borderRadius: 12,
          padding: 10,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: isDarkMode ? config.colors.surfaceDark : '#e5e7eb',
        }}
      >
        {/* Trade Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              {trade.isFeatured && (
                <View style={{
                  backgroundColor: config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>FEATURED</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                {formattedTime}
              </Text>
            </View>
            {/* Status and Mode Badges - Side by side like Trades.jsx */}
            <View style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              marginTop: 4, 
              alignSelf: 'flex-start',
              flexShrink: 1,
              flexGrow: 0,
              flexWrap: 'nowrap',
              width: undefined,
            }}>
              {/* Status Badge (Win/Lose/Fair) - Only show if status field exists */}
              {trade.status && (
                <View style={{
                  backgroundColor: trade.status === 'w' ? '#10B981' : // Green for win
                                  trade.status === 'f' ? config.colors.secondary : // Blue for fair
                                  config.colors.primary, // Pink/red for lose
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.status === 'w' ? 'Win' : trade.status === 'f' ? 'Fair' : 'Lose'}
                  </Text>
                </View>
              )}
              {/* Shark/Frost/GG Badge */}
              {trade.isSharkMode !== undefined && (
                <View style={{
                  backgroundColor: trade.isSharkMode == 'GG' ? '#5c4c49' : trade.isSharkMode === true ? config.colors.secondary : config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.isSharkMode == 'GG' ? 'GG Values' : trade.isSharkMode === true ? 'Shark' : 'Frost'}
                  </Text>
                </View>
              )}
            </View>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{
                  backgroundColor: deal.color,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                  borderRadius: 6,
                  marginRight: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>
                    {t(deal.label) || deal.label}
                  </Text>
                </View>
                <Text style={{
                  fontSize: 11,
                  color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed,
                  fontWeight: '600'
                }}>
                  {tradePercentage}% {!neutral && (
                    <Icon
                      name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={10}
                      color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                    />
                  )}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Trade Items - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 }}>
          {/* Has Items Grid */}
          {trade.hasItems && trade.hasItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.hasItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.hasItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{ 
                              color: 'white', 
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71', 
                              borderRadius: 10, 
                              width: 10, 
                              height: 10, 
                              fontSize: 6, 
                              textAlign: 'center', 
                              lineHeight: 10, 
                              fontWeight: '600', 
                              overflow: 'hidden', 
                              padding: 0, 
                              margin: 0 
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>Give offer</Text>
              </View>
            </View>
          )}
          
          {/* Transfer Icon */}
          <View style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Image source={require('../../../assets/left-right.png')} style={{ width: 20, height: 20, borderRadius: 5 }} />
          </View>
          
          {/* Wants Items Grid */}
          {trade.wantsItems && trade.wantsItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.wantsItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.wantsItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{ 
                              color: 'white', 
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71', 
                              borderRadius: 10, 
                              width: 10, 
                              height: 10, 
                              fontSize: 6, 
                              textAlign: 'center', 
                              lineHeight: 10, 
                              fontWeight: '600', 
                              overflow: 'hidden', 
                              padding: 0, 
                              margin: 0 
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>Give offer</Text>
              </View>
            </View>
          )}
        </View>
        
        {/* Trade Totals - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', width: '100%', marginTop: 10 }}>
          {trade.hasItems && trade.hasItems.length > 0 && (
            <Text style={{ 
              fontSize: 8, 
              fontFamily: 'Lato-Bold', 
              color: 'white', 
              textAlign: 'center', 
              alignSelf: 'center', 
              marginHorizontal: 'auto', 
              paddingHorizontal: 4, 
              paddingVertical: 2, 
              borderRadius: 6,
              backgroundColor: config.colors.hasBlockGreen
            }}>
              ME: {formatTradeValue(typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0)}
            </Text>
          )}
          <View style={{ justifyContent: 'center', alignItems: 'center', marginHorizontal: 8 }}>
            {(trade.hasItems && trade.hasItems.length > 0 && trade.wantsItems && trade.wantsItems.length > 0) && (
              <>
                {(() => {
                  const hasValue = typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0;
                  const wantsValue = typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0;
                  if (hasValue > wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-up-outline" size={12} color="green" />
                        <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: 'green', textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(hasValue - wantsValue)}
                        </Text>
                      </View>
                    );
                  } else if (hasValue < wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-down-outline" size={12} color={config.colors.hasBlockGreen} />
                        <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: config.colors.hasBlockGreen, textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(wantsValue - hasValue)}
                        </Text>
                      </View>
                    );
                  } else {
                    return <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: config.colors.primary, textAlign: 'center' }}>-</Text>;
                  }
                })()}
              </>
            )}
          </View>
          {trade.wantsItems && trade.wantsItems.length > 0 && (
            <Text style={{ 
              fontSize: 8, 
              fontFamily: 'Lato-Bold', 
              color: 'white', 
              textAlign: 'center', 
              alignSelf: 'center', 
              marginHorizontal: 'auto', 
              paddingHorizontal: 4, 
              paddingVertical: 2, 
              borderRadius: 6,
              backgroundColor: config.colors.wantBlockRed
            }}>
              YOU: {formatTradeValue(typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0)}
            </Text>
          )}
        </View>

        {/* Description */}
        {trade.description && (
          <Text style={{
            fontSize: 10,
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            marginTop: 6,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: isDarkMode ? config.colors.surfaceDark : '#e5e7eb',
          }}>
            {trade.description}
          </Text>
        )}
      </View>
    );
  }, [isDarkMode, t]);

  // ✅ Render Post Item
  const renderPostItem = useCallback((post) => {
    const timeLabel = post.createdAt ? dayjs(post.createdAt.toDate ? post.createdAt.toDate() : post.createdAt).fromNow() : 'Just now';
    const images = Array.isArray(post.imageUrl) ? post.imageUrl : (post.imageUrl ? [post.imageUrl] : []);
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const tags = Array.isArray(post.selectedTags) ? post.selectedTags : [];

    const getTagColor = (tag) => {
      switch ((tag || '').toLowerCase()) {
        case 'scam alert': return '#FF3B30';
        case 'looking for trade': return '#34C759';
        case 'discussion': return '#5AC8FA';
        case 'real or fake': return '#AF52DE';
        case 'need help': return '#FF9500';
        case 'misc': case 'misc.': return '#8E8E93';
        default: return config.colors.primary;
      }
    };

    return (
      <TouchableOpacity
        key={post.id}
        activeOpacity={0.8}
        onPress={() => setSelectedPost(post)}
        style={{
          backgroundColor: isDarkMode ? config.colors.backgroundDark : '#ffffff',
          borderRadius: 12,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isDarkMode ? config.colors.surfaceDark : '#e5e7eb',
          overflow: 'hidden',
        }}
      >
        {/* Post Image */}
        {images.length > 0 && (
          <Image
            source={{ uri: images[0] }}
            style={{ width: '100%', height: 140, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
            resizeMode="cover"
          />
        )}

        {/* Content */}
        <View style={{ padding: 10 }}>
          {/* Tags row */}
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {tags.map((tag, idx) => (
                <View key={idx} style={{
                  paddingHorizontal: 7, paddingVertical: 2,
                  borderRadius: 999, backgroundColor: getTagColor(tag),
                }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description */}
          {!!post.desc && (
            <Text
              style={{
                fontSize: 12, lineHeight: 17,
                color: isDarkMode ? '#e2e8f0' : '#111827',
                marginBottom: 6,
              }}
              numberOfLines={3}
            >
              {post.desc}
            </Text>
          )}

          {/* Footer: time + stats */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 10, color: isDarkMode ? '#64748b' : '#9ca3af' }}>
              {timeLabel}
            </Text>
            {likeCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="heart" size={10} color="#EF4444" />
                <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#94a3b8' : '#6b7280' }}>
                  {likeCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [isDarkMode]);

  // ── Post Viewer Modal ──
  const screenWidth = Dimensions.get('window').width;

  const renderPostViewerModal = useMemo(() => {
    if (!selectedPost) return null;

    const post = selectedPost;
    const timeLabel = post.createdAt
      ? dayjs(post.createdAt.toDate ? post.createdAt.toDate() : post.createdAt).fromNow()
      : 'Just now';
    const images = Array.isArray(post.imageUrl) ? post.imageUrl : (post.imageUrl ? [post.imageUrl] : []);
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const tags = Array.isArray(post.selectedTags) ? post.selectedTags : [];

    const getTagColor = (tag) => {
      switch ((tag || '').toLowerCase()) {
        case 'scam alert': return '#FF3B30';
        case 'looking for trade': return '#34C759';
        case 'discussion': return '#5AC8FA';
        case 'real or fake': return '#AF52DE';
        case 'need help': return '#FF9500';
        case 'misc': case 'misc.': return '#8E8E93';
        default: return config.colors.primary;
      }
    };

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={!!selectedPost}
        onRequestClose={() => setSelectedPost(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setSelectedPost(null)}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: isDarkMode ? config.colors.surfaceDark : '#ffffff',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '85%',
              paddingBottom: Platform.OS === 'ios' ? 34 : 20,
            }}
          >
            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 14,
              borderBottomWidth: 1, borderBottomColor: isDarkMode ? config.colors.surfaceDark : '#e5e7eb',
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Image
                  source={{ uri: post.avatar || avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                  style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#f3f4f6' : '#111827' }} numberOfLines={1}>
                    {post.displayName || userName || 'Anonymous'}
                  </Text>
                  <Text style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#6b7280' }}>{timeLabel}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setSelectedPost(null)} style={{ padding: 4 }}>
                <Icon name="close" size={24} color={isDarkMode ? '#e5e7eb' : '#374151'} />
              </TouchableOpacity>
            </View>

            {/* Images */}
            {images.length > 0 && (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {images.map((img, idx) => (
                  <Image
                    key={idx}
                    source={{ uri: img }}
                    style={{ width: screenWidth, height: 300 }}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {/* Tags */}
              {tags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 4 }}>
                  {tags.map((tag, idx) => (
                    <View key={idx} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: getTagColor(tag) }}>
                      <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Description */}
              {post.desc ? (
                <Text style={{ fontSize: 14, color: isDarkMode ? '#e2e8f0' : '#111827', lineHeight: 20, marginTop: 10, marginBottom: 10 }}>
                  {post.desc}
                </Text>
              ) : null}

              {/* Like count */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderTopWidth: 1, borderTopColor: isDarkMode ? config.colors.surfaceDark : '#e5e7eb', marginBottom: 10,
              }}>
                <Icon name="heart" size={16} color="#EF4444" />
                <Text style={{ fontSize: 12, fontWeight: '600', color: isDarkMode ? '#e2e8f0' : '#111827', marginLeft: 6 }}>
                  {likeCount} {likeCount === 1 ? 'Like' : 'Likes'}
                </Text>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }, [selectedPost, isDarkMode, avatar, userName, screenWidth]);

  // ── Default gradient — neutral gray ──
  const DEFAULT_BANNER = ['#64748b', '#94a3b8', '#cbd5e1'];
  const bannerColor = DEFAULT_BANNER[0];
  const bannerColorEnd = DEFAULT_BANNER[2];

  // ─────────────────────────────────────────────
  return (
    <>
      {renderPostViewerModal}
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible && !selectedPost}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <SwipeableBottomDrawer onClose={toggleModal} showPill={false} style={[styles.drawer, { padding: 0, paddingBottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', shadowOpacity: 0, elevation: 0 }]}>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: loadDetails ? Dimensions.get('window').height * 0.85 : 500, backgroundColor: 'rgba(0,0,0,0.5)' }}
          >
            {/* ═══ GRADIENT BANNER ═══ */}
            <View style={{
              height: 90,
              backgroundColor: bannerColor,
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Drag Handle — overlaid on banner */}
              <View style={{ alignItems: 'center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', marginTop: 8 }} />
              </View>
              {/* Decorative gradient circles */}
              <View style={{
                position: 'absolute', top: -20, right: -20,
                width: 80, height: 80, borderRadius: 40,
                backgroundColor: bannerColorEnd, opacity: 0.3,
              }} />
              <View style={{
                position: 'absolute', bottom: -15, left: 30,
                width: 50, height: 50, borderRadius: 25,
                backgroundColor: '#ffffff', opacity: 0.1,
              }} />
              <View style={{
                position: 'absolute', top: 10, left: -10,
                width: 60, height: 60, borderRadius: 30,
                backgroundColor: bannerColorEnd, opacity: 0.2,
              }} />

              {/* PRO badge on banner */}
              {mergedUser?.isPro && (
                <View style={{
                  position: 'absolute', top: 12, right: 14,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  paddingHorizontal: 10, paddingVertical: 4,
                  borderRadius: 999,
                }}>
                  <Text style={{ fontSize: 12 }}>⭐</Text>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Pro</Text>
                </View>
              )}

              {/* Ban/Block icon on banner */}
              <TouchableOpacity
                onPress={handleBanToggle}
                style={{
                  position: 'absolute', top: 12, left: 14,
                  padding: 6, borderRadius: 999,
                  backgroundColor: 'rgba(255,255,255,0.15)',
                }}
              >
                <Icon
                  name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={16}
                  color="#fff"
                />
              </TouchableOpacity>
            </View>

            {/* ═══ CONTENT AREA (white/dark bg below banner) ═══ */}
            <View style={{ backgroundColor: c.bg, paddingBottom: 12 }}>

              {/* ═══ CENTERED AVATAR (overlapping banner) ═══ */}
              <View style={{ alignItems: 'center', marginTop: -36, zIndex: 10 }}>
                {/* No fixed-size overflow:hidden wrapper here — FramedAvatar
                    paints wider than its avatarSize and would be clipped. */}
                <FramedAvatar
                  avatarUri={mergedUser?.avatar || avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                  frame={drawerCosmetics?.profileFrame || null}
                  isDarkMode={isDarkMode}
                  avatarSize={72}
                />
                {/* Online indicator */}
                <View style={{
                  position: 'absolute', bottom: 2, right: '50%', marginRight: -36,
                  width: 14, height: 14,
                  borderRadius: 7,
                  backgroundColor: isOnline ? '#22c55e' : '#94a3b8',
                  borderWidth: 2,
                  borderColor: c.bg,
                  zIndex: 11,
                }} />
              </View>

              {/* ═══ NAME + BADGES (centered) ═══ */}
              <View style={{ alignItems: 'center', marginTop: 8, paddingHorizontal: 12 }}>
                {/* Name row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Text
                    style={{
                      fontSize: 20, fontWeight: '800',
                      color: c.text,
                    }}
                    numberOfLines={1}
                  >
                    {userName}
                  </Text>
                  {selectedUser?.flage ? (
                    <Text style={{ fontSize: 18 }}>{selectedUser.flage}</Text>
                  ) : null}
                  <TouchableOpacity onPress={() => copyToClipboard(userName)} style={{ padding: 2 }}>
                    <Icon name="copy-outline" size={14} color={c.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Badge pills */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 5 }}>
                  {mergedUser?.isAdmin && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                      <Icon name="shield" size={10} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>Admin</Text>
                    </View>
                  )}
                  {!mergedUser?.isAdmin && mergedUser?.isModerator && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#8B5CF6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                      <Icon name="shield-checkmark" size={10} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>Mod</Text>
                    </View>
                  )}
                  {mergedUser?.robloxUsernameVerified && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: isDarkMode ? 'rgba(56,189,248,0.15)' : 'rgba(14,165,233,0.1)',
                      borderWidth: 1, borderColor: isDarkMode ? 'rgba(56,189,248,0.3)' : 'rgba(14,165,233,0.25)',
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                    }}>
                      <Icon name="checkmark-circle" size={10} color={isDarkMode ? '#38bdf8' : '#0ea5e9'} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: isDarkMode ? '#38bdf8' : '#0ea5e9' }}>Verified</Text>
                    </View>
                  )}
                  {mergedUser?.robloxUsername && !mergedUser?.robloxUsernameVerified && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(217,119,6,0.1)',
                      borderWidth: 1, borderColor: isDarkMode ? 'rgba(251,191,36,0.3)' : 'rgba(217,119,6,0.25)',
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                    }}>
                      <Icon name="alert-circle-outline" size={10} color={isDarkMode ? '#fbbf24' : '#d97706'} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: isDarkMode ? '#fbbf24' : '#d97706' }}>Unverified</Text>
                    </View>
                  )}
                </View>

                {/* Roblox username subtitle */}
                {mergedUser?.robloxUsername && (
                  <TouchableOpacity
                    onPress={handleOpenRobloxProfile}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                    activeOpacity={0.7}
                  >
                    <Icon name="game-controller" size={12} color={c.textMuted} />
                    <Text style={{ fontSize: 12, color: c.textSecondary, fontWeight: '600' }}>
                      {mergedUser.robloxUsername}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ═══ STATS STRIP ═══ */}
              {loadDetails && !loadingRating && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  marginTop: 14, marginHorizontal: 12,
                  paddingVertical: 10,
                  borderTopWidth: 1, borderBottomWidth: 1,
                  borderColor: isDarkMode ? config.colors.surfaceDark : '#f1f5f9',
                }}>
                  {/* Rating */}
                  {ratingSummary && (
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Rating</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <Text style={{ fontSize: 12, color: '#fbbf24' }}>★</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                          {ratingSummary.value.toFixed(1)}
                        </Text>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: c.textMuted }}>({ratingSummary.count})</Text>
                      </View>
                    </View>
                  )}
                  {/* Followers */}
                  <View style={{
                    flex: 1, alignItems: 'center',
                    borderLeftWidth: ratingSummary ? 1 : 0,
                    borderColor: c.border,
                  }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Followers</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      <Icon name="people" size={12} color="#8b5cf6" />
                      <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                        {followersCount || 0}
                      </Text>
                    </View>
                  </View>
                  {/* XP */}
                  {userPoints !== null && userPoints > 0 && (
                    <View style={{
                      flex: 1, alignItems: 'center',
                      borderLeftWidth: 1, borderColor: c.border,
                    }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>XP</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <Text style={{ fontSize: 12 }}>⚡</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                          {Number(userPoints).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  )}
                  {/* Wins */}
                  {gameWins !== null && gameWins > 0 && (
                    <View style={{
                      flex: 1, alignItems: 'center',
                      borderLeftWidth: 1, borderColor: c.border,
                    }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Wins</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <Text style={{ fontSize: 12 }}>🏆</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                          {gameWins}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* ═══ JOINED DATE (under stats) ═══ */}
              {loadDetails && !loadingRating && createdAtText && (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon name="calendar-outline" size={11} color={c.textMuted} />
                    <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '500' }}>
                      Joined {createdAtText}
                    </Text>
                  </View>
                </View>
              )}

              {/* Loading indicator for details */}
              {loadDetails && loadingRating && (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <ActivityIndicator size="small" color={config.colors.primary} />
                </View>
              )}

              {/* 📝 Bio Section */}
              {loadDetails && (
                <View style={{
                  borderRadius: 14, padding: 12, marginHorizontal: 12,
                  backgroundColor: c.bgAlt,
                  marginTop: 8,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <View style={{
                      width: 24, height: 24, borderRadius: 8,
                      backgroundColor: isDarkMode ? 'rgba(96,165,250,0.15)' : 'rgba(96,165,250,0.1)',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon name="person" size={12} color="#60a5fa" />
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>
                      Bio
                    </Text>
                  </View>
                  <Text style={{
                    fontSize: 13, lineHeight: 19,
                    color: c.text,
                  }}>
                    {userBio || 'Hi there, I am new here'}
                  </Text>
                </View>
              )}


              {/* 🎒 Items & Portfolio */}
              {loadDetails && (
                <View style={{ marginHorizontal: 12 }}>
                  <CompactPortfolio
                    ownedPets={ownedItems}
                    wishlistPets={wishlistItems}
                    isDarkMode={isDarkMode}
                    t={t}
                    loadingPets={loadingItems}
                    renderPetBubble={renderItemBubble}
                  />
                </View>
              )}

              {/* ⭐ Reviews Section */}
              {loadDetails && (
                <View style={{ marginHorizontal: 12 }}>
                  <ProfileReviewsSection
                    isDarkMode={isDarkMode}
                    t={t}
                    reviews={reviews}
                    loadingReviews={loadingReviews}
                    hasMoreReviews={hasMoreReviews}
                    handleLoadMoreReviews={handleLoadMoreReviews}
                    renderStars={renderStars}
                    getTimestampMs={getTimestampMs}
                    formatCreatedAt={formatCreatedAt}
                    starFilter={starFilter}
                    setStarFilter={setStarFilter}
                  />
                </View>
              )}

              {/* 🔄 Trades Section */}
              {loadDetails && (
                <View style={{ marginHorizontal: 12 }}>
                  <ProfileTradesSection
                    isDarkMode={isDarkMode}
                    t={t}
                    trades={trades}
                    loadingTrades={loadingTrades}
                    hasMoreTrades={hasMoreTrades}
                    handleLoadMoreTrades={handleLoadMoreTrades}
                    renderTradeItem={renderTradeItem}
                  />
                </View>
              )}

              {/* 🖼️ Posts Section */}
              {loadDetails && (
                <View style={{ marginHorizontal: 12 }}>
                  <ProfilePostsSection
                    isDarkMode={isDarkMode}
                    t={t}
                    posts={posts}
                    loadingPosts={loadingPosts}
                    hasMorePosts={hasMorePosts}
                    handleLoadMorePosts={handleLoadMorePosts}
                    renderPostItem={renderPostItem}
                  />
                </View>
              )}

              {/* ═══ ACTION BUTTONS (Premium Pill Style) ═══ */}
              <View style={{
                marginTop: 10, marginBottom: 10,
                paddingHorizontal: 12,
                gap: 7,
              }}>
                {/* Top row: Chat + Follow (or Chat + Roblox if no follow) */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {/* Chat Action */}
                  {!fromPvtChat && (
                    <TouchableOpacity
                      onPress={handleStartChat}
                      activeOpacity={0.85}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 7, paddingVertical: 10, borderRadius: 12,
                        backgroundColor: bannerColor,
                        shadowColor: bannerColor, shadowOffset: { width: 0, height: 5 },
                        shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
                      }}
                    >
                      {/* Inner glow */}
                      <View style={{
                        position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                        borderRadius: 13, borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.2)',
                      }} />
                      <Icon name="chatbubble" size={18} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                        {t('chat.start_chat')}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Follow/Unfollow Action */}
                  {!fromPvtChat && user?.id !== selectedUserId && (
                    <TouchableOpacity
                      onPress={handleFollowToggle}
                      disabled={followLoading}
                      activeOpacity={0.85}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 7, paddingVertical: 10, borderRadius: 12,
                        backgroundColor: isFollowing
                          ? (isDarkMode ? config.colors.surfaceDark : '#f1f5f9')
                          : (isDarkMode ? '#059669' : '#10b981'),
                        borderWidth: isFollowing ? 1.5 : 0,
                        borderColor: isFollowing
                          ? (c.border)
                          : 'transparent',
                        shadowColor: isFollowing ? (isDarkMode ? '#000' : '#94a3b8') : '#10b981',
                        shadowOffset: { width: 0, height: isFollowing ? 3 : 5 },
                        shadowOpacity: isFollowing ? 0.15 : 0.35,
                        shadowRadius: isFollowing ? 6 : 10,
                        elevation: isFollowing ? 3 : 6,
                      }}
                    >
                      {!isFollowing && (
                        <View style={{
                          position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                          borderRadius: 13, borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.2)',
                        }} />
                      )}
                      {followLoading ? (
                        <ActivityIndicator size="small" color={isFollowing ? (c.textSecondary) : '#fff'} />
                      ) : (
                        <>
                          <Icon
                            name={isFollowing ? "person-remove" : "person-add"}
                            size={18}
                            color={isFollowing ? (c.textSecondary) : '#fff'}
                          />
                          <Text style={{
                            fontSize: 13, fontWeight: '700',
                            color: isFollowing ? (c.textSecondary) : '#fff',
                          }}>
                            {isFollowing ? 'Unfollow' : 'Follow'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>

                {/* Second row: Roblox + View Profile */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {/* Roblox Profile */}
                  {mergedUser?.robloxUsername && (
                    <TouchableOpacity
                      onPress={handleOpenRobloxProfile}
                      activeOpacity={0.85}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 7, paddingVertical: 9, borderRadius: 12,
                        backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f1f5f9',
                        borderWidth: 1.5,
                        borderColor: c.border,
                        shadowColor: isDarkMode ? '#000' : '#94a3b8',
                        shadowOffset: { width: 0, height: 3 },
                        shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                      }}
                    >
                      <Icon name="game-controller" size={16} color={isDarkMode ? '#60a5fa' : '#2563eb'} />
                      <Text style={{
                        fontSize: 12, fontWeight: '700',
                        color: isDarkMode ? '#60a5fa' : '#2563eb',
                      }}>Roblox</Text>
                    </TouchableOpacity>
                  )}

                  {/* View Profile — only on initial view */}
                  {!loadDetails && (
                    <TouchableOpacity
                      onPress={() => setLoadDetails(true)}
                      activeOpacity={0.85}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 7, paddingVertical: 9, borderRadius: 12,
                        backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f1f5f9',
                        borderWidth: 1.5,
                        borderColor: c.border,
                        shadowColor: isDarkMode ? '#000' : '#94a3b8',
                        shadowOffset: { width: 0, height: 3 },
                        shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                      }}
                    >
                      <Icon name="person" size={16} color={isDarkMode ? '#e2e8f0' : '#475569'} />
                      <Text style={{
                        fontSize: 12, fontWeight: '700',
                        color: isDarkMode ? '#e2e8f0' : '#475569',
                      }}>View Detail Profile</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

            </View>{/* end content area */}
          </ScrollView>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
    </>
  );
};

export default ProfileBottomDrawer;

