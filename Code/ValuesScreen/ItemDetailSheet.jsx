// ItemDetailSheet — one MM2 item's details in a bottom sheet (2026-11-04,
// features LOG "Calculator UX batch 1"). Before this nothing in the app showed
// an item on its own: Values cards were inert in browse mode.
//
// Opened from a Values card (browse mode only — the chat / My Stuff pickers
// keep their tap-to-add) and from the calculator's SlotActionSheet "Details".
//
// Same visual language as Code/Homescreen/SlotActionSheet.jsx: 56px image
// tile, 16px bold name, 11–12px labels, 14–16px values, 20px top radius.
// Read-only on purpose: My Stuff is a Firestore list behind sign-in with no
// shared add helper, and the calculator has no hand-off API, so no actions.
import React, { useMemo } from 'react';
import { View, Text, Modal, Pressable, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { useLocalState } from '../LocalGlobelStats';
import { timeAgo } from '../Helper/timeAgo';
import {
  priceOf, displayValueText, sourceUpdatedAt, VALUE_SOURCE, DEFAULT_VALUE_SOURCE,
} from '../Helper/valueSources';

// The feeds write "no value" as 'N/A', '[N/A]', '-' and friends (as ValueCard).
const present = (v) => v != null && !/^\W*(n\/?a|none|-)?\W*$/i.test(String(v));

// Stability / trend colour. Lives here so the Values grid and this sheet agree.
export const getStabilityColor = (stability) => {
  if (!stability || stability === 'N/A') return '#888';
  const s = String(stability).toLowerCase();
  if (s === 'stable') return '#34C759';
  if (s === 'doing well' || s === 'recovering') return '#30D158';
  if (s === 'overpaid for' || s === 'peaking') return '#007AFF';
  if (s === 'fluctuating') return '#FF9500';
  if (s === 'underpaid for') return '#FF6B35';
  if (s === 'decreasing') return '#FF3B30';
  return '#888';
};

// Same text as the Values card: the source's own words when it has no real
// price ("Award only", "x3 T1 Legendaries"), else the number with commas.
const valueTextFor = (item, source) => {
  const label = displayValueText(item, source);
  if (label) return label;
  const n = priceOf(item, source).value || 0;
  return n >= 1 ? n.toLocaleString() : n.toString();
};

// Supreme first, MM2 second — the order of the Values screen's switch.
const SOURCES = [VALUE_SOURCE.SUPREME, VALUE_SOURCE.MM2];

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {object|null} props.item   a pool row (Values card or calculator slot)
 * @param {string} props.imageUrl
 * @param {boolean} props.isDarkMode
 * @param {Function} props.onClose
 */
const ItemDetailSheet = ({ visible, item, imageUrl, isDarkMode, onClose }) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const activeSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;
  const dataMeta = localState?.dataMeta;
  const suprimeMeta = localState?.suprimeMeta;

  const rows = useMemo(() => {
    if (!item) return [];
    return SOURCES.map((src) => {
      const at = sourceUpdatedAt(src === VALUE_SOURCE.MM2 ? dataMeta : suprimeMeta, src);
      return {
        src,
        label: t(src === VALUE_SOURCE.SUPREME ? 'value.source_supreme' : 'value.source_mm2'),
        value: valueTextFor(item, src),
        updated: at ? t('calc.updated_ago', { time: timeAgo(at, t) }) : '',
      };
    });
  }, [item, dataMeta, suprimeMeta, t]);

  if (!item) return null;

  const surface = isDarkMode ? '#1f2937' : '#ffffff';
  const text = isDarkMode ? '#f1f5f9' : '#0f172a';
  const sub = isDarkMode ? '#94a3b8' : '#64748b';
  const chipBg = isDarkMode ? '#334155' : '#f1f5f9';
  const accent = config.colors.primary;

  const tier = present(item.tier) ? String(item.tier).replace(/^tier\s*/i, 'T') : '';
  const category = item.type || item.category || '';
  const hasDemand = present(item.demand);
  const hasStability = present(item.stability);
  const hasRange = present(item.range);
  const stabilityColor = getStabilityColor(item.stability);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel={t('slot_sheet.close', { defaultValue: 'Close' })} />
      <View style={[styles.sheet, { backgroundColor: surface, paddingBottom: 16 + insets.bottom }]}>
        <View style={[styles.handle, { backgroundColor: sub + '55' }]} />

        <View style={styles.header}>
          <View style={[styles.imageWrap, { backgroundColor: chipBg }]}>
            {!!imageUrl && <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />}
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: text }]} numberOfLines={1}>{item.name}</Text>
            <View style={styles.metaRow}>
              {!!tier && (
                <View style={styles.tier}>
                  <Text style={styles.tierText} numberOfLines={1}>{tier}</Text>
                </View>
              )}
              {!!category && <Text style={[styles.category, { color: sub }]} numberOfLines={1}>{category}</Text>}
            </View>
          </View>
        </View>

        <View style={styles.values}>
          {rows.map((r) => {
            const active = r.src === activeSource;
            return (
              <View
                key={r.src}
                style={[
                  styles.valueBox,
                  active
                    ? { backgroundColor: accent + '14', borderColor: accent + '66' }
                    : [styles.valueBoxIdle, { backgroundColor: chipBg }],
                ]}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.valueLabel, { color: active ? accent : sub }]} numberOfLines={1}>{r.label}</Text>
                <Text
                  style={[styles.value, { color: active ? accent : text }]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {r.value}
                </Text>
                {!!r.updated && <Text style={[styles.updated, { color: sub }]} numberOfLines={1}>{r.updated}</Text>}
              </View>
            );
          })}
        </View>

        {(hasDemand || hasStability || hasRange) && (
          <View style={styles.chips}>
            {hasDemand && (
              <View style={[styles.chip, { backgroundColor: chipBg }]}>
                <Text style={[styles.chipText, { color: text }]} numberOfLines={1}>{t('value.demand_chip', { value: item.demand })}</Text>
              </View>
            )}
            {hasStability && (
              <View style={[styles.chip, { backgroundColor: stabilityColor + '1F' }]}>
                <View style={[styles.dot, { backgroundColor: stabilityColor }]} />
                <Text style={[styles.chipText, { color: stabilityColor }]} numberOfLines={1}>{item.stability}</Text>
              </View>
            )}
            {hasRange && (
              <Text style={[styles.range, { color: sub }]} numberOfLines={1}>{t('value.range_chip', { value: item.range })}</Text>
            )}
          </View>
        )}

        {/* The trade advisor, opened with this item picked (2026-11-20). */}
        <TouchableOpacity
          style={[styles.advisor, { borderColor: accent + '55', backgroundColor: accent + '12' }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          onPress={() => {
            onClose?.();
            navigation.navigate('TradeAdvisor', { items: [{ name: item.name, category: item.category || item.type }] });
          }}
        >
          <FontAwesome name="wand-magic-sparkles" size={13} color={accent} />
          <Text style={[styles.advisorText, { color: accent }]} numberOfLines={1}>
            {t('advisor.item_button', { defaultValue: 'What can I get for this?' })}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  imageWrap: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  image: { width: 46, height: 46 },
  headerText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  tier: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: 'rgba(106,90,205,0.9)', maxWidth: '60%' },
  tierText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  category: { fontSize: 12, flexShrink: 1 },
  values: { flexDirection: 'row', gap: 8 },
  valueBox: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  valueBoxIdle: { borderColor: 'transparent' },
  valueLabel: { fontSize: 11, fontWeight: '600' },
  value: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  updated: { fontSize: 11, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: '100%' },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  range: { fontSize: 12 },
  advisor: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1 },
  advisorText: { fontSize: 13, fontWeight: '700' },
});

export default ItemDetailSheet;
