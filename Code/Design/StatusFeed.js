/**
 * StatusFeed.js
 * Instagram/WhatsApp Stories-style horizontal status bubbles for MM2 Values.
 *
 * Features:
 * - Horizontal scrollable avatar bubbles with gradient ring for unviewed
 * - Create status: text + image (uploaded to Bunny CDN)
 * - View status: fullscreen modal
 * - Delete own statuses
 * - 24h auto-expiry via Firestore expiresAt
 *
 * ── Cost Optimizations ──
 * - MMKV cache for statuses (5-min TTL) and following list (30-min TTL)
 * - Paginated following statuses (chunks of 30 IDs, load more on scroll)
 * - Random seed for global statuses (10 max, fair rotation)
 * - Local-first post/delete (no Firestore re-fetch)
 * - Skip duplicate markViewed writes
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, Animated,
  StyleSheet, Dimensions, Modal, TextInput, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  collection, query, where, orderBy, limit, getDocs,
  addDoc, serverTimestamp, Timestamp, doc, updateDoc, arrayUnion, deleteDoc,
} from '@react-native-firebase/firestore';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { addXP, XP_ACTIONS } from '../Engagement/xpUtils';
import InterstitialAdManager from '../Ads/IntAd';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { createMMKV } from 'react-native-mmkv';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUBBLE_SIZE = 64;
const STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STORY_DURATION = 5000;

// ── Cache config ──
const STATUS_CACHE_TTL = 30 * 60 * 1000;       // 30 min — refetch only after this
const FOLLOWING_CACHE_TTL = 30 * 60 * 1000;    // 30 min
const FOLLOWING_CHUNK_SIZE = 30;               // Firestore 'in' limit
// Feed = everyone you follow, then the newest statuses from everyone else.
const GLOBAL_STATUS_LIMIT = 15;                // Latest N from the wider app
const GLOBAL_FETCH_LIMIT = 15;                 // One query, exactly what we show
// Hard bound on the following query, which previously had none.
const FOLLOWING_FETCH_LIMIT = 40;

// ── Lazy MMKV init (avoids crash if native module isn't ready at import time) ──
let _statusCache = null;
const getStorage = () => {
  if (!_statusCache) {
    try { _statusCache = createMMKV({ id: 'mm2-status-feed-cache' }); }
    catch (e) { console.warn('[StatusFeed] MMKV init failed:', e?.message); return null; }
  }
  return _statusCache;
};

// ── Cache helpers ──
const getCachedJSON = (key) => {
  try {
    const s = getStorage();
    if (!s) return null;
    const raw = s.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const setCachedJSON = (key, val) => {
  try { const s = getStorage(); if (s) s.set(key, JSON.stringify(val)); } catch {}
};
const isCacheValid = (key, ttl) => {
  const s = getStorage();
  if (!s) return false;
  const ts = s.getNumber(`${key}_ts`);
  return ts && (Date.now() - ts) < ttl;
};
const setCacheTimestamp = (key) => {
  const s = getStorage();
  if (s) s.set(`${key}_ts`, Date.now());
};

// Ring colors
const RING_SEEN = '#94A3B8';

// Bunny CDN config (same creds as rest of app)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

// Base64 decoder (no atob in RN)
const base64ToBytes = (base64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output.push(chr1);
    if (enc3 !== 64) output.push(chr2);
    if (enc4 !== 64) output.push(chr3);
  }
  return Uint8Array.from(output);
};

// ── Helper: group raw status docs by userId ──
const groupStatuses = (rawStatuses, myId) => {
  const grouped = {};
  rawStatuses.forEach(s => {
    if (!grouped[s.userId]) {
      grouped[s.userId] = {
        userId: s.userId,
        userName: s.userName || 'Anonymous',
        userAvatar: s.userAvatar || null,
        statuses: [],
        hasUnviewed: false,
      };
    }
    grouped[s.userId].statuses.push(s);
    if (!s.viewedBy?.includes(myId)) {
      grouped[s.userId].hasUnviewed = true;
    }
  });
  return grouped;
};

// ── Serialize Firestore Timestamps for MMKV cache ──
const serializeStatus = (s) => ({
  ...s,
  createdAt: s.createdAt?.toDate ? { _seconds: Math.floor(s.createdAt.toDate().getTime() / 1000) } : s.createdAt,
  expiresAt: s.expiresAt?.toDate ? { _seconds: Math.floor(s.expiresAt.toDate().getTime() / 1000) } : s.expiresAt,
});

const deserializeTimestamp = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return { toDate: () => new Date(ts._seconds * 1000) };
  return ts;
};

const deserializeStatus = (s) => ({
  ...s,
  createdAt: deserializeTimestamp(s.createdAt),
  expiresAt: deserializeTimestamp(s.expiresAt),
});

// ── Shimmer placeholder ──
const ShimmerPlaceholder = ({ style }) => {
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[
        { backgroundColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center' },
        style,
        { opacity: shimmerAnim },
      ]}
    >
      <ActivityIndicator size="small" color="#94A3B8" />
    </Animated.View>
  );
};

// ── Image with loading shimmer ──
const LoadingImage = ({ source, style, resizeMode = 'cover', borderRadius }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[style, { overflow: 'hidden', borderRadius: borderRadius || style?.borderRadius || 0 }]}>
      {!loaded && (
        <ShimmerPlaceholder
          style={[StyleSheet.absoluteFill, { borderRadius: borderRadius || style?.borderRadius || 0 }]}
        />
      )}
      <Image
        source={source}
        style={[style, { position: loaded ? 'relative' : 'absolute', opacity: loaded ? 1 : 0 }]}
        resizeMode={resizeMode}
        onLoad={() => setLoaded(true)}
      />
    </View>
  );
};

const getTimeAgo = (date) => {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};


const StatusFeed = ({ user, firestoreDB, appdatabase, isDarkMode, onRequireSignIn }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState(() => {
    const cached = getCachedJSON('statuses_grouped');
    if (!cached) return [];
    // Drop anything that expired while the app was closed. The cache is also
    // what we fall back to when a fetch fails, so it must never resurrect a
    // story that is past its 24h window.
    const now = Date.now();
    return cached
      .map(g => ({
        ...g,
        statuses: g.statuses
          .map(deserializeStatus)
          .filter(s => !s.expiresAt?.toMillis || s.expiresAt.toMillis() > now),
      }))
      .filter(g => g.statuses.length > 0);
  });
  const [followingIds, setFollowingIds] = useState(() => getCachedJSON('following_ids') || []);
  const [viewingStatus, setViewingStatus] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  // Stories viewer state
  const [storyIndex, setStoryIndex] = useState(0);
  const storyTimerRef = useRef(null);
  const pressTimestampRef = useRef(0);
  const storyProgressAnim = useRef(new Animated.Value(0)).current;
  // Profile drawer for chat-from-status
  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const followingChunkRef = useRef(0);
  const allFollowingLoadedRef = useRef(false);
  const viewedLocallyRef = useRef(new Set());
  // Only one fetch set in flight at a time
  const inFlightRef = useRef(false);
  // Mirrors "the feed currently has content", so fetchStatuses can check it
  // without taking statuses.length as a dependency (which made it self-trigger)
  const hasStatusesRef = useRef(statuses.length > 0);
  // Session-scoped global results — the non-following half of the feed is the
  // same for everyone, so it is fetched once rather than per auth transition
  const globalCacheRef = useRef(null);
  // Which user id the cached feed was built for. `undefined` = nothing cached
  // this session, so the first run always fetches.
  const cachedForUserRef = useRef(undefined);

  // ── Fetch who I follow (MMKV cache, 30-min TTL) ──
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    if (isCacheValid('following_ids', FOLLOWING_CACHE_TTL) && followingIds.length > 0) return;

    (async () => {
      try {
        const q = query(
          collection(firestoreDB, 'following'),
          where('followerId', '==', user.id),
          limit(200),
        );
        const snap = await getDocs(q);
        const ids = snap.docs.map(d => d.data().followingId).filter(Boolean);
        setFollowingIds(ids);
        setCachedJSON('following_ids', ids);
        setCacheTimestamp('following_ids');
      } catch (err) {
        console.warn('[StatusFeed] Error fetching following:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // ── Upload to Bunny CDN ──
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const localPath = imagePath.startsWith('file://') ? imagePath.replace('file://', '') : imagePath;
      const base64 = await RNFS.readFile(localPath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const remotePath = `statuses/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
        method: 'PUT',
        headers: { AccessKey: BUNNY_ACCESS_KEY, 'Content-Type': 'image/jpeg' },
        body: bytes,
      });

      if (!response.ok) throw new Error('Upload failed');
      return `${BUNNY_CDN_BASE}/${remotePath}`;
    } catch (err) {
      console.warn('[StatusFeed] Upload error:', err?.message);
      return null;
    }
  }, []);

  // ── Fetch the latest statuses app-wide ──
  // ONE query. Statuses all share a fixed 24h TTL, so ordering by expiresAt
  // DESC is the same as newest-first — and it satisfies Firestore's rule that
  // the first orderBy match the inequality field, so no composite index is
  // needed (the automatic single-field index covers it).
  const fetchGlobalLatest = useCallback(async () => {
    if (!firestoreDB) return [];
    try {
      const now = Timestamp.now();
      const q = query(
        collection(firestoreDB, 'statuses'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(GLOBAL_FETCH_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      // null (not []) so the caller can tell "request failed" apart from
      // "nobody has posted". Returning [] here used to blank the whole feed.
      console.warn('[StatusFeed] Global fetch error:', err?.message);
      return null;
    }
  }, [firestoreDB]);

  // ── Fetch following statuses (paginated) ──
  const fetchFollowingChunk = useCallback(async (chunkIndex) => {
    if (!firestoreDB || !user?.id || followingIds.length === 0) return [];

    const idsToQuery = [user.id];
    const start = chunkIndex * FOLLOWING_CHUNK_SIZE;
    const chunk = followingIds.slice(start, start + FOLLOWING_CHUNK_SIZE);

    if (chunkIndex > 0 && chunk.length === 0) {
      allFollowingLoadedRef.current = true;
      return [];
    }

    const combined = [...new Set([...idsToQuery, ...chunk])].slice(0, 30);

    try {
      const now = Timestamp.now();
      // ⚠️ This query had NO limit: it read every live status from up to 30
      // users on every fetch. Bounded + newest-first now.
      // Needs a composite index on statuses(userId ASC, expiresAt DESC).
      const q = query(
        collection(firestoreDB, 'statuses'),
        where('userId', 'in', combined),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(FOLLOWING_FETCH_LIMIT),
      );
      const snap = await getDocs(q);

      if (chunk.length < FOLLOWING_CHUNK_SIZE) {
        allFollowingLoadedRef.current = true;
      }
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      // null = failed. [] above is a legitimate "nothing to show".
      // If this reports a missing index, Firestore puts a one-click creation
      // URL in the message — the query needs statuses(userId, expiresAt DESC).
      if (/index/i.test(err?.message || '')) {
        console.warn('[StatusFeed] MISSING INDEX for following query — create it via the link below:\n', err?.message);
      } else {
        console.warn('[StatusFeed] Following fetch error:', err?.message);
      }
      return null;
    }
  }, [firestoreDB, user?.id, followingIds]);

  // ── Main fetch ──
  // Standard stories fetch: at most one round-trip set in flight, results
  // cached for STATUS_CACHE_TTL, and the global (non-following) half reused
  // for the rest of the session so the sign-in transition doesn't re-run it.
  const fetchStatuses = useCallback(async (force = false) => {
    if (!firestoreDB) return;
    if (inFlightRef.current) return;               // single-flight
    // Serve from cache for a full hour. The identity check matters because the
    // first pass of a cold start runs before auth resolves: without it, that
    // guest result would satisfy the cache and the user's following statuses
    // wouldn't appear until the hour was up.
    const identity = user?.id || null;
    const identityChanged = cachedForUserRef.current !== identity;
    if (!force && !identityChanged
        && isCacheValid('statuses_grouped', STATUS_CACHE_TTL)
        && hasStatusesRef.current) {
      return;
    }

    inFlightRef.current = true;
    try {
      followingChunkRef.current = 0;
      allFollowingLoadedRef.current = false;

      const followingResults = await fetchFollowingChunk(0);
      followingChunkRef.current = 1;

      // The "latest 15" half is identical for everyone, so when this re-runs
      // purely because auth resolved, reuse it instead of re-querying.
      let globalResults;
      if (!force && identityChanged && globalCacheRef.current) {
        globalResults = globalCacheRef.current;
      } else {
        globalResults = await fetchGlobalLatest();
        if (globalResults !== null) globalCacheRef.current = globalResults;
      }

      // Once signed in, the feed must KEEP showing what it has. A dropped
      // request used to fall through as an empty success, blanking the list
      // AND overwriting the MMKV cache with [] — so the feed stayed empty
      // across restarts until a fetch happened to succeed.
      if (followingResults === null && globalResults === null) {
        return; // total failure — leave the current feed alone
      }

      const followingSet = new Set([user?.id, ...followingIds]);
      const globalOnly = (globalResults || [])
        .filter(s => !followingSet.has(s.userId))
        .slice(0, GLOBAL_STATUS_LIMIT);

      const allRaw = [...(followingResults || []), ...globalOnly];
      const grouped = groupStatuses(allRaw, user?.id);

      // Order: me → people I follow → everyone else, each block newest-first.
      const newestOf = (g) => g.statuses.reduce((m, s) => {
        const t = s.createdAt?.toMillis?.() ?? s.expiresAt?.toMillis?.() ?? 0;
        return t > m ? t : m;
      }, 0);
      const rank = (g) => (g.userId === user?.id ? 0 : followingIds.includes(g.userId) ? 1 : 2);

      const arr = Object.values(grouped);
      arr.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return newestOf(b) - newestOf(a);
      });

      // Don't replace a populated feed with an empty one. This happens on a
      // cold start too: StatusFeed mounts before auth resolves, so the first
      // pass runs with no user id and — if the rules require auth — comes back
      // empty. Without this, cached stories flash away and only return after
      // the second fetch (or never, if that one also fails).
      if (arr.length === 0 && hasStatusesRef.current && !force) {
        return;
      }

      hasStatusesRef.current = arr.length > 0;
      cachedForUserRef.current = identity;
      setStatuses(arr);
      setCachedJSON('statuses_grouped', arr.map(g => ({ ...g, statuses: g.statuses.map(serializeStatus) })));
      setCacheTimestamp('statuses_grouped');
    } catch (err) {
      console.warn('[StatusFeed] fetch error:', err?.message);
    } finally {
      inFlightRef.current = false;
    }
    // NOTE: `statuses.length` deliberately not a dep — this callback calls
    // setStatuses, so depending on it made the effect below re-run itself.
  }, [firestoreDB, user?.id, followingIds, fetchFollowingChunk, fetchGlobalLatest]);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // ── Load more ──
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || allFollowingLoadedRef.current || !firestoreDB) return;
    setLoadingMore(true);
    try {
      const moreResults = await fetchFollowingChunk(followingChunkRef.current);
      if (moreResults === null) {
        // Failed — don't advance the cursor, or this page is skipped forever.
        setLoadingMore(false);
        return;
      }
      followingChunkRef.current += 1;

      if (moreResults.length > 0) {
        const moreGrouped = groupStatuses(moreResults, user?.id);
        setStatuses(prev => {
          const existingMap = {};
          prev.forEach(g => { existingMap[g.userId] = g; });
          Object.values(moreGrouped).forEach(g => {
            if (existingMap[g.userId]) {
              const existingIds = new Set(existingMap[g.userId].statuses.map(s => s.id));
              existingMap[g.userId] = {
                ...existingMap[g.userId],
                statuses: [...existingMap[g.userId].statuses, ...g.statuses.filter(s => !existingIds.has(s.id))],
                hasUnviewed: existingMap[g.userId].hasUnviewed || g.hasUnviewed,
              };
            } else {
              existingMap[g.userId] = g;
            }
          });
          const merged = Object.values(existingMap);
          hasStatusesRef.current = merged.length > 0;
          merged.sort((a, b) => {
            if (a.userId === user?.id) return -1;
            if (b.userId === user?.id) return 1;
            return followingIds.includes(a.userId) ? -1 : 1;
          });
          setCachedJSON('statuses_grouped', merged.map(g => ({ ...g, statuses: g.statuses.map(serializeStatus) })));
          setCacheTimestamp('statuses_grouped');
          return merged;
        });
      }
    } catch (err) {
      console.warn('[StatusFeed] Load more error:', err?.message);
    }
    setLoadingMore(false);
  }, [loadingMore, firestoreDB, fetchFollowingChunk, user?.id, followingIds]);

  // ── Pick image ──
  const handlePickImage = useCallback(async () => {
    if (!user?.id) { onRequireSignIn?.(); return; }
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo', quality: 0.8, selectionLimit: 1,
        maxWidth: 1920, maxHeight: 1920,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Could not pick image');
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      let finalUri = asset.uri;
      try {
        const compressPromise = CompressorImage.compress(asset.uri, {
          maxWidth: 1200, quality: 0.7, returnableOutputType: 'uri',
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Compression timeout')), 5000)
        );
        finalUri = await Promise.race([compressPromise, timeoutPromise]);
      } catch {}

      setSelectedImage({ ...asset, uri: finalUri });
      setShowCreator(true);
    } catch (err) {
      Alert.alert('Error', 'Could not open image picker');
    }
  }, [user?.id, onRequireSignIn]);

  // ── Post status (local-first) ──
  const { localState } = useLocalState();

  const handlePostStatus = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    if (!caption.trim() && !selectedImage) {
      Alert.alert('Empty Status', 'Write something or add a photo!');
      return;
    }

    // Core upload logic — called after ad (or directly if Pro)
    const performUpload = async () => {
      setUploading(true);
      try {
        let imageUrl = null;
        if (selectedImage?.uri) {
          imageUrl = await uploadToBunny(selectedImage.uri);
          if (!imageUrl) {
            Alert.alert('Upload Failed', 'Image could not be uploaded. Try again.');
            setUploading(false);
            return;
          }
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + STATUS_EXPIRY_MS);

        const docData = {
          userId: user.id,
          userName: user.displayName || 'Anonymous',
          caption: caption.trim() || '',
          imageUrl: imageUrl || null,
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromDate(expiresAt),
          viewedBy: [],
          type: imageUrl ? 'image' : 'text',
          // This build no longer reads randomSeed (the feed is following-first
          // + latest). Keep WRITING it: older app versions still in the wild
          // query `where randomSeed >= x`, and a doc without the field is
          // invisible to them.
          randomSeed: Math.random(),
          ...(user.avatar ? { userAvatar: user.avatar } : {}),
        };

        const docRef = await addDoc(collection(firestoreDB, 'statuses'), docData);
        addXP(appdatabase, user.id, XP_ACTIONS.POST_STATUS);

        // Local-first update
        const newStatus = {
          ...docData,
          id: docRef.id,
          createdAt: { toDate: () => now },
          expiresAt: { toDate: () => expiresAt },
        };
        setStatuses(prev => {
          const updated = [...prev];
          const myIdx = updated.findIndex(g => g.userId === user.id);
          if (myIdx >= 0) {
            updated[myIdx] = { ...updated[myIdx], statuses: [...updated[myIdx].statuses, newStatus] };
          } else {
            updated.unshift({
              userId: user.id,
              userName: user.displayName || 'Anonymous',
              userAvatar: user.avatar || null,
              statuses: [newStatus],
              hasUnviewed: false,
            });
          }
          setCachedJSON('statuses_grouped', updated.map(g => ({ ...g, statuses: g.statuses.map(serializeStatus) })));
          setCacheTimestamp('statuses_grouped');
          return updated;
        });

        setCaption('');
        setSelectedImage(null);
        setShowCreator(false);
      } catch (err) {
        Alert.alert('Error', 'Could not post status');
      }
      setUploading(false);
    };

    // Show ad before upload for non-Pro users (like UploadModal)
    if (!localState.isPro) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            InterstitialAdManager.showAd(performUpload);
          } catch (err) {
            console.warn('[AdManager] Failed to show ad:', err);
            performUpload();
          }
        }, 400);
      });
    } else {
      performUpload();
    }
  }, [user, firestoreDB, appdatabase, caption, selectedImage, uploadToBunny, localState.isPro]);

  // ── Delete status (local-first) ──
  const handleDeleteStatus = useCallback((statusId) => {
    if (!firestoreDB || !statusId) return;
    Alert.alert('Delete Status', 'Are you sure you want to delete this status?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(firestoreDB, 'statuses', statusId));
            setViewingStatus(null);
            setStatuses(prev => {
              const updated = prev.map(g => ({
                ...g,
                statuses: g.statuses.filter(s => s.id !== statusId),
              })).filter(g => g.statuses.length > 0 || g.userId === user?.id);
              setCachedJSON('statuses_grouped', updated.map(g => ({ ...g, statuses: g.statuses.map(serializeStatus) })));
              setCacheTimestamp('statuses_grouped');
              return updated;
            });
          } catch {
            Alert.alert('Error', 'Could not delete status');
          }
        },
      },
    ]);
  }, [firestoreDB, user?.id]);

  // ── Mark viewed ──
  const markViewed = useCallback(async (statusId) => {
    if (!user?.id || !firestoreDB) return;
    if (viewedLocallyRef.current.has(statusId)) return;
    viewedLocallyRef.current.add(statusId);
    try {
      await updateDoc(doc(firestoreDB, 'statuses', statusId), {
        viewedBy: arrayUnion(user.id),
      });
    } catch {}
  }, [user?.id, firestoreDB]);

  const handleViewStatus = useCallback((group) => {
    setStoryIndex(0);
    setViewingStatus(group);
    if (group.statuses?.length > 0 && user?.id) {
      group.statuses.forEach(s => {
        if (!s.viewedBy?.includes(user.id)) markViewed(s.id);
      });
      setStatuses(prev => {
        const updated = prev.map(g => {
          if (g.userId !== group.userId) return g;
          return {
            ...g,
            hasUnviewed: false,
            statuses: g.statuses.map(s => ({
              ...s,
              viewedBy: s.viewedBy?.includes(user.id) ? s.viewedBy : [...(s.viewedBy || []), user.id],
            })),
          };
        });
        setCachedJSON('statuses_grouped', updated.map(g => ({ ...g, statuses: g.statuses.map(serializeStatus) })));
        return updated;
      });
    }
  }, [markViewed, user?.id]);

  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

  const handleReaction = useCallback(async (statusId, emoji) => {
    if (!user?.id || !firestoreDB) return;
    try {
      await updateDoc(doc(firestoreDB, 'statuses', statusId), {
        [`reactions.${user.id}`]: emoji,
      });
      setViewingStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map(s => {
            if (s.id !== statusId) return s;
            return { ...s, reactions: { ...(s.reactions || {}), [user.id]: emoji } };
          }),
        };
      });
    } catch {}
  }, [user?.id, firestoreDB]);

  // ── Follow toggle ──
  const handleFollowToggle = useCallback(async (targetUserId) => {
    if (!user?.id || !firestoreDB || !targetUserId || user.id === targetUserId) return;
    setFollowLoading(true);
    const isFollowing = followingIds.includes(targetUserId);
    try {
      if (isFollowing) {
        const snap = await getDocs(
          query(collection(firestoreDB, 'following'), where('followerId', '==', user.id), where('followingId', '==', targetUserId))
        );
        await Promise.all(snap.docs.map(d => deleteDoc(doc(firestoreDB, 'following', d.id))));
        const updated = followingIds.filter(id => id !== targetUserId);
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      } else {
        await addDoc(collection(firestoreDB, 'following'), {
          followerId: user.id,
          followingId: targetUserId,
          createdAt: serverTimestamp(),
        });
        const updated = [...followingIds, targetUserId];
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      }
    } catch {}
    setFollowLoading(false);
  }, [user?.id, firestoreDB, followingIds]);

  // ── Story auto-play controls ──
  const startStoryTimer = useCallback((index, total) => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.setValue(0);
    Animated.timing(storyProgressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start();
    storyTimerRef.current = setTimeout(() => {
      if (index < total - 1) {
        setStoryIndex(index + 1);
      } else {
        setViewingStatus(null);
      }
    }, STORY_DURATION);
  }, [storyProgressAnim]);

  const stopStoryTimer = useCallback(() => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.stopAnimation();
  }, [storyProgressAnim]);

  useEffect(() => {
    if (viewingStatus?.statuses?.length > 0) {
      startStoryTimer(storyIndex, viewingStatus.statuses.length);
    }
    return () => { if (storyTimerRef.current) clearTimeout(storyTimerRef.current); };
  }, [storyIndex, viewingStatus?.userId]);

  // ── Chat from status: open profile drawer, then navigate on startChat ──
  const handleChatFromStatus = useCallback(() => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 300);
      return;
    }
    if (!viewingStatus?.userId) return;
    stopStoryTimer();
    const profileUser = {
      senderId: viewingStatus.userId,
      sender: viewingStatus.userName || 'User',
      avatar: viewingStatus.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    };
    setDrawerUser(profileUser);
    setViewingStatus(null);
    setTimeout(() => setIsDrawerVisible(true), 300);
  }, [user?.id, viewingStatus, onRequireSignIn, stopStoryTimer]);

  const handleStartChatFromDrawer = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      try {
        const rootNav = navigation.getParent() || navigation;
        rootNav.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: drawerUser.senderId,
            sender: drawerUser.sender,
            avatar: drawerUser.avatar,
          },
        });
      } catch (e) {
        console.warn('[StatusFeed] Chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  // Colors (MM2 sober palette)
  const textColor = isDarkMode ? '#e2e8f0' : config.colors.surfaceDark;
  const subtextColor = isDarkMode ? '#94a3b8' : '#64748b';

  // ── Render bubble ──
  const renderBubble = useCallback(({ item }) => {
    const isMe = item.userId === user?.id;
    const hasUnviewed = item.hasUnviewed;
    const hasStatuses = item.statuses.length > 0;
    const ringStyle = hasUnviewed
      ? styles.bubbleRingUnseen
      : hasStatuses
        ? [styles.bubbleRingSeen, { borderColor: isDarkMode ? '#475569' : RING_SEEN }]
        : { borderColor: isDarkMode ? '#334155' : '#e2e8f0' };

    return (
      <TouchableOpacity
        style={styles.bubbleWrap}
        onPress={() => isMe && item.statuses.length === 0 ? handlePickImage() : handleViewStatus(item)}
        activeOpacity={0.7}
      >
        {hasUnviewed ? (
          <View style={styles.gradientRingOuter}>
            <View style={styles.gradientRingMiddle}>
              <View style={[styles.gradientRingInner, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#fff' }]}>
                <LoadingImage
                  source={{ uri: item.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                  style={styles.bubbleAvatar}
                  borderRadius={(BUBBLE_SIZE - 4) / 2}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.bubbleRing, ringStyle]}>
            <LoadingImage
              source={{ uri: item.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
              style={styles.bubbleAvatar}
              borderRadius={(BUBBLE_SIZE - 4) / 2}
            />
          </View>
        )}
        {isMe && (
          <View style={styles.addBadge}>
            <FontAwesome name="plus" size={8} color="#FFF" solid />
          </View>
        )}
        <Text style={[styles.bubbleName, { color: subtextColor }]} numberOfLines={1}>
          {isMe ? 'You' : (item.userName || '').split(' ')[0]}
        </Text>
      </TouchableOpacity>
    );
  }, [user?.id, isDarkMode, handlePickImage, handleViewStatus, subtextColor]);

  // Build data
  const feedData = useMemo(() => {
    const hasMyStatus = statuses.some(s => s.userId === user?.id);
    if (!hasMyStatus && user?.id) {
      return [
        { userId: user.id, userName: 'You', userAvatar: user.avatar, statuses: [], hasUnviewed: false },
        ...statuses,
      ];
    }
    return statuses;
  }, [statuses, user]);

  if (feedData.length === 0) {
    return (
      <View style={[styles.container, { borderBottomColor: isDarkMode ? config.colors.surfaceDark : 'rgba(0,0,0,0.05)' }]}>
        <View style={styles.listContent}>
          <View style={{ height: BUBBLE_SIZE + 24 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderBottomColor: isDarkMode ? config.colors.surfaceDark : 'rgba(0,0,0,0.05)' }]}>
      <FlatList
        data={feedData}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.userId}
        renderItem={renderBubble}
        contentContainerStyle={styles.listContent}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? (
          <View style={{ width: 50, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={isDarkMode ? '#94A3B8' : '#64748B'} />
          </View>
        ) : null}
      />

      {/* ── Stories-Style Fullscreen Viewer Modal ── */}
      {viewingStatus && (() => {
        const currentStatus = viewingStatus.statuses[storyIndex] || viewingStatus.statuses[0];
        if (!currentStatus) return null;
        const isMyStatus = currentStatus.userId === user?.id;
        const totalStatuses = viewingStatus.statuses.length;
        const reactionEntries = Object.entries(currentStatus.reactions || {});
        const myReaction = currentStatus.reactions?.[user?.id];
        const reactionCounts = {};
        reactionEntries.forEach(([, emoji]) => {
          reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        });

        return (
          <Modal visible={true} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { stopStoryTimer(); setViewingStatus(null); }}>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              {/* Progress bars */}
              <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 10, paddingTop: Math.max(insets.top, 30) + 8, zIndex: 20 }}>
                {viewingStatus.statuses.map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' }}>
                    {i < storyIndex ? (
                      <View style={{ width: '100%', height: '100%', backgroundColor: '#fff' }} />
                    ) : i === storyIndex ? (
                      <Animated.View style={{
                        height: '100%', backgroundColor: '#fff', borderRadius: 2,
                        width: storyProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                      }} />
                    ) : null}
                  </View>
                ))}
              </View>

              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, zIndex: 20 }}>
                <Image
                  source={{ uri: viewingStatus.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                  style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' }}
                />
                <Text style={{ flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 10 }} numberOfLines={1}>
                  {viewingStatus.userName}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginRight: 10 }}>
                  {currentStatus.createdAt?.toDate ? getTimeAgo(currentStatus.createdAt.toDate()) : ''}
                </Text>
                {user?.id && viewingStatus.userId !== user.id && (
                  <TouchableOpacity
                    onPress={() => handleFollowToggle(viewingStatus.userId)}
                    disabled={followLoading}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, marginRight: 8,
                      ...(followingIds.includes(viewingStatus.userId)
                        ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }
                        : { backgroundColor: '#6A5ACD' }),
                      ...(followLoading ? { opacity: 0.5 } : {}),
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                      {followingIds.includes(viewingStatus.userId) ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => { stopStoryTimer(); setViewingStatus(null); }} style={{ padding: 6 }}>
                  <Text style={{ fontSize: 20, color: '#fff', fontWeight: '300' }}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Content area — tap left/right to navigate, hold to pause */}
              <TouchableOpacity
                activeOpacity={1}
                onPressIn={() => { stopStoryTimer(); pressTimestampRef.current = Date.now(); }}
                onPressOut={() => {
                  if (Date.now() - (pressTimestampRef.current || 0) > 300) {
                    startStoryTimer(storyIndex, totalStatuses);
                  }
                }}
                onPress={(e) => {
                  const x = e.nativeEvent.locationX;
                  if (x < SCREEN_WIDTH * 0.3) {
                    if (storyIndex > 0) setStoryIndex(storyIndex - 1);
                    else startStoryTimer(storyIndex, totalStatuses);
                  } else if (x > SCREEN_WIDTH * 0.7) {
                    if (storyIndex < totalStatuses - 1) setStoryIndex(storyIndex + 1);
                    else { stopStoryTimer(); setViewingStatus(null); }
                  } else {
                    startStoryTimer(storyIndex, totalStatuses);
                  }
                }}
                style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
              >
                {currentStatus.imageUrl ? (
                  <LoadingImage
                    source={{ uri: currentStatus.imageUrl }}
                    style={{ width: SCREEN_WIDTH - 32, height: SCREEN_HEIGHT * 0.5, borderRadius: 16 }}
                    resizeMode="cover"
                    borderRadius={16}
                  />
                ) : null}

                {!currentStatus.imageUrl && currentStatus.caption ? (
                  <Text style={{ fontSize: 20, fontWeight: '600', color: '#fff', textAlign: 'center', lineHeight: 30, paddingHorizontal: 20 }}>
                    {currentStatus.caption}
                  </Text>
                ) : null}

                {currentStatus.imageUrl && currentStatus.caption ? (
                  <Text style={{ fontSize: 15, color: '#fff', marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                    {currentStatus.caption}
                  </Text>
                ) : null}
              </TouchableOpacity>

              {/* Bottom bar: view count, reactions, chat, delete */}
              <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 20) + 20, zIndex: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {currentStatus.viewedBy?.length > 0 && (
                      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                        👁 {currentStatus.viewedBy.length}
                      </Text>
                    )}
                    {reactionEntries.length > 0 && (
                      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                        {Object.keys(reactionCounts).map(e => `${e}${reactionCounts[e] > 1 ? reactionCounts[e] : ''}`).join(' ')}
                      </Text>
                    )}
                  </View>
                  {totalStatuses > 1 && (
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                      {storyIndex + 1}/{totalStatuses}
                    </Text>
                  )}
                </View>

                {!isMyStatus && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
                      {REACTION_EMOJIS.map(emoji => (
                        <TouchableOpacity
                          key={emoji}
                          onPress={() => {
                            stopStoryTimer();
                            handleReaction(currentStatus.id, emoji);
                            setTimeout(() => startStoryTimer(storyIndex, totalStatuses), 400);
                          }}
                          style={{
                            paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20,
                            backgroundColor: myReaction === emoji ? '#6A5ACD40' : 'rgba(255,255,255,0.1)',
                            borderWidth: myReaction === emoji ? 1.5 : 0,
                            borderColor: '#6A5ACD',
                          }}
                        >
                          <Text style={{ fontSize: 16 }}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity
                      onPress={handleChatFromStatus}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        backgroundColor: '#6A5ACD', paddingHorizontal: 16, paddingVertical: 10,
                        borderRadius: 24,
                      }}
                    >
                      <FontAwesome name="paper-plane" size={12} color="#fff" solid />
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Chat</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {isMyStatus && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); setViewingStatus(null); handlePickImage(); }}
                      style={[styles.deleteBtn, { backgroundColor: 'rgba(106,90,205,0.25)' }]}
                    >
                      <FontAwesome name="plus" size={12} color="#6A5ACD" solid />
                      <Text style={[styles.deleteText, { color: '#6A5ACD' }]}>New</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); handleDeleteStatus(currentStatus.id); }}
                      style={styles.deleteBtn}
                    >
                      <FontAwesome name="trash" size={12} color="#EF4444" />
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* ── Profile Drawer for chat-from-status ── */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChatFromDrawer}
        selectedUser={drawerUser}
        isOnline={false}
        bannedUsers={[]}
      />

      {/* ── Status Creator Modal ── */}
      <Modal visible={showCreator} transparent animationType="slide" onRequestClose={() => setShowCreator(false)}>
        <View style={styles.creatorOverlay}>
          <View style={[styles.creatorCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FFF' }]}>
            <View style={styles.creatorHeader}>
              <Text style={[styles.creatorTitle, { color: textColor }]}>New Status</Text>
              <TouchableOpacity onPress={() => { setShowCreator(false); setCaption(''); setSelectedImage(null); }}>
                <Text style={{ fontSize: 18, color: subtextColor }}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedImage?.uri && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} resizeMode="cover" />
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => setSelectedImage(null)}>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {!selectedImage && (
              <TouchableOpacity
                style={[styles.addImageBtn, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f1f5f9' }]}
                onPress={handlePickImage}
              >
                <FontAwesome name="image" size={20} color={subtextColor} />
                <Text style={{ color: subtextColor, fontSize: 13, marginTop: 4 }}>Add Photo</Text>
              </TouchableOpacity>
            )}

            <TextInput
              style={[styles.creatorInput, {
                color: textColor,
                backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc',
                borderColor: isDarkMode ? '#334155' : '#e2e8f0',
              }]}
              placeholder="What's on your mind?"
              placeholderTextColor={subtextColor}
              multiline
              maxLength={200}
              value={caption}
              onChangeText={setCaption}
            />

            <TouchableOpacity
              style={[styles.creatorPostBtn, uploading && { opacity: 0.5 }]}
              onPress={handlePostStatus}
              disabled={uploading}
            >
              {uploading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.creatorPostText}>Uploading...</Text>
                </View>
              ) : (
                <Text style={styles.creatorPostText}>Post Status</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 4,
  },
  bubbleWrap: { alignItems: 'center', width: 72 },
  bubbleRing: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    borderWidth: 2.5, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center',
  },
  bubbleRingUnseen: { borderColor: '#6A5ACD', borderWidth: 2.5 }, // MM2 slate blue
  bubbleRingSeen: { borderColor: '#94A3B8', borderWidth: 2 },
  gradientRingOuter: {
    width: BUBBLE_SIZE + 6, height: BUBBLE_SIZE + 6,
    borderRadius: (BUBBLE_SIZE + 6) / 2,
    backgroundColor: '#8B5CF6', // Purple
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingMiddle: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    backgroundColor: '#6A5ACD', // MM2 primary
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingInner: {
    width: BUBBLE_SIZE, height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  bubbleAvatar: {
    width: BUBBLE_SIZE - 4, height: BUBBLE_SIZE - 4,
    borderRadius: (BUBBLE_SIZE - 4) / 2,
  },
  addBadge: {
    position: 'absolute', bottom: 18, right: 8,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#6A5ACD',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },
  bubbleName: { fontSize: 10, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  // Viewer
  viewerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  viewerCard: { width: '100%', borderRadius: 16, padding: 16, maxHeight: '85%' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  viewerAvatar: { width: 36, height: 36, borderRadius: 18 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: '700' },
  followBtn: {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, marginRight: 6,
  },
  followBtnFollow: { backgroundColor: '#6A5ACD' }, // MM2 primary
  followBtnFollowing: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  followBtnText: { fontSize: 12, fontWeight: '700' },
  viewerContent: { marginBottom: 16, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.1)', paddingBottom: 12 },
  viewerCaption: { fontSize: 16, fontWeight: '500', lineHeight: 24, marginBottom: 6 },
  viewerImage: { width: '100%', height: 280, borderRadius: 12, marginBottom: 8 },
  viewerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewerTime: { fontSize: 11 },
  viewerViews: { fontSize: 11 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: '#FEE2E2',
  },
  deleteText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  // Creator
  creatorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  creatorCard: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  creatorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  creatorTitle: { fontSize: 18, fontWeight: '700' },
  imagePreviewWrap: { position: 'relative', marginBottom: 12 },
  imagePreview: { width: '100%', height: 200, borderRadius: 12 },
  removeImageBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  addImageBtn: {
    height: 80, borderRadius: 12, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', borderStyle: 'dashed',
  },
  creatorInput: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
    minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  creatorPostBtn: {
    backgroundColor: '#6A5ACD', paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  creatorPostText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});

export default React.memo(StatusFeed);
