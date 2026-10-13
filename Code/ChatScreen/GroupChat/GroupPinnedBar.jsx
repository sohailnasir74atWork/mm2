/**
 * GroupPinnedBar — pinned messages at the top of a group chat.
 *
 * Ported from Adopt Me (Code/ChatScreen/GroupChat/GroupPinnedBar.jsx).
 *
 * The strip shows one pin (newest first). Tapping it jumps to that message
 * in the chat and moves the strip on to the next pin, so repeated taps walk
 * through all of them. The list button opens every pin; each row jumps, and
 * the group's creator and staff can unpin from there.
 *
 * Pins live on the group's Firestore doc (groups/{id}.pinnedMessages, newest
 * first, at most MAX_GROUP_PINS), which GroupChatScreen already listens to.
 * Each pin is a snapshot copy of the message: { id (the RTDB message key),
 * text, senderId, senderName, hasImage, itemCount, timestamp, pinnedBy,
 * pinnedAt }.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useModalWindowInsets } from '../../Helper/useNavBarInset';
import { flipInRTL } from '../../Helper/rtl';

export const MAX_GROUP_PINS = 5;
const ACCENT = '#8B5CF6';

const preview = (pin, t) => {
  const text = (pin?.text || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (pin?.hasImage) return `📷 ${t('group_chat.photo')}`;
  if (pin?.itemCount > 0) return `🐾 ${t('group_chat.pin_items', { count: pin.itemCount })}`;
  return '…';
};

// Props (no destructured defaults — Hermes): pins, c (getThemeColors),
// canManage, onJump(pin), onUnpin(pin).
export default function GroupPinnedBar(props) {
  const { pins, c, canManage, onJump, onUnpin } = props;
  const { t } = useTranslation();
  // Inside a <Modal>: on iOS useSafeAreaInsets() reads 0 there (App.js's root
  // SafeAreaView pads instead), so the sheet takes the window's insets.
  // Android: the same numbers as before.
  const insets = useModalWindowInsets();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const count = Array.isArray(pins) ? pins.length : 0;

  // Keep the shown pin valid when pins are added or removed.
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

  if (!count) return null;
  const shown = Math.min(index, count - 1);
  const pin = pins[shown];

  const tapStrip = () => {
    onJump(pin);
    if (count > 1) setIndex((i) => (i + 1) % count);
  };

  return (
    <>
      <View style={[styles.bar, { backgroundColor: c.bgAlt, borderBottomColor: c.border }]}>
        <TouchableOpacity style={styles.main} onPress={tapStrip} activeOpacity={0.7}>
          <View style={styles.rail}>
            {pins.map((p, i) => (
              <View key={p.id} style={[styles.railDot, { backgroundColor: i === shown ? ACCENT : c.border }]} />
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: ACCENT }]} numberOfLines={1}>
              📌 {count > 1
                ? t('group_chat.pinned_n_of', { n: shown + 1, total: count })
                : t('chat.pinned_message')}
            </Text>
            <Text style={[styles.text, { color: c.text }]} numberOfLines={1}>
              {pin.senderName ? <Text style={styles.textName}>{t('group_chat.pin_sender', { name: pin.senderName })} </Text> : null}
              {preview(pin, t)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          style={styles.listBtn}
          hitSlop={8}
          accessibilityLabel={t('group_chat.pinned_messages_title', { total: count })}
        >
          <Icon name="list" size={20} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: c.bgElevated || c.bgAlt, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>📌 {t('group_chat.pinned_messages_title', { total: count })}</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {pins.map((p) => (
              <View key={p.id} style={[styles.row, { borderColor: c.border }]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => { setOpen(false); onJump(p); }}>
                  <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>{p.senderName || '—'}</Text>
                  <Text style={[styles.rowText, { color: c.textSecondary }]} numberOfLines={3}>{preview(p, t)}</Text>
                  <View style={styles.goRow}>
                    <Text style={styles.goText}>{t('group_chat.go_to_message')}</Text>
                    <Icon name="chevron-forward" size={13} color={ACCENT} style={flipInRTL} />
                  </View>
                </TouchableOpacity>
                {canManage ? (
                  <TouchableOpacity
                    onPress={() => onUnpin(p)}
                    style={styles.unpin}
                    hitSlop={8}
                    accessibilityLabel={t('group_chat.unpin_message')}
                  >
                    <Icon name="close-circle" size={22} color="#EF4444" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingStart: 10 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  rail: { width: 3, marginEnd: 10, alignSelf: 'stretch', justifyContent: 'center', gap: 2 },
  railDot: { flex: 1, maxHeight: 30, borderRadius: 2 },
  label: { fontSize: 11.5, fontFamily: 'Lato-Bold' },
  text: { fontSize: 13.5, marginTop: 1, fontFamily: 'Lato-Regular' },
  textName: { fontFamily: 'Lato-Bold' },
  listBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontFamily: 'Lato-Bold', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  rowName: { fontSize: 13.5, fontFamily: 'Lato-Bold', marginBottom: 2 },
  rowText: { fontSize: 13.5, lineHeight: 19, fontFamily: 'Lato-Regular' },
  goRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  goText: { color: ACCENT, fontSize: 12, fontFamily: 'Lato-Bold' },
  unpin: { paddingStart: 12 },
});
