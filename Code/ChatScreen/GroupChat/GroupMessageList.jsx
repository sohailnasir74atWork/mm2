import React, { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useNavigation } from '@react-navigation/native';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import { fruitStyles } from '../PrivateChat/PrivateMessageList';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { parseMessageText } from '../ChatHelper';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import { resolveProfile, warmProfileCache, getCachedProfile } from '../../Helper/profileCache';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import FramedAvatar from './FramedAvatar';
import { getUserRoles, useRoleRosterVersion } from '../../Helper/roleRoster';
import { sourceLabelForItems } from '../../Helper/valueSources';
import { getThemeColors } from '../../Helper/themeColors';
import MessageActionDrawer from './MessageActionDrawer';

const GroupMessageList = ({
  messages,
  userId,
  user,
  groupData,
  handleLoadMore,
  refreshing,
  onRefresh,
  loading,
  isPaginating,
  onUserPress, // Callback to open profile drawer
  onReply, // Callback to reply to a message
  scrollToMessage, // Function to scroll to a message
  highlightedMessageId, // ID of highlighted message
  flatListRef, // Ref for FlatList
  // Ported from Adopt Me (2026-10-13). All optional: without them the
  // long-press sheet offers Copy and Reply, as the old menu did.
  onReaction, // (messageId, emoji) — toggle the viewer's reaction
  onTranslate, // (message) — translate into the device language
  onPinMessage, // (message) — pin / unpin (creator and staff)
  canPin, // the viewer may pin in this group
  pinnedIds, // Set of pinned message ids (the sheet then offers Unpin)
}) => {
  const { theme, appdatabase } = useGlobalState();
  const roleRosterVersion = useRoleRosterVersion(appdatabase);
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const c = useMemo(() => getThemeColors(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { triggerHapticFeedback } = useHaptic();

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [actionDrawerVisible, setActionDrawerVisible] = useState(false);

  const openActions = useCallback((item) => {
    triggerHapticFeedback('impactMedium');
    setSelectedMessage(item);
    setActionDrawerVisible(true);
  }, [triggerHapticFeedback]);

  const closeActions = useCallback(() => {
    setActionDrawerVisible(false);
    setSelectedMessage(null);
  }, []);

  // Jumping to a reply or a pin far up the list: the row isn't laid out yet,
  // so get close by the average row height, then retry (from Adopt Me).
  const scrollRetryRef = useRef(0);
  const handleScrollToIndexFailed = useCallback((info) => {
    const list = flatListRef?.current;
    if (!list) return;
    list.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    // At most three retries per jump; the window reopens after 2 s.
    if (scrollRetryRef.current >= 3) return;
    scrollRetryRef.current += 1;
    if (scrollRetryRef.current === 1) setTimeout(() => { scrollRetryRef.current = 0; }, 2000);
    setTimeout(() => {
      try {
        flatListRef?.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
      } catch (e) { /* the next failure callback retries */ }
    }, 250);
  }, [flatListRef]);

  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? `${config.colors.surfaceDark}55` : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      value: isDarkMode ? '#e5e7eb' : '#4b5563',
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue: isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );

  // Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);

  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('home.alert.success'), t('private_chat.msg_copied'));
  }, [triggerHapticFeedback, t]);

  // Get reply preview text
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return t('chat.reply_deleted');

    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.imageUrl || (Array.isArray(replyTo.imageUrls) && replyTo.imageUrls.length > 0)) {
      const imageCount = Array.isArray(replyTo.imageUrls) ? replyTo.imageUrls.length : (replyTo.imageUrl ? 1 : 0);
      return t('chat.reply_images', { count: Math.max(1, imageCount) });
    }

    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0
        ? t('chat.reply_items', { count })
        : t('chat.reply_items_message');
    }

    return t('chat.reply_deleted');
  }, [t]);

  // Filtered messages (sorted descending for inverted FlatList)
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    return [...messages].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  }, [messages]);

  // Warm the profile cache for the UNIQUE senders in view so avatar frames +
  // chat text colors render (group messages are slim — no cosmetics in the
  // payload). Unique senders + uncached-only keep it cheap; bumping the
  // version re-renders the memoised rows via extraData once profiles land.
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  useEffect(() => {
    if (!appdatabase) return;
    const senders = [...new Set(filteredMessages.map(m => m?.senderId).filter(Boolean))]
      .filter(id => !getCachedProfile(id));
    if (senders.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, senders)
      .then(() => { if (!cancelled) setProfileCacheVersion(v => v + 1); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [filteredMessages, appdatabase]);

  const renderMessage = useCallback(
    ({ item }) => {
      if (!item || typeof item !== 'object') return null;

      const isMyMessage = item.senderId === userId;
      const senderName = item.sender || 'Anonymous';
      const senderAvatar =
        item.avatar ||
        groupData?.members?.[item.senderId]?.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
      // Sender cosmetics (frame + chat text color) from the profile cache.
      const profile = resolveProfile(item);

      const fruits = Array.isArray(item.fruits) ? item.fruits : [];
      const hasFruits = fruits.length > 0;
      const totalFruitValue = hasFruits
        ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
        : 0;

      // Check for recent win
      const hasRecentWin =
        item?.hasRecentGameWin ||
        (typeof item?.lastGameWinAt === 'number' &&
          Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);

      return (
        <View
          style={[
            isMyMessage ? styles.mymessageBubble : styles.othermessageBubble,
            isMyMessage ? styles.myMessage : styles.otherMessage,
            item.id === highlightedMessageId && {
              backgroundColor: isDarkMode ? '#3a2a10' : '#fef3c7',
              borderWidth: 2,
              borderColor: '#F59E0B',
            },
          ]}
        >
          {/* Avatar Container - matching main chat structure */}
          <View style={styles.senderName}>
            <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({
                    senderId: item.senderId,
                    sender: senderName,
                    avatar: senderAvatar,
                  });
                }
              }}
              disabled={!onUserPress}
              activeOpacity={0.7}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <FramedAvatar
                avatarUri={senderAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={profile.profileFrame || null}
                isDarkMode={isDarkMode}
                avatarSize={28}
                forceDetail
              />
            </TouchableOpacity>
          </View>

          {/* Message Content Container */}
          <View style={styles.messageTextBox}>
            {/* Reply Preview */}
            {item.replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyContainer,
                  { backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#E5E7EB' },
                ]}
                activeOpacity={0.7}
                onPress={() => scrollToMessage && scrollToMessage(item.replyTo.id)}
              >
                <Text style={[styles.replyText, { color: isDarkMode ? '#9CA3AF' : '#6B7280' }]} numberOfLines={2}>
                  {t('chat.replying_to_preview', { text: getReplyPreview(item.replyTo) })}
                </Text>
              </TouchableOpacity>
            )}

            {/* Username with badges - shown for ALL messages (including current user) */}
           

            {/* Long press opens the action sheet (reactions, copy, reply,
                translate, pin) — Adopt Me's MessageActionDrawer, replacing
                the old Copy/Reply popup menu. */}
            <TouchableOpacity
              activeOpacity={1}
              delayLongPress={300}
              onLongPress={() => openActions(item)}
            >
                {/* Message Content Wrapper - matching main chat structure */}
                <View style={[
                  isMyMessage ? styles.myMessageText : styles.otherMessageText,
                ]}>
                   <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({
                    senderId: item.senderId,
                    sender: senderName,
                    avatar: senderAvatar,
                  });
                }
              }}
              disabled={!onUserPress}
              activeOpacity={0.7}
              style={{ alignSelf: 'flex-start' }}
            >
              <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                flexWrap: 'nowrap',
              }}>
                <Text 
                  style={[styles.userNameText, { 
                    flexShrink: 1,
                  }]} 
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.sender || t('group_chat.anonymous')}
                </Text>

                {/* Pro badge */}
                {item?.isPro && (
                  <Image resizeMethod="resize"
                    source={require('../../../assets/pro.png')}
                    style={{ width: 16, height: 16, marginLeft: 4 }}
                  />
                )}

                {/* Verified badge */}
                {item?.robloxUsernameVerified && (
                  <Image resizeMethod="resize"
                    source={require('../../../assets/verification.png')}
                    style={{ width: 16, height: 16, marginLeft: 4 }}
                  />
                )}

                {/* Role pills from the roster (Code/Helper/roleRoster.js):
                    rules-protected, so they cannot be faked from a message. */}
                {(() => {
                  const roles = getUserRoles(item.senderId);
                  const firstBadge = getFirstBadgeType(roles);
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                      {roles.isAdmin && (
                        <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'admin'} />
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
                    </View>
                  );
                })()}

                {/* Trophy badge (recent win) */}
                {hasRecentWin && (
                  <Image resizeMethod="resize"
                    source={require('../../../assets/trophy.webp')}
                    style={{ width: 10, height: 10, marginLeft: 4 }}
                  />
                )}

                {/* Creator badge */}
                {item?.isCreator && (
                  <View style={{
                    backgroundColor: '#8B5CF6',
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    borderRadius: 3,
                    marginLeft: 4,
                  }}>
                    <Text style={{
                      color: '#FFF',
                      fontSize: 9,
                      fontWeight: '600',
                    }}>{t('group_chat.role_creator')}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity> 
                  {/* Images - Support multiple images */}
                  {(item.imageUrls || item.imageUrl) && (() => {
                    // Support both array (imageUrls) and single (imageUrl) for backward compatibility
                    const imageArray = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
                      ? item.imageUrls
                      : (item.imageUrl ? [item.imageUrl] : []);
                    
                    if (imageArray.length === 0) return null;
                    
                    return (
                      <View style={{ marginBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                        {imageArray.map((imageUri, imgIndex) => {
                          // Fixed size approach: larger for single, smaller for multiple
                          const imageSize = imageArray.length === 1 ? 250 : imageArray.length === 2 ? 150 : 110;
                          
                          return (
                            <TouchableOpacity
                              key={`img-${imgIndex}`}
                              activeOpacity={0.8}
                              onPress={() =>
                                navigation.navigate('ImageViewerScreenChat', {
                                  images: imageArray,
                                  initialIndex: imgIndex,
                                })
                              }
                            >
                              <Image resizeMethod="resize" 
                                source={{ uri: imageUri }} 
                                style={{ 
                                  width: imageSize,
                                  height: imageSize,
                                  borderRadius: 8,
                                  resizeMode: 'cover',
                                }} 
                              />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })()}

                  {/* 🐾 Fruits list (matching main chat style) */}
                  {hasFruits && (
                    <View
                      style={[
                        fruitStyles.fruitsWrapper,                     ]}
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
                              </Text>

                              <View style={fruitStyles.badgeRow}>
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

                  {/* Normal text (can be empty if only fruits) - matching main chat */}
                  {!!item.text && (
                    isMultiColorText(profile.chatTextColor)
                      ? <RainbowText
                          colors={getMultiColorPalette(profile.chatTextColor)}
                          style={[isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                        >{item.text}</RainbowText>
                      : <Text style={[
                          isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                          profile.chatTextColor ? { color: getSafeTextColor(profile.chatTextColor, null) } : null,
                        ]}>
                          {parseMessageText(item.text)}
                        </Text>
                  )}
                </View>
            </TouchableOpacity>

            {/* Reaction badges (from Adopt Me). Tapping one toggles yours. */}
            {item.reactions && typeof item.reactions === 'object' && Object.keys(item.reactions).length > 0 && (() => {
              const counts = {};
              Object.values(item.reactions).forEach((emoji) => {
                if (typeof emoji === 'string') counts[emoji] = (counts[emoji] || 0) + 1;
              });
              const myReaction = (userId && item.reactions[userId]) || null;
              const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              if (entries.length === 0) return null;
              return (
                <View style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginTop: 2,
                  marginBottom: 2,
                  alignSelf: isMyMessage ? 'flex-end' : 'flex-start',
                }}>
                  {entries.map(([emoji, count]) => (
                    <TouchableOpacity
                      key={emoji}
                      disabled={!onReaction || !userId}
                      onPress={() => onReaction && onReaction(item.id, emoji)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 999,
                        backgroundColor: c.bgAlt,
                        gap: 3,
                        borderWidth: 1,
                        borderColor: c.border,
                        ...(myReaction === emoji ? {
                          backgroundColor: isDarkMode ? '#1e3a5f' : '#dbeafe',
                          borderColor: isDarkMode ? '#3b82f6' : '#60a5fa',
                        } : {}),
                      }}
                    >
                      <Text style={{ fontSize: 12 }}>{emoji}</Text>
                      <Text style={{
                        fontSize: 10,
                        fontFamily: 'Lato-Bold',
                        color: myReaction === emoji
                          ? (isDarkMode ? '#93c5fd' : '#2563eb')
                          : c.textSecondary,
                      }}>{count}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>

          <Text style={styles.timestamp}>
            {item.timestamp
              ? new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </Text>
        </View>
      );
    },
    [userId, groupData, styles, c, fruitColors, navigation, openActions, onUserPress, isDarkMode, scrollToMessage, highlightedMessageId, getReplyPreview, onReaction, t]
  );

  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  const messageListStyles = useMemo(
    () => ({
      flex: 1,
    }),
    []
  );

  const messageListContentStyles = useMemo(
    () => ({
      flexGrow: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
      ...(filteredMessages.length === 0 && { justifyContent: 'flex-end' }),
    }),
    [filteredMessages.length]
  );


  return (
    <>
    <FlatList
      ref={flatListRef}
      data={filteredMessages}
      renderItem={renderMessage}
      keyExtractor={keyExtractor}
      inverted={true} // ✅ Latest messages at bottom
      style={messageListStyles}
      contentContainerStyle={messageListContentStyles}
      extraData={`${highlightedMessageId}-${profileCacheVersion}-${roleRosterVersion}`} // Re-render on highlight or cosmetics cache warm
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
      }
      onEndReached={handleLoadMore} // ✅ Fires when scrolling to top (for inverted list)
      onEndReachedThreshold={0.3} // ✅ Trigger earlier for smoother loading
      initialNumToRender={15} // ✅ Render 15 messages initially
      maxToRenderPerBatch={10} // ✅ Render 10 per batch
      windowSize={5} // ✅ Optimize memory usage
      removeClippedSubviews={false} // ✅ Improve performance
      ListFooterComponent={
        isPaginating ? (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <ActivityIndicator size="small" color="#8B5CF6" />
          </View>
        ) : null
      }
      ListEmptyComponent={
        !loading ? (
          <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.emptyText}>{t('group_chat.no_msgs')}</Text>
          </View>
        ) : null
      }
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={handleScrollToIndexFailed}
    />
    <MessageActionDrawer
      visible={actionDrawerVisible}
      message={selectedMessage}
      onClose={closeActions}
      onReaction={onReaction || null}
      onCopy={handleCopy}
      onReply={onReply || null}
      onTranslate={onTranslate || null}
      onPinMessage={onPinMessage || null}
      canPin={!!canPin}
      isPinned={!!(selectedMessage && pinnedIds && pinnedIds.has(selectedMessage.id))}
      userId={userId}
      isDarkMode={isDarkMode}
    />
    </>
  );
};

export default memo(GroupMessageList);
