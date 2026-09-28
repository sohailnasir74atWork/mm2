/**
 * ValueCard — one item in the Values grid.
 *
 * Shows BOTH catalogues: the one the user picked (the MM2 | Supreme switch on
 * the Values screen, shared with the calculator) large, the other small
 * underneath. The two disagree on ~70% of shared items, so seeing both side by
 * side is the point — a trader can tell at a glance when the sources differ.
 */
import React, { memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import config from '../Helper/Environment';
import { SCREEN_GUTTER } from '../Helper/layout';
import { VALUE_SOURCE } from '../Helper/valueSources';

export const CARD_GAP = 10;
const CARD_W = (Dimensions.get('window').width - SCREEN_GUTTER * 2 - CARD_GAP) / 2;

// The feeds write "no value" as 'N/A', '[N/A]', '-' and friends.
const present = (v) => v != null && !/^\W*(n\/?a|none|-)?\W*$/i.test(String(v));

const SOURCE_NAME = { [VALUE_SOURCE.MM2]: 'MM2', [VALUE_SOURCE.SUPREME]: 'Supreme' };

const ValueCard = ({
  item, imageUrl, primary, secondary, source, otherSource,
  stabilityColor, isDarkMode, onPress, disabled,
}) => {
  const c = isDarkMode
    ? { card: config.colors.surfaceDark, well: '#0d2137', text: '#e8ecf1', sub: '#8a95a5', line: 'rgba(255,255,255,0.07)' }
    : { card: '#ffffff', well: '#f1f3f8', text: '#1c1e21', sub: '#65707e', line: 'rgba(0,0,0,0.07)' };
  const hasDemand = present(item.demand);
  const hasStability = present(item.stability);
  const hasRange = present(item.range);

  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <View style={[s.well, { backgroundColor: c.well }]}>
        <Image source={{ uri: imageUrl }} style={s.image} resizeMode="contain" />
        {!!item.tier && (
          <View style={s.tier}>
            <Text style={s.tierText}>{String(item.tier).replace(/^tier\s*/i, 'T')}</Text>
          </View>
        )}
      </View>

      <Text style={[s.name, { color: c.text }]} numberOfLines={1}>{item.name}</Text>

      <View style={s.primaryRow}>
        <Text style={s.primaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{primary}</Text>
        <Text style={[s.sourceTag, { color: c.sub }]}>{SOURCE_NAME[source]}</Text>
      </View>
      <Text style={[s.secondary, { color: c.sub }]} numberOfLines={1}>
        {SOURCE_NAME[otherSource]} · {secondary}
      </Text>

      {(hasDemand || hasStability) && (
        <View style={s.chips}>
          {hasDemand && (
            <View style={[s.chip, { backgroundColor: c.well }]}>
              <Text style={[s.chipText, { color: c.sub }]}>Demand {item.demand}</Text>
            </View>
          )}
          {hasStability && (
            <View style={[s.chip, { backgroundColor: stabilityColor + '1F' }]}>
              <View style={[s.dot, { backgroundColor: stabilityColor }]} />
              <Text style={[s.chipText, { color: stabilityColor }]} numberOfLines={1}>{item.stability}</Text>
            </View>
          )}
        </View>
      )}
      {hasRange && <Text style={[s.range, { color: c.sub }]} numberOfLines={1}>Range {item.range}</Text>}
    </TouchableOpacity>
  );
};

const s = StyleSheet.create({
  card: {
    width: CARD_W, marginBottom: CARD_GAP,
    borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 10,
  },
  well: { height: 96, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  image: { width: 76, height: 76 },
  tier: {
    position: 'absolute', top: 6, left: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    backgroundColor: 'rgba(106,90,205,0.9)',
  },
  tierText: { fontSize: 10, fontFamily: 'Lato-Bold', color: '#fff' },
  name: { fontSize: 14, fontFamily: 'Lato-Bold', marginTop: 10 },
  primaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  primaryValue: { flexShrink: 1, fontSize: 18, fontFamily: 'Lato-Bold', color: config.colors.primary },
  sourceTag: { fontSize: 10, fontFamily: 'Lato-Bold', letterSpacing: 0.4, textTransform: 'uppercase' },
  secondary: { fontSize: 12, fontFamily: 'Lato-Regular', marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, maxWidth: '100%' },
  chipText: { fontSize: 10.5, fontFamily: 'Lato-Bold', flexShrink: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  range: { fontSize: 10.5, fontFamily: 'Lato-Regular', marginTop: 6 },
});

export default memo(ValueCard);
