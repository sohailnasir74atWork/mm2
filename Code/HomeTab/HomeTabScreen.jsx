/**
 * HomeTabScreen — home: search, tools, portfolio, status feed
 *
 * Layout follows FischValues' Home (FischValues/Code/HomeTab/HomeTabScreen.jsx):
 * a coloured header band, a search bar that lands on Values results, a 2x2
 * tool grid, then the secondary extras at a smaller weight.
 *
 * Home holds only the core tools. Cosmetics (egg hatching), Our Team and
 * Invite moved to the More tab (Code/More/MoreHubScreen.jsx) on 2026-10-13;
 * nothing appears on both screens, so add a tool to one or the other.
 *
 * The mini-games row is no longer on Home. The game screens (ArrowGameScreen,
 * GameScreen) are still registered in App.js, so nothing that deep-links into
 * them breaks; they just have no entry point here.
 */
import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, StatusBar, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { useThemeColors } from '../Helper/themeColors';
import {
  buildItemPool, unwrapFeed, priceOf, isSummable, DEFAULT_VALUE_SOURCE,
} from '../Helper/valueSources';
import { setAppLanguage } from '../../i18n';
import { useLanguage } from '../Translation/LanguageProvider';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import BannerAdComponent from '../Ads/bannerAds';
import HomeIcon from './HomeIcons';
import { accentFor } from './accents';
import { SCREEN_GUTTER } from '../Helper/layout';

import DailyStarRewards from '../Engagement/DailyStarRewards';
import SignInDrawer from '../Firebase/SigninDrawer';

import StatusFeed from '../Design/StatusFeed';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getMyCosmetics, syncMyCosmetics } from '../Helper/cosmeticsCache';
import BirthdayHomeCard from '../Birthdays/BirthdayHomeCard';
import BanStatusCard from './BanStatusCard';
import { flipInRTL } from '../Helper/rtl';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español (Latinoamérica)', flag: '🇲🇽' },
  { code: 'es-ES', name: 'Español (España)', flag: '🇪🇸' },
  // pt was auto-picked on Portuguese phones but missing here, so a player who
  // switched away could never come back. Complete since 2026-10-13.
  { code: 'pt', name: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
];

// ── Home header band ───────────────────────────────────────────────────────
// A deep slate-blue in BOTH themes rather than following the page, so the
// heading stops reading as the first row of content. Dark enough to carry
// white text either way, so the status bar icons never change with the theme.
const HEADER_BG = '#4B3FA6'; // deeper cut of the brand #6A5ACD
const HEADER_TEXT = '#FFFFFF';
const HEADER_TEXT_DIM = 'rgba(255,255,255,0.78)';
const HEADER_BTN_BG = 'rgba(255,255,255,0.16)';

// On iOS the root SafeAreaView in App.js pads the top, so the band cannot
// reach behind the status bar, and the status bar stays native (owner
// decision 2026-09-27: no tinting it to match). A full-width band would then
// start with a squared-off top under a dark strip, so on iOS the band floats
// as a rounded card instead. Android is edge-to-edge and keeps the full bleed.
const HEADER_FLOATS = Platform.OS === 'ios';


const FONT_BOLD = 'Lato-Bold';
const FONT_REGULAR = 'Lato-Regular';

const fmt = (v) => {
  if (!v || typeof v !== 'number') return '0';
  const smart = (n, u) => { const s = n.toFixed(1); return (s.endsWith('.0') ? n.toFixed(0) : s) + u; };
  if (v >= 1e9) return smart(v / 1e9, 'B');
  if (v >= 1e6) return smart(v / 1e6, 'M');
  if (v >= 1e3) return smart(v / 1e3, 'K');
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(1);
};

const HomeTabScreen = ({ selectedTheme }) => {
  const { theme, user, appdatabase, firestoreDB, isAdmin, canGrantJmd } = useGlobalState();
  // Same gate MainTabs uses for the moderation trophy. That one lives on the
  // Calculator tab's headerRight, which is the ONLY header in the tab navigator
  // (Home / Trade / Designs / Chat all set headerShown: false), so staff who
  // stay on Home never saw an entry point to the dashboard.
  const canOpenModeration = isAdmin || !!user?.isModerator || !!user?.isBabyMod || !!canGrantJmd;
  const { localState } = useLocalState();
  const { t, i18n } = useTranslation();
  const { changeLanguage: setLang } = useLanguage();
  const nav = useNavigation();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  // Only while Home is on screen: bottom-tab screens stay mounted, so an
  // unconditional <StatusBar> here would keep forcing light icons on the other
  // tabs too. Unmounting it pops RN's status-bar stack back to App.js's entry.
  const isFocused = useIsFocused();

  const [showDailyStars, setShowDailyStars] = useState(false);
  const [homeQuery, setHomeQuery] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);

  const curLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  const handleLangSelect = (code) => {
    // All languages are free
    setLang(code);
    setAppLanguage(code);
    setShowLangPicker(false);
  };

  const [signinVis, setSigninVis] = useState(false);
  const [signinMsg, setSigninMsg] = useState('');
  const [owned, setOwned] = useState([]);
  // Equipped cosmetics — seeded from MMKV so the frame paints on first render
  const [myCosmetics, setMyCosmetics] = useState(() => getMyCosmetics());

  // Stable, so memo(StatusFeed) holds while typing in the search box.
  const requireSignInForStatus = useCallback(() => {
    setSigninMsg(t('home.signin_status'));
    setSigninVis(true);
  }, [t]);

  const guard = (fn, msg) => {
    if (!user?.id) { setSigninMsg(msg || t('home.signin_continue')); setSigninVis(true); return; }
    fn();
  };

  // Re-read the equipped frame from MMKV whenever this screen regains focus, so
  // something just equipped in My Cosmetics shows without a remount. Sync read,
  // no DB cost. The DB sync below reconciles it when signed in.
  useFocusEffect(useCallback(() => {
    setMyCosmetics(getMyCosmetics());
    if (user?.id && appdatabase) {
      syncMyCosmetics(appdatabase, user.id).then(c => c && setMyCosmetics(c)).catch(() => {});
    }
  }, [user?.id, appdatabase]));

  useFocusEffect(useCallback(() => {
    if (!user?.id || !firestoreDB) return;
    (async () => {
      try {
        let s = await getDoc(doc(firestoreDB, 'user_profiles', user.id));
        if (!s.exists()) s = await getDoc(doc(firestoreDB, 'reviews', user.id));
        if (s.exists()) setOwned(Array.isArray(s.data()?.ownedPets) ? s.data().ownedPets : []);
      } catch {}
    })();
  }, [user?.id, firestoreDB]));

  const greet = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? t('home.good_morning') : h < 17 ? t('home.good_afternoon') : t('home.good_evening');
  }, [t]);

  // Which catalogue prices this screen. See Code/Helper/valueSources.js.
  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;

  const parsedData = useMemo(() => {
    const parse = (raw) => {
      try {
        if (!raw) return null;
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return p && typeof p === 'object' ? unwrapFeed(p) : null;
      } catch { return null; }
    };
    // One deduped pool from both catalogues, same as the calculator.
    return buildItemPool(parse(localState?.data), parse(localState?.suprime));
  }, [localState?.data, localState?.suprime]);

  // Priced from the catalogue the user selected, and only from values that can
  // honestly be summed. See Code/Helper/valueSources.js.
  const lookupVal = useCallback((item) => {
    if (!item?.name) return 0;
    const n = (item.name || '').toLowerCase().trim();
    const f = parsedData.find(d => (d?.name || '').toLowerCase().trim() === n);
    const priced = priceOf(f || item, valueSource);
    if (isSummable(priced)) return priced.value || 0;
    return 0;
  }, [parsedData, valueSource]);

  const portfolio = useMemo(() => owned.reduce((s, p) => s + lookupVal(p), 0), [owned, lookupVal]);

  const submitSearch = () => {
    const q = homeQuery.trim();
    if (!q) return;
    // Hand the query to Values rather than just opening it, so the user lands
    // on results instead of an empty list they retype into.
    nav.navigate('Values', { q });
    setHomeQuery('');
  };

  const C = useThemeColors();

  return (
    <View style={[$.root, { backgroundColor: C.bg }]}>

      {/* ── Header band ──
          Its own surface, not the page background. The inset padding lives
          here, so the colour runs to the very top of the screen (edge-to-edge
          lets the app draw under the status bar). */}
      <View style={[$.headerBand, HEADER_FLOATS && $.headerCard, { backgroundColor: HEADER_BG, paddingTop: insets.top }]}>
        {isFocused && <StatusBar barStyle="light-content" />}
        <View style={$.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[$.sub11, { color: HEADER_TEXT_DIM }]}>{greet}</Text>
            <Text style={[$.h1, { color: HEADER_TEXT }]} numberOfLines={1}>
              {user?.displayName || t('home.trader')}
            </Text>
          </View>
          {canOpenModeration && (
            <TouchableOpacity
              onPress={() => nav.navigate('Admin')}
              style={[$.iconBtn, { backgroundColor: HEADER_BTN_BG }]}
              activeOpacity={0.8}
              accessibilityLabel="Open moderation dashboard"
            >
              <FontAwesome name="shield-halved" size={20} color={HEADER_TEXT} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('home.change_language')}
            onPress={() => setShowLangPicker(true)}
            style={[$.iconBtn, { backgroundColor: HEADER_BTN_BG }]}
          >
            <Text style={{ fontSize: 24 }}>{curLang.flag}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('home.open_profile')}
            style={$.profileTouch}
            onPress={() => nav.navigate('Setting')}
            activeOpacity={0.8}
          >
            <FramedAvatar
              avatarUri={user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={myCosmetics?.profileFrame || null}
              isDarkMode={dark}
              avatarSize={44}
              forceDetail
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }} bounces>
        {/* ── Search: the app's primary job ──
            A values app exists to answer "what is this worth". The query rides
            through as a route param so this lands on results. */}
        {/* ── Ban status ── a signed-in player under a live account or device
            ban sees why, and for how long (renders nothing otherwise). First,
            above search, as in Adopt Me. */}
        <BanStatusCard />

        <View style={[$.searchBar, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
          <FontAwesome name="magnifying-glass" size={17} color={accentFor('violet', dark).color} />
          <TextInput
            style={[$.searchInput, { color: C.text }]}
            value={homeQuery}
            onChangeText={setHomeQuery}
            // A distinct key on purpose: `home.search_placeholder` already
            // exists as a generic "Search...", and a defaultValue only applies
            // when the key is MISSING.
            placeholder={t('home.search_values', { defaultValue: 'Find a knife, gun or pet…' })}
            placeholderTextColor={C.textSecondary}
            returnKeyType="search"
            onSubmitEditing={submitSearch}
          />
          {homeQuery.length > 0 && (
            <TouchableOpacity onPress={() => setHomeQuery('')} hitSlop={8}>
              <FontAwesome name="circle-xmark" size={14} color={C.textSecondary} solid />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Birthdays ── your birthday, a countdown, "add your birthday",
            or today's birthdays (renders nothing otherwise, or signed out). */}
        <BirthdayHomeCard userId={user?.id || null} userName={user?.displayName} />

        {/* ── Tools: what the app is for ──
            A 2x2 grid, every tile visible at once, each with its own hue so the
            grid is scannable by colour before it is read. */}
        <Text style={[$.sectionTitle, $.sectionSpacing, { color: C.text }]}>{t('home.explore_tools', { defaultValue: 'Explore' })}</Text>
        <View style={$.toolGrid}>
          {[
            // Nothing here duplicates the tab bar: Calculator, Trade, Feed and
            // Chat are one tap away down there already, so the grid holds the
            // destinations that have no tab of their own.
            { icon: 'values', accent: 'violet', label: t('home.values'), sub: t('home.values_sub', { defaultValue: 'Latest item values' }), onPress: () => nav.navigate('Values') },
            { icon: 'trophy', accent: 'rose', label: t('home.top_rated'), sub: t('home.top_rated_sub', { defaultValue: 'Most trusted traders' }), onPress: () => nav.navigate('Leaderboard') },
            { icon: 'friends', accent: 'blue', label: t('home.friends') || 'Friends', sub: t('home.friends_sub', { defaultValue: 'Your trading circle' }), onPress: () => guard(() => nav.navigate('SocialDashboard'), t('home.signin_continue')) },
            { icon: 'star', accent: 'amber', label: t('home.daily_stars'), sub: t('home.daily_stars_sub', { defaultValue: 'Collect your daily reward' }), onPress: () => guard(() => setShowDailyStars(true), t('home.signin_continue')) },
          ].map((tool) => {
            const a = accentFor(tool.accent, dark);
            return (
              <TouchableOpacity
                key={tool.icon}
                accessibilityRole="button"
                accessibilityLabel={tool.label + '. ' + tool.sub}
                style={[$.toolCard, { backgroundColor: a.tint, borderColor: a.tint }]}
                onPress={tool.onPress}
                activeOpacity={0.8}
              >
                <View style={$.toolTopRow}>
                  <View style={[$.toolIcon, { backgroundColor: dark ? '#FFFFFF0D' : '#FFFFFFB3' }]}>
                    <HomeIcon name={tool.icon} size={30} color={a.color} />
                  </View>
                  <FontAwesome name="arrow-up-right-from-square" size={12} color={a.color} style={flipInRTL} />
                </View>
                <Text style={[$.toolLabel, { color: C.text }]} numberOfLines={1}>{tool.label}</Text>
                <Text style={[$.toolSub, { color: a.color }]} numberOfLines={1}>{tool.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Trade Match ── the owner wanted it on Home, not in More (2026-10-13).
            Full width under Explore: finding a trade partner is the next thing
            a trader does after checking a value. */}
        <TouchableOpacity
          onPress={() => guard(() => nav.navigate('TradeMatch'), t('trade_match.sign_in'))}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${t('trade_match.title')}. ${t('trade_match.subtitle')}`}
          style={[$.matchCard, { backgroundColor: accentFor('blue', dark).tint, borderColor: accentFor('blue', dark).tint }]}
        >
          <View style={[$.toolIcon, { backgroundColor: dark ? '#FFFFFF0D' : '#FFFFFFB3' }]}>
            <HomeIcon name="match" size={30} color={accentFor('blue', dark).color} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[$.toolLabel, { color: C.text }]} numberOfLines={1}>{t('trade_match.title')}</Text>
            <Text style={[$.toolSub, { color: accentFor('blue', dark).color }]} numberOfLines={2}>{t('trade_match.subtitle')}</Text>
          </View>
          <View style={[$.matchBtn, { backgroundColor: accentFor('blue', dark).color }]}>
            <Text style={[$.matchBtnText, { color: dark ? C.bg : '#FFFFFF' }]} numberOfLines={1}>{t('trade_match.home_cta')}</Text>
            <FontAwesome name="arrow-right" size={11} color={dark ? C.bg : '#FFFFFF'} style={flipInRTL} />
          </View>
        </TouchableOpacity>

        {/* ── My Stuff Worth ── personal, but secondary to lookup */}
        <TouchableOpacity
          onPress={() => guard(() => nav.navigate('MyStuff'), t('home.signin_continue'))}
          activeOpacity={0.8}
          style={[$.myStuffCard, { backgroundColor: accentFor('kelp', dark).tint, borderColor: accentFor('kelp', dark).tint }]}
        >
          <View style={$.myStuffCardInner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <HomeIcon name="inventory" size={22} color={accentFor('kelp', dark).color} />
              <Text style={[$.b14, { color: C.text, flexShrink: 1 }]}>{t('home.my_stuff_worth')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[$.worthPill, { backgroundColor: accentFor('kelp', dark).color }]}>
                <FontAwesome name="tags" size={10} color={dark ? C.bg : '#FFFFFF'} solid />
                <Text style={[$.worthText, { color: dark ? C.bg : '#FFFFFF' }]}>{fmt(portfolio)}</Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={accentFor('kelp', dark).color} style={flipInRTL} />
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Stories ── titled like every other section, so the avatar row
            reads as a feature rather than loose circles between two cards. */}
        <View style={[$.sectionHead, $.sectionSpacing]}>
          <Text style={[$.sectionTitle, { color: C.text }]}>{t('home.stories', { defaultValue: 'Stories' })}</Text>
          <Text style={[$.sectionMeta, { color: C.textSecondary }]}>{t('home.stories_sub', { defaultValue: 'Last 24 hours' })}</Text>
        </View>
        <StatusFeed
          user={user}
          firestoreDB={firestoreDB}
          appdatabase={appdatabase}
          isDarkMode={dark}
          onRequireSignIn={requireSignInForStatus}
        />

        {/* ── Footer ── */}
        <Text style={[$.footer, { color: C.textSecondary }]}>{t('home.made_with_love')}</Text>

      </ScrollView>

      {/* ── Banner Ad ── (tab bar is docked, so bottom: 0 sits flush above it) */}
      <View style={{ position: 'absolute', bottom: 0, width: '100%', alignItems: 'center' }}>
        <BannerAdComponent collapsible />
      </View>

      {/* ── Modals ── */}
      <DailyStarRewards visible={showDailyStars} onClose={() => setShowDailyStars(false)} db={appdatabase} uid={user?.id} isDarkMode={dark} />

      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="Home" message={signinMsg} />

      <Modal visible={showLangPicker} animationType="fade" transparent onRequestClose={() => setShowLangPicker(false)}>
        <TouchableOpacity style={$.langOverlay} activeOpacity={1} onPress={() => setShowLangPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={[$.langBox, { backgroundColor: dark ? config.colors.surfaceDark : '#fff' }]}>
            <Text style={[$.b16, { color: C.text, textAlign: 'center', marginBottom: 14 }]}>🌍 {t('home.language')}</Text>
            {LANGUAGES.map(l => {
              const on = i18n.language === l.code;
              return (
                <TouchableOpacity key={l.code} style={[$.langRow, on && { backgroundColor: '#7C3AED12' }]}
                  onPress={() => handleLangSelect(l.code)}>
                  <Text style={{ fontSize: 20 }}>{l.flag}</Text>
                  <Text style={[$.b14, { color: C.text, flex: 1, marginLeft: 10, fontFamily: on ? FONT_BOLD : FONT_REGULAR }]}>{l.name}</Text>
                  {on && <FontAwesome name="check" size={12} color="#7C3AED" solid />}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const $ = StyleSheet.create({
  root: { flex: 1 },

  // Header band — rounded bottom edge gives it a defined end.
  headerCard: { marginHorizontal: SCREEN_GUTTER, marginTop: 6, borderRadius: 24 },
  headerBand: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', paddingBottom: 4 },
  header: { minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SCREEN_GUTTER, paddingVertical: 14, gap: 10 },
  h1: { fontSize: 22, fontFamily: FONT_BOLD, letterSpacing: -0.3 },
  sub11: { fontSize: 12, fontFamily: FONT_REGULAR },
  b14: { fontSize: 14, fontFamily: FONT_BOLD },
  b16: { fontSize: 16, fontFamily: FONT_BOLD },
  iconBtn: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // FramedAvatar must not be wrapped in a fixed-size `overflow: 'hidden'` box
  // or the frame decorations get clipped.
  profileTouch: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },

  sectionTitle: { fontSize: 17, fontFamily: FONT_BOLD },
  sectionSpacing: { marginHorizontal: SCREEN_GUTTER, marginTop: 20 },

  // Search — the screen's primary affordance, full width.
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SCREEN_GUTTER, marginTop: 16,
    paddingHorizontal: 16, minHeight: 50,
    borderRadius: 16, borderWidth: 1,
  },
  searchInput: { fontSize: 14, fontFamily: FONT_REGULAR, flex: 1, padding: 0 },

  // Tool grid — 2x2, every tile on screen at once.
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SCREEN_GUTTER, marginTop: 10, gap: 12 },
  toolCard: {
    // 45% + gap + flexGrow lands exactly two per row at any phone width.
    flexBasis: '45%', flexGrow: 1, minWidth: 0,
    padding: 14, borderRadius: 20, borderWidth: 1,
  },
  toolTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 15, fontFamily: FONT_BOLD },
  toolSub: { fontSize: 12, fontFamily: FONT_REGULAR, marginTop: 3 },

  // Trade Match
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SCREEN_GUTTER, marginTop: 12, padding: 14, borderRadius: 20, borderWidth: 1 },
  matchBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, maxWidth: 140 },
  matchBtnText: { fontSize: 12.5, fontFamily: FONT_BOLD },

  // My Stuff
  myStuffCard: { marginHorizontal: SCREEN_GUTTER, marginTop: 14, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 16, borderWidth: 1 },
  myStuffCardInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  worthPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  worthText: { fontSize: 13, fontFamily: FONT_BOLD },

  // Section header with a trailing meta line
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  sectionMeta: { fontSize: 12, fontFamily: FONT_REGULAR },

  // Footer
  footer: { textAlign: 'center', fontSize: 11, fontFamily: FONT_REGULAR, marginTop: 24, paddingBottom: 8 },

  // Language
  langOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  langBox: { borderRadius: 20, padding: 20, width: '100%', maxWidth: 340 },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2 },
});

export default HomeTabScreen;
