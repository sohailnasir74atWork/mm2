/**
 * HomeTabScreen — Games-first home with mini-games grid
 * Subtle nav row at top, full games grid, status feed, XP + portfolio
 */
import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Dimensions, Share, StatusBar, Animated, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { useThemeColors } from '../Helper/themeColors';
import { setAppLanguage } from '../../i18n';
import { useLanguage } from '../Translation/LanguageProvider';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import BannerAdComponent from '../Ads/bannerAds';


import DailyStarRewards from '../Engagement/DailyStarRewards';
import GameLeaderboard from '../Engagement/GameLeaderboard';
import SignInDrawer from '../Firebase/SigninDrawer';

import StatusFeed from '../Design/StatusFeed';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getMyCosmetics, syncMyCosmetics } from '../Helper/cosmeticsCache';

const { width: W } = Dimensions.get('window');
const GAME_CARD_W = (W - 48) / 4.4; // compact — ~4.4 visible cards
const GAME_CARD_H = GAME_CARD_W * 1.05;

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
];


const fmt = (v) => {
  if (!v || typeof v !== 'number') return '0';
  const smart = (n, u) => { const s = n.toFixed(1); return (s.endsWith('.0') ? n.toFixed(0) : s) + u; };
  if (v >= 1e9) return smart(v / 1e9, 'B');
  if (v >= 1e6) return smart(v / 1e6, 'M');
  if (v >= 1e3) return smart(v / 1e3, 'K');
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(1);
};

// ── Mini Games Data ──
// Mystery Egg lives in the Cosmetics section — it's a cosmetic unlock, not a game.
const getMiniGames = (t) => [
  { id: 'arrow',  icon: 'location-arrow', label: t('games.arrow', { defaultValue: 'Arrow' }),   color: '#3B82F6', ready: true, hot: true },
  { id: 'spot',   icon: 'gavel',          label: t('games.whack', { defaultValue: 'Whack!' }),  color: '#B91C1C', ready: true },
  { id: 'safe',   icon: 'vault',          label: t('games.safe', { defaultValue: 'Safe' }),     color: '#D97706', ready: true },
  { id: 'draw',   icon: 'bolt',           label: t('games.draw', { defaultValue: 'Draw!' }),    color: '#DC2626', ready: true },
  { id: 'bomb',   icon: 'bomb',           label: t('games.bomb', { defaultValue: 'Bomb' }),     color: '#92400E', ready: true },
  { id: 'memory', icon: 'clone',          label: t('games.memory', { defaultValue: 'Memory' }), color: '#6366F1', ready: true },
  { id: 'killer', icon: 'user-secret',    label: t('games.killer', { defaultValue: 'Killer' }), color: '#7C3AED', ready: true },
];

const HomeTabScreen = ({ selectedTheme }) => {
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const { t, i18n } = useTranslation();
  const { changeLanguage: setLang } = useLanguage();
  const nav = useNavigation();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();


  const [showDailyStars, setShowDailyStars] = useState(false);
  const [showGameLeaderboard, setShowGameLeaderboard] = useState(false);

  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showOfferWall, setShowOfferWall] = useState(false);

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

  const guard = (fn, msg) => {
    if (!user?.id) { setSigninMsg(msg || 'Sign in first'); setSigninVis(true); return; }
    fn();
  };

  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle(dark ? 'light-content' : 'dark-content', true);
    if (Platform.OS === 'android') StatusBar.setBackgroundColor(dark ? '#0F172A' : '#FFFFFF', true);
  }, [dark]));



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

  const parsedData = useMemo(() => {
    const parse = (raw) => {
      try {
        if (!raw) return [];
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!p || typeof p !== 'object') return [];
        // MM2 data is nested: {category: {tier: [{name, value, ...}]}}
        const items = [];
        for (const tiers of Object.values(p)) {
          if (tiers && typeof tiers === 'object') {
            for (const arr of Object.values(tiers)) {
              if (Array.isArray(arr)) {
                items.push(...arr);
              }
            }
          }
        }
        return items;
      } catch { return []; }
    };
    return [...parse(localState?.data), ...parse(localState?.suprime)];
  }, [localState?.data, localState?.suprime]);

  const lookupVal = useCallback((item) => {
    if (!item?.name || !parsedData.length) return Number(String(item?.value || 0).replace(/,/g, '')) || 0;
    const n = (item.name || '').toLowerCase().trim();
    const f = parsedData.find(d => (d?.name || '').toLowerCase().trim() === n);
    if (f) {
      const v = Number(String(f.value || 0).replace(/,/g, ''));
      if (v) return v;
      const rv = Number(String(f.rvalue || 0).replace(/,/g, ''));
      if (rv) return rv;
    }
    return Number(String(item?.value || 0).replace(/,/g, '')) || 0;
  }, [parsedData]);

  const portfolio = useMemo(() => owned.reduce((s, p) => s + lookupVal(p), 0), [owned, lookupVal]);

  const handleGamePress = (game) => {
    guard(() => {
      if (game.id === 'arrow') {
        nav.navigate('ArrowGameScreen');
      } else {
        nav.navigate('GameScreen', {
          gameId: game.id,
          title: game.label,
          color: game.color,
        });
      }
    }, 'Sign in to play');
  };

  const C = useThemeColors();

  return (
    <View style={[$.root, { backgroundColor: C.bg, paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 220 }} bounces>

        {/* ── Header ── */}
        <View style={$.header}>
          <View style={{ flex: 1 }}>
            <Text style={[$.sub11, { color: C.textSecondary }]}>{greet}</Text>
            <Text style={[$.h1, { color: C.text }]} numberOfLines={1}>
              {user?.displayName || t('home.trader')}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowLangPicker(true)} style={[$.iconBtn, { backgroundColor: C.bgAlt }]}>
            <Text style={{ fontSize: 16 }}>{curLang.flag}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => nav.navigate('Setting')} activeOpacity={0.8}>
            <FramedAvatar
              avatarUri={user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={myCosmetics?.profileFrame || null}
              isDarkMode={dark}
              avatarSize={36}
              forceDetail
            />
          </TouchableOpacity>

        </View>


        {/* ── My Stuff Worth Card ── */}
        <TouchableOpacity
          onPress={() => guard(() => nav.navigate('MyStuff'), 'Sign in')}
          activeOpacity={0.8}
          style={[$.myStuffCard, { backgroundColor: C.bgAlt, borderColor: C.border }]}
        >
          <View style={$.myStuffCardInner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FontAwesome name="box-open" size={16} color={C.text} solid />
              <Text style={[$.b14, { color: C.text }]}>{t('home.my_stuff_worth')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[$.worthPill, { backgroundColor: C.border }]}>
                <FontAwesome name="tags" size={10} color="#FFC107" solid />
                <Text style={$.worthText}>{portfolio.toLocaleString()}</Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={C.textSecondary} />
            </View>
          </View>
        </TouchableOpacity>


        {/* ── Quick Nav Pills ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={$.navRow}
          style={{ marginTop: 8 }}
        >
          {[
            { emoji: '🌎', label: t('home.friends') || 'Friends', onPress: () => guard(() => nav.navigate('SocialDashboard'), 'Sign in') },
            { emoji: '⭐', label: t('home.daily_stars'), onPress: () => guard(() => setShowDailyStars(true), 'Sign in') },
            { emoji: '🏷️', label: t('home.values'), onPress: () => nav.navigate('Values') },

            { emoji: '🏆', label: t('home.top_rated'), onPress: () => nav.navigate('Leaderboard') },
            { emoji: '📩', label: t('home.invite'), onPress: async () => {
              const link = Platform.OS === 'ios' ? config.IOsShareLink : config.andriodShareLink;
              try { await Share.share({ message: `${t('home.share_message')} ${link}` }); } catch {}
            }},

          ].map((p, i) => (
            <TouchableOpacity key={i} style={[$.navPill, { backgroundColor: C.bgAlt, borderColor: C.border }]} onPress={p.onPress} activeOpacity={0.7}>
              <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
              <Text style={[$.navLabel, { color: C.text }]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Status Feed ── */}
        <StatusFeed
          user={user}
          firestoreDB={firestoreDB}
          appdatabase={appdatabase}
          isDarkMode={dark}
          onRequireSignIn={() => { setSigninMsg('Sign in to post a status'); setSigninVis(true); }}
        />

        {/* ══════════ SECTION: Cosmetics ══════════ */}
        <View style={$.sectionHeader}>
          <FontAwesome name="wand-magic-sparkles" size={16} color={C.text} solid />
          <Text style={[$.sectionTitle, { color: C.text }]}>
            {t('home.cosmetics', { defaultValue: 'Cosmetics' })}
          </Text>
        </View>

        <View style={$.cosmeticsRow}>
          <TouchableOpacity
            style={[$.cosmeticCard, { backgroundColor: '#DB2777' }]}
            onPress={() => guard(() => nav.navigate('MysteryEggScreen'), 'Sign in to open eggs')}
            activeOpacity={0.85}
          >
            <View style={$.cosmeticIconWrap}>
              <FontAwesome name="egg" size={20} color="#fff" solid />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={$.cosmeticLabel} numberOfLines={1}>
                {t('home.win_cosmetics', { defaultValue: 'Win Cosmetics' })}
              </Text>
              <Text style={$.cosmeticSub} numberOfLines={1}>
                {t('home.win_cosmetics_sub', { defaultValue: 'Hatch eggs to unlock' })}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[$.cosmeticCard, { backgroundColor: '#7C3AED' }]}
            onPress={() => guard(() => nav.navigate('MyCosmeticsScreen'), 'Sign in to see cosmetics')}
            activeOpacity={0.85}
          >
            <View style={$.cosmeticIconWrap}>
              <FontAwesome name="shirt" size={20} color="#fff" solid />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={$.cosmeticLabel} numberOfLines={1}>
                {t('home.my_cosmetics', { defaultValue: 'My Cosmetics' })}
              </Text>
              <Text style={$.cosmeticSub} numberOfLines={1}>
                {t('home.my_cosmetics_sub', { defaultValue: 'Equip your items' })}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ══════════ SECTION: Mini Games ══════════ */}
        {/* Tinted full-bleed band so games read as their own section, not a
            continuation of Cosmetics. */}
        <View style={[$.sectionBand, { backgroundColor: C.bgAlt, borderColor: C.border }]}>
          <View style={[$.sectionHeader, $.sectionHeaderInBand]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FontAwesome name="gamepad" size={16} color={C.text} solid />
              <Text style={[$.sectionTitle, { color: C.text }]}>{t('home.mini_games')}</Text>
            </View>
            <TouchableOpacity
              style={[$.ranksBtn, { backgroundColor: C.bg }]}
              onPress={() => guard(() => setShowGameLeaderboard(true), 'Sign in to see ranks')}
              activeOpacity={0.7}
            >
              <FontAwesome name="trophy" size={11} color="#F59E0B" solid />
              <Text style={{ fontSize: 11, fontWeight: '800', color: C.text }}>
                {t('home.ranks', { defaultValue: 'Ranks' })}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2, gap: 8 }}
            decelerationRate="fast"
            snapToInterval={GAME_CARD_W + 8}
          >
            {getMiniGames(t).map((game) => (
              <TouchableOpacity
                key={game.id}
                style={[$.gameTile, { backgroundColor: game.color }]}
                onPress={() => handleGamePress(game)}
                activeOpacity={0.8}
              >
                {/* Gradient overlay */}
                <View style={$.gameTileOverlay} />
                {/* HOT badge */}
                {game.hot && (
                  <View style={$.hotBadge}>
                    <Text style={$.hotBadgeText}>HOT</Text>
                  </View>
                )}
                {/* Content */}
                <FontAwesome name={game.icon} size={20} color="#fff" solid style={{ marginBottom: 6 }} />
                <Text style={$.gameLabel} numberOfLines={1}>{game.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Footer ── */}
        <Text style={[$.footer, { color: C.textSecondary }]}>{t('home.made_with_love')}</Text>

      </ScrollView>

      {/* ── Banner Ad ── (tab bar is docked, so bottom: 0 sits flush above it) */}
      <View style={{ position: 'absolute', bottom: 0, width: '100%', alignItems: 'center' }}>
        <BannerAdComponent collapsible />
      </View>

      {/* ── Modals ── */}
      <GameLeaderboard visible={showGameLeaderboard} onClose={() => setShowGameLeaderboard(false)} />
      <DailyStarRewards visible={showDailyStars} onClose={() => setShowDailyStars(false)} db={appdatabase} uid={user?.id} isDarkMode={dark} />

      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="Home" message={signinMsg} />

      <Modal visible={showLangPicker} animationType="fade" transparent>
        <TouchableOpacity style={$.langOverlay} activeOpacity={1} onPress={() => setShowLangPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={[$.langBox, { backgroundColor: dark ? config.colors.surfaceDark : '#fff' }]}>
            <Text style={[$.b16, { color: C.text, textAlign: 'center', marginBottom: 14 }]}>🌍 {t('home.language')}</Text>
            {LANGUAGES.map(l => {
              const on = i18n.language === l.code;
              const isPro = l.code !== 'en';
              return (
                <TouchableOpacity key={l.code} style={[$.langRow, on && { backgroundColor: '#7C3AED12' }]}
                  onPress={() => handleLangSelect(l.code)}>
                  <Text style={{ fontSize: 20 }}>{l.flag}</Text>
                  <Text style={[$.b14, { color: C.text, flex: 1, marginLeft: 10, fontWeight: on ? '800' : '500' }]}>{l.name}</Text>
                  {isPro && !localState.isPro && <Text style={{ fontSize: 9, color: '#F59E0B', fontWeight: '800' }}>{t('home.pro')}</Text>}
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

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 10 },
  h1: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  sub11: { fontSize: 11, fontWeight: '500' },
  b14: { fontSize: 14, fontWeight: '700' },
  b16: { fontSize: 16, fontWeight: '800' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // (removed profileBtn/profileAvatar — the header now uses FramedAvatar, which
  // must not be wrapped in a fixed-size `overflow: 'hidden'` box or the frame
  // decorations get clipped.)
  ava: { width: 38, height: 38, borderRadius: 19 },

  // XP Strip
  xpStrip: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 6,
    padding: 12, borderRadius: 14, borderWidth: 1,
  },
  barBg: { height: 5, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: '#7C3AED' },

  // My Stuff Card
  myStuffCard: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  myStuffCardInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  worthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  worthText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B8860B',
  },

  // Nav Pills
  navRow: { paddingHorizontal: 16, gap: 8 },
  navPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
    position: 'relative',
  },
  navLabel: { fontSize: 12, fontWeight: '700' },
  pillDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#EF4444',
  },

  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 14, marginBottom: 10 },
  sectionHeaderInBand: { justifyContent: 'space-between', marginTop: 0, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '900' },
  // Full-bleed tinted band — visually splits Mini Games off from Cosmetics
  sectionBand: {
    marginTop: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ranksBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: '#F59E0B',
  },

  // Cosmetics
  cosmeticsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  cosmeticCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cosmeticIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  cosmeticLabel: { fontSize: 13, fontWeight: '900', color: '#fff' },
  cosmeticSub: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.78)', marginTop: 1 },

  // Games Grid
  gameTile: {
    width: GAME_CARD_W,
    height: GAME_CARD_H,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  gameTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  gameLabel: { fontSize: 10, fontWeight: '800', color: '#fff', textAlign: 'center', paddingHorizontal: 3, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  hotBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: '#FF4500',
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 7,
    zIndex: 10,
  },
  hotBadgeText: { fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 0.4 },

  // Footer
  footer: { textAlign: 'center', fontSize: 11, fontWeight: '500', marginTop: 24, paddingBottom: 8 },

  // Language
  langOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  langBox: { borderRadius: 20, padding: 20, width: '100%', maxWidth: 340 },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2 },
});

export default HomeTabScreen;
