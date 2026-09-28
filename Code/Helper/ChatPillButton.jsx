import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from './Environment';

// The "Chat" button on trade cards and feed post cards. Shared so the two
// stay identical. CHAT_PILL_HEIGHT is exported so neighbours (the trade
// bookmark) can match it and sit on the same line.
export const CHAT_PILL_HEIGHT = 24;

const ChatPillButton = ({ onPress, style }) => (
  <TouchableOpacity style={[styles.btn, style]} onPress={onPress} activeOpacity={0.8} hitSlop={8}>
    <Icon name="chatbubble" size={10} color="#fff" />
    <Text style={styles.label}>Chat</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CHAT_PILL_HEIGHT,
    paddingHorizontal: 9,
    gap: 4,
    borderRadius: 999,
    backgroundColor: config.colors.primary,
  },
  label: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 10,
  },
});

export default ChatPillButton;
