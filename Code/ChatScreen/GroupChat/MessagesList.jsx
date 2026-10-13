import React, { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Vibration,
  Image,
  Alert,
  Keyboard,
  StyleSheet,
  Animated,
} from 'react-native';
import { getStyles } from './../Style';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import ReportPopup from './../ReportPopUp';
import { parseMessageText } from '../ChatHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { FLOATING_BUTTON_ICON_SIZE } from '../../Helper/floatingButtonLayout';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import FramedAvatar from './FramedAvatar';
import { resolveProfile, warmProfileCache, getCachedProfile } from '../../Helper/profileCache';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import axios from 'axios';
import { useLocalState } from '../../LocalGlobelStats';
import { getDeviceLanguage } from '../../../i18n';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import { banUserwithEmail, unbanUserWithEmail } from '../utils';
import { getUserEmail } from '../../Helper/privateProfile';
import { sourceLabelForItems } from '../../Helper/valueSources';
import { getUserRoles, useRoleRosterVersion } from '../../Helper/roleRoster';

// Reply preview text for a quoted message. Module-level so the memoised row
// can call it with its own `t`.
const getReplyPreview = (replyTo, t) => {
  if (!replyTo || typeof replyTo !== 'object') return t('chat.reply_deleted');

  if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
    return replyTo.text;
  }

  if (replyTo.gif) {
    return t('chat.reply_emoji');
  }

  if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
    const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
    return count > 0
      ? t('chat.reply_items', { count })
      : t('chat.reply_items_message');
  }

  return t('chat.reply_deleted');
};

// One public-chat message. Memoised, so a new message re-renders only the
// rows whose props changed (the new one, and the row whose date header
// moved) instead of every row on screen. All props are primitives or
// stable objects: `actions` never changes identity (it calls through a ref),
// and styles / fruitColors / t change only with theme or language.
// profileCacheVersion and roleRosterVersion are not read here; they are
// props so the memo lets a row repaint when the profile cache (frames, text
// colour) or the role rosters (badges) land, since both are module caches.
const MessageRow = memo(function MessageRow(props) {
  const {
    item, showDateHeader, isHighlighted, userId, isAdmin, isDarkMode,
    styles, fruitColors, t, language, actions,
  } = props;

  // Cosmetics (frame, chat text colour) for this message's sender. Messages
  // are slim, so this comes from the profile cache — warmed by MessagesList
  // for other users, and seeded for the signed-in user by Trader.jsx.
  const msgProfile = resolveProfile(item) || {};

  const fruits = Array.isArray(item.fruits) ? item.fruits : [];
  const hasFruits = fruits.length > 0;
  const totalFruitValue = hasFruits
    ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
    : 0;

  // Winner badge info comes directly from message payload, similar to isPro / robloxUsernameVerified
  const hasRecentWin =
    !!item?.hasRecentGameWin ||
    (typeof item?.lastGameWinAt === 'number' &&
      Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);

  return (
    <View>
      {/* Display the date header if it's a new day */}
      {showDateHeader && (
        <View>
          {/* currentDate (toDateString) stays the comparison key; the label
              is formatted in the app language. */}
          <Text style={styles.dateSeparator}>
            {new Date(item.timestamp).toLocaleDateString(language, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
      )}

      {/* Render the message */}
      {!item.isReportedByUser && (
        <View
        style={[
          item.senderId === userId ? styles.mymessageBubble : styles.othermessageBubble,
          item.senderId === userId ? styles.myMessage : styles.otherMessage, item.isReportedByUser && styles.reportedMessage,
          isHighlighted && styles.highlightedMessage, // 👈 NEW
          { width: '100%' } // Force full width so the right-aligned dots reach the screen edge
        ]}
      >
        <View
          style={[
            styles.senderName,
          ]}
        >

          <TouchableOpacity onPress={() => actions.profileClick(item)}>
            <FramedAvatar
              avatarUri={item.avatar || msgProfile.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={msgProfile.profileFrame || null}
              isDarkMode={isDarkMode}
              avatarSize={28}
              forceDetail
            />
          </TouchableOpacity>

        </View>

        <View style={styles.messageTextBox}>
          {/* Render reply context if present */}
          {item.replyTo && (
<TouchableOpacity
  style={styles.replyContainer}
  activeOpacity={0.7}
  onPress={() => actions.scrollToMessage(item.replyTo.id)}
>
  <Text style={styles.replyText} numberOfLines={2}>
    {t('chat.replying_to_preview', { text: getReplyPreview(item.replyTo, t) })}
  </Text>
</TouchableOpacity>
)}


          {/* Render main message */}

          <Menu>
            <MenuTrigger
              onLongPress={() => actions.longPress(item)}
              customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
            >
              
              <View style={[
                item.senderId === userId ? styles.myBubbleContent : styles.otherBubbleContent,
                item.isReportedByUser && styles.reportedMessage,
                isAdmin && item.strikeCount === 1 ? { backgroundColor: 'rgba(255, 192, 203, 0.8)' } : null,
                isAdmin && item.strikeCount >= 2 ? { backgroundColor: 'rgba(255, 0, 0, 0.8)' } : null,
              ]}>

                <View style={styles.bubbleInner}>
                 <View style={styles.nameRow}>
          <Text style={item.senderId === userId ? styles.userNameTextMy : styles.userNameText}>{item.sender}</Text>

{item?.isPro && (
  <Image resizeMethod="resize"
    source={require('../../../assets/pro.png')}
    style={styles.icon}
  />
)}

{/* Role pills from the roster (Code/Helper/roleRoster.js), not from
    flags on the message: chat_new is open to any write, so a stamped
    isAdmin / isModerator could be faked by anyone. */}
{(() => {
  const roles = getUserRoles(item.senderId);
  const firstBadge = getFirstBadgeType(roles);
  return (
    <>
      {roles.isAdmin && (
        <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} labelOverride={t('chat.admin')} glow={firstBadge === 'admin'} />
      )}
      {!roles.isAdmin && roles.isModerator && (
        <UserBadgePill type="mod" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'mod'} />
      )}
      {!roles.isAdmin && !roles.isModerator && roles.isBabyMod && (
        <UserBadgePill type="jmd" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'jmd'} />
      )}
      {roles.isTrusted && (
        <UserBadgePill type="trusted" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'trusted'} />
      )}
      {roles.isCMSR && (
        <UserBadgePill type="cmsr" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'cmsr'} />
      )}
      {roles.isHelper && (
        <UserBadgePill type="helper" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'helper'} />
      )}
    </>
  );
})()}

{item?.robloxUsernameVerified && (
  <Image resizeMethod="resize"
    source={require('../../../assets/verification.png')}
    style={styles.icon}
  />
)}

{hasRecentWin && (
  <Image resizeMethod="resize"
    source={require('../../../assets/trophy.webp')}
    style={{  width: 10,
      height: 10,
      marginLeft: 4,}}
  />
)}

{isAdmin && item.OS && (
  <View
    style={[
      styles.platformBadge,
    ]}
  >
    <Icon
      name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
      size={14}
      color={item.OS === 'ios' ? '#007AFF' : '#34C759' }
    />
  </View>
)}
</View>


                
                    {item.gif && (
                      <View>
                        <Image resizeMethod="resize" 
                          source={{ uri: item.gif }} 
                          style={{ height: 50, width: 50, resizeMode: 'contain' }} 
                        />
                      </View>
                    )}
                  {item?.text && (
                    isMultiColorText(msgProfile.chatTextColor)
                      ? <RainbowText
                          colors={getMultiColorPalette(msgProfile.chatTextColor)}
                          style={[item.senderId === userId ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                        >{item.text}</RainbowText>
                      : <Text style={[
                          item.senderId === userId ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                          msgProfile.chatTextColor ? { color: getSafeTextColor(msgProfile.chatTextColor, null) } : null,
                        ]}>
                          {parseMessageText(item.text)}
                        </Text>
                  )}

                {/* Timestamp inside bubble — WhatsApp style */}
                <Text style={{
                  fontSize: 9,
                  color: item.senderId === userId
                    ? (isDarkMode ? '#ffffffaa' : '#00000066')
                    : (isDarkMode ? '#ffffff77' : '#00000055'),
                  alignSelf: 'flex-end',
                  marginTop: 2,
                }}>
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                </View>
              </View>
              {hasFruits && (
<View
  style={[
    fruitStyles.fruitsWrapper,
    { backgroundColor: fruitColors.wrapperBg },
  ]}
>
  {fruits.map((fruit, index) => {
    return (
      <View
        key={`${fruit.id || fruit.name}-${index}`}
        style={fruitStyles.fruitCard}
      >
        <Image resizeMethod="resize"
          source={{ uri: fruit.imageUrl }}
          style={fruitStyles.fruitImage}
        />

        <View style={fruitStyles.fruitInfo}>
          <Text
            style={[fruitStyles.fruitName, { color: fruitColors.name }]}
            numberOfLines={1}
          >
            {`${fruit.name || fruit.Name}  `}
          </Text>

          <Text
            style={[fruitStyles.fruitValue, { color: fruitColors.value }]}
          >
            {t('chat.item_value', { value: Number(fruit.value || 0).toLocaleString() })}
            {/* {fruit.category
              ? `  ·  ${String(fruit.category).toUpperCase()}  `
              : ''} */}{' '}
          </Text>

          <View style={fruitStyles.badgeRow}>
            {/* D / N / M badge */}
            {/* Fly badge */}
            {fruit.isFly && (
              <View style={[fruitStyles.badge, fruitStyles.badgeFly]}>
                <Text style={fruitStyles.badgeText}>F</Text>
              </View>
            )}

            {/* Ride badge */}
            {fruit.isRide && (
              <View style={[fruitStyles.badge, fruitStyles.badgeRide]}>
                <Text style={fruitStyles.badgeText}>R</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  })}

  {/* ✅ Total row – only if more than one fruit */}
  {fruits.length > 1 && (
    <View
      style={[
        fruitStyles.totalRow,
        { borderTopColor: fruitColors.divider },
      ]}
    >
      <Text
        style={[fruitStyles.totalLabel, { color: fruitColors.totalLabel }]}
      >
        {t('private_chat.total_value')}
      </Text>
      <Text
        style={[fruitStyles.totalValue, { color: fruitColors.totalValue }]}
      >
        {totalFruitValue.toLocaleString()}
      </Text>
    </View>
  )}

  {/* Which catalogue priced this list. Replaces a 'D' badge that
      was an Adopt Me leftover (Default/Neon/Mega) — MM2 has no such
      variants, so it rendered 'D' on every item and meant nothing.
      The two catalogues disagree on 70% of the items they share, so
      a reader needs to know which one these numbers came from. */}
  <Text style={fruitStyles.sourceNote}>
    {t('chat.based_on_values', { source: sourceLabelForItems(fruits) })}
  </Text>
</View>
)}
            </MenuTrigger>
          <MenuOptions customStyles={{
              optionsContainer: styles.menuoptions,
              optionWrapper: styles.menuOption,
              optionText: styles.menuOptionText,
            }}>
              <MenuOption onSelect={() => actions.copy(item)}>
                <Text style={styles.menuOptionText}>{t('private_chat.copy')}</Text>
              </MenuOption>
              {userId && (
                <MenuOption onSelect={() => actions.reply(item)}>
                  <Text style={styles.menuOptionText}>{t("chat.reply")}</Text>
                </MenuOption>
              )}
              <MenuOption onSelect={() => actions.translate(item)}>
                <Text style={styles.menuOptionText}>{t('private_chat.translate')}</Text>
              </MenuOption>
              <MenuOption onSelect={() => actions.report(item)}>
                <Text style={styles.menuOptionText}>{t("chat.report")}</Text>
              </MenuOption>
            </MenuOptions>
          </Menu>

          {/* {(item.reportCount > 0 || item.isReportedByUser) && (
            <Text style={styles.reportIcon}>Reported</Text>
          )} */}


        </View>


        {/* Admin Actions or Timestamp */}
        <View style={{ flex: 1, alignItems: item.senderId === userId ? 'flex-start' : 'flex-end', justifyContent: 'center', paddingHorizontal: 4 }}>
          {(!isAdmin && item.senderId === userId) && (
            <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={18}
                  color={isDarkMode ? '#9ca3af' : '#6b7280'}
                />
              </MenuTrigger>
              <MenuOptions customStyles={{
                optionsContainer: styles.menuoptions,
                optionWrapper: styles.menuOption,
                optionText: styles.menuOptionText,
              }}>
                <MenuOption onSelect={() => actions.deleteMessage(item.id)}>
                  <Text style={styles.menuOptionTextDanger}>{t('chat.delete')}</Text>
                </MenuOption>
              </MenuOptions>
            </Menu>
          )}
          {(isAdmin) && (
            <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={18}
                  color={isDarkMode ? '#9ca3af' : '#6b7280'}
                />
              </MenuTrigger>
              <MenuOptions customStyles={{
                optionsContainer: styles.menuoptions,
                optionWrapper: styles.menuOption,
                optionText: styles.menuOptionText,
              }}>
                <MenuOption onSelect={() => actions.deleteMessage(item.id)}>
                  <Text style={styles.menuOptionTextDanger}>Delete</Text>
                </MenuOption>
                <MenuOption onSelect={() => actions.deleteAllMessages(item?.senderId)}>
                  <Text style={styles.menuOptionTextDanger}>Delete All</Text>
                </MenuOption>
                <MenuOption onSelect={() => actions.blockSender(item)}>
                  <Text style={styles.menuOptionTextDanger}>Block</Text>
                </MenuOption>
                <MenuOption onSelect={() => actions.unblockSender(item)}>
                  <Text style={styles.menuOptionText}>Unblock</Text>
                </MenuOption>
                <MenuOption onSelect={() => actions.pinMessage(item)}>
                  <Text style={styles.menuOptionText}>Pin Message</Text>
                </MenuOption>
              </MenuOptions>
            </Menu>
          )}
        </View>
      </View>
      )}
    </View>
  );
});

const MessagesList = ({
  channelPath,
  messages,
  isAtBottom, setIsAtBottom,
  handleLoadMore,
  user,
  isDarkMode,
  onPinMessage,
  onDeleteMessage,
  onReply,
  // isAdmin,
  refreshing,
  flatListRef,
  onRefresh,
  banUser,
  makeadmin,
  removeAdmin,
  unbanUser,
  onUnpinMessage,
  // isOwner,
  toggleDrawer,
  setMessages,
  onDeleteAllMessage,
  handlePinMessage,

}) => {
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const { triggerHapticFeedback } = useHaptic();
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);

  const { t, i18n } = useTranslation();
  const { isAdmin, api, freeTranslation, appdatabase } = useGlobalState();
  const userId = user?.id;

  // ✅ PERF: Hold messages in a ref so the row renderer and scrollToMessage
  // don't depend on the array (a new message no longer re-creates them).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Re-renders rows when the role rosters load or change (badges).
  const roleRosterVersion = useRoleRosterVersion(appdatabase);

  // Warm the profile cache for the senders in view so avatar frames render.
  // Public-chat messages are slim — they carry no cosmetics — so without this
  // resolveProfile has nothing to return. Unique + uncached-only keeps it
  // cheap; bumping the version re-renders rows via the FlatList extraData.
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  useEffect(() => {
    if (!appdatabase || !Array.isArray(messages)) return;
    const senders = [...new Set(messages.map(m => m?.senderId).filter(Boolean))]
      .filter(id => !getCachedProfile(id));
    if (senders.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, senders)
      .then(() => { if (!cancelled) setProfileCacheVersion(v => v + 1); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [messages, appdatabase]);
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('home.alert.success'), t('private_chat.msg_copied'));
  }, [triggerHapticFeedback, t]);
  // useEffect(() => {
  //   if (!messages || messages.length === 0) return;
  //   if (!isAtBottom) return; // only when user is at bottom
  
  //   const newest = messages[0]; // because FlatList is inverted
  //   if (!newest?.id) return;
  
  //   setHighlightedMessageId(newest.id);
  
  //   const timer = setTimeout(() => {
  //     setHighlightedMessageId((current) =>
  //       current === newest.id ? null : current,
  //     );
  //   }, 1500);
  
  //   return () => clearTimeout(timer);
  // }, [messages, isAtBottom]);
  
  

  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;
  
      const list = Array.isArray(messagesRef.current) ? messagesRef.current : [];
      const index = list.findIndex((m) => m.id === targetId);
      if (index === -1) return;
  
      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
  
        // highlight only the scrolled-to message
        setHighlightedMessageId(targetId);
  
        setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        console.log('scrollToIndex error:', e);
      }
    },
    [flatListRef],
  );

  // ✅ Scroll to bottom handler
  const handleScrollToBottom = useCallback(() => {
    if (!flatListRef?.current) return;
    
    triggerHapticFeedback('impactLight');
    
    try {
      // Since FlatList is inverted, index 0 is the bottom (newest message)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtBottom(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtBottom(true);
    }
  }, [flatListRef, triggerHapticFeedback, setIsAtBottom]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtBottom ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtBottom, scrollButtonOpacity]);
  
  
  
  
  
  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? `${config.colors.surfaceDark}55` : '#e5e7eb55',
      name:      isDarkMode ? '#f9fafb' : '#111827',
      value:     isDarkMode ? '#e5e7eb' : '#4b5563',
      divider:   isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel:isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue:isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );
  // ✅ Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);

  // ✅ Memoize translateText
  const translateText = useCallback(async (text, targetLang = deviceLanguage) => {
    if (!text || typeof text !== 'string') return null;

    const placeholders = {};
    let maskedText = text;

    // Step 1: Replace fruit names with placeholders using pre-compiled regex
    fruitRegexPatterns.forEach(({ regex, placeholder, word }) => {
      maskedText = maskedText.replace(regex, placeholder);
      placeholders[placeholder] = word;
    });

    try {
      // Step 2: Send masked text for translation
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2`,
        {},
        {
          params: {
            q: maskedText,
            target: targetLang,
            key: api,
          },
        }
      );

      let translated = response.data.data.translations[0].translatedText;

      // Step 3: Replace placeholders back with original fruit names
      Object.entries(placeholders).forEach(([placeholder, word]) => {
        translated = translated.replace(new RegExp(placeholder, 'g'), word);
      });


      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  }, [fruitRegexPatterns, deviceLanguage, api]);

  // ✅ Memoize handleTranslate
  const handleTranslate = useCallback(async (item) => {
    if (!item || !item.text) {
      Alert.alert(t('chat.error'), t('private_chat.invalid_translate'));
      return;
    }
    const isUnlimited = freeTranslation || localState.isPro;

    if (!isUnlimited && !canTranslate()) {
      Alert.alert(t('private_chat.limit_reached'), t('private_chat.translate_limit'));
      return;
    }

    const translated = await translateText(item.text, deviceLanguage);

    if (translated) {
      if (!isUnlimited) incrementTranslationCount();

      const remaining = isUnlimited
        ? t('private_chat.unlimited')
        : t('chat.translations_remaining', { count: getRemainingTranslationTries() });

      Alert.alert(
        t('private_chat.translated_title'),
        `${translated}\n\n${t('chat.daily_limit_line', { remaining })}${isUnlimited
          ? ''
          : `\n\n🔓 ${t('private_chat.upgrade_pro')}`
        }`
      );
    } else {
      Alert.alert(t('chat.error'), t('private_chat.translate_failed'));
    }
  }, [canTranslate, freeTranslation, localState?.isPro, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage, t]);

  // ✅ Memoize handleLongPress
  const handleLongPress = useCallback((item) => {
    if (!user?.id || !item) return;
    triggerHapticFeedback('impactMedium');
    setSelectedMessage(item);
  }, [user?.id, triggerHapticFeedback]);

  // ✅ Memoize handleReport
  const handleReport = useCallback((message) => {
    if (!message) return;
    triggerHapticFeedback('impactLight');
    setSelectedMessage(message);
    setShowReportPopup(true);
  }, [triggerHapticFeedback]);

  // ✅ Memoize handleReportSuccess
  const handleReportSuccess = useCallback((reportedMessageId) => {
    if (!reportedMessageId) return;
    triggerHapticFeedback('impactLight');
    if (setMessages && typeof setMessages === 'function') {
      setMessages(prevMessages => {
        if (!Array.isArray(prevMessages)) return prevMessages;
        return prevMessages.map(msg =>
          msg?.id === reportedMessageId
            ? { ...msg, isReportedByUser: true }
            : msg
        );
      });
    }
  }, [triggerHapticFeedback, setMessages]);

  // Staff Block / Unblock. Messages no longer carry the sender's email — it
  // was readable by anyone opening the room — so it is resolved from
  // users_private, which only staff can read. Messages sent by older builds
  // still carry currentUserEmail until the cutover scrub; that is the fallback.
  const resolveSenderEmail = useCallback(async (item) => (
    (await getUserEmail(appdatabase, item?.senderId)) || item?.currentUserEmail || null
  ), [appdatabase]);

  const staffActor = useCallback(() => ({
    id: user?.id, displayName: user?.displayName, avatar: user?.avatar,
    role: isAdmin ? 'admin' : (user?.isModerator ? 'moderator' : (user?.isBabyMod ? 'baby_mod' : null)),
  }), [user?.id, user?.displayName, user?.avatar, user?.isModerator, user?.isBabyMod, isAdmin]);

  const handleBlockSender = useCallback(async (item) => {
    const email = await resolveSenderEmail(item);
    if (!email) {
      Alert.alert('No email on record', 'Bans are keyed by email, and this account has none.');
      return;
    }
    banUserwithEmail(
      email, isAdmin, item.senderId,
      { id: item.senderId, displayName: item.sender, avatar: item.avatar },
      staffActor(),
      null, 'group_chat',
    );
  }, [resolveSenderEmail, isAdmin, staffActor]);

  const handleUnblockSender = useCallback(async (item) => {
    const email = await resolveSenderEmail(item);
    if (!email) {
      Alert.alert('No email on record', 'Bans are keyed by email, and this account has none.');
      return;
    }
    unbanUserWithEmail(email, isAdmin, staffActor(), null, 'group_chat');
  }, [resolveSenderEmail, isAdmin, staffActor]);

  // ✅ Memoize handleProfileClick
  const handleProfileClick = useCallback((item) => {
    if (!item || !user?.id) return;
    if (toggleDrawer && typeof toggleDrawer === 'function') {
      toggleDrawer(item);
      triggerHapticFeedback('impactLight');
    }
  }, [user?.id, toggleDrawer, triggerHapticFeedback]);
  // Row callbacks, read through a ref so `rowActions` keeps one identity for
  // the life of the list. Parent props (onReply, onDeleteMessage, ...) and the
  // handlers above can change identity on any render; routing them through
  // the ref means the memoised rows still call the latest version without
  // re-rendering when they change.
  const rowActionsRef = useRef(null);
  rowActionsRef.current = {
    profileClick: handleProfileClick,
    scrollToMessage,
    longPress: handleLongPress,
    copy: handleCopy,
    reply: onReply,
    translate: handleTranslate,
    report: handleReport,
    deleteMessage: onDeleteMessage,
    deleteAllMessages: onDeleteAllMessage,
    blockSender: handleBlockSender,
    unblockSender: handleUnblockSender,
    pinMessage: onPinMessage,
  };
  const rowActions = useMemo(() => {
    const call = (name) => (...args) => rowActionsRef.current?.[name]?.(...args);
    return {
      profileClick: call('profileClick'),
      scrollToMessage: call('scrollToMessage'),
      longPress: call('longPress'),
      copy: call('copy'),
      reply: call('reply'),
      translate: call('translate'),
      report: call('report'),
      deleteMessage: call('deleteMessage'),
      deleteAllMessages: call('deleteAllMessages'),
      blockSender: call('blockSender'),
      unblockSender: call('unblockSender'),
      pinMessage: call('pinMessage'),
    };
  }, []);

  // ✅ PERF: renderMessage reads the array through messagesRef and hands each
  // row only primitives + stable objects, so its identity no longer changes on
  // every incoming message and MessageRow's memo can skip unchanged rows.
  const renderMessage = useCallback(({ item, index }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const previousMessage = messagesRef.current[index + 1];
    const currentDate = item.timestamp ? new Date(item.timestamp).toDateString() : null;
    const previousDate = previousMessage?.timestamp
      ? new Date(previousMessage.timestamp).toDateString()
      : null;
    const showDateHeader = !!currentDate && currentDate !== previousDate;

    return (
      <MessageRow
        item={item}
        showDateHeader={showDateHeader}
        isHighlighted={item.id === highlightedMessageId}
        userId={userId}
        isAdmin={isAdmin}
        isDarkMode={isDarkMode}
        styles={styles}
        fruitColors={fruitColors}
        t={t}
        language={i18n.language}
        actions={rowActions}
        profileCacheVersion={profileCacheVersion}
        roleRosterVersion={roleRosterVersion}
      />
    );
  }, [highlightedMessageId, userId, isAdmin, isDarkMode, styles, fruitColors, t, i18n.language, rowActions, profileCacheVersion, roleRosterVersion]);

  return (
    <>
      <FlatList
        data={messages}
        // Stable per-message key. The index used to be part of it, and since
        // new messages are prepended to this inverted list every existing key
        // shifted on each arrival — remounting every visible row (avatar
        // frame, images, popup menus). Ids are deduped on arrival (Trader.jsx).
        keyExtractor={(item, index) => (item?.id != null ? String(item.id) : `row-${index}`)}
        renderItem={renderMessage}
        contentContainerStyle={styles.chatList}
        inverted
        // profileCacheVersion so rows repaint once frames/colours land
        extraData={`${highlightedMessageId}-${profileCacheVersion}-${roleRosterVersion}`}
        ref={flatListRef}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          const atBottom = contentOffset.y <= 60;
          // console.log("✅ isAtBottom (detected):", atBottom);
          setIsAtBottom(atBottom);
        }}
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={20} // Render the first 20 messages upfront
        maxToRenderPerBatch={10} // Render 10 items per batch for smoother performance
        windowSize={5} // Adjust the window size for rendering nearby items
        
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#FFF' : '#000'}
          />
        }
        // onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
      />
      {/* ✅ Scroll to Bottom Button */}
      {!isAtBottom && (
        <Animated.View
          style={[
            styles.scrollToBottomButton,
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
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
            style={styles.scrollToBottomTouchable}
          >
            <Icon
              name="chevron-down-circle"
              size={FLOATING_BUTTON_ICON_SIZE}
              color={config.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        channelPath={channelPath}
        onClose={(success) => {
          if (success) {
            handleReportSuccess(selectedMessage.id);
          }
          setSelectedMessage(null);
          setShowReportPopup(false);
        }}
      />
    </>
  );
};
export const fruitStyles = StyleSheet.create({
  sourceNote: {
    fontSize: 9,
    opacity: 0.6,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  fruitsWrapper: {
    marginTop: 1,
    // gap: 1,
    backgroundColor: `${config.colors.surfaceDark}15`, // subtle blue-ish bg
    padding: 4,
    borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent:'flex-start',
    alignSelf: 'stretch',
  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
    backgroundColor: '#0002',
  },
  fruitInfo: {
    // flex: 1,
    flexDirection:'row',
    justifyContent:'flex-start',
    // backgroundColor:'red',
    alignItems:'center'
  },
  fruitName: {
    fontSize: 12,
    fontWeight: '500',
    // color: '#fff',
  },
  fruitValue: {
    fontSize: 11,
    // color: '#e5e5e5',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // marginTop: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    // minWidth: 16,
    // justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  badgeDefault: {
    backgroundColor: '#FF6666', // D
  },
  badgeNeon: {
    backgroundColor: '#2ecc71', // N
  },
  badgeMega: {
    backgroundColor: '#9b59b6', // M
  },
  badgeFly: {
    backgroundColor: '#3498db', // F
  },
  badgeRide: {
    backgroundColor: '#e74c3c', // R
  },
  totalRow: {
    flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6666',
  },
});
export default memo(MessagesList);