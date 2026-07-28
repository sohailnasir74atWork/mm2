/**
 * XPBar.js
 * Animated XP progress bar with level display.
 *
 * Shows: [emoji] Level X · Title ────────── XP/NextXP
 *
 * Usage:
 *   <XPBar xp={4520} isDarkMode={true} />
 *   <XPBar xp={4520} isDarkMode={true} compact />
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { getLevelFromXP, getNextLevel, getXPProgress } from './xpUtils';
import { getThemeColors } from '../Helper/themeColors';

const XPBar = ({ xp = 0, isDarkMode = false, compact = false }) => {
  const currentLevel = useMemo(() => getLevelFromXP(xp), [xp]);
  const nextLevel = useMemo(() => getNextLevel(xp), [xp]);
  const progress = useMemo(() => getXPProgress(xp), [xp]);
  const isMaxLevel = currentLevel.level === nextLevel.level;

  // Animated width
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: progress,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // Colors
  const c = getThemeColors(isDarkMode);
  const barBg = c.xpBarBg;
  const barFill = getBarColor(currentLevel.level);
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <Text style={{ fontSize: 12 }}>{currentLevel.emoji}</Text>
        <Text style={[styles.compactLevel, { color: textColor }]}>
          {' '}Lv.{currentLevel.level}
        </Text>
        <View style={[styles.compactBar, { backgroundColor: barBg }]}>
          <Animated.View
            style={[
              styles.compactFill,
              {
                backgroundColor: barFill,
                width: animatedWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, {
      backgroundColor: c.bgAlt,
      borderColor: c.border,
    }]}>
      {/* Header: Level + Title */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 16 }}>{currentLevel.emoji}</Text>
          <Text style={[styles.levelText, { color: textColor }]}>
            Level {currentLevel.level}
          </Text>
        </View>
        <Text style={[styles.titleText, { color: barFill }]}>
          {currentLevel.title}
        </Text>
      </View>

      {/* Progress Bar */}
      <View style={[styles.barContainer, { backgroundColor: barBg }]}>
        <Animated.View
          style={[
            styles.barFill,
            {
              backgroundColor: barFill,
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      {/* XP count */}
      <View style={styles.xpRow}>
        <Text style={[styles.xpText, { color: subtextColor }]}>
          {formatXP(xp)} XP
        </Text>
        {!isMaxLevel && (
          <Text style={[styles.xpText, { color: subtextColor }]}>
            {formatXP(nextLevel.xp)} XP
          </Text>
        )}
        {isMaxLevel && (
          <Text style={[styles.xpText, { color: barFill }]}>
            MAX ✨
          </Text>
        )}
      </View>
    </View>
  );
};

// Format XP nicely: 1500 → "1.5K", 40000 → "40K"
const formatXP = (xp) => {
  if (xp >= 10000) return `${(xp / 1000).toFixed(0)}K`;
  if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
  return String(xp);
};

// Sober color tiers for MM2 (steel-blue progression)
const getBarColor = (level) => {
  if (level >= 25) return '#C49530'; // Gold — Godly/Ancient/Mythic
  if (level >= 20) return '#7E6CB5'; // Muted purple — Sheriff
  if (level >= 15) return '#4A7FB5'; // Steel blue — Trade Pro
  if (level >= 10) return '#3D9B7A'; // Teal green — Collector/Veteran
  if (level >= 5)  return '#5A94AA'; // Slate teal — Scout/Detective
  return '#7A8A9A';                  // Cool gray — Rookie/Trainee
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  levelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  titleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  barContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  xpText: {
    fontSize: 11,
    fontWeight: '500',
  },
  // Compact variant
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactLevel: {
    fontSize: 11,
    fontWeight: '600',
  },
  compactBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  compactFill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default React.memo(XPBar);
