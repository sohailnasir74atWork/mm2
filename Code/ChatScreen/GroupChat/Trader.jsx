import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
  StyleSheet as RNStyleSheet,
} from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import ChatHeaderContent from './ChatHeaderContent';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import { banUser, handleDeleteLast300Messages, isUserOnline, unbanUser } from '../utils';
import { serverNowMs } from '../../Helper/serverTime';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref, remove, get, push, onChildAdded, query as dbQuery, orderByKey, limitToLast, endAt } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
import config from '../../Helper/Environment';
import { CHANNELS } from '../chatChannels';
import PetModal from '../PrivateChat/PetsModel';
import { seedCurrentUser } from '../../Helper/profileCache';
import { syncMyCosmetics } from '../../Helper/cosmeticsCache';
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');





const CHANNEL_STORAGE_KEY = 'preferred_chat_lang';
const channelStorage = createMMKV();

const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, fetchChats, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }) => {
  const { user, theme, appdatabase, setUser, isAdmin, currentUserEmail, strikeInfo, isUserBlocked } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // Store the selected user's details
  const [isOnline, setIsOnline] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const [signinMessage, setSigninMessage] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t, i18n } = useTranslation();

  // Seed MY OWN profile + refresh my equipped cosmetics.
  // Public-chat messages are slim (no frame / text colour in the payload), so
  // the row renderer reads them from the profile cache. warmProfileCache skips
  // the current user by design, which is why the signed-in user's own frame
  // and chat text colour never rendered on their own messages.
  // Deps deliberately narrow — see GroupChatScreen for the same reasoning.
  useEffect(() => {
    if (!user?.id) return;
    seedCurrentUser(user, localState, appdatabase);
    if (appdatabase) syncMyCosmetics(appdatabase, user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.avatar, appdatabase]);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isFocused = useIsFocused();
  const [petModalVisible, setPetModalVisible] = useState(false);
const [selectedFruits, setSelectedFruits] = useState([]); 
const [device, setDevice] = useState(null)
const [selectedEmoji, setSelectedEmoji] = useState(null);
const bannerBottomPos = 0; // tab bar is docked (in layout flow), so screen bottom == tab bar top; banner sits flush above it
const [bannerHeight, setBannerHeight] = useState(0); // measured, 0 when no ad is on screen

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);

  const flatListRef = useRef();

  // Refs mirror isAtBottom + bannedUsers so the realtime onChildAdded listener
  // can read the latest values WITHOUT listing them as deps — otherwise the
  // listener tore down and re-attached (re-reading the last message) on every
  // scroll toggle and every banned-list change.
  const isAtBottomRef = useRef(isAtBottom);
  const bannedUsersRef = useRef(bannedUsers);
  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { bannedUsersRef.current = bannedUsers; }, [bannedUsers]);

  // console.log(selectedUser)

  useEffect(() => {
    if (isAtBottom && pendingMessages.length > 0) {
      // console.log("✅ User scrolled to bottom. Releasing held messages...");
      // A held message can also arrive via a page load while it waits here.
      setMessages((prev) => {
        const seen = new Set(prev.map((msg) => msg?.id).filter(Boolean));
        return [...pendingMessages.filter((msg) => !seen.has(msg?.id)), ...prev];
      });
      setPendingMessages([]); // Clear the queue
    }
  }, [isAtBottom, pendingMessages]);


  const INITIAL_PAGE_SIZE = 5; // ✅ Initial load: 5 messages
  const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch

  const navigation = useNavigation()
// ✅ Memoize openProfileDrawer
const openProfileDrawer = useCallback(async (userData) => {
  if (!userData || !userData.senderId) return;

  setSelectedUser(userData);
  setIsDrawerVisible(true);

  try {
    const online = await isUserOnline(userData.senderId);
    setIsOnline(online);
  } catch (error) {
    console.error('🔥 Error checking online status:', error);
    setIsOnline(false);
  }
}, []);

// ✅ Memoize closeProfileDrawer
const closeProfileDrawer = useCallback(() => {
  setIsDrawerVisible(false);
}, []);

// ✅ Memoize toggleDrawer
const toggleDrawer = useCallback(async (userData = null) => {
  setSelectedUser(userData);
  setIsDrawerVisible((prev) => !prev);

  if (userData?.senderId) {
    try {
      const online = await isUserOnline(userData.senderId);
      setIsOnline(online);
    } catch (error) {
      console.error("🔥 Error checking online status:", error);
      setIsOnline(false);
    }
  } else {
    setIsOnline(false);
  }
}, []);

// ✅ Memoize startPrivateChat
const startPrivateChat = useCallback(() => {
  const callbackfunction = () => {
    closeProfileDrawer();
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('PrivateChat', { selectedUser, selectedTheme });
    }
  };
  callbackfunction();
}, [selectedUser, selectedTheme, closeProfileDrawer]);

  // Preferred channel, remembered across launches. Falls back to the app's
  // own language, then English — so a Spanish-speaking user lands in the
  // Spanish room without hunting for it.
  const [activeChannel, setActiveChannel] = useState(() => {
    try {
      const savedId = channelStorage.getString(CHANNEL_STORAGE_KEY);
      if (savedId) {
        const found = CHANNELS.find((c) => c.id === savedId);
        if (found) return found;
      }
    } catch (e) { /* storage unavailable — fall through to the language match */ }
    const lang = (i18n?.language || 'en').split('-')[0];
    return CHANNELS.find((c) => c.id === lang) || CHANNELS[0];
  });

  // Preferred channel first, the rest in declared order.
  const orderedChannels = useMemo(() => {
    const idx = CHANNELS.findIndex((c) => c.id === activeChannel.id);
    if (idx <= 0) return CHANNELS;
    return [CHANNELS[idx], ...CHANNELS.slice(0, idx), ...CHANNELS.slice(idx + 1)];
  }, [activeChannel.id]);

  // Switching rooms must drop the old room's messages. Without the reset the
  // new channel's first page appends underneath the previous language's
  // backlog, and the pagination cursor keeps paging the old node.
  const handleChannelSwitch = useCallback((channel) => {
    if (!channel || channel.id === activeChannel.id) return;
    triggerHapticFeedback('impactLight');
    try {
      channelStorage.set(CHANNEL_STORAGE_KEY, channel.id);
    } catch (e) { /* preference is a convenience; never block the switch */ }
    setActiveChannel(channel);
    setMessages([]);
    setPendingMessages([]);
    setLastLoadedKey(null);
    setReplyTo(null);
    setInput('');
  }, [activeChannel.id, triggerHapticFeedback]);

  // Everything downstream already depends on chatRef — loadMessages, the
  // onChildAdded subscription and the send handler all list it in their deps —
  // so switching channels re-points the listeners without further wiring.
  const chatRef = useMemo(
    () => ref(appdatabase, activeChannel.path),
    [appdatabase, activeChannel.path],
  );

  // A page request that resolves after a channel switch belongs to the old
  // room; compare against the live ref and drop it. The in-flight flag stops
  // onEndReached (which fires repeatedly) from requesting the same page twice.
  // Same fix as FischValues (2026-09-23).
  const currentChatRef = useRef(chatRef);
  currentChatRef.current = chatRef;
  const loadingMoreRef = useRef(false);
  // Bumped by every reset, so a load-more page that resolves after one (pull
  // to refresh, channel switch) cannot append old-cursor rows to the new list.
  const resetGenRef = useRef(0);
  const resetsInFlightRef = useRef(0);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  // const isAdmin = user?.admin || false;
  // const isOwner = user?.owner || false;
  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);




  const validateMessage = useCallback((message) => {
    const text = (message?.text ?? "").toString();
    const trimmed = text.trim();
  
    const hasFruits = Array.isArray(message?.fruits) && message.fruits.length > 0;
    const hasGif = !!message?.gif;
  
    const hasContent = trimmed.length > 0 || hasFruits || hasGif;
  
    return {
      ...message,
      sender: (message?.sender ?? "Anonymous").toString().trim() || "Anonymous",
      text: trimmed, // keep trimmed text, but don't force empty for fruits-only
      // ✅ do NOT invent fake timestamps
      timestamp:
        typeof message?.timestamp === "number"
          ? message.timestamp
          : Date.now(), // fallback only if missing
      // Optional: if message is truly empty (shouldn't exist), mark it
      _invalid: !hasContent,
    };
  }, []);
  

  const loadMessages = useCallback(
    async (reset = false) => {
      // Guard OUTSIDE the try: an early return inside it would run `finally`
      // and clear the flag that the in-flight request still owns.
      if (!reset) {
        if (loadingMoreRef.current || resetsInFlightRef.current > 0) return;
        loadingMoreRef.current = true;
      } else {
        resetsInFlightRef.current += 1;
      }
      const gen = reset ? ++resetGenRef.current : resetGenRef.current;
      try {
        if (reset) {
          // console.log('Resetting messages and loading the latest ones.');
          setLoading(true);
          setLastLoadedKey(null); // Reset pagination key
        }

        // console.log(`Fetching messages. Reset: ${reset}, LastLoadedKey: ${lastLoadedKey}`);

        const requestRef = chatRef;

        // ✅ Use INITIAL_PAGE_SIZE for first load, PAGE_SIZE for pagination
        //
        // endAt() is INCLUSIVE: a page ending at the cursor re-reads the cursor
        // message, which is already on screen. That was the duplicate bug —
        // every page appended one repeat (React's "two children with the same
        // key"), and in a short room onEndReached kept firing and appended the
        // same message again and again. Fetch one extra and drop the cursor key.
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const messageQuery = reset
          ? dbQuery(chatRef, orderByKey(), limitToLast(limitSize))
          : dbQuery(chatRef, orderByKey(), endAt(lastLoadedKey), limitToLast(limitSize + 1));

        const snapshot = await get(messageQuery);
        if (currentChatRef.current !== requestRef) return; // channel switched mid-request
        if (resetGenRef.current !== gen) return; // a newer reset owns the list now
        const data = snapshot.val() || {};
        if (!reset && lastLoadedKey) delete data[lastLoadedKey];

        // The cursor comes from the RAW keys, before the banned-user filter:
        // push keys sort chronologically, and a page whose oldest rows were
        // all filtered out must still move the cursor past them.
        const rawKeys = Object.keys(data).sort();
        const oldestKey = rawKeys.length > 0 ? rawKeys[0] : null;

        // if (developmentMode) {
        //   const dataSize = JSON.stringify(data).length / 1024;
        //   console.log(`🚀 Downloaded group chat data: ${dataSize.toFixed(2)} KB from load messages`);
        // }

        // console.log(`Fetched ${Object.keys(data).length} messages from Firebase.`);

        // const bannedUserIds = bannedUsers?.map((user) => user.id) || [];
        // console.log('Banned User IDs:', bannedUserIds);

        // ✅ Safety check for bannedUsers array
        const bannedIds = Array.isArray(bannedUsers)
        ? bannedUsers.map(u => (typeof u === "string" ? u : u?.id)).filter(Boolean)
        : [];
                const parsedMessages = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId)).sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  
        // console.log('Parsed Messages:', parsedMessages);

        if (!oldestKey && !reset) {
          // console.log('No more messages to load.');
          setLastLoadedKey(null);
          return;
        }

        if (reset) {
          setMessages(parsedMessages);
          // console.log('Resetting messages:', parsedMessages);
        } else {
          // Merge by id: the realtime listener may already hold some of these rows.
          setMessages((prev) => {
            const seen = new Set(prev.map((msg) => msg?.id).filter(Boolean));
            return [...prev, ...parsedMessages.filter((msg) => !seen.has(msg.id))];
          });
          // console.log('Appending messages:', parsedMessages);
        }

        // A page shorter than its limit reached the start of the room: there is
        // nothing older, so stop paging instead of re-querying forever.
        const reachedStart = rawKeys.length < limitSize;
        setLastLoadedKey(reachedStart ? null : oldestKey);
      } catch (error) {
        // console.error('Error loading messages:', error);
      } finally {
        if (reset) {
          resetsInFlightRef.current = Math.max(0, resetsInFlightRef.current - 1);
          // Only the last reset standing hides the spinner: an older one that
          // was superseded (channel switch) must not reveal a half-loaded room.
          if (resetsInFlightRef.current === 0) setLoading(false);
        } else {
          loadingMoreRef.current = false;
        }
      }
    },
    [chatRef, lastLoadedKey, validateMessage, bannedUsers, appdatabase]
  );
  useEffect(() => {
    if (!pinnedMessagesRef) return;

    const fetchPinnedMessages = async () => {
      try {
        const snapshot = await get(pinnedMessagesRef);
        const pinnedMessagesData = snapshot.val() || {};
  
        // ✅ Safety check and transform data into an array
        const pinnedMessagesArray = Object.entries(pinnedMessagesData)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return {
              firebaseKey: key,
              ...value,
            };
          })
          .filter(Boolean);
  
        setPinnedMessages(pinnedMessagesArray);
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };
  
    fetchPinnedMessages();  // Fetch pinned messages initially
  
    // Listen to real-time updates on pinned messages
    const unsubPinned = onChildAdded(pinnedMessagesRef, (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;
      const newPinnedMessage = { firebaseKey: snapshot.key, ...data };
      setPinnedMessages((prev) => {
        // ✅ Prevent duplicates
        const exists = prev.some(msg => msg.firebaseKey === snapshot.key);
        return exists ? prev : [...prev, newPinnedMessage];
      });
    });
  
    return () => {
      unsubPinned();
    };
  }, []);
  
  useEffect(() => {
    const platform = Platform.OS; // "ios" or "android"
  
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(platform);
  }, [ setChatFocused]);

  // Reset and load the latest messages — on mount AND on every channel
  // switch. This used to run on mount only, so a switched-to room showed
  // nothing but the one message the realtime listener delivers, with
  // pagination dead (no cursor) until a pull-to-refresh.
  useEffect(() => {
    loadMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRef]);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  useEffect(() => {
    if (!isFocused || !chatRef) return;

    const unsubChat = onChildAdded(dbQuery(chatRef, limitToLast(1)), (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;

      const newMessage = validateMessage({ id: snapshot.key, ...data });
      if (!newMessage || !newMessage.id) return;

      // ✅ Check if message is from banned user
      const banned = Array.isArray(bannedUsersRef.current) ? bannedUsersRef.current : [];
      if (banned.includes(newMessage.senderId)) return;

      setMessages((prev) => {
        if (!Array.isArray(prev)) return [newMessage];
        const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
        if (seenKeys.has(newMessage.id)) return prev;

        if (isAtBottomRef.current) {
          // Insert immediately
          // console.log("📥 User is at bottom, adding message now");
          return [newMessage, ...prev];
        } else {
          // Hold in pending
          // console.log("⏳ Holding new message, user not at bottom");
          setPendingMessages((prevPending) => {
            const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
            if (pendingIds.has(newMessage.id)) return prevPending;
            return [newMessage, ...prevPending];
          });
          return prev;
        }
      });
    });

    return () => {
      unsubChat();
    };
    // isAtBottom + bannedUsers read via refs (above) so the listener attaches
    // once per focus, not on every scroll toggle / banned-list change.
  }, [chatRef, validateMessage, isFocused]);





  const handleLoadMore = useCallback(async () => {
    // ✅ Fixed: use && instead of &
    if (!user?.id && !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: t('stock.ok'), onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true);
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {
      // console.log('No more messages to load or currently loading.');
    }
  }, [user?.id, signinMessage, loading, lastLoadedKey, loadMessages, t]);




  const handlePinMessage = async (message) => {
    try {
      // A message from an older build still carries currentUserEmail, and
      // pin_messages is public-read too — never copy it into a pin.
      const { currentUserEmail: _senderEmail, ...publicFields } = message || {};
      const pinnedMessage = { ...publicFields, pinnedAt: Date.now() };
      const newRef = await push(pinnedMessagesRef, pinnedMessage);
  
      // Use the Firebase key for tracking the message
      setPinnedMessages((prev) => [
        ...prev,
        { firebaseKey: newRef.key, ...pinnedMessage },
      ]);
    } catch (error) {
      console.error('Error pinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not pin the message. Please try again.');
    }
  };
  


  const unpinSingleMessage = async (firebaseKey) => {
    try {
      const messageRef = ref(appdatabase, `pin_messages/${firebaseKey}`);
      await remove(messageRef);  // Remove from Firebase
  
      // Update local state by filtering out the removed message
      setPinnedMessages((prev) => {
        const updatedMessages = prev.filter((msg) => msg.firebaseKey !== firebaseKey);
        return updatedMessages;
      });
    } catch (error) {
      console.error('Error unpinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not unpin the message. Please try again.');
    }
  };
  




  const clearAllPinnedMessages = async () => {
    try {
      await remove(pinnedMessagesRef);
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), 'Could not clear pinned messages. Please try again.');
    }
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };



  // Ban state comes from GlobelStats now — one listener for the whole app,
  // validated against server time. The private copy that used to live here
  // duplicated the read and compared against the device clock.


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
    // fetchChats()
  };

  // expects to be called like:
// await handleSendMessage(replyTo, trimmedInput, fruits);

const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
  const hasEmoji  = !!emojiUrl;

  // console.log(emojiUrl)
  const hasFruits = Array.isArray(fruits) && fruits.length > 0;

  const MAX_CHARACTERS = 250;
  // Staff write the pinned announcements, which run long. They get a word
  // budget instead of the 250-char cap; the char ceiling only stops a
  // pasted blob with no spaces from counting as one word.
  const MOD_MAX_WORDS = 300;
  const MOD_MAX_CHARACTERS = 2000;
  const isStaffSender = !!isAdmin || !!user?.isModerator;
  const MESSAGE_COOLDOWN = 100; // ms
  const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag

  // Must be logged in
  if (!user?.id || !currentUserEmail) {
    showMessage({
      message: t('chat.sign_in_required_title'),
      description: t('chat.must_sign_in_to_send'),
      type: 'danger',
    });
    return;
  }

  // ---- Strike / ban checks ----
  // isUserBlocked is the authoritative gate: GlobelStats validates the ban
  // against a server-time probe, so a user who rolls their device clock
  // forward is still stopped here. The block below only formats the message.
  if (isUserBlocked) {
    showMessage({
      message: t('chat.access_denied', { defaultValue: 'Access Denied' }),
      description: t('chat.banned_message', { defaultValue: 'You are banned from sending messages.' }),
      type: 'danger',
    });
    return;
  }

  if (strikeInfo) {
    const { strikeCount, bannedUntil } = strikeInfo;
    const now = serverNowMs();

    // Permanent ban
    if (bannedUntil === 'permanent') {
      showMessage({
        message: t('feed.permanently_banned'),
        description: t('feed.banned_msg'),
        type: 'danger',
      });
      return;
    }

    // Temporary ban (timestamp in ms)
    if (typeof bannedUntil === 'number' && now < bannedUntil) {
      const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      showMessage({
        message: t('chat.strike_title', { strike: strikeCount }),
        description: hours > 0
          ? t('chat.strike_ban_hours', { hours, minutes })
          : t('chat.strike_ban_minutes', { count: minutes }),
        type: 'warning',
        duration: 5000,
      });
      return;
    }
  }

  // Use the argument, not external state
  const trimmedInput = (trimmedInputArg || '').trim();

  // ✅ Validate fruits count - maximum 18 fruits allowed
  if (hasFruits && fruits.length > 18) {
    Alert.alert(t('home.alert.error'), t('group_chat.limit_pets'));
    return;
  }

  // Disallow empty text + no fruits
  if (!trimmedInput && !hasFruits && !emojiUrl) {
    Alert.alert(t('home.alert.error'), t('chat.cannot_empty'));
    return;
  }

  // Profanity check
  if (trimmedInput && leoProfanity.check(trimmedInput)) {
    Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
    return;
  }

  // Length check
  if (isStaffSender) {
    const wordCount = trimmedInput ? trimmedInput.split(/\s+/).length : 0;
    if (wordCount > MOD_MAX_WORDS || trimmedInput.length > MOD_MAX_CHARACTERS) {
      Alert.alert(t('home.alert.error'), t('misc.messageTooLongWords', { max: MOD_MAX_WORDS }));
      return;
    }
  } else if (trimmedInput.length > MAX_CHARACTERS) {
    Alert.alert(t('home.alert.error'), t('misc.messageTooLong', { max: MAX_CHARACTERS }));
    return;
  }

  // Cooldown check
  if (isCooldown) {
    Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
    return;
  }

  // ✅ Duplicate message check - prevent copy-paste spam (no Firebase cost, client-side only)
  const currentMessage = {
    text: trimmedInput,
    fruits: hasFruits ? JSON.stringify(fruits.sort((a, b) => (a?.id || '').localeCompare(b?.id || ''))) : null,
    emoji: emojiUrl || null,
  };
  
  if (lastSentMessageRef.current) {
    const lastMessage = lastSentMessageRef.current;
    const isDuplicate = 
      lastMessage.text === currentMessage.text &&
      lastMessage.fruits === currentMessage.fruits &&
      lastMessage.emoji === currentMessage.emoji;
    
    if (isDuplicate) {
      Alert.alert(
        t('home.alert.error'),
        t('chat.duplicate_message'),
      );
      return;
    }
  }

  // Link check (only for non-pro & non-admin)
  const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;
  if (containsLink && !localState?.isPro && !isAdmin) {
    Alert.alert(t('home.alert.error'), t('misc.proUsersOnlyLinks'));
    return;
  }

  try {
    // ✅ Use chatRef instead of creating new ref
    if (!chatRef) {
      console.error('❌ Chat ref not available');
      return;
    }

    // Push to Firebase Realtime Database
    const now = Date.now();
    const hasRecentWin =
      typeof user?.lastGameWinAt === 'number' &&
      now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

    await push(chatRef, {
      text: trimmedInput || null, // allow fruits-only messages
      timestamp: database.ServerValue.TIMESTAMP,
      sender: user.displayName || 'Anonymous',
      senderId: user.id,
      avatar:
        user.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      replyTo: replyToArg
        ? { id: replyToArg.id, text: replyToArg.text }
        : null,
      reportCount: 0,
      containsLink,
      isPro: !!localState?.isPro,
      isAdmin: !!isAdmin,
      strikeCount: strikeInfo?.strikeCount ?? null,
      // No `currentUserEmail` any more: every room is public-read, signed out
      // included, so it published each sender's email. Staff moderation
      // resolves the email from users_private (Helper/privateProfile.js).
      fruits: hasFruits ? fruits : [],
      gif: hasEmoji ? emojiUrl : null,
      flage: user.flage ? user.flage : null,
      OS: Platform.OS, // ✅ Store platform (Android/iOS) - only visible to admins
      robloxUsername: user?.robloxUsername || null,
      robloxUsernameVerified: user?.robloxUsernameVerified || false,
      robloxUserId: user?.robloxUserId || null, // ✅ Store userId for profile link
      hasRecentGameWin: hasRecentWin,
      lastGameWinAt: user?.lastGameWinAt || null,
    });

    // ✅ Store last sent message to prevent duplicates (session-based, no Firebase cost)
    lastSentMessageRef.current = currentMessage;

    // Reset local input state
    setInput('');
    setReplyTo(null);

    // Start cooldown
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);
  } catch (error) {
    console.error('Error sending message:', error);
    Alert.alert(
      t('home.alert.error'),
      t('group_chat.could_not_send'),
    );
  }
};


  // console.log(isPro)
  return (
    <>
      <GestureHandlerRootView>
        {/* Language channels. Each is a separate RTDB node; see CHANNELS. */}
        <ScrollView
          horizontal
          style={channelTabStyles.scroller}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={channelTabStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {orderedChannels.map((channel) => {
            const isActive = channel.id === activeChannel.id;
            return (
              <TouchableOpacity
                key={channel.id}
                style={[
                  channelTabStyles.pill,
                  isActive
                    ? { backgroundColor: config.colors.primary, borderColor: config.colors.primary }
                    : { backgroundColor: 'transparent', borderColor: theme === 'dark' ? '#444' : '#ccc' },
                ]}
                onPress={() => handleChannelSwitch(channel)}
                activeOpacity={0.8}
              >
                <Text style={channelTabStyles.pillFlag}>{channel.flag}</Text>
                <Text
                  numberOfLines={1}
                  style={[
                    channelTabStyles.pillText,
                    { color: isActive ? '#fff' : (theme === 'dark' ? '#aaa' : '#666') },
                    isActive && channelTabStyles.pillTextActive,
                  ]}
                >
                  {channel.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.container}>
          <ChatHeaderContent
            pinnedMessages={pinnedMessages}
            onUnpinMessage={unpinSingleMessage}
            selectedTheme={selectedTheme}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            onlineUsersVisible={onlineUsersVisible}
            setOnlineUsersVisible={setOnlineUsersVisible}
          />

          <ConditionalKeyboardWrapper style={{ flex: 1 }} chatscreen={true}>
            {loading ? (
              <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
            ) : (
              <MessagesList
                channelPath={activeChannel.path}
                messages={messages}
                user={user}
                flatListRef={flatListRef}
                isDarkMode={theme === 'dark'}
                onPinMessage={handlePinMessage}
                onDeleteMessage={(messageId) => remove(ref(
                  appdatabase,
                  // The id is prefixed with the node it came from, so strip
                  // whichever channel is active rather than assuming chat_new.
                  `${activeChannel.path}/${messageId.replace(`${activeChannel.path}-`, '')}`,
                ))}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId)}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                banUser={banUser}
                // makeadmin={makeAdmin}
                // onReport={onReport}
                // removeAdmin={removeAdmin}
                unbanUser={unbanUser}
                // isOwner={isOwner}
                isAtBottom={isAtBottom}
                setIsAtBottom={setIsAtBottom}
                // toggleDrawer={toggleDrawer}
                setMessages={setMessages}
                isAdmin={isAdmin}
                toggleDrawer={openProfileDrawer}
                
              />
            )}
            <View style={{ backgroundColor: theme === 'dark' ? config.colors.backgroundDark : config.colors.backgroundLight }}>
              {user.id ? (
                <MessageInput
                  input={input}
                  setInput={setInput}
                  handleSendMessage={handleSendMessage}
                  selectedTheme={selectedTheme}
                  replyTo={replyTo} // Pass reply context to MessageInput
                  onCancelReply={() => setReplyTo(null)} // Clear reply context
                  petModalVisible={petModalVisible}
                  setPetModalVisible={setPetModalVisible}
                  selectedFruits={selectedFruits}
                  setSelectedFruits={setSelectedFruits}
                  selectedEmoji={selectedEmoji}
                  setSelectedEmoji={setSelectedEmoji}
                />
              ) : (
                <TouchableOpacity
                  style={styles.login}
                  onPress={() => {
                    setIsSigninDrawerVisible(true); triggerHapticFeedback('impactLight');
                  }}
                >
                  <Text style={styles.loginText}>{t('misc.loginToStartChat')}</Text>
                </TouchableOpacity>
                
              )}
            </View>
             <PetModal
               fromChat={true}
      visible={petModalVisible}
      onClose={() => setPetModalVisible(false)}
        selectedFruits={selectedFruits}
        setSelectedFruits={setSelectedFruits}



      
    />
          </ConditionalKeyboardWrapper>

          {/* Spacer: reserves room for the absolutely-positioned banner, and
              ONLY when a banner is actually on screen. On a no-fill (or for a
              Pro member) the banner occupies nothing and the tab bar is docked
              in the layout flow, so anything reserved here is dead space
              between the message input and the tab bar. */}
          <View style={{ height: bannerHeight ? bannerBottomPos + bannerHeight : 0 }} />

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            message={t('misc.loginRequired')}
            screen='Chat'

          />
        </View>
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={startPrivateChat}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />
      </GestureHandlerRootView>
      {!localState.isPro && (
        <View style={{ position: 'absolute', bottom: bannerBottomPos, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
          <BannerAdComponent onHeightChange={setBannerHeight} />
        </View>
      )}
    </>
  );
};

export default ChatScreen;

const channelTabStyles = RNStyleSheet.create({
  scroller: {
    maxHeight: Platform.OS === 'ios' ? 50 : 38,
    flexGrow: 0,
    // Breathing room between the nav header and the pills. Kept as a margin,
    // not padding on scrollContent: padding would come out of maxHeight and
    // squeeze the pills instead of moving them down.
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillFlag: { fontSize: 13, marginRight: 5 },
  pillText: { fontSize: 10.5, fontWeight: '500' },
  pillTextActive: { fontWeight: '700' },
});
