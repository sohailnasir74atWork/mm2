/**
 * BadgesScreen.js — Visual Badges & Achievements screen
 * Shows: XP progress, earned badges, level roadmap.
 *
 * Simplified for MM2 — no Lottie, no ViewShot/Share,
 * uses emoji-based badges with XP level progression.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';
import {
  LEVELS, getLevelFromXP, getNextLevel, getXPProgress, getUserXP,
} from '../Engagement/xpUtils';

const { width } = Dimensions.get('window');
const BADGE_CARD_WIDTH = (width - 64) / 3;

// ── MM2-specific badge definitions ──
const MM2_BADGES = [
  { id: 'firstTrade', emoji: '🤝', name: 'First Trade', hint: 'Complete your first trade check', color: '#4A7FB5' },
  { id: 'collector10', emoji: '📦', name: 'Collector', hint: 'Add 10 items to favorites', color: '#3D9B7A' },
  { id: 'collector50', emoji: '💎', name: 'Hoarder', hint: 'Add 50 items to favorites', color: '#7E6CB5' },
  { id: 'quizPerfect', emoji: '🧠', name: 'Quiz Master', hint: 'Perfect score in Daily Quiz', color: '#C49530' },
  { id: 'spinner', emoji: '🎡', name: 'Lucky Spin', hint: 'Spin the wheel 10 times', color: '#B06048' },
  { id: 'streak3', emoji: '🔥', name: 'On Fire', hint: '3-day app streak', color: '#B06048' },
  { id: 'streak7', emoji: '⚡', name: 'Dedicated', hint: '7-day app streak', color: '#C49530' },
  { id: 'streak30', emoji: '🌟', name: 'Legendary', hint: '30-day app streak', color: '#7E6CB5' },
  { id: 'chatActive', emoji: '💬', name: 'Social', hint: 'Send 50 chat messages', color: '#4A7FB5' },
  { id: 'level5', emoji: '🏅', name: 'Rising', hint: 'Reach level 5', color: '#3D9B7A' },
  { id: 'level10', emoji: '🏆', name: 'Veteran', hint: 'Reach level 10', color: '#C49530' },
  { id: 'level20', emoji: '👑', name: 'Mythic', hint: 'Reach level 20', color: '#7E6CB5' },
  { id: 'starDay7', emoji: '⭐', name: 'Star Week', hint: 'Claim all 7 daily stars', color: '#C49530' },
  { id: 'valuator', emoji: '📊', name: 'Analyst', hint: 'Check analytics 10 times', color: '#5A94AA' },
  { id: 'nightOwl', emoji: '🦉', name: 'Night Owl', hint: 'Use app after midnight', color: '#6B7C8D' },
];

// ── XP Progress Header ──
const XPHeader = ({ xp, c, t }) => {
  const currentLevel = getLevelFromXP(xp);
  const nextLevel = getNextLevel(xp);
  const progress = getXPProgress(xp);
  const isMax = currentLevel.level === nextLevel.level;

  return (
    <View style={[s.xpCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
      <View style={s.xpTopRow}>
        <Text style={{ fontSize: 28 }}>{currentLevel.emoji}</Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.xpTitle, { color: c.text }]}>{currentLevel.title}</Text>
          <Text style={[s.xpSubtitle, { color: c.textSecondary }]}>
            {t('badges.level_info', { level: currentLevel.level, xp: xp.toLocaleString() })}
          </Text>
        </View>
        {!isMax && (
          <View style={s.xpNextBadge}>
            <Text style={{ fontSize: 9, color: c.textMuted, fontWeight: '600' }}>{t('badges.next')}</Text>
            <Text style={{ fontSize: 14 }}>{nextLevel.emoji}</Text>
          </View>
        )}
      </View>
      <View style={[s.progressBg, { backgroundColor: c.border }]}>
        <View style={[s.progressFill, {
          width: `${Math.max(3, Math.round(progress * 100))}%`,
          backgroundColor: c.primary,
        }]} />
      </View>
      <Text style={[s.progressLabel, { color: c.textMuted }]}>
        {isMax ? t('badges.max_level') : t('badges.xp_to_next', { xp: (nextLevel.xp - xp).toLocaleString(), levelTitle: nextLevel.title })}
      </Text>
    </View>
  );
};

// ── Badge Card ──
const BadgeCard = ({ badge, earned, c, t }) => (
  <View style={[s.badgeCard, {
    backgroundColor: earned ? badge.color + '15' : c.bgAlt,
    borderColor: earned ? badge.color + '40' : c.border,
    opacity: earned ? 1 : 0.55,
  }]}>
    <Text style={{ fontSize: 28, opacity: earned ? 1 : 0.3 }}>
      {earned ? badge.emoji : '🔒'}
    </Text>
    <Text style={[s.badgeName, { color: earned ? badge.color : c.textMuted }]} numberOfLines={1}>
      {t(`badges.list.${badge.id}.name`)}
    </Text>
    {earned ? (
      <View style={[s.earnedTag, { backgroundColor: badge.color + '20' }]}>
        <Text style={[s.earnedTagText, { color: badge.color }]}>{t('badges.earned')}</Text>
      </View>
    ) : (
      <Text style={[s.badgeHint, { color: c.textMuted }]} numberOfLines={2}>
        {t(`badges.list.${badge.id}.hint`)}
      </Text>
    )}
  </View>
);

// ── Level Roadmap ──
const LevelRow = ({ level, currentLevel, c, t }) => {
  const reached = currentLevel >= level.level;
  const isCurrent = currentLevel === level.level;

  return (
    <View style={[s.levelRow, {
      backgroundColor: isCurrent ? c.primary + '15' : 'transparent',
      borderColor: isCurrent ? c.primary + '40' : c.border,
    }]}>
      <Text style={{ fontSize: 22, opacity: reached ? 1 : 0.35 }}>{level.emoji}</Text>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[s.levelName, { color: reached ? c.text : c.textMuted }]}>
          {level.title}
        </Text>
        <Text style={[s.levelXP, { color: c.textMuted }]}>
          {level.xp.toLocaleString()} XP
        </Text>
      </View>
      {reached && <Icon name="checkmark-circle" size={18} color={c.primary} />}
      {isCurrent && <Text style={[s.currentTag, { color: c.primary }]}>{t('badges.you')}</Text>}
    </View>
  );
};

const BadgesScreen = ({ navigation }) => {
  const { theme, appdatabase, user } = useGlobalState();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const [xp, setXp] = useState(0);
  const [earnedBadges, setEarnedBadges] = useState(new Set());
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    if (!appdatabase || !user?.id) return;
    getUserXP(appdatabase, user.id).then(data => {
      setXp(data.total || 0);

      // Determine earned badges based on XP level
      const earned = new Set();
      const level = getLevelFromXP(data.total || 0).level;
      if (level >= 5) earned.add('level5');
      if (level >= 10) earned.add('level10');
      if (level >= 20) earned.add('level20');

      // Future: also check Firestore for activity-based badges
      setEarnedBadges(earned);
    });
  }, [appdatabase, user?.id]);

  const currentLevel = getLevelFromXP(xp);

  const TABS = [t('badges.tabs_badges'), t('badges.tabs_levels')];

  return (
    <View style={[s.container, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: c.divider }]}>
        {navigation?.goBack && (
          <TouchableOpacity onPress={navigation.goBack} style={s.backBtn}>
            <Icon name="arrow-back" size={22} color={c.text} />
          </TouchableOpacity>
        )}
        <Text style={[s.headerTitle, { color: c.text }]}>{t('badges.title')}</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* XP Header */}
      <XPHeader xp={xp} c={c} t={t} />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f0f0f0' }]}>
        {TABS.map((tab, idx) => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === idx && { backgroundColor: c.primary }]}
            onPress={() => setActiveTab(idx)}
          >
            <Text style={[s.tabText, { color: activeTab === idx ? '#fff' : c.textSecondary }]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Badges Tab */}
        {activeTab === 0 && (
          <>
            <Text style={[s.sectionTitle, { color: c.text }]}>
              {t('badges.earned_count', { count: earnedBadges.size, total: MM2_BADGES.length })}
            </Text>
            <View style={s.badgeGrid}>
              {MM2_BADGES.map(badge => (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  earned={earnedBadges.has(badge.id)}
                  c={c}
                  t={t}
                />
              ))}
            </View>
          </>
        )}

        {/* Levels Tab */}
        {activeTab === 1 && (
          <View style={s.levelList}>
            {LEVELS.map(level => (
              <LevelRow
                key={level.level}
                level={level}
                currentLevel={currentLevel.level}
                c={c}
                t={t}
              />
            ))}
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  tabBar: {
    flexDirection: 'row', marginHorizontal: 16, marginVertical: 10,
    borderRadius: 10, padding: 3,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabText: { fontSize: 13, fontWeight: '600' },
  content: { padding: 16, paddingTop: 4 },

  xpCard: {
    marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 16,
    borderWidth: 1,
  },
  xpTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  xpTitle: { fontSize: 18, fontWeight: '800' },
  xpSubtitle: { fontSize: 12, marginTop: 1 },
  xpNextBadge: { alignItems: 'center', gap: 2 },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#4A7FB5' },
  progressLabel: { fontSize: 10, marginTop: 6, fontWeight: '600' },

  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 12 },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeCard: {
    width: BADGE_CARD_WIDTH, padding: 12, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', gap: 4,
  },
  badgeName: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  earnedTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  earnedTagText: { fontSize: 9, fontWeight: '700' },
  badgeHint: { fontSize: 9, textAlign: 'center', lineHeight: 12 },

  levelList: { gap: 6 },
  levelRow: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderRadius: 12, borderWidth: 1, gap: 4,
  },
  levelName: { fontSize: 14, fontWeight: '700' },
  levelXP: { fontSize: 11, marginTop: 1 },
  currentTag: { fontSize: 10, fontWeight: '800', marginLeft: 4 },
});

export default BadgesScreen;
