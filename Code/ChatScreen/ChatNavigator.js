import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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


const Stack = createNativeStackNavigator();

// Stable identities for props passed into InboxScreen — see the comment at the
// Inbox screen below for why these must not be inline literals.
const EMPTY_CHATS = [];
const NOOP = () => {};

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadcount, setunreadcount] = useState(0);
  const { localState, updateLocalState } = useLocalState()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups
  const prevGroupsRef = useRef(null); // ✅ Track previous groups to avoid unnecessary re-renders
  // Mirror of bannedUsers read inside the RTDB listeners, so the listener effect
  // does NOT need bannedUsers in its deps (which would tear down + re-attach all
  // three child listeners — and re-read the node — on every banned-list change).
  const bannedUsersRef = useRef([]);



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
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }
  
    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
    let totalUnread = 0;
    const unreadCounts = new Map(); // Track unread counts per chat
    
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
        unreadCounts.set(chatPartnerId, 0);
      } else {
        unreadCounts.set(chatPartnerId, isBlocked ? 0 : rawUnread);
      }
      
      // Recalculate total
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      setunreadcount(totalUnread);
    };
    
    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      unreadCounts.delete(snapshot.key);
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      setunreadcount(totalUnread);
    };
    
    // Initial load: fetch only unreadCount fields for each chat (lighter than full data)
    const loadInitialCounts = async () => {
      try {
        const snapshot = await get(userChatsRef);
        if (!snapshot.exists()) {
          setunreadcount(0);
          return;
        }
        
        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setunreadcount(0);
          return;
        }
        
        const banned = Array.isArray(bannedUsersRef.current) ? bannedUsersRef.current : [];
        totalUnread = 0;
        
        Object.entries(fetchedData).forEach(([chatPartnerId, chatData]) => {
          if (!chatData || typeof chatData !== 'object') return;
          const isBlocked = banned.includes(chatPartnerId);
          const rawUnread = chatData?.unreadCount || 0;
          const count = isBlocked ? 0 : rawUnread;
          unreadCounts.set(chatPartnerId, count);
          totalUnread += count;
        });
        
        setunreadcount(totalUnread);
      } catch (error) {
        console.error("❌ Error loading initial unread counts:", error);
        setunreadcount(0);
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
  }, [user?.id, appdatabase]);

  // ✅ Load groups from group_meta_data
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);

    const unsubGroups = onValue(userGroupsRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        const updatedGroups = Object.entries(fetchedData).map(([groupId, groupData]) => {
          if (!groupData || typeof groupData !== 'object') {
            return null;
          }

          return {
            groupId,
            groupName: groupData.groupName || 'Group',
            groupAvatar: groupData.groupAvatar || null,
            lastMessage: groupData.lastMessage || 'No messages yet',
            lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
            unreadCount: groupData.unreadCount || 0,
            memberCount: groupData.memberCount || 0,
            createdBy: groupData.createdBy || null, // Add creator info
          };
        }).filter(Boolean);

        const sortedGroups = updatedGroups.sort(
          (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
        );
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
        
        // ✅ Calculate total group unread count
        const totalGroupUnread = sortedGroups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);
        setGroupUnreadCount(totalGroupUnread);
        
        setGroupsLoading(false);
      } catch (error) {
        console.error('❌ Error fetching groups:', error);
        setGroupsLoading(false);
      }
    });

    return () => {
      unsubGroups();
    };
  }, [user?.id, appdatabase]);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);

  const getGroupChatOptions = useCallback(({ navigation }) => ({
    title: user?.id ? '' : 'Community Chat', // Show title if logged out
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
        unreadcount={unreadcount}
        setunreadcount={setunreadcount}
        groupUnreadCount={groupUnreadCount}
        setGroupUnreadCount={setGroupUnreadCount}
        triggerHapticFeedback={triggerHapticFeedback}
        onOnlineUsersPress={() => setOnlineUsersVisible(true)}
      />
    ),
    headerRightContainerStyle: {
      paddingRight: 0,
      marginRight: 0,
    },
  }), [selectedTheme, unreadcount, setunreadcount, groupUnreadCount, setGroupUnreadCount, triggerHapticFeedback, user?.id]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {() => (
          <ChatScreen
            {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }}
          />
        )}
      </Stack.Screen>

      {/* ✅ Optimized: Pass `chats` & `setChats` via `screenProps` instead of inline function */}
      <Stack.Screen
        name="Inbox"
        options={{ title: 'Inbox' }}
      >
        {/* EMPTY_CHATS / NOOP are module-level constants, NOT inline literals.
            InboxScreen's focus effect lists `setChats` in its deps, and this
            component re-renders on every incoming message (unread counter), so
            fresh `[]` / `() => {}` identities tore down the three RTDB
            listeners and re-downloaded the whole chat_meta_data node per
            message. */}
        {props => <InboxScreen {...props} chats={EMPTY_CHATS} setChats={NOOP} loading={false} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="Groups"
        options={{ title: 'Groups' }}
      >
        {(props) => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} />}
      </Stack.Screen>

      <Stack.Screen
        name="GroupChatDetail"
        options={({ route, navigation }) => ({
          headerBackVisible: true,
          headerTitle: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
          headerRight: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
        })}
      >
        {(props) => <GroupChatScreen {...props} />}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={{ title: 'Blocked Users' }} >
        {props => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
  name="PrivateChat"
  options={({ route }) => ({
    headerTitle: () => (
      <PrivateChatHeader
        selectedUser={route.params?.selectedUser}
        selectedTheme={selectedTheme}
        bannedUsers={bannedUsers}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
      />
    ),
  })}
>
  {(props) => (
    <PrivateChatScreen
      {...props}
      bannedUsers={bannedUsers}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
    />
  )}
</Stack.Screen>
        <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={{ title: 'Image' }}
      />


    </Stack.Navigator>
  );
};
