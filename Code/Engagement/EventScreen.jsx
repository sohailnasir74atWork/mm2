/**
 * EventScreen — the seasonal event hub.
 *
 * 📅 2026-09-13. MM2 runs events back to back from July to February, and each
 * drops ~40 new items whose values then move daily while the community settles
 * on what they are worth. That movement is the reason to open the app during
 * an event; outside one the values list barely changes.
 *
 * Two pieces:
 *   · EventCard   — a small tappable card that sits in the feed
 *   · the modal   — the full list, opened from the card, closeable
 *
 * The card is deliberately small. An earlier version rendered the whole list
 * inline and it read as a post someone had made: 255 Halloween rows pushed the
 * actual feed off screen, and scrolled past its own heading it looked like
 * loose content. A card that announces itself and gets out of the way is the
 * right size for something that is not user content.
 *
 * Everything here is derived, not stored:
 *   · WHICH event is running  → Code/Engagement/eventConfig.js, overridable
 *                               from RTDB /events with no app release
 *   · WHICH items are in it   → Supreme tags `origin` ("Halloween 2025
 *                               (Tier 25)"), so an item added mid-event
 *                               appears here the next time the feed refreshes
 *   · HOW MUCH each moved     → Supreme's own `change` / `changePct`
 *
 * Renders nothing when no event is running or near — an empty seasonal section
 * sitting there for five months is worse than no section.
 *
 * This component NEVER writes. It reads the cached values and draws rows.
 */
import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, Image, FlatList, StyleSheet, TouchableOpacity, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// react-native's SafeAreaView was a no-op on Android and only ever inset on
// iOS; react-native-safe-area-context's insets on both. Pinning the edges
// per-platform keeps the layout exactly what it was before the swap.
const LEGACY_SAFE_AREA_EDGES = Platform.OS === 'ios'
  ? ['top', 'bottom', 'left', 'right']
  : [];

import Icon from 'react-native-vector-icons/Ionicons';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import {
  buildItemPool, unwrapFeed, resolveItemImage, priceOf, displayValueText,
  DEFAULT_VALUE_SOURCE,
} from '../Helper/valueSources';
import { resolveEvent, eventItems } from './eventConfig';

const parseFeed = (raw) => {
  try {
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? unwrapFeed(parsed) : null;
  } catch (e) {
    return null;
  }
};

const palette = (isDarkMode) => ({
  text: isDarkMode ? config.colors.textDark : config.colors.textLight,
  sub: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
  surface: isDarkMode ? config.colors.surfaceElevatedDark : '#ffffff',
  border: isDarkMode ? '#333' : '#e5e7eb',
  screen: isDarkMode ? config.colors.backgroundDark || '#111' : '#f4f4f6',
});

// Supreme writes the sign into changePct ("+3.8%" / "-4.0%"), so read the
// direction from the string rather than re-deriving it from `change`.
const movement = (pct) => {
  if (typeof pct !== 'string' || !pct.trim()) return null;
  if (/^\+?-?0(\.0+)?%$/.test(pct.trim())) return null;
  return { up: pct.trim().startsWith('+'), text: pct.replace(/^\+/, '') };
};

const EventRow = React.memo(({ item, valueSource, C }) => {
  const uri = resolveItemImage(item);
  const priced = priceOf(item, valueSource);
  const label = displayValueText(item, valueSource);
  const moved = movement(item.changePct);

  return (
    <View style={[styles.row, { backgroundColor: C.surface, borderColor: C.border }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: C.border }]} />
      )}
      <View style={styles.info}>
        <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
          {item.Name || item.name}
        </Text>
        <Text style={[styles.origin, { color: C.sub }]} numberOfLines={1}>
          {item.origin}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.value, { color: C.text }]} numberOfLines={1}>
          {label || priced.valueText || (priced.value ? priced.value.toLocaleString() : '—')}
        </Text>
        {moved ? (
          <Text style={[styles.change, { color: moved.up ? '#10B981' : '#EF4444' }]}>
            {moved.up ? '▲' : '▼'} {moved.text}
          </Text>
        ) : item.stability ? (
          <Text style={[styles.stability, { color: C.sub }]} numberOfLines={1}>
            {item.stability}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const EventCard = ({ isDarkMode = false }) => {
  const { localState } = useLocalState();
  const [open, setOpen] = useState(false);
  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;
  const C = palette(isDarkMode);

  // Remote config wins; the built-in estimates are the fallback so a cold
  // start with no network still shows a sensible countdown.
  const state = useMemo(
    () => resolveEvent(Date.now(), localState?.events || null),
    [localState?.events],
  );

  const pool = useMemo(
    () => buildItemPool(parseFeed(localState?.data), parseFeed(localState?.suprime)),
    [localState?.data, localState?.suprime],
  );

  // Sorted newest year first, then by how much the item moved — so the preview
  // thumbnails and the top of the list are this year's movers.
  const items = useMemo(
    () => (state ? eventItems(pool, state.event) : []),
    [pool, state],
  );

  const renderItem = useCallback(
    ({ item }) => <EventRow item={item} valueSource={valueSource} C={C} />,
    [valueSource, C],
  );

  if (!state) return null;

  const { event, phase, daysUntil, daysLeft, estimated } = state;

  const title = phase === 'active'
    ? `${event.label} is live`
    : `${event.label} in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;

  // "around" whenever the window is our own estimate rather than a real date
  // from the backend. The dates genuinely move year to year, and claiming a
  // precision we do not have is how a countdown ends up simply wrong.
  const subtitle = phase === 'active'
    ? (estimated
        ? `${items.length} items · values move fastest now`
        : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · ${items.length} items`)
    : (estimated
        ? `${items.length} items · dates shift each year`
        : `${items.length} items · confirmed start`);

  const preview = items.slice(0, 4).map(resolveItemImage).filter(Boolean);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen(true)}
        style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
      >
        <Text style={styles.cardEmoji}>{event.emoji}</Text>
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.cardSub, { color: C.sub }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        <View style={styles.previewRow}>
          {preview.map((uri, i) => (
            <Image key={uri + i} source={{ uri }} style={styles.previewThumb} />
          ))}
        </View>
        <Icon name="chevron-forward" size={18} color={C.sub} />
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
      >
        <SafeAreaView edges={LEGACY_SAFE_AREA_EDGES} style={[styles.modal, { backgroundColor: C.screen }]}>
          <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
            <View style={styles.modalTitleWrap}>
              <Text style={[styles.modalTitle, { color: C.text }]} numberOfLines={1}>
                {event.emoji}  {title}
              </Text>
              <Text style={[styles.cardSub, { color: C.sub }]} numberOfLines={1}>{subtitle}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="close" size={26} color={C.text} />
            </TouchableOpacity>
          </View>

          {items.length === 0 ? (
            <Text style={[styles.empty, { color: C.sub }]}>
              Items appear here as soon as they are added to the values list.
            </Text>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id || i.Name}
              renderItem={renderItem}
              initialNumToRender={14}
              windowSize={7}
              removeClippedSubviews
              contentContainerStyle={styles.listContent}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginVertical: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  cardEmoji: { fontSize: 22, marginRight: 10 },
  cardInfo: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  cardSub: { fontSize: 11, marginTop: 1, opacity: 0.85 },
  previewRow: { flexDirection: 'row', marginRight: 6 },
  previewThumb: { width: 22, height: 22, borderRadius: 4, marginLeft: -4 },

  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitleWrap: { flex: 1, marginRight: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  listContent: { paddingVertical: 6 },

  empty: { fontSize: 12, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginVertical: 3,
    padding: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 36, height: 36, borderRadius: 6, marginRight: 10 },
  info: { flex: 1, marginRight: 8 },
  name: { fontSize: 13, fontWeight: '600' },
  origin: { fontSize: 10, marginTop: 1 },
  right: { alignItems: 'flex-end', minWidth: 78 },
  value: { fontSize: 13, fontWeight: '700' },
  change: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  stability: { fontSize: 10, marginTop: 1 },
});

export default React.memo(EventCard);
