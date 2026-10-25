import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import ChatScreen from './GroupChat/Trader';
import PrivateChatScreen from './PrivateChat/PrivateChat';
import InboxScreen from './GroupChat/InboxScreen';
import GroupsScreen from './GroupChat/GroupsScreen';
import GroupChatScreen from './GroupChat/GroupChatScreen';
import { useGlobalState } from '../GlobelStats';
import PrivateChatHeader from './PrivateChat/PrivateChatHeader';
import BlockedUsersScreen from './PrivateChat/BlockUserList';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
// import database from '@react-native-firebase/database';
import ImageViewerScreenChat from './PrivateChat/ImageViewer';
import { ref, update, get, onChildAdded, onChildChanged, onChildRemoved, onValue } from '@react-native-firebase/database';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';
import {
  setDmUnread, removeDmUnread, clearDmUnread,
  setGroupUnread, removeGroupUnread, clearGroupUnread,
} from './chatBadgeStore';


const Stack = createNativeStackNavigator();

// Stable identities for props passed into InboxScreen — see the comment at the
// Inbox screen below for why these must not be inline literals.
const EMPTY_CHATS = [];
const NOOP = () => {};

const groupChatDetailOptions = {
  headerBackVisible: true,
  // Both are set dynamically by GroupChatScreen
  headerTitle: () => null,
  headerRight: () => null,
};

// The groups list is redrawn at most this often; group_meta_data fires once
// per message in every group the player is in.
const GROUPS_FLUSH_MS = 400;

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const { localState, updateLocalState } = useLocalState()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const prevGroupsRef = useRef(null); // ✅ Track previous groups to avoid unnecessary re-renders
  // Mirror of bannedUsers read inside the RTDB listeners, so the listener effect
  // does NOT need bannedUsers in its deps (which would tear down + re-attach all
  // three child listeners — and re-read the node — on every banned-list change).
  const bannedUsersRef = useRef([]);

  // These are the app's only RTDB listeners that live for the whole session —
  // every other screen's listeners go away when the user navigates off it. That
  // made them the ones still attached when React Native tears the JS context
  // down (the user backs out of the app while the process stays cached): the
  // Firebase SDK is process-scoped, so it kept delivering child events into a
  // native module whose executors had already been shut down, which throws
  // RejectedExecutionException on the main thread and takes the app with it.
  //
  // Holding them only while the app is actually in the foreground means nothing
  // is attached by the time teardown happens. It also stops us paying for chat
  // metadata sync while the app is backgrounded and JS is suspended — but note
  // the flip side: re-attaching re-reads chat_meta_data/{uid} and
  // group_meta_data/{uid} once per foreground instead of once per launch.
  const [isForeground, setIsForeground] = useState(
    () => AppState.currentState !== 'background',
  );

  useEffect(() => {
    // 'inactive' is a transient iOS state (system dialogs); only a real
    // background should drop the listeners, or they would churn needlessly.
    const sub = AppState.addEventListener('change', (next) => {
      setIsForeground(next !== 'background');
    });
    return () => sub.remove();
  }, []);



  useEffect(() => {
    if (!user?.id) return;
    // ✅ Safety check: ensure bannedUsers is an array
    const banned = Array.isArray(localState.bannedUsers) ? localState.bannedUsers : [];
    setBannedUsers(banned);
    bannedUsersRef.current = banned;
  }, [user?.id, localState.bannedUsers]);


  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: selectedTheme.colors.background },
    freezeOnBlur: true,
    animation: 'fade',
    animationDuration: 300,
  }), [selectedTheme]);


  // ✅ OPTIMIZED: Use child listeners instead of full value listener to reduce data download
  // Listen to individual chat unreadCount changes instead of downloading entire chat_meta_data
  // Only tracks unread counts - full chat list is loaded in InboxScreen when focused
  useEffect(() => {
    // Badge totals live in chatBadgeStore, not in this component's state:
    // a state update here re-rendered every live chat screen per message.
    if (!user?.id || !appdatabase) {
      clearDmUnread();
      return;
    }
  
    // Backgrounded: hold no listeners, and leave the last known badge count on
    // screen rather than zeroing it.
    if (!isForeground) return;

    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
    
    // ✅ OPTIMIZED: Use child_added and child_changed to listen to individual chats
    // This only downloads data when a specific chat changes, not the entire metadata
    const handleChildChange = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const chatData = snapshot.val();
      if (!chatData || typeof chatData !== 'object') return;
      
      const chatPartnerId = snapshot.key;
      const banned = bannedUsersRef.current;
      const isBlocked = Array.isArray(banned) && banned.includes(chatPartnerId);
      const rawUnread = chatData?.unreadCount || 0;
      
      if (isBlocked && rawUnread > 0) {
        update(
          ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`),
          { unreadCount: 0 }
        ).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
        setDmUnread(chatPartnerId, 0);
      } else {
        setDmUnread(chatPartnerId, isBlocked ? 0 : rawUnread);
      }
    };
    
    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      removeDmUnread(snapshot.key);
    };
    
    // Initial load: fetch only unreadCount fields for each chat (lighter than full data)
    const loadInitialCounts = async () => {
      try {
        const snapshot = await get(userChatsRef);
        if (!snapshot.exists()) {
          clearDmUnread();
          return;
        }
        
        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          clearDmUnread();
          return;
        }
        
        const banned = Array.isArray(bannedUsersRef.current) ? bannedUsersRef.current : [];
        
        Object.entries(fetchedData).forEach(([chatPartnerId, chatData]) => {
          if (!chatData || typeof chatData !== 'object') return;
          const isBlocked = banned.includes(chatPartnerId);
          const rawUnread = chatData?.unreadCount || 0;
          setDmUnread(chatPartnerId, isBlocked ? 0 : rawUnread);
        });
      } catch (error) {
        console.error("❌ Error loading initial unread counts:", error);
      }
    };
    
    loadInitialCounts();
    
    // Listen to individual chat changes
    const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);
  
    // ✅ Proper cleanup
    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
    };
    // bannedUsers intentionally excluded — read via bannedUsersRef so the
    // listeners attach once per user, not on every banned-list change.
  }, [user?.id, appdatabase, isForeground]);

  // ✅ Load groups from group_meta_data
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      clearGroupUnread();
      return;
    }

    // Same as the unread listeners above: not held while backgrounded.
    if (!isForeground) return;

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);

    // The first snapshot paints at once; later ones are coalesced so a busy
    // group redraws the Groups list at most every GROUPS_FLUSH_MS. The badge
    // counts go to the store on every snapshot (cheap, no re-render here).
    let flushTimer = null;
    let pendingGroups = null;
    let firstPainted = false;
    const flushGroupsList = () => {
      flushTimer = null;
      if (!pendingGroups) return;
      const sortedGroups = pendingGroups;
      pendingGroups = null;
      // ✅ Shallow compare: only update state if data actually changed
      const prevGroups = prevGroupsRef.current;
      const hasChanged = !prevGroups || prevGroups.length !== sortedGroups.length ||
        sortedGroups.some((g, i) => {
          const p = prevGroups[i];
          return !p || g.groupId !== p.groupId || g.groupName !== p.groupName ||
            g.groupAvatar !== p.groupAvatar || g.lastMessage !== p.lastMessage ||
            g.lastMessageTimestamp !== p.lastMessageTimestamp ||
            g.unreadCount !== p.unreadCount || g.memberCount !== p.memberCount ||
            g.createdBy !== p.createdBy;
        });
      if (hasChanged) {
        prevGroupsRef.current = sortedGroups;
        setGroups(sortedGroups);
      }
      setGroupsLoading(false);
    };
    const scheduleGroupsList = (sortedGroups) => {
      pendingGroups = sortedGroups;
      if (!firstPainted) {
        firstPainted = true;
        flushGroupsList();
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flushGroupsList, GROUPS_FLUSH_MS);
    };
    const seenGroupIds = new Set();
    const syncGroupBadges = (sortedGroups) => {
      const ids = new Set();
      sortedGroups.forEach((g) => {
        ids.add(g.groupId);
        setGroupUnread(g.groupId, g.unreadCount || 0);
      });
      seenGroupIds.forEach((id) => { if (!ids.has(id)) removeGroupUnread(id); });
      seenGroupIds.clear();
      ids.forEach((id) => seenGroupIds.add(id));
    };

    const unsubGroups = onValue(userGroupsRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          syncGroupBadges([]);
          scheduleGroupsList([]);
          return;
        }

        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          syncGroupBadges([]);
          scheduleGroupsList([]);
          return;
        }

        const updatedGroups = Object.entries(fetchedData).map(([groupId, groupData]) => {
          if (!groupData || typeof groupData !== 'object') {
            return null;
          }

          return {
            groupId,
            // Empty fallbacks: GroupsScreen shows the translated
            // "Group" / "No messages yet" at render.
            groupName: groupData.groupName || '',
            groupAvatar: groupData.groupAvatar || null,
            lastMessage: groupData.lastMessage || '',
            lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
            unreadCount: groupData.unreadCount || 0,
            memberCount: groupData.memberCount || 0,
            createdBy: groupData.createdBy || null, // Add creator info
          };
        }).filter(Boolean);

        const sortedGroups = updatedGroups.sort(
          (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
        );
        syncGroupBadges(sortedGroups);
        scheduleGroupsList(sortedGroups);
      } catch (error) {
        console.error('❌ Error fetching groups:', error);
        setGroupsLoading(false);
      }
    });

    return () => {
      unsubGroups();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [user?.id, appdatabase, isForeground]);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);

  const getGroupChatOptions = useCallback(({ navigation }) => ({
    title: user?.id ? '' : t('chat.community_chat'), // Show title if logged out
    headerTitleAlign: 'left',
    headerTitleStyle: { 
      fontFamily: 'Lato-Bold', 
      fontSize: 24,
    },
    headerTitleContainerStyle: {
      left: 0,
      paddingLeft: 0,
    },
    headerRight: () => (
      <CommunityChatHeader
        selectedTheme={selectedTheme}
        triggerHapticFeedback={triggerHapticFeedback}
        onOnlineUsersPress={() => setOnlineUsersVisible(true)}
      />
    ),
    headerRightContainerStyle: {
      paddingRight: 0,
      marginRight: 0,
    },
  }), [selectedTheme, triggerHapticFeedback, user?.id, t]);

  // Every screen's render function is stable: React Navigation skips a
  // mounted screen only when its render function is the same as last time.
  // Inline `{props => ...}` children re-rendered every live chat screen on
  // each ChatStack render.
  const renderGroupChat = useCallback(() => (
    <ChatScreen
      {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, onlineUsersVisible, setOnlineUsersVisible }}
    />
  ), [selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, triggerHapticFeedback, unreadMessagesCount, onlineUsersVisible]);

  // EMPTY_CHATS / NOOP are module-level constants, NOT inline literals.
  // InboxScreen's listener effect lists `setChats` in its deps, so fresh
  // `[]` / `() => {}` identities would tear down its RTDB listeners.
  const renderInbox = useCallback(
    (props) => <InboxScreen {...props} chats={EMPTY_CHATS} setChats={NOOP} loading={false} bannedUsers={bannedUsers} />,
    [bannedUsers],
  );

  const renderGroups = useCallback(
    (props) => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} />,
    [groups, groupsLoading],
  );

  const renderGroupChatDetail = useCallback((props) => <GroupChatScreen {...props} />, []);

  const renderBlockedUsers = useCallback(
    (props) => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />,
    [bannedUsers],
  );

  const getPrivateChatOptions = useCallback(({ route }) => ({
    headerTitle: () => (
      <PrivateChatHeader
        // New header per player, so nothing from the previous chat carries over.
        key={route.params?.selectedUser?.senderId || 'none'}
        selectedUser={route.params?.selectedUser}
        selectedTheme={selectedTheme}
        bannedUsers={bannedUsers}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
      />
    ),
  }), [selectedTheme, bannedUsers, isDrawerVisible]);

  const renderPrivateChat = useCallback((props) => (
    <PrivateChatScreen
      // New screen per player: params changing in place (a quick second tap)
      // left the previous player's state behind.
      key={props.route?.params?.selectedUser?.senderId || 'none'}
      {...props}
      bannedUsers={bannedUsers}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
    />
  ), [bannedUsers, isDrawerVisible]);

  const inboxOptions = useMemo(() => ({ title: t('misc.inbox') }), [t]);
  const groupsOptions = useMemo(() => ({ title: t('chat.groups') }), [t]);
  const blockedUsersOptions = useMemo(() => ({ title: t('chat.blocked_users') }), [t]);
  const imageViewerOptions = useMemo(() => ({ title: t('chat.image') }), [t]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="GroupChat" options={getGroupChatOptions}>
        {renderGroupChat}
      </Stack.Screen>

      <Stack.Screen name="Inbox" options={inboxOptions}>
        {renderInbox}
      </Stack.Screen>

      <Stack.Screen name="Groups" options={groupsOptions}>
        {renderGroups}
      </Stack.Screen>

      <Stack.Screen name="GroupChatDetail" options={groupChatDetailOptions}>
        {renderGroupChatDetail}
      </Stack.Screen>

      <Stack.Screen name="BlockedUsers" options={blockedUsersOptions}>
        {renderBlockedUsers}
      </Stack.Screen>

      <Stack.Screen name="PrivateChat" options={getPrivateChatOptions}>
        {renderPrivateChat}
      </Stack.Screen>

      <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={imageViewerOptions}
      />
    </Stack.Navigator>
  );
};
