/**
 * BirthdayBits.jsx — small shared pieces of the Birthdays feature:
 *   BirthdayAvatar     photo or coloured initial
 *   BirthdayGradient   the pink-to-amber card background
 *   wishLine           how a received wish reads
 * Ported from Blox Fruit's Code/Birthdays (2026-10-13). The gradient is
 * react-native-svg, as on Home's cosmetics card, rather than Blox's CSS
 * backgroundImage (which crashes Android when a view gains it in place).
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { WISH_EMOJI } from './birthdayApi';

export const BIRTHDAY_PINK = '#EC4899';

const INITIAL_COLORS = ['#EC4899', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444'];
const colorFor = (name) => INITIAL_COLORS[[...String(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % INITIAL_COLORS.length];

export const BirthdayAvatar = ({ uri, name, size = 40, ring = false }) => {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle = ring ? { borderWidth: 2, borderColor: BIRTHDAY_PINK } : null;
  if (uri) return <Image resizeMethod="resize" source={{ uri }} style={[box, ringStyle]} />;
  return (
    <View style={[box, ringStyle, { backgroundColor: colorFor(name), alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}>
        {String(name || '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
};

/** Fills its parent (give the parent overflow: 'hidden' and a borderRadius). */
export const BirthdayGradient = React.memo(({ id = 'bday' }) => (
  <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100" pointerEvents="none">
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#F472B6" />
        <Stop offset="0.45" stopColor="#EC4899" />
        <Stop offset="1" stopColor="#F59E0B" />
      </LinearGradient>
    </Defs>
    <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
  </Svg>
));

/** Label for a received wish: "🎉 Have an awesome day!" */
export const wishLine = (t, template) =>
  `${WISH_EMOJI[template] || '🎂'} ${t(`birthdays.wishes.${WISH_EMOJI[template] ? template : 'hbd'}`)}`;
