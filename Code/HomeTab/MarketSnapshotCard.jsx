// MarketSnapshotCard — Home's one compact "what moved" card (2026-11-04,
// batch 2). Numbers come from ./marketSnapshot.js (Supreme's per-item change
// since its last value update, already in the downloaded feed: no reads).
// Renders nothing when there is no movement data, so a failed or missing
// Supreme feed leaves no empty card behind.
//
// Visual language of Code/Homescreen/SlotActionSheet.jsx: 15px bold title,
// 11–12px labels, 14px card radius, neutral chips, green / red only for the
// direction of a move.
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SCREEN_GUTTER } from '../Helper/layout';
import { formatPct } from './marketSnapshot';

const FONT_BOLD = 'Lato-Bold';
const FONT_REGULAR = 'Lato-Regular';

const MarketSnapshotCard = ({ snapshot, updatedText, colors, dark, onOpenItem }) => {
  const { t } = useTranslation();
  if (!snapshot) return null;

  const chipBg = dark ? '#334155' : '#f1f5f9';
  const up = dark ? '#4ade80' : '#16a34a';
  const down = dark ? '#f87171' : '#dc2626';

  const stats = [
    { key: 'changed', label: t('market.changed', { defaultValue: 'Changed' }), value: snapshot.changed, color: colors.text },
    { key: 'rising', label: t('market.rising', { defaultValue: 'Rising' }), value: snapshot.rising, color: up },
    { key: 'falling', label: t('market.falling', { defaultValue: 'Falling' }), value: snapshot.falling, color: down },
  ];

  const column = (title, rows, color) => (
    <View style={s.col}>
      <Text style={[s.colTitle, { color: colors.textSecondary }]} numberOfLines={1}>{title}</Text>
      {rows.map(({ item, pct }) => (
        <TouchableOpacity
          key={item.id || item.name}
          style={s.row}
          onPress={() => onOpenItem(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} ${formatPct(pct)}`}
        >
          <Text style={[s.rowName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[s.rowPct, { color }]} numberOfLines={1}>{formatPct(pct)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[s.card, { backgroundColor: colors.bgAlt, borderColor: colors.border }]}>
      <View style={s.head}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: colors.text }]}>{t('market.title', { defaultValue: 'Market' })}</Text>
          <View style={[s.sourceChip, { backgroundColor: chipBg }]}>
            <Text style={[s.sourceText, { color: colors.textSecondary }]}>Supreme</Text>
          </View>
        </View>
        {!!updatedText && <Text style={[s.updated, { color: colors.textSecondary }]} numberOfLines={1}>{updatedText}</Text>}
      </View>

      <View style={s.stats}>
        {stats.map((st) => (
          <View key={st.key} style={[s.stat, { backgroundColor: chipBg }]}>
            <Text style={[s.statValue, { color: st.color }]} numberOfLines={1}>{st.value.toLocaleString()}</Text>
            <Text style={[s.statLabel, { color: colors.textSecondary }]} numberOfLines={1}>{st.label}</Text>
          </View>
        ))}
      </View>

      {(snapshot.topRising.length > 0 || snapshot.topFalling.length > 0) && (
        <View style={s.cols}>
          {column(t('market.top_rising', { defaultValue: 'Top rising' }), snapshot.topRising, up)}
          {column(t('market.top_falling', { defaultValue: 'Top falling' }), snapshot.topFalling, down)}
        </View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  card: { marginHorizontal: SCREEN_GUTTER, marginTop: 20, padding: 14, borderRadius: 14, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  title: { fontSize: 15, fontFamily: FONT_BOLD },
  sourceChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  sourceText: { fontSize: 10.5, fontFamily: FONT_BOLD },
  updated: { fontSize: 11, fontFamily: FONT_REGULAR, flexShrink: 1, textAlign: 'right' },
  stats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  stat: { flex: 1, minWidth: 0, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  statValue: { fontSize: 15, fontFamily: FONT_BOLD },
  statLabel: { fontSize: 11, fontFamily: FONT_REGULAR, marginTop: 1 },
  cols: { flexDirection: 'row', gap: 12, marginTop: 10 },
  col: { flex: 1, minWidth: 0 },
  colTitle: { fontSize: 11, fontFamily: FONT_BOLD, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  rowName: { flex: 1, minWidth: 0, fontSize: 12, fontFamily: FONT_REGULAR },
  rowPct: { fontSize: 12, fontFamily: FONT_BOLD },
});

export default memo(MarketSnapshotCard);
