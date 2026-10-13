import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ref, get, query, orderByValue, equalTo, limitToFirst, startAfter } from '@react-native-firebase/database';
import { searchUsersByName } from '../utils/userSearch';
import { getOrFetchFullProfile } from '../../Helper/profileCache';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import config from '../../Helper/Environment';
import CreateGroupModal from './CreateGroupModal';
import { useHaptic } from '../../Helper/HepticFeedBack';
import useNavBarInset from '../../Helper/useNavBarInset';
import { getUserAdminGroup, addMembersToGroup } from '../utils/groupUtils';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { sendGameInvite, isUserInActiveGame } from '../../ValuesScreen/PetGuessingGame/utils/gameInviteSystem';
const INITIAL_LOAD = 5; // Fetch first 10 online users
const LOAD_MORE = 5; // Load 5 more on scroll
const MAX_GROUP_MEMBERS = 50;

const OnlineUsersList = ({ 
  visible, 
  onClose, 
  mode = 'view',
  // Game invitation props (only used when mode === 'gameInvite')
  roomId = null,
  onInviteSent = null,
  // Group creation props (only used when mode === 'select')
  // ... existing props work for this
}) => {
  // mode: 'view' = just view online users and start chats
  // mode: 'select' = select users for group creation/addition
  // mode: 'gameInvite' = select users to invite to game
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  // Bottom sheet: the list clears the nav bar / home indicator (keyboard down).
  const navBarInset = useNavBarInset();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  
  // ✅ Store online users from RTDB (id, displayName, avatar, etc.)
  const [allOnlineUsers, setAllOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allOnlineUserIds, setAllOnlineUserIds] = useState([]); // All online user IDs from presence
  const [loadedUserIds, setLoadedUserIds] = useState(new Set()); // Track which user IDs we've loaded
  
  // ✅ Group creation state (only used in 'select' mode)
  const [isSelectionMode, setIsSelectionMode] = useState(mode === 'select');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  // Every user ever ticked, keyed by id. Selection is by id, but the create
  // sheet and the invite map need the name and avatar, and a player picked
  // from Search is not in allOnlineUsers -- nor in searchResults once the
  // query changes. Without this they were silently dropped from the group.
  const [pickedUsers, setPickedUsers] = useState({});
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  // 'online' = people online now, 'search' = anyone by name or ID (select mode
  // only, ported from Adopt Me's member picker).
  const [activeTab, setActiveTab] = useState('online');

  // Search state (the Search tab in select mode; the inline box in gameInvite).
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  // Bumped per request so a slow answer to an older query never overwrites
  // the newer one.
  const searchSeqRef = useRef(0);

  // ✅ User's existing group state (only used in 'select' mode)
  const [userGroup, setUserGroup] = useState(null);
  const [checkingGroup, setCheckingGroup] = useState(false);
  
  // ✅ Game invitation state (only used in 'gameInvite' mode)
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Check if user has existing group (only in 'select' mode)
  useEffect(() => {
    if (mode !== 'select' || !visible || !appdatabase || !user?.id) {
      setUserGroup(null);
      return;
    }

    setCheckingGroup(true);
    const checkUserGroup = async () => {
      try {
        // Was `getUserAdminGroup(null, user.id)`. That function's first line is
        // `if (!firestoreDB || !userId) return { success: false }`, so passing
        // null made it bail before running -- userGroup stayed permanently
        // null, the button never said "Add", and the addMembersToGroup branch
        // below was unreachable. Adding members to an existing group could not
        // work from this sheet at all. firestoreDB is already in scope.
        const result = await getUserAdminGroup(firestoreDB, user.id);
        if (result.success) {
          setUserGroup({ groupId: result.groupId, groupData: result.groupData });
        } else {
          setUserGroup(null);
        }
      } catch (error) {
        console.error('Error checking user group:', error);
        setUserGroup(null);
      } finally {
        setCheckingGroup(false);
      }
    };

    checkUserGroup();
  }, [mode, visible, appdatabase, firestoreDB, user?.id]);

  // ✅ Reset game invitation state when modal closes
  useEffect(() => {
    if (!visible && mode === 'gameInvite') {
      setInvitingIds(new Set());
      setInvitedIds(new Set());
    }
  }, [visible, mode]);

  // ✅ Fetch user metadata from users node (only relevant fields)
  // ✅ OPTIMIZED: Fetch only specific child paths instead of full user objects
  const loadUserBatch = useCallback(async (userIds, alreadyLoaded) => {
    if (!appdatabase || userIds.length === 0) return;

    try {
      // ✅ Fetch only specific fields by querying child paths in parallel
      // This reduces data transfer significantly (from ~100KB to ~2-5KB per user)
      // One read per user, through the shared profile cache
      // (PLAN_2026-09.md F1). This used to fire EIGHT parallel leaf reads per
      // user — displayName, avatar, isPro, robloxUsernameVerified,
      // lastGameWinAt, isAdmin, OS, isPlaying — so opening the online list
      // with 20 users cost 160 database round-trips. The cached record has
      // all of it, plus the role flags the badges below need.
      const userPromises = userIds.map(async (userId) => {
        if (alreadyLoaded.has(userId)) return null;

        try {
          const record = await getOrFetchFullProfile(appdatabase, userId);
          // No record at all — a deleted account still sitting in /presence.
          if (!record || (!record.displayName && !record.avatar)) return null;

          return {
            id: userId,
            displayName: record.displayName || 'Anonymous',
            avatar: record.avatar
              || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            isPro: !!record.isPro,
            robloxUsernameVerified: !!record.robloxUsernameVerified,
            lastGameWinAt: record.lastGameWinAt ?? null,
            // RTDB stores the owner flag as `admin`; older rows used `isAdmin`.
            isAdmin: !!record.admin || !!record.isAdmin,
            isModerator: !!record.isModerator,
            isBabyMod: !!record.isBabyMod,
            isTrusted: !!record.isTrusted,
            isCMSR: !!record.isCMSR,
            isHelper: !!record.isHelper,
            OS: record.OS ?? null,
            isPlaying: !!record.isPlaying,
          };
        } catch (error) {
          console.error(`Error fetching user ${userId}:`, error);
          return null;
        }
      });

      const users = (await Promise.all(userPromises)).filter((u) => u !== null);

      // ✅ Add new users to existing list
      setAllOnlineUsers((prev) => {
        const existingIds = new Set(prev.map((u) => u.id));
        const newUsers = users.filter((u) => !existingIds.has(u.id));
        return [...prev, ...newUsers];
      });

      // ✅ Track loaded user IDs
      setLoadedUserIds((prev) => {
        const newSet = new Set(prev);
        userIds.forEach((id) => newSet.add(id));
        return newSet;
      });
    } catch (error) {
      console.error('Error loading user batch:', error);
    }
  }, [appdatabase]);

  // ✅ Fetch online user IDs from RTDB presence node when modal opens
  useEffect(() => {
    if (!visible || !appdatabase) {
      // Reset when modal closes
      setAllOnlineUsers([]);
      setAllOnlineUserIds([]);
      setLoadedUserIds(new Set());
      setLoading(true);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchOnlineUserIds = async () => {
      try {
        // ✅ Query presence node for online users (value === true)
        const presenceRef = ref(appdatabase, 'presence');
        const onlineQuery = query(presenceRef, orderByValue(), equalTo(true));
        const snapshot = await get(onlineQuery);

        if (!isMounted) return;

        if (!snapshot.exists()) {
          setAllOnlineUserIds([]);
          setAllOnlineUsers([]);
          setLoading(false);
          return;
        }

        // ✅ Get all online user IDs (include current user too)
        const presenceData = snapshot.val() || {};
        const onlineIds = Object.keys(presenceData)
          .filter((id) => presenceData[id] === true);

        setAllOnlineUserIds(onlineIds);

        // ✅ Load first batch of users
        await loadUserBatch(onlineIds.slice(0, INITIAL_LOAD), new Set());

        if (isMounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching online user IDs from RTDB:', error);
        if (isMounted) {
          setAllOnlineUserIds([]);
          setAllOnlineUsers([]);
          setLoading(false);
        }
      }
    };

    fetchOnlineUserIds();

    return () => {
      isMounted = false;
    };
  }, [visible, appdatabase, user?.id, loadUserBatch]);

  // ✅ Load more users on scroll (next 5 IDs from presence)
  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    
    // ✅ Find next batch of user IDs that haven't been loaded
    const unloadedIds = allOnlineUserIds.filter((id) => !loadedUserIds.has(id));
    if (unloadedIds.length === 0) return; // All users loaded

    setLoadingMore(true);
    
    // ✅ Load next batch (5 users)
    const nextBatch = unloadedIds.slice(0, LOAD_MORE);
    await loadUserBatch(nextBatch, loadedUserIds);

    setLoadingMore(false);
  }, [loadingMore, allOnlineUserIds, loadedUserIds, loadUserBatch]);


  // ✅ Reset selection mode when modal closes or mode changes
  useEffect(() => {
    if (!visible) {
      setIsSelectionMode(mode === 'select');
      setSelectedUserIds(new Set());
      setPickedUsers({});
      setShowCreateGroupModal(false);
      setActiveTab('online');
      setSearchText('');
      setSearchResults([]);
      setSearching(false);
      setSearchFailed(false);
    }
  }, [visible, mode]);

  // ✅ Handle toggle selection mode (only in 'view' mode, 'select' mode is always in selection)
  const handleToggleSelectionMode = useCallback(() => {
    if (mode === 'select') return; // Can't toggle in select mode
    triggerHapticFeedback('impactLight');
    setIsSelectionMode((prev) => !prev);
    if (isSelectionMode) {
      setSelectedUserIds(new Set());
    }
  }, [mode, isSelectionMode, triggerHapticFeedback]);

  // ✅ Handle user selection for group creation
  const handleToggleUserSelection = useCallback((picked) => {
    const userId = picked?.id;
    if (!userId) return;
    triggerHapticFeedback('impactLight');
    // Remember who this is, whichever list it came from (see pickedUsers).
    setPickedUsers((prev) => (prev[userId] ? prev : { ...prev, [userId]: picked }));
    setSelectedUserIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        // Check max members limit (creator + selected members <= MAX_GROUP_MEMBERS)
        if (newSet.size >= MAX_GROUP_MEMBERS - 1) {
          return prev; // Don't add if limit reached
        }
        newSet.add(userId);
      }
      return newSet;
    });
  }, [triggerHapticFeedback]);

  // ✅ Get selected users for group creation -- from the online list AND from
  // Search. This used to read allOnlineUsers only, so anyone picked from
  // search vanished on the way to CreateGroupModal and the group was created
  // with the online picks alone.
  const selectedUsers = useMemo(() => {
    const onlineById = new Map(allOnlineUsers.map((u) => [u.id, u]));
    return Array.from(selectedUserIds)
      .map((id) => pickedUsers[id] || onlineById.get(id))
      .filter(Boolean);
  }, [allOnlineUsers, pickedUsers, selectedUserIds]);

  // ✅ Handle create group or add members button
  const handleCreateOrAddMembers = useCallback(async () => {
    if (selectedUserIds.size === 0) {
      showErrorMessage(t('online.no_selection_title'), t('online.select_one_or_more'));
      return;
    }

    triggerHapticFeedback('impactMedium');

    // If user has existing group, add members to it
    if (userGroup?.groupId) {
      const selectedIds = Array.from(selectedUserIds);
      setLoading(true);
      
      try {
        // ✅ Build user data map from the picked users (online AND search) to
        // avoid an extra read per invitee
        const invitedUsersMap = {};
        selectedUsers.forEach((u) => {
          if (u.id && selectedIds.includes(u.id)) {
            invitedUsersMap[u.id] = {
              displayName: u.displayName || 'Anonymous',
              avatar: u.avatar || null,
            };
          }
        });

        const result = await addMembersToGroup(
          null, // firestoreDB - pass null if using RTDB only
          appdatabase,
          userGroup.groupId,
          selectedIds,
          {
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          },
          invitedUsersMap // ✅ Pass user data to avoid extra reads
        );

        if (result.success) {
          showSuccessMessage(t('home.alert.success'), t('online.invitations_sent', { count: result.invitedCount || selectedIds.length }));
          setSelectedUserIds(new Set());
          setPickedUsers({});
          setIsSelectionMode(false);
        } else {
          showErrorMessage(t('chat.error'), result.error || t('online.invitations_failed'));
        }
      } catch (error) {
        console.error('Error adding members:', error);
        showErrorMessage(t('chat.error'), t('online.add_members_failed'));
      } finally {
        setLoading(false);
      }
    } else {
      // Create new group
      setShowCreateGroupModal(true);
    }
  }, [selectedUserIds, userGroup, user, appdatabase, selectedUsers, triggerHapticFeedback, t]);

  // ✅ Handle group created (navigate to group chat)
  const handleGroupCreated = useCallback((groupId) => {
    if (groupId) {
      onClose();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('GroupChatDetail', {
          groupId,
        });
      }
    }
  }, [onClose, navigation]);

  // ✅ Handle game invitation (only in 'gameInvite' mode)
  const handleGameInvite = useCallback(async (selectedUser) => {
    if (mode !== 'gameInvite' || !roomId || !firestoreDB || !appdatabase || !user?.id) {
      if (!firestoreDB) {
        console.error('FirestoreDB is required for game invitations');
        showErrorMessage('Error', 'Unable to send invitation. Please try again.');
      }
      return;
    }
    if (invitingIds.has(selectedUser.id) || invitedIds.has(selectedUser.id) || selectedUser.isPlaying) {
      return;
    }

    setInvitingIds((prev) => new Set([...prev, selectedUser.id]));

    try {
      // Check if user is in active game
      const isInActiveGame = await isUserInActiveGame(firestoreDB, selectedUser.id);
      if (isInActiveGame) {
        showErrorMessage('Error', 'This user is already in a game');
        setInvitingIds((prev) => {
          const next = new Set(prev);
          next.delete(selectedUser.id);
          return next;
        });
        return;
      }

      // Send game invitation
      const success = await sendGameInvite(
        firestoreDB,
        roomId,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        selectedUser.id
      );

      if (success) {
        setInvitedIds((prev) => new Set([...prev, selectedUser.id]));
        showSuccessMessage('Invite Sent', `Invited ${selectedUser.displayName} to play!`);
        // ✅ Notify parent component that invite was sent
        if (onInviteSent && typeof onInviteSent === 'function') {
          onInviteSent(selectedUser);
        }
      } else {
        showErrorMessage('Error', 'Failed to send invite. Please try again.');
      }
    } catch (error) {
      console.error('Error inviting user to game:', error);
      showErrorMessage('Error', 'Failed to send invite.');
    } finally {
      setInvitingIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedUser.id);
        return next;
      });
    }
  }, [mode, roomId, firestoreDB, appdatabase, user, invitingIds, invitedIds, onInviteSent]);

  // ✅ Handle start private chat (only in 'view' mode)
  const handleStartChat = useCallback((selectedUser) => {
    if (mode === 'select') {
      // In select mode, toggle selection instead
      handleToggleUserSelection(selectedUser);
      return;
    }

    if (mode === 'gameInvite') {
      // In game invite mode, send invite instead
      handleGameInvite(selectedUser);
      return;
    }

    const callbackFunction = () => {
      onClose();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: selectedUser.id,
            sender: selectedUser.displayName,
            avatar: selectedUser.avatar,
          },
        });
      }
    };

    callbackFunction();
  }, [mode, onClose, navigation, localState?.isPro, handleToggleUserSelection, handleGameInvite]);

  // ✅ Memoize render user item
  const renderUserItem = useCallback(({ item }) => {
    if (!item || !item.id) return null;

    const isSelected = selectedUserIds.has(item.id);
    const isInviting = invitingIds.has(item.id);
    const isInvited = invitedIds.has(item.id);
    const isPlaying = item.isPlaying || false;

    return (
      <TouchableOpacity
        style={[styles.userItem, isSelected && styles.userItemSelected]}
        onPress={() => handleStartChat(item)}
        activeOpacity={0.7}
        disabled={mode === 'gameInvite' && (isInviting || isInvited || isPlaying)}
      >
        {mode === 'select' && (
          <View style={styles.checkboxContainer}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
          </View>
        )}
        <View style={styles.userItemLeft}>
          <Image resizeMethod="resize"
            source={{ uri: item.avatar }}
            style={styles.avatar}
            defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          />
          {/* Online-list rows have no isOnline and are online by definition;
              search rows carry it, and an offline player gets no dot. */}
          {item.isOnline !== false && <View style={styles.onlineIndicator} />}
        </View>
        <View style={styles.userInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={styles.userName} numberOfLines={1}>
              {`${item.displayName || t('group_chat.anonymous')}`}
            </Text>
            
            {/* Pro badge */}
            {item?.isPro && (
              <Image resizeMethod="resize"
                source={require('../../../assets/pro.png')}
                style={{ width: 12, height: 12, marginLeft: 4 }}
              />
            )}

            {/* Verified badge */}
            {item?.robloxUsernameVerified && (
              <Image resizeMethod="resize"
                source={require('../../../assets/verification.png')}
                style={{ width: 12, height: 12, marginLeft: 4 }}
              />
            )}

            {/* Trophy badge (recent win) */}
            {(item?.hasRecentGameWin ||
              (typeof item?.lastGameWinAt === 'number' &&
                Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000)) && (
              <Image resizeMethod="resize"
                source={require('../../../assets/trophy.webp')}
                style={{ width: 10, height: 10, marginLeft: 4 }}
              />
            )}

            {/* Role pills */}
            {(() => {
              const firstBadge = getFirstBadgeType(item);
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                  {item?.isAdmin && (
                    <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} labelOverride={t('chat.admin')} glow={firstBadge === 'admin'} />
                  )}
                  {!item?.isAdmin && item?.isModerator && (
                    <UserBadgePill type="mod" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'mod'} />
                  )}
                  {!item?.isAdmin && !item?.isModerator && item?.isBabyMod && (
                    <UserBadgePill type="jmd" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'jmd'} />
                  )}
                  {item?.isTrusted && (
                    <UserBadgePill type="trusted" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'trusted'} />
                  )}
                  {item?.isCMSR && (
                    <UserBadgePill type="cmsr" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'cmsr'} />
                  )}
                  {item?.isHelper && (
                    <UserBadgePill type="helper" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'helper'} />
                  )}
                </View>
              );
            })()}

            {/* Platform badge (for admins) */}
            {item?.isAdmin && item?.OS && (
              <View
                style={{
                  marginLeft: 4,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                  borderRadius: 3,
                  backgroundColor: isDarkMode ? config.colors.surfaceDark : '#F3F4F6',
                }}
              >
                <Icon
                  name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                  size={12}
                  color={item.OS === 'ios' ? '#007AFF' : '#34C759'}
                />
              </View>
            )}
          </View>
          {mode === 'gameInvite' && (
            <Text style={[styles.statusText, { color: isDarkMode ? '#9CA3AF' : '#6B7280' }]}>
              {isPlaying ? 'Currently Playing' : 'Online'}
            </Text>
          )}
        </View>
        {mode === 'view' && (
          <Icon name="chatbubble-outline" size={18} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
        )}
        {mode === 'gameInvite' && (
          <>
            {isInviting ? (
              <ActivityIndicator size="small" color={config.colors.primary || '#8B5CF6'} />
            ) : isInvited ? (
              <View style={styles.invitedBadge}>
                <Icon name="checkmark-circle" size={20} color="#10B981" />
              </View>
            ) : isPlaying ? (
              <View style={styles.playingBadge}>
                <Icon name="game-controller-outline" size={18} color="#F59E0B" />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.inviteButton}
                onPress={() => handleGameInvite(item)}
              >
                <Icon name="person-add-outline" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )}
      </TouchableOpacity>
    );
  }, [styles, handleStartChat, isDarkMode, isSelectionMode, selectedUserIds, mode, invitingIds, invitedIds, handleGameInvite, t]);

  // ✅ Memoize key extractor
  // ── Search by name ──────────────────────────────────────────────────────
  // The list itself only ever held people who were online right now, so an
  // offline friend could not be added to a group at all. A non-empty query
  // swaps the data source to a prefix search over /users; clearing it returns
  // to the online list untouched. See utils/userSearch.js for why prefix and
  // not substring.
  //
  // In select mode (group creation) this is a separate Search tab beside the
  // Online tab, as in Adopt Me's picker; gameInvite keeps the inline box.
  const inSearchTab = mode === 'select' && activeTab === 'search';
  const searchTerm = searchText.trim();
  const isSearching = mode === 'select' ? inSearchTab : searchTerm.length >= 2;

  // Never addable: yourself, and anyone you have blocked. The same rule is
  // applied to the online list below, so both tabs offer the same people.
  const blockedIds = localState?.bannedUsers;
  const excludedIds = useMemo(() => {
    const ids = new Set(Array.isArray(blockedIds) ? blockedIds : []);
    if (user?.id) ids.add(user.id);
    return ids;
  }, [blockedIds, user?.id]);

  const onlineIdSet = useMemo(() => new Set(allOnlineUserIds), [allOnlineUserIds]);

  const runSearch = useCallback(async (term) => {
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setSearchFailed(false);
    try {
      const found = await searchUsersByName(appdatabase, term, {
        limit: 25,
        excludeIds: Array.from(excludedIds),
      });
      if (seq !== searchSeqRef.current) return; // a newer query owns the list
      setSearchResults(found.map((u) => ({ ...u, isOnline: onlineIdSet.has(u.id) })));
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      setSearchResults([]);
      setSearchFailed(true);
      console.warn('[OnlineUsersList] search failed:', err?.message || err);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [appdatabase, excludedIds, onlineIdSet]);

  // Debounced search as you type (~300 ms). Any answer still in flight is for
  // an older term, so it is invalidated the moment the term changes.
  useEffect(() => {
    searchSeqRef.current += 1;
    if (searchTerm.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchFailed(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => runSearch(searchTerm), 300);
    return () => clearTimeout(timer);
    // runSearch is left out on purpose: it changes when the online id list
    // loads, and re-firing the query for that is not worth a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, appdatabase]);

  // The Search button / keyboard "search" key: run now, skip the debounce.
  const handleSearchNow = useCallback(() => {
    if (searchTerm.length < 2) return;
    runSearch(searchTerm);
  }, [searchTerm, runSearch]);

  const handleTabChange = useCallback((tab) => {
    if (tab === activeTab) return;
    triggerHapticFeedback('impactLight');
    setActiveTab(tab);
    if (tab === 'online') {
      // As in Adopt Me: leaving Search clears it. Picks are kept (pickedUsers).
      setSearchText('');
      setSearchResults([]);
    }
  }, [activeTab, triggerHapticFeedback]);

  // In select mode you, and anyone you have blocked, are not offered.
  const onlineUsersForMode = useMemo(() => (
    mode === 'select'
      ? allOnlineUsers.filter((u) => !excludedIds.has(u.id))
      : allOnlineUsers
  ), [mode, allOnlineUsers, excludedIds]);

  // Selection state is keyed by id and lives outside both lists, so a user
  // picked from search stays selected after the query is cleared.
  const visibleUsers = isSearching ? searchResults : onlineUsersForMode;

  const keyExtractor = useCallback((item) => item?.id || Math.random().toString(), []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.modalOverlay} 
        activeOpacity={1}
        onPress={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View 
          style={[styles.modalContent, { paddingBottom: navBarInset }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {mode === 'select' ? t('online.select_members') : mode === 'gameInvite' ? 'Invite Friends to Play' : t('online.online_users')}
            </Text>
            <View style={styles.headerRight}>
              {mode === 'select' ? (
                // Selection mode header
                <>
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.headerButton}
                  >
                    <Text style={styles.cancelText}>{t('chat.cancel')}</Text>
                  </TouchableOpacity>
                  {selectedUserIds.size > 0 && (
                    <TouchableOpacity
                      onPress={handleCreateOrAddMembers}
                      style={[styles.headerButton, styles.createGroupButton]}
                      disabled={loading}
                    >
                      <Text style={styles.createGroupText}>
                        {userGroup
                          ? t('online.add_to_group', { group: userGroup.groupData?.name || userGroup.groupData?.groupName || t('groups_screen.group'), count: selectedUserIds.size })
                          : t('online.create_count', { count: selectedUserIds.size })}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                // View mode or game invite mode header (just close button)
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Icon name="close" size={22} color={isDarkMode ? '#FFFFFF' : '#000000'} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Tab bar (group member picker only): Online | Search, as in
              Adopt Me. */}
          {mode === 'select' && (
            <View style={styles.tabBar}>
              {[
                { key: 'online', label: t('online.online_users') },
                { key: 'search', label: t('create_group.tab_search') },
              ].map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => handleTabChange(tab.key)}
                    style={[styles.tab, active && styles.tabActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Search input (select mode: Search tab only) */}
          {inSearchTab && (
            <View style={[styles.searchWrap, styles.searchWrapWithButton]}>
              <Icon name="search" size={16} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
              <TextInput
                style={styles.searchInput}
                value={searchText}
                onChangeText={setSearchText}
                placeholder={t('online.search_placeholder')}
                placeholderTextColor={isDarkMode ? '#6B7280' : '#9CA3AF'}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={handleSearchNow}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={16} color={isDarkMode ? '#6B7280' : '#9CA3AF'} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleSearchNow}
                disabled={searchTerm.length < 2 || searching}
                style={[
                  styles.searchButton,
                  searchTerm.length < 2 && styles.searchButtonDisabled,
                ]}
              >
                {searching ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.searchButtonText}>{t('create_group.search_button')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Inline search for the game-invite picker ('view' mode is a
              presence list, where searching offline people would mislead). */}
          {mode === 'gameInvite' && (
            <View style={styles.searchWrap}>
              <Icon name="search" size={16} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
              <TextInput
                style={styles.searchInput}
                value={searchText}
                onChangeText={setSearchText}
                placeholder={t('online.search_placeholder')}
                placeholderTextColor={isDarkMode ? '#6B7280' : '#9CA3AF'}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={16} color={isDarkMode ? '#6B7280' : '#9CA3AF'} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Users List */}
          {inSearchTab && searchTerm.length < 2 ? (
            // Nothing typed yet (or one character): say what Search does.
            <View style={styles.emptyContainer}>
              <Icon name="search-outline" size={64} color={isDarkMode ? '#4B5563' : '#D1D5DB'} />
              <Text style={[styles.emptyText, styles.centeredText]}>
                {searchTerm.length === 0
                  ? t('create_group.search_prompt')
                  : t('create_group.search_min_chars', { min: 2 })}
              </Text>
              {selectedUserIds.size > 0 && (
                <Text style={styles.searchHintText}>
                  {t('create_group.search_keeps_picks')}
                </Text>
              )}
            </View>
          ) : (isSearching ? searching : loading) ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={config.colors.primary} />
            </View>
          ) : isSearching && searchFailed ? (
            <View style={styles.emptyContainer}>
              <Icon name="cloud-offline-outline" size={64} color={isDarkMode ? '#4B5563' : '#D1D5DB'} />
              <Text style={[styles.emptyText, styles.centeredText]}>
                {t('social.search_users_failed')}
              </Text>
            </View>
          ) : visibleUsers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon 
                name={isSearching ? 'search-outline' : 'people-outline'}
                size={64} 
                color={isDarkMode ? '#4B5563' : '#D1D5DB'} 
              />
              <Text style={styles.emptyText}>
                {isSearching ? t('online.no_one_found', { query: searchText.trim() }) : t('online.no_online_users')}
              </Text>
              {isSearching && (
                <Text style={styles.searchHintText}>
                  {t('online.search_hint')}
                </Text>
              )}
            </View>
          ) : (
            <FlatList
              data={visibleUsers}
              renderItem={renderUserItem}
              keyExtractor={keyExtractor}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              maxToRenderPerBatch={5}
              windowSize={5}
              initialNumToRender={5}
              onEndReached={isSearching ? undefined : handleLoadMore}
              onEndReachedThreshold={0.5}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListFooterComponent={
                !isSearching && allOnlineUserIds.length > loadedUserIds.size ? (
                  <View style={styles.loadMoreContainer}>
                    {loadingMore ? (
                      <ActivityIndicator size="small" color={config.colors.primary} />
                    ) : (
                      <Text style={styles.loadMoreText}>
                        {t('online.more_users', { count: allOnlineUserIds.length - loadedUserIds.size })}
                      </Text>
                    )}
                  </View>
                ) : null
              }
            />
          )}

          {/* Footer Info */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {mode === 'select'
                ? selectedUserIds.size > 0
                  ? t('online.selected_max', { count: selectedUserIds.size, max: MAX_GROUP_MEMBERS - 1 })
                  : t('online.select_to_create')
                : allOnlineUsers.length < allOnlineUserIds.length
                  ? t('online.users_online_loaded', { count: allOnlineUserIds.length, loaded: allOnlineUsers.length })
                  : t('online.users_online', { count: allOnlineUserIds.length })
              }
            </Text>
          </View>
        </View>
        </KeyboardAvoidingView>
      </TouchableOpacity>

      {/* Create Group Modal */}
      <CreateGroupModal
        visible={showCreateGroupModal}
        onClose={() => {
          setShowCreateGroupModal(false);
          setIsSelectionMode(false);
          setSelectedUserIds(new Set());
          setPickedUsers({});
        }}
        selectedUsers={selectedUsers}
      />
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: isDark ? config.colors.surfaceDark : '#FFFFFF',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: 500,
      minHeight: 400,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? config.colors.surfaceElevatedDark : '#E5E7EB',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#FFFFFF' : '#111827',
      fontFamily: 'Lato-Bold',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerButton: {
      padding: 4,
    },
    cancelText: {
      fontSize: 14,
      fontFamily: 'Lato-SemiBold',
      color: isDark ? '#FFFFFF' : '#111827',
    },
    createGroupButton: {
      backgroundColor: '#8B5CF6',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    createGroupText: {
      fontSize: 13,
      fontFamily: 'Lato-Bold',
      color: '#FFFFFF',
    },
    closeButton: {
      padding: 4,
    },
    checkboxContainer: {
      marginRight: 10,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: isDark ? '#6B7280' : '#9CA3AF',
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      backgroundColor: '#8B5CF6',
      borderColor: '#8B5CF6',
    },
    userItemSelected: {
      backgroundColor: isDark ? '#4B5563' : '#E0E7FF',
      borderWidth: 2,
      borderColor: '#8B5CF6',
    },
    list: {
      flex: 1,
      maxHeight: '100%',
    },
    listContent: {
      padding: 6,
    },
    userItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      marginVertical: 3,
      marginHorizontal: 6,
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#F9FAFB',
      borderRadius: 10,
    },
    userItemLeft: {
      position: 'relative',
      marginRight: 10,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDark ? '#4B5563' : '#E5E7EB',
    },
    onlineIndicator: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#10B981',
      borderWidth: 2,
      borderColor: isDark ? config.colors.surfaceDark : '#FFFFFF',
    },
    userInfo: {
      flex: 1,
      marginRight: 6,
    },
    userName: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#FFFFFF' : '#111827',
      fontFamily: 'Lato-SemiBold',
    },
    statusText: {
      fontSize: 12,
      fontFamily: 'Lato-Regular',
      marginTop: 2,
    },
    inviteButton: {
      backgroundColor: '#8B5CF6',
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    invitedBadge: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    playingBadge: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      borderRadius: 18,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 30,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 12,
      height: 40,
      borderRadius: 12,
      backgroundColor: isDark ? '#1F2937' : '#F1F3F6',
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      padding: 0,
      color: isDark ? '#FFFFFF' : '#111827',
    },
    // Search tab: the Search button sits flush in the box's trailing end.
    searchWrapWithButton: {
      paddingEnd: 0,
      overflow: 'hidden',
    },
    searchButton: {
      height: 40,
      minWidth: 64,
      paddingHorizontal: 14,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary || '#8B5CF6',
      borderTopEndRadius: 12,
      borderBottomEndRadius: 12,
    },
    searchButtonDisabled: {
      backgroundColor: isDark ? '#374151' : '#D1D5DB',
    },
    searchButtonText: {
      fontSize: 13,
      color: '#FFFFFF',
      fontFamily: 'Lato-Bold',
    },
    tabBar: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginTop: 10,
      marginBottom: 10,
      padding: 4,
      borderRadius: 12,
      backgroundColor: isDark ? '#1F2937' : '#F1F3F6',
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#FFFFFF',
    },
    tabText: {
      fontSize: 13,
      fontFamily: 'Lato-Regular',
      color: isDark ? '#9CA3AF' : '#6B7280',
    },
    tabTextActive: {
      fontFamily: 'Lato-Bold',
      color: isDark ? '#FFFFFF' : '#111827',
    },
    centeredText: {
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    searchHintText: {
      marginTop: 6,
      fontSize: 12,
      color: isDark ? '#6B7280' : '#9CA3AF',
    },
    emptyText: {
      marginTop: 12,
      fontSize: 14,
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    },
    footer: {
      padding: 10,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderTopColor: isDark ? config.colors.surfaceElevatedDark : '#E5E7EB',
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    },
    loadMoreContainer: {
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadMoreText: {
      fontSize: 12,
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    },
  });

export default OnlineUsersList;
