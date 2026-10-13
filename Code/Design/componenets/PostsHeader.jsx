import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';

const TAG_CONFIG = {
  'Scam Alert':        { icon: 'shield-halved',     color: '#EF4444' },
  'Looking for Trade': { icon: 'handshake',          color: '#10B981' },
  'Discussion':        { icon: 'comments',           color: '#3B82F6' },
  'Real or Fake':      { icon: 'magnifying-glass',   color: '#8B5CF6' },
  'Need Help':         { icon: 'circle-question',    color: '#F59E0B' },
  'Misc':              { icon: 'ellipsis',            color: '#6B7280' },
};

const SORT_MODES = [
  { key: 'latest',   icon: 'clock',             color: null },          // uses primary
  { key: 'hot',      icon: 'fire-flame-curved', color: '#F97316' },
  { key: 'trending', icon: 'arrow-trend-up',    color: '#10B981' },
];

const SORT_LABELS = { latest: 'feed.sort_latest', hot: 'feed.sort_hot', trending: 'feed.sort_trending' };

// `value` is the English tag stored on every post in Firestore (and queried
// by fetchPostsByTag), so it never changes; only the label is translated.
// Keyed by the lowercased value so PostCard can label old posts too
// ("Misc." came from an earlier build).
export const FEED_TAG_KEYS = {
  'scam alert':        'feed.tag_scam_alert',
  'looking for trade': 'feed.tag_looking_for_trade',
  'discussion':        'feed.tag_discussion',
  'real or fake':      'feed.tag_real_or_fake',
  'need help':         'feed.tag_need_help',
  'misc':              'feed.tag_misc',
  'misc.':             'feed.tag_misc',
};

// Display label for a stored tag value; unknown tags show as stored.
export const feedTagLabel = (tag, t) => {
  const key = FEED_TAG_KEYS[String(tag || '').toLowerCase()];
  return key ? t(key) : tag;
};

export const FEED_TAG_VALUES = ['Scam Alert', 'Looking for Trade', 'Discussion', 'Real or Fake', 'Need Help', 'Misc'];

const availableTags = FEED_TAG_VALUES.map((value) => ({ value }));

const PostsHeader = ({
  selectedTag,
  filterMyPosts,
  setFilterMyPosts,
  setSelectedTag,
  fetchInitialPosts,
  fetchMyPosts,
  fetchPostsByTag,
  activeSort = 'latest',
  onSortChange,
}) => {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const handleSelectTag = (value) => {
    if (selectedTag === value) {
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(false);
      setSelectedTag(value);
      fetchPostsByTag(value);
    }
  };

  const handleMyPosts = () => {
    if (filterMyPosts) {
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(true);
      setSelectedTag(null);
      fetchMyPosts();
    }
  };

  const handleSortChange = (sortKey) => {
    if (!onSortChange) return;
    setFilterMyPosts(false);
    setSelectedTag(null);
    onSortChange(sortKey);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.tabBarScroll,
        { backgroundColor: isDark ? config.colors.backgroundDark : '#fff', borderBottomColor: isDark ? config.colors.surfaceDark : '#e8e8f0' },
      ]}
      contentContainerStyle={styles.tabBar}
    >
      {/* ── Sort Modes: Latest / Hot / Trending ── */}
      {SORT_MODES.map(({ key, icon, color }) => {
        const isActive = activeSort === key && !filterMyPosts && !selectedTag;
        const activeColor = color || config.colors.primary;
        const inactiveColor = isDark ? '#64748b' : '#94a3b8';

        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.sortTab,
              isActive && {
                backgroundColor: activeColor + '18',
                borderColor: activeColor + '40',
                borderWidth: 1.5,
              },
            ]}
            onPress={() => handleSortChange(key)}
            activeOpacity={0.75}
          >
            <FontAwesome6
              name={icon}
              size={12}
              color={isActive ? activeColor : inactiveColor}
              solid
            />
            <Text
              style={[
                styles.sortTabText,
                { color: inactiveColor },
                isActive && { color: activeColor, fontWeight: '800' },
              ]}
            >
              {t(SORT_LABELS[key])}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* ── Separator ── */}
      <View style={[styles.separator, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />

      {/* ── My Posts ── */}
      <TouchableOpacity
        style={[
          styles.tab,
          filterMyPosts && {
            backgroundColor: config.colors.primary + '18',
            borderColor: config.colors.primary + '40',
            borderWidth: 1.5,
          },
        ]}
        onPress={handleMyPosts}
        activeOpacity={0.8}
      >
        <FontAwesome6
          name="user"
          size={11}
          color={filterMyPosts ? config.colors.primary : isDark ? '#64748b' : '#94a3b8'}
          solid
        />
        <Text
          style={[
            styles.tabText,
            { color: isDark ? '#64748b' : '#94a3b8' },
            filterMyPosts && { color: config.colors.primary, fontWeight: '800' },
          ]}
        >
           {t('feed.my_posts')}
        </Text>
      </TouchableOpacity>

      {/* ── Separator ── */}
      <View style={[styles.separator, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />

      {/* ── Tag pills ── */}
      {availableTags.map(({ value }) => {
        const cfg = TAG_CONFIG[value] || { icon: 'tag', color: config.colors.primary };
        const isActive = selectedTag === value;
        return (
          <TouchableOpacity
            key={value}
            style={[
              styles.tab,
              isActive && {
                backgroundColor: cfg.color + '18',
                borderColor: cfg.color + '40',
                borderWidth: 1.5,
              },
            ]}
            onPress={() => handleSelectTag(value)}
            activeOpacity={0.8}
          >
            <FontAwesome6
              name={cfg.icon}
              size={11}
              color={isActive ? cfg.color : isDark ? '#64748b' : '#94a3b8'}
              solid
            />
            <Text
              style={[
                styles.tabText,
                { color: isDark ? '#64748b' : '#94a3b8' },
                isActive && { color: cfg.color, fontWeight: '800' },
              ]}
            >
              {feedTagLabel(value, t)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  tabBarScroll: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 5,
    alignItems: 'center',
  },
  // Sort tabs (Latest / Hot / Trending)
  sortTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortTabText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Regular tabs (My Posts, tag pills)
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 10,
    fontWeight: '700',
  },
  separator: {
    width: 1,
    height: 20,
    borderRadius: 999,
    marginHorizontal: 2,
  },
});

export default PostsHeader;
