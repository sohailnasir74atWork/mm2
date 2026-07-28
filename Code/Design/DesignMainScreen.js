import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { 
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  addDoc,
  writeBatch,
  deleteField,
} from '@react-native-firebase/firestore';
import { ref as dbRef, get } from '@react-native-firebase/database';

import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import PostCard from './componenets/PostCard';
import UploadModal from './componenets/UploadModal';
import SignInDrawer from '../Firebase/SigninDrawer';
import config from '../Helper/Environment';
import { getMyCosmetics } from '../Helper/cosmeticsCache';
import { Platform } from 'react-native';
import { showMessage } from 'react-native-flash-message';
import NativeAdCard from '../Ads/NativeAdCard';
import { releaseByPrefix as releaseNativeAds } from '../Ads/NativeAdManager';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import PostsHeader from './componenets/PostsHeader';
import { useTranslation } from 'react-i18next';

// Insert a native-ad slot every AD_FREQUENCY real items. Module-scoped so its
// identity is stable across renders (lets dataToRender be safely memoized).
const AD_FREQUENCY = 5;
function interleaveAds(items, showAds) {
  if (!showAds) return items;
  const out = [];
  let real = 0;
  for (let i = 0; i < items.length; i++) {
    out.push(items[i]);
    real++;
    if (real > 0 && real % AD_FREQUENCY === 0) {
      out.push({ __type: 'ad', id: `ad-${i}` });
    }
  }
  return out;
}

const DesignFeedScreen = ({ route }) => {
  const { selectedTheme } = route.params;
  const { appdatabase, user, theme, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // + 24: a clear (but not oversized) gap above the floating tab bar. The
  // collapsible/expanding format is disabled on Android (bannerAds.js), so a
  // static banner 24px above the nav is well clear of any tab tap without the
  // dead space a full finger-width left (AdMob "accidental clicks: layout").
  const bannerBottomPos = 0; // tab bar is docked (in layout flow), so screen bottom == tab bar top; banner sits flush above it
  const { t } = useTranslation();

  const [modalVisible, setModalVisible] = useState(false);
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [posts, setPosts] = useState([]);
  const [lastVisibleDoc, setLastVisibleDoc] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterMyPosts, setFilterMyPosts] = useState(false);
  const [myPosts, setMyPosts] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [lastPostTime, setLastPostTime] = useState(null);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [activeSort, setActiveSort] = useState('latest');
  const [rankedPosts, setRankedPosts] = useState([]);

  useEffect(() => {
    // if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [localState.bannedUsers]);

  // Free this feed's native ad handles on unmount (keys are prefixed 'ad-').
  useEffect(() => {
    return () => releaseNativeAds('ad-');
  }, []);
  // console.log('mainscreen')
  const fetchMyPosts = async (tag = null) => {
    if (!user?.id) return;
    // console.log('📦 Fetching My Posts...');
    setInitialLoading(true);
    try {
      let q = query(
        collection(firestoreDB, 'designPosts'),
        where('userId', '==', user.id),
        orderBy('createdAt', 'desc')
      );
      
  
      if (tag) {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', user.id),
          where('selectedTags', 'array-contains', tag),
          orderBy('createdAt', 'desc')
        );
        
      }
  
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // console.log('✅ My Posts fetched:', data.length);
      setMyPosts(data);
      setHasMore(snapshot.docs.length > 0);
    } catch (err) {
      console.error('❌ Error fetching my posts:', err);
      showMessage({ message: t('feed.fetch_failed'), type: 'danger' });
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };
  
  const deleteUsersLatestPosts = async (userId, n = 15) => {
    if (!userId) throw new Error('userId is required');
  
    const q = query(
      collection(firestoreDB, 'designPosts'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(n)
    );
  
    const snap = await getDocs(q);
    if (snap.empty) return [];
  
    const batch = writeBatch(firestoreDB);
    const ids = [];
  
    snap.docs.forEach(d => {
      batch.delete(d.ref);
      ids.push(d.id);
    });
  
    await batch.commit();
    return ids;
  };
  
  // useEffect(() => {
  //   nativeAdPool.fillIfNeeded();
  //   return () => nativeAdPool.destroyAll();
  // }, []);


  const fetchPostsByTag = async (tag) => {
    try {
      setInitialLoading(true);

      const q = query(
        collection(firestoreDB, 'designPosts'),
        where('selectedTags', 'array-contains', tag),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      
      const snapshot = await getDocs(q);
      

      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Error fetching posts by tag:', err);
      showMessage({ message: t('feed.fetch_failed'), type: 'danger' });
    } finally {
      setInitialLoading(false);
    }
  };


  const skeletonArray = useMemo(() => Array.from({ length: 5 }), []);
    const handleDeletePost = async (postId) => {
      try {
        await deleteDoc(doc(firestoreDB, 'designPosts', postId));
        setPosts(prev => prev.filter(p => p.id !== postId));
        showMessage({ message: t('feed.post_deleted'), type: 'success' });
      } catch (err) {
        showMessage({ message: t('feed.delete_failed'), type: 'danger' });
      }
    };
    



  const fetchInitialPosts = async () => {
    try {
      const q = query(
        collection(firestoreDB, 'designPosts'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Initial load error:', err);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  // ── Fetch ranked posts (Hot / Trending) from RTDB ──
  const fetchRankedPosts = useCallback(async (sortKey) => {
    if (!appdatabase || !firestoreDB) return;
    setInitialLoading(true);
    try {
      // Read pre-computed ranking from RTDB
      const rankingRef = dbRef(appdatabase, `feedRanking/${sortKey}`);
      const snap = await get(rankingRef);

      if (!snap.exists()) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      const ranking = snap.val(); // Array of { postId, score, ... }
      if (!Array.isArray(ranking) || ranking.length === 0) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      // Batch fetch post documents by ID
      const postIds = ranking.map(r => r.postId).filter(Boolean);
      const postPromises = postIds.map(id =>
        getDoc(doc(firestoreDB, 'designPosts', id))
          .then(d => d.exists() ? { id: d.id, ...d.data() } : null)
          .catch(() => null)
      );

      const fetchedPosts = await Promise.all(postPromises);
      const validPosts = fetchedPosts.filter(Boolean);

      // Preserve the ranking order from RTDB
      const orderMap = new Map(postIds.map((id, idx) => [id, idx]));
      validPosts.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

      setRankedPosts(validPosts);
      setHasMore(false); // No pagination for ranked lists
    } catch (err) {
      console.warn(`[Feed] Error fetching ${sortKey} posts:`, err?.message);
      setRankedPosts([]);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, firestoreDB]);

  // ── Handle sort mode changes ──
  const handleSortChange = useCallback((sortKey) => {
    setActiveSort(sortKey);
    if (sortKey === 'latest') {
      fetchInitialPosts();
    } else {
      fetchRankedPosts(sortKey);
    }
  }, [fetchInitialPosts, fetchRankedPosts]);

  useEffect(() => {
    fetchInitialPosts();
  }, []);

  // NOTE: Previously this screen opened one live Firestore onSnapshot listener
  // PER post (and re-subscribed all of them on every pagination), which billed a
  // read on attach plus a read on every like/comment by anyone — the largest
  // read-cost source in the app. Removed in favour of optimistic local updates
  // in handleLike (below); likes/comment counts now reconcile on pull-to-refresh.

  const loadMorePosts = async () => {
    // Hot/Trending load all at once (ranked), no pagination
    if (loadingMore || !hasMore || !lastVisibleDoc || filterMyPosts || activeSort !== 'latest') return;

    setLoadingMore(true);
    try {
      let q;

      if (selectedTag) {
        // with tag filter
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('selectedTags', 'array-contains', selectedTag),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      } else {
        // without tag filter
        q = query(
          collection(firestoreDB, 'designPosts'),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      }

      const snapshot = await getDocs(q);
      const newPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(prev => [...prev, ...newPosts]);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 10);
    } catch (err) {
      console.error('Pagination load error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLike = async (post) => {
    if (!user?.id) return;
    const postRef = doc(firestoreDB, 'designPosts', post.id);
    const alreadyLiked = !!post.likes?.[user.id];

    // Optimistic local update across every list the post can appear in. This
    // replaces the former per-post onSnapshot listener (a major read cost): the
    // UI reflects the like instantly, the write below persists it, and we roll
    // back on failure.
    const applyLike = (liked) => (arr) =>
      Array.isArray(arr)
        ? arr.map((p) => {
            if (p?.id !== post.id) return p;
            const likes = { ...(p.likes || {}) };
            if (liked) likes[user.id] = true;
            else delete likes[user.id];
            return { ...p, likes };
          })
        : arr;

    const toNewState = applyLike(!alreadyLiked);
    setPosts(toNewState);
    setMyPosts(toNewState);
    setRankedPosts(toNewState);

    try {
      await updateDoc(postRef, {
        [`likes.${user.id}`]: alreadyLiked ? deleteField() : true,
      });
    } catch (e) {
      // Roll back to the prior like state on write failure.
      const rollback = applyLike(alreadyLiked);
      setPosts(rollback);
      setMyPosts(rollback);
      setRankedPosts(rollback);
    }
  };

  const handleUploadPost = async (desc, imageUrls, selectedTags, currentUserEmail) => {
    // ✅ Prevent multiple submissions - check if already submitting
    if (isSubmittingPost) {
      return;
    }
    
    if (!user?.id) return;
    
    // ✅ Set submitting state IMMEDIATELY to prevent duplicate submissions
    setIsSubmittingPost(true);
    
    try {
      // ✅ 2-minute cooldown check (using Date.now() for accurate comparison)
      const now = Date.now();
      const COOLDOWN_MS = 120000; // 2 minutes
      if (lastPostTime && (now - lastPostTime) < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastPostTime)) / 1000);
        const minutesLeft = Math.floor(secondsLeft / 60);
        const remainingSeconds = secondsLeft % 60;
        const timeMessage = minutesLeft > 0 
          ? `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`
          : `${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;
        showMessage({ 
          message: `Please wait ${timeMessage} before posting again.`, 
          type: 'danger',
          duration: 3000
        });
        setIsSubmittingPost(false);
        throw new Error('Cooldown period not elapsed'); // ✅ Throw error to prevent clearing form
      }
      // ✅ Tags are mandatory
      if (!selectedTags || (Array.isArray(selectedTags) && selectedTags.length === 0)) {
        showMessage({
          message: t('feed.missing_tag'),
          description: t('feed.missing_tag_msg'),
          type: 'danger',
        });
        setIsSubmittingPost(false);
        throw new Error('Missing tags'); // ✅ Throw error to prevent clearing form
      }
      
      // Ensure imageUrls is an array (PostCard expects imageUrl as array)
      const imageUrlArray = Array.isArray(imageUrls) 
        ? imageUrls.filter(url => url && typeof url === 'string' && url.trim().length > 0)
        : (imageUrls && typeof imageUrls === 'string' && imageUrls.trim().length > 0 ? [imageUrls] : []);
      
      // ✅ Calculate hasRecentGameWin (similar to Trader.jsx)
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h
      
      // ✅ Images are optional - posts can have text only, images only, or both
      // ✅ Tags are always required and must be saved to database
      const post = {
        imageUrl: imageUrlArray.length > 0 ? imageUrlArray : [], // PostCard expects imageUrl as array
        desc: (desc && desc.trim()) || "",
        userId: user?.id || "Anonymous",
        displayName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        createdAt: serverTimestamp(),
        likes: {},
        selectedTags: Array.isArray(selectedTags) && selectedTags.length > 0 
          ? selectedTags 
          : (selectedTags ? [selectedTags] : ['Discussion']), // ✅ Always ensure tags exist
        email: currentUserEmail || null,
        report: false,
        flage: user?.flage || null,
        robloxUsername: user?.robloxUsername || null,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        hasRecentGameWin: hasRecentWin, // ✅ Game win info
        lastGameWinAt: user?.lastGameWinAt || null, // ✅ Game win timestamp
        // Stamp the poster's equipped frame so the feed can render it without a
        // profile lookup. PostCard still falls back to the profile cache for
        // posts made before this shipped.
        ...(getMyCosmetics()?.profileFrame ? { profileFrame: getMyCosmetics().profileFrame } : {}),
      };
      
      await addDoc(collection(firestoreDB, 'designPosts'), post);
      
      // ✅ Update last post time after successful upload
      setLastPostTime(now);
      
      // ✅ Refresh feed after posting
      setRefreshing(true);
      await fetchInitialPosts();
      
      showMessage({
        message: 'Success',
        description: 'Post created successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('Error uploading post:', error);
      // ✅ Only show error message if it's not a validation error (cooldown/tags)
      if (!error.message || (!error.message.includes('Cooldown') && !error.message.includes('tags'))) {
        showMessage({
          message: t('feed.upload_failed'),
          description: t('feed.upload_failed_msg'),
          type: 'danger',
        });
      }
      // ✅ Re-throw error so UploadModal can handle it and prevent form clearing
      throw error;
    } finally {
      // ✅ Always reset submitting state, even if there was an error
      setIsSubmittingPost(false);
    }
  };
  
  const renderItem = ({ item, index }) => {
    if (initialLoading) {
      return <View style={[styles.skeletonPost, isDarkMode && { backgroundColor: '#444' }]} />;
    }

    // Native ad slot interleaved into the feed (collapses to nothing when
    // unfilled or for Pro users, so the feed never shows a blank gap).
    if (item?.__type === 'ad') {
      return <NativeAdCard adKey={item.id} isDarkMode={isDarkMode} />;
    }

    return (
      <PostCard
        item={item}
        userId={user?.id}
        onLike={handleLike}
        localState={localState}
        appdatabase={appdatabase}
        onDelete={handleDeletePost}
        onDeleteAll={deleteUsersLatestPosts}


      />
    );
  };

  // const dataToRender = initialLoading
  //   ? skeletonArray
  //   : filterMyPosts
  //     ? myPosts
  //     : posts;
  const baseList = initialLoading
    ? skeletonArray
    : filterMyPosts
      ? myPosts
      : (activeSort !== 'latest' ? rankedPosts : posts);

  // keep ads; drop banned users' posts
  const filteredBase = useMemo(() => {
    if (initialLoading) return skeletonArray;
    if (!Array.isArray(bannedUsers) || bannedUsers.length === 0) return baseList;
    return baseList.filter(item =>
      item?.__type === 'ad' || !bannedUsers.includes(item?.userId)
    );
  }, [initialLoading, baseList, bannedUsers, skeletonArray]);
  
  // Memoized so FlatList gets a stable `data` reference (the interleave used to
  // run and allocate a new array on every render, defeating list bail-out).
  const dataToRender = useMemo(
    () => (initialLoading ? skeletonArray : interleaveAds(filteredBase, !localState?.isPro)),
    [initialLoading, filteredBase, localState?.isPro, skeletonArray]
  );

  // Stable keys: drop `index` from real-item keys so pagination/reorder doesn't
  // remount rows (which previously also forced native ad cards to reload).
  const keyExtractor = useCallback(
    (item, index) =>
      initialLoading
        ? `skeleton-${index}`
        : item?.__type === 'ad'
          ? item.id
          : (item?.id != null ? String(item.id) : `post-${index}`),
    [initialLoading]
  );

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <FlatList
        data={dataToRender}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        contentContainerStyle={{ paddingBottom: 180 }}
        onRefresh={() => {
          setRefreshing(true);
          if (activeSort !== 'latest') {
            fetchRankedPosts(activeSort);
          } else {
            fetchInitialPosts();
          }
        }}
        ListHeaderComponent={
          <View>
            <PostsHeader
              selectedTag={selectedTag}
              filterMyPosts={filterMyPosts}
              setFilterMyPosts={setFilterMyPosts}
              setSelectedTag={setSelectedTag}
              fetchInitialPosts={fetchInitialPosts}
              fetchMyPosts={fetchMyPosts}
              fetchPostsByTag={fetchPostsByTag}
              activeSort={activeSort}
              onSortChange={handleSortChange}
            />
          </View>
        }
        stickyHeaderIndices={[0]}
        ListFooterComponent={
          loadingMore && !initialLoading ? (
            <ActivityIndicator size="small" color={config.colors.primary} />
          ) : null
        }
        ListEmptyComponent={
          !initialLoading && (
            <Text style={{ textAlign: 'center', padding: 20, color: isDarkMode ? '#ccc' : '#666' }}>
              {filterMyPosts
                ? t('feed.no_my_posts')
                : t('feed.no_posts')}
            </Text>
          )
        }

      />

      {/* <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)
        }
      >
        <Icon name="plus" size={24} color="white" />
      </TouchableOpacity> */}
      <TouchableOpacity
        // bannerBottomPos + 80 keeps the FAB's bottom edge ~20px ABOVE the
        // ad's top edge, and zIndex 6 (> the ad's 5) guarantees the ad never
        // renders on top of the button (AdMob "accidental clicks: layout").
        style={[styles.fab, { bottom: !localState.isPro ? bannerBottomPos + 80 : 75, zIndex: 6 }]}
        onPress={() => user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)}
      >
        <FontAwesome name="circle-plus" size={44} color={config.colors.primary} />
      </TouchableOpacity>

      <UploadModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onUpload={handleUploadPost}
        user={user}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={() => setSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        screen="Design"
        message={t('feed.signin_to_post')}
      />
      {!localState.isPro && (
        <View style={{ position: 'absolute', bottom: bannerBottomPos, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
          <BannerAdComponent collapsible />
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: '#fff',
  },
  darkContainer: {
    backgroundColor: config.colors.backgroundDark,
  },
  fab: {
    position: 'absolute',
    bottom: 65,
    right: 10,
    // backgroundColor: config.colors.primary,
    width: 60,
    height: 60,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor:'white'
    // elevation: 4,
  },
  skeletonPost: {
    height: 250,
    margin: 10,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
  },
  latoText: {
    fontFamily: 'Lato-Regular',
  },
  latoBold: {
    fontFamily: 'Lato-Bold',
  },


});

export default DesignFeedScreen;
