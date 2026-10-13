/**
 * MessageActionDrawer — long-press menu for a group chat message.
 *
 * Ported from Adopt Me (Code/ChatScreen/GroupChat/MessageActionDrawer.jsx).
 * A bottom sheet with the emoji reaction row on top (❤️🔥😍💀🎯, one per
 * player, tap the same one again to remove it) and the actions under it:
 * Copy, Reply, Translate, and Pin / Unpin for the group's creator and staff.
 *
 * Adopt Me's drawer also carries Report / Delete / Delete all. MM2's group
 * chat has no handlers for those, so they are left out rather than shipped
 * as rows that do nothing.
 */
import React, { useMemo, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useModalWindowInsets } from '../../Helper/useNavBarInset';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import config from '../../Helper/Environment';

export const REACTION_EMOJIS = ['❤️', '🔥', '😍', '💀', '🎯'];

// Props (no destructured defaults — Hermes):
//   visible, message, onClose, userId, isDarkMode
//   onReaction(messageId, emoji), onCopy(message), onReply(message),
//   onTranslate(message), onPinMessage(message) — any may be null
//   canPin  — creator or staff (the row is hidden otherwise)
//   isPinned — the row then reads Unpin
const MessageActionDrawer = (props) => {
  const {
    visible,
    message,
    onClose,
    onReaction,
    onCopy,
    onReply,
    onTranslate,
    onPinMessage,
    canPin,
    isPinned,
    userId,
    isDarkMode,
  } = props;
  const { t } = useTranslation();
  // Inside a <Modal>: on iOS useSafeAreaInsets() reads 0 there (App.js's root
  // SafeAreaView pads instead), so the sheet takes the window's insets.
  // Android: the same numbers as before.
  const insets = useModalWindowInsets();

  const myReaction = useMemo(() => {
    if (!message?.reactions || !userId) return null;
    return message.reactions[userId] || null;
  }, [message?.reactions, userId]);

  const reactionCounts = useMemo(() => {
    if (!message?.reactions) return {};
    const counts = {};
    Object.values(message.reactions).forEach((emoji) => {
      if (typeof emoji === 'string') counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return counts;
  }, [message?.reactions]);

  const handleEmojiTap = useCallback(
    (emoji) => {
      if (onReaction && message?.id) onReaction(message.id, emoji);
      onClose();
    },
    [onReaction, message?.id, onClose],
  );

  const handleAction = useCallback(
    (action) => {
      onClose();
      if (typeof action === 'function') {
        // Small delay so the sheet closes before an Alert or a scroll.
        setTimeout(() => action(message), 100);
      }
    },
    [onClose, message],
  );

  const styles = useMemo(() => getStyles(!!isDarkMode), [isDarkMode]);
  const iconColor = isDarkMode ? '#e2e8f0' : '#334155';

  if (!visible || !message) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <SwipeableBottomDrawer
          onClose={onClose}
          isDarkMode={!!isDarkMode}
          style={[styles.drawer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        >
          {/* Emoji reaction row */}
          {onReaction && userId ? (
            <>
              <View style={styles.emojiRow}>
                {REACTION_EMOJIS.map((emoji) => {
                  const isActive = myReaction === emoji;
                  const count = reactionCounts[emoji] || 0;
                  return (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() => handleEmojiTap(emoji)}
                      activeOpacity={0.7}
                      style={[styles.emojiBtn, isActive && styles.emojiBtnActive]}
                    >
                      <Text style={styles.emojiText}>{emoji}</Text>
                      {count > 0 && (
                        <Text style={[styles.emojiCount, isActive && styles.emojiCountActive]}>{count}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.divider} />
            </>
          ) : null}

          <View style={styles.actionsList}>
            {!!message?.text && onCopy && (
              <TouchableOpacity style={styles.actionRow} activeOpacity={0.6} onPress={() => handleAction(onCopy)}>
                <Icon name="copy-outline" size={20} color={iconColor} />
                <Text style={styles.actionText}>{t('private_chat.copy')}</Text>
              </TouchableOpacity>
            )}

            {userId && onReply && (
              <TouchableOpacity style={styles.actionRow} activeOpacity={0.6} onPress={() => handleAction(onReply)}>
                <Icon name="arrow-undo-outline" size={20} color={iconColor} />
                <Text style={styles.actionText}>{t('chat.reply')}</Text>
              </TouchableOpacity>
            )}

            {!!message?.text && onTranslate && (
              <TouchableOpacity style={styles.actionRow} activeOpacity={0.6} onPress={() => handleAction(onTranslate)}>
                <Icon name="language-outline" size={20} color={iconColor} />
                <Text style={styles.actionText}>{t('private_chat.translate')}</Text>
              </TouchableOpacity>
            )}

            {/* Pin / Unpin — the group's creator and staff. */}
            {onPinMessage && canPin && (
              <TouchableOpacity style={styles.actionRow} activeOpacity={0.6} onPress={() => handleAction(onPinMessage)}>
                <Icon name={isPinned ? 'pin' : 'pin-outline'} size={20} color={iconColor} />
                <Text style={styles.actionText}>
                  {t(isPinned ? 'group_chat.unpin_message' : 'group_chat.pin_message')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </SwipeableBottomDrawer>
      </Pressable>
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    drawer: {
      backgroundColor: isDark ? config.colors.surfaceDark : '#ffffff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 8,
      maxHeight: '70%',
    },
    emojiRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    emojiBtn: {
      width: 52,
      height: 52,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#f1f5f9',
    },
    emojiBtnActive: {
      backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
      borderWidth: 2,
      borderColor: isDark ? '#3b82f6' : '#60a5fa',
    },
    emojiText: {
      fontSize: 24,
    },
    emojiCount: {
      fontSize: 10,
      color: isDark ? '#94a3b8' : '#64748b',
      fontFamily: 'Lato-Bold',
      marginTop: 1,
    },
    emojiCountActive: {
      color: isDark ? '#93c5fd' : '#2563eb',
    },
    divider: {
      height: 1,
      backgroundColor: isDark ? '#334155' : '#e2e8f0',
      marginHorizontal: 16,
      marginVertical: 6,
    },
    actionsList: {
      paddingHorizontal: 8,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 13,
      paddingHorizontal: 16,
      gap: 14,
      borderRadius: 10,
    },
    actionText: {
      fontSize: 15,
      fontFamily: 'Lato-Regular',
      color: isDark ? '#e2e8f0' : '#334155',
    },
  });

export default React.memo(MessageActionDrawer);
