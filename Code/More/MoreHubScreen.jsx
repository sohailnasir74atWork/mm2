/**
 * MoreHubScreen.jsx
 * The More tab's home: one card per tool. Same layout as Adopt Me's More hub
 * (adoptme-jan7/Code/More/MoreHubScreen.jsx): a full-width hero card, then a
 * two-column grid.
 *
 * News, Complaints & ideas and the Admin inbox are Adopt Me's screens, ported
 * 2026-10-13 and pushed onto the More stack (./MoreNavigator). The other cards
 * open MM2's existing root-stack screens (App.js). Only tools that are NOT on
 * Home belong here: Home keeps the core (Values, Top Rated, Friends, Daily
 * Stars, Trade Match, My Stuff), and nothing appears on both screens.
 *
 * Trade Match lives on Home (owner, 2026-10-13), not here.
 *
 * Icons and hues are Home's (HomeIcons + accents), not bitmaps.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useThemeColors } from '../Helper/themeColors';
import { useHaptic } from '../Helper/HepticFeedBack';
import { SCREEN_GUTTER } from '../Helper/layout';
import HomeIcon from '../HomeTab/HomeIcons';
import { accentFor } from '../HomeTab/accents';
import BannerAdComponent from '../Ads/bannerAds';
import SignInDrawer from '../Firebase/SigninDrawer';
import { flipInRTL } from '../Helper/rtl';

const FONT_BOLD = 'Lato-Bold';
const FONT_REGULAR = 'Lato-Regular';

const chunkPairs = (items) => {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
};

const MoreHubScreen = ({ navigation, selectedTheme }) => {
  const { t } = useTranslation();
  const { theme, user, isAdmin } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const insets = useSafeAreaInsets();
  const C = useThemeColors();
  const dark = theme === 'dark';
  // Tab screens stay mounted, so the StatusBar only renders while this one is
  // on screen (same reason as HomeTabScreen).
  const isFocused = useIsFocused();

  const [signinVis, setSigninVis] = useState(false);
  const [signinMsg, setSigninMsg] = useState('');

  const cards = useMemo(() => {
    const list = [
      { key: 'news', icon: 'news', accent: 'amber', title: t('tabs.news'), desc: t('more_hub.news_desc'), screen: 'MoreNews' },
      { key: 'reports', icon: 'report', accent: 'coral', title: t('reports.title'), desc: t('more_hub.reports_desc'), screen: 'MoreReport' },
      { key: 'birthdays', icon: 'cake', accent: 'rose', title: t('birthdays.title'), desc: t('more_hub.birthdays_desc'), screen: 'Birthdays' },
      { key: 'cosmetics', icon: 'cosmetics', accent: 'violet', title: t('home.my_cosmetics'), desc: t('more_hub.cosmetics_desc'), screen: 'MyCosmeticsScreen', signIn: t('more_hub.signin_cosmetics') },
      { key: 'team', icon: 'shield', accent: 'blue', title: t('home.our_team'), desc: t('home.our_team_sub'), screen: 'ModsScreen' },
    ];
    // Admin-only card, left in English like the rest of the staff tools. The
    // moderation dashboard is not here: Home's shield button opens it.
    if (isAdmin) list.push({ key: 'admin', icon: 'inbox', accent: 'kelp', title: 'Admin', desc: 'Complaints, ideas and old feedback', screen: 'MoreAdmin' });
    return list;
  }, [t, isAdmin]);

  const open = (card) => {
    triggerHapticFeedback('impactLight');
    if (card.signIn && !user?.id) {
      setSigninMsg(card.signIn);
      setSigninVis(true);
      return;
    }
    if (card.action) card.action();
    else navigation.navigate(card.screen);
  };

  const hero = { key: 'egg', screen: 'MysteryEggScreen', signIn: t('more_hub.signin_eggs') };

  return (
    // The inset pads the outer view, not the scroll content: Android is
    // edge-to-edge, so padded content would scroll up under the status bar.
    <View style={[styles.flex1, { backgroundColor: C.bg, paddingTop: insets.top }]}>
      {isFocused && <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: C.text }]}>{t('tabs.more')}</Text>
          <Text style={[styles.headerSub, { color: C.textSecondary }]}>{t('more_hub.subtitle')}</Text>
        </View>

        {/* Hero: cosmetics, the one tool here that is about fun rather than data. */}
        <TouchableOpacity
          style={styles.hero}
          onPress={() => open(hero)}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={t('home.win_cosmetics')}
        >
          <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="moreHero" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#6A5ACD" />
                <Stop offset="0.55" stopColor="#8B4FC9" />
                <Stop offset="1" stopColor="#C2417F" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#moreHero)" />
          </Svg>
          <View pointerEvents="none" style={styles.heroGlow} />
          <View style={styles.flex1}>
            <Text style={styles.heroTitle}>{t('home.cosmetics_hero_title')}</Text>
            <Text style={styles.heroSub} numberOfLines={2}>{t('home.cosmetics_hero_sub')}</Text>
            <View style={styles.heroBtn}>
              <Text style={styles.heroBtnText}>{t('home.win_cosmetics')}</Text>
              <FontAwesome name="arrow-right" size={11} color="#5B3FB0" style={flipInRTL} />
            </View>
          </View>
          <View pointerEvents="none" style={styles.heroIcon}>
            <HomeIcon name="egg" size={84} color="rgba(255,255,255,0.9)" />
          </View>
        </TouchableOpacity>

        {chunkPairs(cards).map((row) => (
          <View key={row[0].key} style={styles.row}>
            {row.map((card) => {
              const a = accentFor(card.accent, dark);
              return (
                <TouchableOpacity
                  key={card.key}
                  style={[styles.card, { backgroundColor: C.cardBg, borderColor: C.cardBorder }]}
                  onPress={() => open(card)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${card.title}. ${card.desc}`}
                >
                  <View style={[styles.cardWash, { backgroundColor: a.tint }]} />
                  <View style={styles.cardTop}>
                    <View style={[styles.cardIcon, { backgroundColor: dark ? '#FFFFFF0D' : '#FFFFFFB3' }]}>
                      <HomeIcon name={card.icon} size={30} color={a.color} />
                    </View>
                    <View style={[styles.chevron, { backgroundColor: a.color }]}>
                      <FontAwesome name="chevron-right" size={10} color={dark ? C.bg : '#FFFFFF'} style={flipInRTL} />
                    </View>
                  </View>
                  <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>{card.title}</Text>
                  <Text style={[styles.cardDesc, { color: C.textSecondary }]} numberOfLines={2}>{card.desc}</Text>
                </TouchableOpacity>
              );
            })}
            {row.length === 1 && <View style={styles.cardSpacer} />}
          </View>
        ))}
      </ScrollView>

      {/* Plain, not collapsible: the expanding first load stays on Home. */}
      <BannerAdComponent />

      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="More" message={signinMsg} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingHorizontal: SCREEN_GUTTER, paddingTop: 12, paddingBottom: 32 },
  header: { marginBottom: 16 },
  headerTitle: { fontSize: 28, fontFamily: FONT_BOLD, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, fontFamily: FONT_REGULAR, marginTop: 2 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 18, paddingRight: 10, borderRadius: 22, marginBottom: 12, overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute', right: -30, top: -40, width: 170, height: 170, borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: FONT_BOLD, letterSpacing: -0.3 },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 12.5, fontFamily: FONT_REGULAR, lineHeight: 17, marginTop: 4 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFFFFF',
  },
  heroBtnText: { color: '#5B3FB0', fontSize: 12.5, fontFamily: FONT_BOLD },
  heroIcon: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '12deg' }] },

  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  card: { flex: 1, minHeight: 148, padding: 14, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  cardSpacer: { flex: 1 },
  cardWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 74 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  cardIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontFamily: FONT_BOLD },
  cardDesc: { fontSize: 11.5, fontFamily: FONT_REGULAR, lineHeight: 15, marginTop: 3 },
});

export default MoreHubScreen;
