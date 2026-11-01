/**
 * FantasyLeagueScreen.jsx — MM2 Fantasy League (2026-10-30).
 *
 * Four tabs on one root-stack screen ('FantasyLeague', More hub card and
 * league pushes with route 'FantasyLeague'):
 *   Team         pick 5 items from this week's hot list, call each one up or
 *                down, choose a captain (×2). Once joined: your picks, points,
 *                rank and one free swap (a second after a rewarded ad; Pro
 *                skips the ad, never gets a third).
 *   Leaderboard  this round's top 100 (copied onto the round document).
 *   Guess        Guess the Value: price a NEW feed item as it will be on day 7.
 *   Season       the event (or month) table: weekly points + guess points.
 *
 * Why direction and a hot list instead of "% gained": MM2 values move slowly
 * (19–78 of ~1,100 items a week). See functions/fantasy/logic.js.
 *
 * Every number on this screen is the server's: picks go through
 * fantasyJoin / fantasySwap / fantasyGuess, and the hourly fantasyTick
 * re-scores. Reads are document gets on open / pull-to-refresh, no listeners.
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, StatusBar, FlatList, ScrollView,
  TextInput, ActivityIndicator, RefreshControl, Modal, Keyboard,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ref, get } from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { useHaptic } from '../Helper/HepticFeedBack';
import { flipInRTL } from '../Helper/rtl';
import { resolveItemImage } from '../Helper/valueSources';
import { resolveEvent, eventLabel } from '../Engagement/eventConfig';
import { BirthdayAvatar } from '../Birthdays/BirthdayBits';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import RewardedAdManager from '../Ads/RewardedAdManager';
import SignInDrawer from '../Firebase/SigninDrawer';
import { MyDarkTheme, MyLightTheme } from '../AppHelper/AppHelperFunction';
import {
  joinRound, swapPick, submitGuess, loadRound, loadSeason, loadGuesses, setLeagueAlerts,
} from './fantasyApi';
import {
  PICKS, currentRoundId, timeLeft, formatValue, daysAgo, swapsLeft,
  nextSwapNeedsExtra, draftReady, filterPool, parseGuess, monthSeasonLabel,
  wholePct, nextUpdateAt, quickPick,
} from './fantasyFormat';
import { mockRound, mockEntry, mockGuesses, mockSeason } from './fantasyMock';

const ACCENT = '#6A5ACD';
const UP = '#16A34A';
const DOWN = '#DC2626';
const GOLD = '#F5B301';
const TABS = ['team', 'board', 'guess', 'season'];

const itemImage = (p) => resolveItemImage({ image: p.img, name: p.n });

// First-open tutorial flag (per device). Same MMKV pattern as Birthdays/birthdayApi.js.
let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'fantasy' });
} catch (e) {
  const mem = new Map();
  storage = { getBoolean: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };
}
const TUTORIAL_KEY = 'tutorialSeen';
const TUTORIAL_STEPS = [['🔪', 'tut_1'], ['⬆️', 'tut_2'], ['🏆', 'tut_3']];

/** Arrow + whole number ("▲ 18", "▼ 13") — easier for kids than "-12.5%". */
const arrowPct = (pct) => `${pct > 0 ? '▲' : '▼'} ${wholePct(pct)}%`;

const ItemThumb = memo(({ p, c, size = 40 }) => {
  const uri = itemImage(p);
  const box = { width: size, height: size, borderRadius: 10, backgroundColor: c.bgElevated || c.bg };
  return uri ? <Image source={{ uri }} style={box} resizeMode="contain" /> : <View style={box} />;
});

const PctBadge = ({ pct, t }) => {
  if (!pct) return <Text style={[styles.badge, styles.badgeFlat]}>{t('fantasy.no_move')}</Text>;
  const up = pct > 0;
  return (
    <Text style={[styles.badge, { backgroundColor: up ? 'rgba(22,163,74,0.14)' : 'rgba(220,38,38,0.14)', color: up ? UP : DOWN }]}>
      {t(up ? 'fantasy.went_up' : 'fantasy.went_down', { pct: wholePct(pct) })}
    </Text>
  );
};

const DirToggle = ({ dir, onChange, c, t }) => (
  <View style={styles.dirRow}>
    {['up', 'down'].map((d) => {
      const on = dir === d;
      const color = d === 'up' ? UP : DOWN;
      return (
        <TouchableOpacity
          key={d}
          onPress={() => onChange(on ? null : d)}
          style={[styles.dirBtn, { borderColor: on ? color : c.border, backgroundColor: on ? color : 'transparent' }]}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          accessibilityLabel={t(d === 'up' ? 'fantasy.call_up' : 'fantasy.call_down')}
        >
          <Icon name={d === 'up' ? 'arrow-up' : 'arrow-down'} size={16} color={on ? '#fff' : color} />
        </TouchableOpacity>
      );
    })}
  </View>
);

/** A hot-list row: what it is worth and when it last moved. */
const PoolRow = memo(({ p, dir, captain, onDir, onCaptain, c, t, disabled }) => {
  const ago = p.last ? daysAgo(p.last.at) : null;
  let moveText = t('fantasy.steady');
  if (p.isNew) moveText = t('fantasy.new_item');
  else if (p.last && p.last.p) {
    moveText = ago === 0
      ? t('fantasy.moved_today', { pct: arrowPct(p.last.p) })
      : t('fantasy.moved_ago', { pct: arrowPct(p.last.p), n: ago });
  }
  return (
    <View style={[styles.poolRow, { borderBottomColor: c.border, opacity: disabled && !dir ? 0.45 : 1 }]}>
      <ItemThumb p={p} c={c} />
      <View style={styles.flex1Pad}>
        <Text style={[styles.itemName, { color: c.text }]} numberOfLines={1}>{p.n}</Text>
        <Text style={[styles.itemSub, { color: c.textSecondary }]} numberOfLines={1}>
          {formatValue(p.v)}  ·  {moveText}{p.ch > 1 ? `  ·  ${t('fantasy.moves_count', { n: p.ch })}` : ''}
        </Text>
      </View>
      {dir ? (
        <TouchableOpacity onPress={onCaptain} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t('fantasy.make_captain')}>
          <Icon name={captain ? 'star' : 'star-outline'} size={20} color={captain ? GOLD : c.textSecondary} />
        </TouchableOpacity>
      ) : null}
      <DirToggle dir={dir} onChange={(d) => !(disabled && !dir) && onDir(d)} c={c} t={t} />
    </View>
  );
});

/** One of your 5 picks once you have joined. */
const PickRow = memo(({ p, c, t, onSwap, swapping }) => (
  <View style={[styles.pickRow, { borderBottomColor: c.border }]}>
    <ItemThumb p={p} c={c} size={44} />
    <View style={styles.flex1Pad}>
      <Text style={[styles.itemName, { color: c.text }]} numberOfLines={1}>
        {p.cap ? '⭐ ' : ''}{p.n}
      </Text>
      <Text style={[styles.itemSub, { color: c.textSecondary }]} numberOfLines={1}>
        {t(p.dir === 'up' ? 'fantasy.you_called_up' : 'fantasy.you_called_down')}  ·  {formatValue(p.base)} → {formatValue(p.cur)}
      </Text>
      <View style={styles.pickMeta}>
        <PctBadge pct={p.pct} t={t} />
        {p.hype ? <Text style={[styles.hype, { color: ACCENT }]}>🔥 +{p.hype} {t('fantasy.hype')}</Text> : null}
      </View>
    </View>
    <View style={styles.pickPts}>
      <Text style={[styles.ptsBig, { color: p.pts ? c.text : c.textSecondary }]}>{(p.pts || 0) + (p.hype || 0)}</Text>
      <Text style={[styles.ptsLabel, { color: c.textSecondary }]}>{t('fantasy.pts')}</Text>
      {onSwap ? (
        <TouchableOpacity onPress={onSwap} style={[styles.swapChip, { borderColor: swapping ? ACCENT : c.border }]} accessibilityRole="button">
          <Text style={[styles.swapChipText, { color: swapping ? ACCENT : c.textSecondary }]}>{t('fantasy.swap')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  </View>
));

const BoardRow = memo(({ r, me, c, t, right }) => (
  <View style={[styles.boardRow, { borderBottomColor: c.border, backgroundColor: me ? 'rgba(106,90,205,0.10)' : 'transparent' }]}>
    <Text style={[styles.rank, { color: r.rank <= 3 ? GOLD : c.textSecondary }]}>
      {r.rank === 1 ? '👑' : `#${r.rank}`}
    </Text>
    <BirthdayAvatar uri={r.avatar} name={r.name} size={34} />
    <Text style={[styles.boardName, { color: c.text }]} numberOfLines={1}>{r.name}{me ? `  (${t('fantasy.you')})` : ''}</Text>
    <Text style={[styles.boardPts, { color: c.text }]}>{right}</Text>
  </View>
));

const HowItWorks = ({ visible, onClose, c, t }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={styles.modalBack} activeOpacity={1} onPress={onClose}>
      <View style={[styles.modalCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        <Text style={[styles.modalTitle, { color: c.text }]}>{t('fantasy.how_title')}</Text>
        {['how_1', 'how_2', 'how_3'].map((k) => (
          <Text key={k} style={[styles.modalLine, { color: c.text }]}>{t(`fantasy.${k}`)}</Text>
        ))}
        <TouchableOpacity onPress={onClose} style={[styles.primaryBtn, { marginTop: 14 }]}>
          <Text style={styles.primaryBtnText}>{t('fantasy.got_it')}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  </Modal>
);

/** First-open tutorial: three big cards, one idea each. */
const Tutorial = ({ visible, step, onNext, c, t }) => {
  const [emoji, key] = TUTORIAL_STEPS[step] || TUTORIAL_STEPS[0];
  const last = step >= TUTORIAL_STEPS.length - 1;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNext}>
      <View style={styles.modalBack}>
        <View style={[styles.modalCard, styles.tutCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
          <Text style={[styles.tutStep, { color: c.textSecondary }]}>{t('fantasy.tut_title')}  ·  {step + 1}/{TUTORIAL_STEPS.length}</Text>
          <Text style={styles.tutEmoji}>{emoji}</Text>
          <Text style={[styles.tutHead, { color: c.text }]}>{t(`fantasy.${key}`)}</Text>
          <Text style={[styles.tutBody, { color: c.textSecondary }]}>{t(`fantasy.${key}_body`)}</Text>
          <View style={styles.tutDots}>
            {TUTORIAL_STEPS.map((_, i) => (
              <View key={i} style={[styles.tutDot, { backgroundColor: i === step ? ACCENT : c.border }]} />
            ))}
          </View>
          <TouchableOpacity onPress={onNext} style={[styles.primaryBtn, styles.tutBtn]} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>{t(last ? 'fantasy.tut_start' : 'fantasy.tut_next')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const FantasyLeagueScreen = () => {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { theme, user, firestoreDB, appdatabase } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const insets = useSafeAreaInsets();
  const isDark = theme === 'dark';
  const c = useMemo(() => getThemeColors(isDark), [isDark]);
  // Root-stack screens get no selectedTheme prop; SignInDrawer needs one (same as TradeMatchScreen).
  const selectedTheme = isDark ? MyDarkTheme : MyLightTheme;
  const uid = user?.id || null;

  const [tab, setTab] = useState('team');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [round, setRound] = useState(null);
  const [entry, setEntry] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState({}); // k → 'up' | 'down'
  const [captain, setCaptain] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [swapOut, setSwapOut] = useState(null);
  const [swapDir, setSwapDir] = useState({});
  const [guessData, setGuessData] = useState(null);
  const [guessText, setGuessText] = useState({});
  const [seasonData, setSeasonData] = useState(null);
  const [alertsOn, setAlertsOn] = useState(true);
  const [howVis, setHowVis] = useState(false);
  const [signinVis, setSigninVis] = useState(false);
  // __DEV__ only: long-press the header trophy for sample data (fantasyMock.js).
  const [preview, setPreview] = useState(false);
  const [tutStep, setTutStep] = useState(() => {
    try {
      return storage.getBoolean(TUTORIAL_KEY) ? -1 : 0;
    } catch (e) {
      return 0;
    }
  });
  const nextTutorial = () => {
    if (tutStep < TUTORIAL_STEPS.length - 1) {
      setTutStep(tutStep + 1);
      return;
    }
    setTutStep(-1);
    try { storage.set(TUTORIAL_KEY, true); } catch (e) { /* shows again next time */ }
  };

  const roundId = useMemo(() => currentRoundId(), []);

  const load = useCallback(async (pull = false) => {
    if (preview) {
      setRound(mockRound());
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!firestoreDB) return;
    if (pull) setRefreshing(true);
    try {
      const res = await loadRound(firestoreDB, roundId, uid);
      setRound(res.round);
      setEntry(res.entry);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [firestoreDB, roundId, uid, preview]);

  const loadTab = useCallback(async (which) => {
    if (preview) {
      if (which === 'guess') setGuessData(mockGuesses());
      if (which === 'season') setSeasonData(mockSeason(mockRound()));
      return;
    }
    if (!firestoreDB) return;
    try {
      if (which === 'guess') setGuessData(await loadGuesses(firestoreDB, uid));
      if (which === 'season' && round?.season?.id) setSeasonData(await loadSeason(firestoreDB, round.season.id, uid));
    } catch (e) {
      // Leave the tab's previous content; pull to refresh retries.
    }
  }, [firestoreDB, uid, round?.season?.id, preview]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { loadTab(tab); }, [tab, loadTab]);
  useEffect(() => { RewardedAdManager.prepare?.(); }, []);
  useEffect(() => {
    if (!uid || !appdatabase) return;
    get(ref(appdatabase, `users/${uid}/notificationSettings/fantasyAlerts`))
      .then((s) => setAlertsOn(s.val() !== false))
      .catch(() => {});
  }, [uid, appdatabase]);

  const refresh = useCallback(() => {
    load(true);
    loadTab(tab);
  }, [load, loadTab, tab]);

  const needSignIn = () => {
    if (uid) return false;
    setSigninVis(true);
    return true;
  };

  const errorText = (e) => t(`fantasy.err.${e?.code || 'generic'}`, { defaultValue: t('fantasy.err.generic') });

  const now = Date.now();
  const joinOpen = !!round && round.status === 'live' && now < round.joinUntil;
  const pool = round?.pool || [];
  const picked = Object.keys(draft);
  const ready = draftReady(draft, captain);

  // ── Actions ──
  const setDir = (k, d) => {
    triggerHapticFeedback('impactLight');
    const next = { ...draft };
    if (!d) delete next[k];
    else if (next[k] || Object.keys(next).length < PICKS) next[k] = d;
    else return;
    setDraft(next);
    // The first pick is captain until the player moves the star.
    if (!next[captain]) setCaptain(Object.keys(next)[0] || null);
  };

  const onQuickPick = () => {
    triggerHapticFeedback('impactMedium');
    const qp = quickPick(pool);
    setDraft(qp.draft);
    setCaptain(qp.captain);
    trackGrowthEvent('fantasy_quick_pick', { round: roundId });
  };

  const onJoin = async () => {
    if (preview && ready) {
      setEntry(mockEntry(round, draft, captain, uid));
      return;
    }
    if (needSignIn() || !ready || busy) return;
    setBusy(true);
    try {
      const res = await joinRound(roundId, picked.map((k) => ({ k, dir: draft[k] })), captain);
      setEntry(res.entry);
      setDraft({});
      setCaptain(null);
      trackGrowthEvent('fantasy_join', { round: roundId });
      showSuccessMessage(t('fantasy.joined_title'), t('fantasy.joined_body'));
    } catch (e) {
      showErrorMessage(t('fantasy.err_title'), errorText(e));
      if (e?.code === 'already_joined') load();
    } finally {
      setBusy(false);
    }
  };

  const doSwap = async (inKey, dir) => {
    if (busy || !swapOut) return;
    if (preview) {
      setSwapOut(null);
      setSwapDir({});
      showSuccessMessage(t('fantasy.swap'), `${swapOut} → ${inKey} (${dir})`);
      return;
    }
    let extra = false;
    if (nextSwapNeedsExtra(entry)) {
      if (localState?.isPro) {
        extra = true;
      } else {
        const r = await RewardedAdManager.showForResult();
        if (r !== 'earned') {
          if (r === 'unavailable') showErrorMessage(t('fantasy.err_title'), t('fantasy.ad_unavailable'));
          return;
        }
        extra = true;
      }
    }
    setBusy(true);
    try {
      const res = await swapPick(roundId, swapOut, inKey, dir, extra);
      setEntry(res.entry);
      setSwapOut(null);
      setSwapDir({});
      trackGrowthEvent('fantasy_swap', { round: roundId, extra: extra ? 1 : 0 });
    } catch (e) {
      showErrorMessage(t('fantasy.err_title'), errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onGuess = async (g) => {
    const n = parseGuess(guessText[g.id]);
    if (preview && n) {
      // Sample data only: show the guess on the card, never call the server.
      setGuessData((prev) => ({ ...prev, mine: { ...(prev?.mine || {}), [g.id]: { guess: n } } }));
      return;
    }
    if (needSignIn() || busy) return;
    if (!n) {
      showErrorMessage(t('fantasy.err_title'), t('fantasy.err.bad_guess'));
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    try {
      await submitGuess(g.id, n);
      trackGrowthEvent('fantasy_guess', { item: g.k });
      showSuccessMessage(t('fantasy.guess_saved'), t('fantasy.guess_saved_body', { item: g.n }));
      loadTab('guess');
    } catch (e) {
      showErrorMessage(t('fantasy.err_title'), errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleAlerts = () => {
    if (needSignIn()) return;
    const next = !alertsOn;
    setAlertsOn(next);
    setLeagueAlerts(appdatabase, uid, next).catch(() => setAlertsOn(!next));
    showSuccessMessage(t(next ? 'fantasy.alerts_on' : 'fantasy.alerts_off'));
  };

  // ── Pieces ──
  const seasonName = round?.season
    ? (round.season.kind === 'event'
      ? `${round.season.emoji || ''} ${eventLabel({ id: String(round.season.id).replace(/-\d{4}$/, ''), label: round.season.label }, t)}`.trim()
      : monthSeasonLabel(round.season.id, i18n.language))
    : '';

  const header = (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('fantasy.back')}>
        <Icon name="arrow-back" size={22} color={c.text} style={flipInRTL} />
      </TouchableOpacity>
      <View style={styles.flex1}>
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('fantasy.title')}</Text>
        <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{seasonName || t('fantasy.subtitle')}</Text>
      </View>
      <TouchableOpacity
        disabled={!__DEV__}
        onLongPress={() => { setPreview(true); setEntry(null); setGuessData(null); setSeasonData(null); }}
        style={styles.trophy}
      >
        <Text style={styles.trophyText}>🏆</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={toggleAlerts} style={styles.iconBtn} accessibilityRole="switch" accessibilityState={{ checked: alertsOn }} accessibilityLabel={t('fantasy.alerts')}>
        <Icon name={alertsOn ? 'notifications' : 'notifications-off-outline'} size={21} color={c.text} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setHowVis(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('fantasy.how_title')}>
        <Icon name="help-circle-outline" size={23} color={c.text} />
      </TouchableOpacity>
    </View>
  );

  const tabs = (
    <View style={[styles.tabs, { borderBottomColor: c.border }]}>
      {TABS.map((k) => (
        <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderBottomColor: ACCENT }]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
          <Text style={[styles.tabText, { color: tab === k ? ACCENT : c.textSecondary }]}>{t(`fantasy.tab_${k}`)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // Values move only every few days; saying when the next update is due makes
  // "no change yet" feel normal instead of broken.
  const nextAt = nextUpdateAt(round?.valuesAt);
  let updateLine = t('fantasy.values_note');
  if (nextAt) updateLine = nextAt > now ? t('fantasy.next_update', { time: timeLeft(nextAt) }) : t('fantasy.next_update_soon');

  const roundCard = round ? (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{t('fantasy.round_label', { id: round.id.replace(/^\d{4}-W/, '') })}</Text>
        <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
          {round.status === 'live' ? t('fantasy.ends_in', { time: timeLeft(round.endsAt) }) : t('fantasy.round_over')}
        </Text>
      </View>
      <Text style={[styles.cardMeta, { color: c.textSecondary, marginTop: 4 }]}>
        {t('fantasy.players_count', { n: round.players || 0 })}  ·  {updateLine}
      </Text>
    </View>
  ) : null;

  const renderTeam = () => {
    if (!round) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🏁</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t(loadError ? 'fantasy.load_error' : 'fantasy.no_round')}</Text>
          <Text style={[styles.emptyBody, { color: c.textSecondary }]}>{t('fantasy.no_round_body')}</Text>
        </View>
      );
    }

    if (entry) {
      const swapsRemaining = joinOpen ? swapsLeft(entry) : 0;
      const choosing = !!swapOut;
      const inPool = choosing ? filterPool(pool, search).filter((p) => !entry.picks.some((x) => x.k === p.k)) : [];
      return (
        <FlatList
          data={inPool}
          keyExtractor={(p) => p.k}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          contentContainerStyle={styles.listPad}
          ListHeaderComponent={(
            <View>
              {roundCard}
              <View style={[styles.card, styles.scoreCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <View>
                  <Text style={[styles.scoreBig, { color: c.text }]}>{entry.points || 0}</Text>
                  <Text style={[styles.cardMeta, { color: c.textSecondary }]}>{t('fantasy.points')}</Text>
                </View>
                <View style={styles.alignEnd}>
                  <Text style={[styles.rankBig, { color: ACCENT }]}>{entry.rank ? `#${entry.rank}` : '—'}</Text>
                  <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
                    {entry.rank ? t('fantasy.rank_of', { n: round.players || 0 }) : t('fantasy.rank_pending')}
                  </Text>
                </View>
              </View>
              <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border, paddingVertical: 4 }]}>
                {(entry.picks || []).map((p) => (
                  <PickRow
                    key={p.k}
                    p={p}
                    c={c}
                    t={t}
                    swapping={swapOut === p.k}
                    onSwap={swapsRemaining > 0 ? () => { setSwapOut(swapOut === p.k ? null : p.k); setSearch(''); } : null}
                  />
                ))}
                {entry.banked ? (
                  <Text style={[styles.cardMeta, { color: c.textSecondary, paddingVertical: 8 }]}>
                    {t('fantasy.banked', { pts: entry.banked })}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.hint, { color: c.textSecondary }]}>
                {joinOpen
                  ? t('fantasy.swaps_left', { n: swapsRemaining }) + (nextSwapNeedsExtra(entry) && swapsRemaining ? `  ·  ${t(localState?.isPro ? 'fantasy.swap_pro' : 'fantasy.swap_ad')}` : '')
                  : t('fantasy.locked')}
              </Text>
              {choosing ? (
                <View>
                  <Text style={[styles.sectionTitle, { color: c.text }]}>
                    {t('fantasy.swap_choose', { item: (entry.picks.find((p) => p.k === swapOut) || {}).n || '' })}
                  </Text>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t('fantasy.search')}
                    placeholderTextColor={c.placeholder}
                    style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
                  />
                </View>
              ) : null}
            </View>
          )}
          renderItem={({ item }) => (
            <PoolRow
              p={item}
              dir={swapDir[item.k] || null}
              captain={false}
              c={c}
              t={t}
              onCaptain={() => {}}
              onDir={(d) => {
                if (!d) return;
                setSwapDir({ [item.k]: d });
                doSwap(item.k, d);
              }}
            />
          )}
        />
      );
    }

    if (!joinOpen) {
      return (
        <ScrollView contentContainerStyle={styles.listPad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
          {roundCard}
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>⏳</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('fantasy.join_closed')}</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>{t('fantasy.join_closed_body', { time: timeLeft(round.endsAt) })}</Text>
          </View>
        </ScrollView>
      );
    }

    return (
      <View style={styles.flex1}>
        <FlatList
          // Picked items first, so a kid sees their whole team (Quick Pick can
          // choose items anywhere in an ~80-item list).
          data={filterPool(pool, search).slice().sort((a, b) => (draft[b.k] ? 1 : 0) - (draft[a.k] ? 1 : 0))}
          keyExtractor={(p) => p.k}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          contentContainerStyle={styles.listPad}
          ListHeaderComponent={(
            <View>
              {roundCard}
              <Text style={[styles.sectionTitle, { color: c.text }]}>{t('fantasy.pick_title', { n: picked.length, total: PICKS })}</Text>
              <Text style={[styles.hint, { color: c.textSecondary, marginTop: 0 }]}>{t('fantasy.pick_hint')}</Text>
              <TouchableOpacity onPress={onQuickPick} style={[styles.quickBtn, { borderColor: ACCENT }]} accessibilityRole="button">
                <Text style={[styles.quickBtnText, { color: ACCENT }]}>{t('fantasy.quick_pick')}</Text>
              </TouchableOpacity>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('fantasy.search')}
                placeholderTextColor={c.placeholder}
                style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
              />
            </View>
          )}
          renderItem={({ item }) => (
            <PoolRow
              p={item}
              dir={draft[item.k] || null}
              captain={captain === item.k}
              disabled={picked.length >= PICKS}
              c={c}
              t={t}
              onDir={(d) => setDir(item.k, d)}
              onCaptain={() => setCaptain(item.k)}
            />
          )}
        />
        <View style={[styles.joinBar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Text style={[styles.cardMeta, { color: c.textSecondary, flex: 1 }]} numberOfLines={2}>
            {picked.length < PICKS
              ? t('fantasy.pick_more', { n: PICKS - picked.length })
              : (captain ? t('fantasy.captain_is', { item: (pool.find((p) => p.k === captain) || {}).n || '' }) : t('fantasy.pick_captain'))}
          </Text>
          <TouchableOpacity onPress={onJoin} disabled={!ready || busy} style={[styles.primaryBtn, (!ready || busy) && styles.btnOff]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('fantasy.join')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBoard = () => {
    const top = round?.top || [];
    const mineInTop = top.some((r) => r.uid === uid);
    return (
      <FlatList
        data={top}
        keyExtractor={(r) => r.uid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.listPad}
        ListHeaderComponent={roundCard}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏆</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('fantasy.board_empty')}</Text>
          </View>
        )}
        ListFooterComponent={entry && !mineInTop && entry.rank ? (
          <BoardRow r={{ ...entry, rank: entry.rank }} me c={c} t={t} right={t('fantasy.pts_n', { n: entry.points || 0 })} />
        ) : null}
        renderItem={({ item }) => <BoardRow r={item} me={item.uid === uid} c={c} t={t} right={t('fantasy.pts_n', { n: item.points || 0 })} />}
      />
    );
  };

  const renderGuess = () => {
    const open = guessData?.open || [];
    const done = guessData?.done || [];
    const mine = guessData?.mine || {};
    const ev = resolveEvent(Date.now(), null, 60);
    return (
      <ScrollView contentContainerStyle={styles.listPad} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Text style={[styles.hint, { color: c.textSecondary }]}>{t('fantasy.guess_intro')}</Text>
        {!guessData ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {guessData && !open.length ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎯</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('fantasy.guess_empty')}</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              {ev && ev.phase === 'upcoming'
                ? t('fantasy.guess_next_event', { event: eventLabel(ev, t), n: Math.max(1, Math.ceil((ev.startsAt - Date.now()) / 86400000)) })
                : t('fantasy.guess_empty_body')}
            </Text>
          </View>
        ) : null}
        {open.map((g) => {
          const my = mine[g.id];
          const closed = Date.now() >= g.closesAt;
          return (
            <View key={g.id} style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <View style={styles.rowCenter}>
                <ItemThumb p={g} c={c} size={52} />
                <View style={styles.flex1Pad}>
                  <Text style={[styles.itemName, { color: c.text }]}>{g.n}  <Text style={styles.newTag}>{t('fantasy.new_item')}</Text></Text>
                  <Text style={[styles.itemSub, { color: c.textSecondary }]}>{t('fantasy.guess_now', { value: formatValue(g.valueAtOpen) })}</Text>
                  <Text style={[styles.itemSub, { color: c.textSecondary }]}>
                    {closed ? t('fantasy.guess_settles', { time: timeLeft(g.resolveAt) }) : t('fantasy.guess_closes', { time: timeLeft(g.closesAt) })}
                    {'  ·  '}{t('fantasy.players_count', { n: g.players || 0 })}
                  </Text>
                </View>
              </View>
              {my ? (
                <Text style={[styles.myGuess, { color: ACCENT }]}>{t('fantasy.your_guess', { value: formatValue(my.guess) })}</Text>
              ) : closed ? null : (
                <View style={[styles.rowCenter, { marginTop: 10 }]}>
                  <TextInput
                    value={guessText[g.id] || ''}
                    onChangeText={(v) => setGuessText((prev) => ({ ...prev, [g.id]: v }))}
                    placeholder={t('fantasy.guess_placeholder')}
                    placeholderTextColor={c.placeholder}
                    keyboardType="numeric"
                    style={[styles.search, styles.flex1, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg, marginTop: 0 }]}
                  />
                  <TouchableOpacity onPress={() => onGuess(g)} disabled={busy} style={[styles.primaryBtn, { marginLeft: 10 }, busy && styles.btnOff]}>
                    <Text style={styles.primaryBtnText}>{t('fantasy.guess_submit')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
        {done.length ? <Text style={[styles.sectionTitle, { color: c.text }]}>{t('fantasy.guess_settled')}</Text> : null}
        {done.map((g) => {
          const my = mine[g.id];
          return (
            <View key={g.id} style={[styles.card, styles.rowCenter, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <ItemThumb p={g} c={c} />
              <View style={styles.flex1Pad}>
                <Text style={[styles.itemName, { color: c.text }]}>{g.n}</Text>
                <Text style={[styles.itemSub, { color: c.textSecondary }]}>
                  {t('fantasy.guess_final', { from: formatValue(g.valueAtOpen), to: formatValue(g.final) })}
                </Text>
                {my ? (
                  <Text style={[styles.itemSub, { color: ACCENT }]}>
                    {t('fantasy.guess_result', { value: formatValue(my.guess), pts: my.pts || 0 })}
                  </Text>
                ) : null}
              </View>
              {g.top && g.top[0] ? <Text style={[styles.cardMeta, { color: c.textSecondary }]}>👑 {g.top[0].name}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderSeason = () => {
    const season = seasonData?.season;
    const top = season?.top || [];
    const me = seasonData?.me;
    return (
      <FlatList
        data={top}
        keyExtractor={(r) => r.uid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.listPad}
        ListHeaderComponent={(
          <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>{seasonName || t('fantasy.tab_season')}</Text>
            {season?.endsAt ? (
              <Text style={[styles.cardMeta, { color: c.textSecondary, marginTop: 4 }]}>
                {Date.now() < season.endsAt ? t('fantasy.season_ends', { time: timeLeft(season.endsAt) }) : t('fantasy.round_over')}
                {'  ·  '}{t('fantasy.players_count', { n: season.players || 0 })}
              </Text>
            ) : null}
            <Text style={[styles.cardMeta, { color: c.textSecondary, marginTop: 6 }]}>{t('fantasy.season_hint')}</Text>
            {me ? (
              <Text style={[styles.myGuess, { color: ACCENT }]}>
                {t('fantasy.season_you', { pts: me.points || 0, rounds: me.rounds || 0, guess: me.guessPts || 0 })}
              </Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={seasonData ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('fantasy.season_empty')}</Text>
          </View>
        ) : <ActivityIndicator style={{ marginTop: 24 }} />}
        renderItem={({ item }) => <BoardRow r={item} me={item.uid === uid} c={c} t={t} right={t('fantasy.pts_n', { n: item.points || 0 })} />}
      />
    );
  };

  return (
    // Android draws edge-to-edge: pad the status bar like BirthdaysScreen.
    <View style={[styles.flex1, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {header}
      {tabs}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : (
        <View style={styles.flex1}>
          {tab === 'team' && renderTeam()}
          {tab === 'board' && renderBoard()}
          {tab === 'guess' && renderGuess()}
          {tab === 'season' && renderSeason()}
        </View>
      )}
      <ScreenBottomBanner background={c.bg} />
      <HowItWorks visible={howVis} onClose={() => setHowVis(false)} c={c} t={t} />
      <Tutorial visible={tutStep >= 0 && !loading} step={Math.max(0, tutStep)} onNext={nextTutorial} c={c} t={t} />
      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="FantasyLeague" message={t('fantasy.signin')} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  flex1Pad: { flex: 1, marginHorizontal: 10 },
  alignEnd: { alignItems: 'flex-end' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  trophy: { marginRight: 2 },
  trophyText: { fontSize: 22 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 13, fontWeight: '700' },
  listPad: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, marginTop: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardMeta: { fontSize: 12 },
  scoreCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreBig: { fontSize: 34, fontWeight: '900' },
  rankBig: { fontSize: 26, fontWeight: '900' },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginTop: 18 },
  hint: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, marginTop: 10 },
  poolRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  pickMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  pickPts: { alignItems: 'center', minWidth: 52 },
  ptsBig: { fontSize: 20, fontWeight: '900' },
  ptsLabel: { fontSize: 10 },
  itemName: { fontSize: 14, fontWeight: '700' },
  itemSub: { fontSize: 12, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  badgeFlat: { backgroundColor: 'rgba(138,149,165,0.15)', color: '#8a95a5' },
  hype: { fontSize: 11, fontWeight: '700', marginLeft: 8 },
  dirRow: { flexDirection: 'row' },
  dirBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  capBtn: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  swapChip: { marginTop: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  swapChipText: { fontSize: 11, fontWeight: '700' },
  joinBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnOff: { opacity: 0.45 },
  boardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  rank: { width: 44, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  boardName: { flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '600' },
  boardPts: { fontSize: 14, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 42 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  emptyBody: { fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  newTag: { fontSize: 10, fontWeight: '900', color: ACCENT },
  myGuess: { fontSize: 13, fontWeight: '800', marginTop: 10 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  modalLine: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  tutCard: { alignItems: 'center', paddingVertical: 24 },
  tutStep: { fontSize: 12, fontWeight: '700' },
  tutEmoji: { fontSize: 56, marginTop: 14 },
  tutHead: { fontSize: 22, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  tutBody: { fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: 'center' },
  tutDots: { flexDirection: 'row', marginTop: 18 },
  tutDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  tutBtn: { marginTop: 18, alignSelf: 'stretch' },
  quickBtn: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  quickBtnText: { fontSize: 15, fontWeight: '800' },
});

export default FantasyLeagueScreen;
