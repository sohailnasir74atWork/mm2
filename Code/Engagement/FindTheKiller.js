/**
 * FindTheKiller.js — "🔍 Find the Killer" detective game
 * AI-generated crime scene images, tap-to-investigate clues,
 * confidence betting, streak system, community stats.
 *
 * Levels progress from simple (3 suspects, no red herrings) to
 * expert (5 suspects, 3 red herrings, faster timer).
 *
 * Data model:
 *   Firestore  mystery_levels/{levelId}  – level config
 *   Firestore  mystery_answers/{levelId}/answers/{uid} – user answer
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  Vibration,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import {
  doc, getDoc, setDoc, collection, getDocs, increment, updateDoc,
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import { updateLeaderboardCacheRealtime } from './updateLeaderboardCache';
import { initGameSounds, playPop, playWoosh, setSoundEnabled, releaseGameSounds } from '../Helper/GameSoundService';
import { createMMKV } from 'react-native-mmkv';

const soundStorage = createMMKV({ id: 'game-sounds' });
const SOUND_KEY = 'game_sound_killer';
const GAME_KEY = 'killer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT * 0.42;

const ADMIN_MODE = false; // 🚨 Set to TRUE to tap image and get exact coordinates. Set to FALSE for production.

// ─── sample levels (will be replaced by Firestore data later) ───
const SAMPLE_LEVELS = [
  {
    id: 'lvl_1',
    title: 'The Alley',
    difficulty: 1,
    imageUrl: 'https://wxyz-fatch.b-cdn.net/killer_lvl1.webp',
    timer: 60,
    suspects: [
      { id: 's1', name: 'Red Hood', emoji: '🔴' },
      { id: 's2', name: 'Blue Mask', emoji: '🔵' },
      { id: 's3', name: 'Shadow', emoji: '⚫' },
    ],
    correctSuspect: 's3',
    explanation: 'The shadow\'s footprints led directly to the weapon.',
    clueZones: [
      { x: 0.2, y: 0.6, text: '🔍 Bloody footprints lead to the dark corner', isRedHerring: false },
      { x: 0.7, y: 0.3, text: '🔍 A broken window — but from the outside', isRedHerring: false },
      { x: 0.5, y: 0.8, text: '🔍 The knife handle has dark fingerprints', isRedHerring: false },
    ],
  },
  {
    id: 'lvl_2',
    title: 'The Mansion',
    difficulty: 2,
    imageUrl: 'https://wxyz-fatch.b-cdn.net/killer_lvl2.webp',
    timer: 55,
    suspects: [
      { id: 's1', name: 'Butler', emoji: '🎩' },
      { id: 's2', name: 'Maid', emoji: '👩‍🦰' },
      { id: 's3', name: 'Chef', emoji: '👨‍🍳' },
    ],
    correctSuspect: 's1',
    explanation: 'The butler\'s gloves had traces of the poison.',
    clueZones: [
      { x: 0.3, y: 0.4, text: '🔍 Poison bottle hidden behind the wine rack', isRedHerring: false },
      { x: 0.8, y: 0.2, text: '🔍 White gloves stained with purple liquid', isRedHerring: false },
      { x: 0.5, y: 0.7, text: '🔍 Kitchen was clean — chef had left early', isRedHerring: false },
    ],
  },
  {
    id: 'lvl_3',
    title: 'The Docks',
    difficulty: 3,
    imageUrl: 'https://wxyz-fatch.b-cdn.net/killer_lvl3.webp',
    timer: 50,
    suspects: [
      { id: 's1', name: 'Fisherman', emoji: '🎣' },
      { id: 's2', name: 'Sailor', emoji: '⚓' },
      { id: 's3', name: 'Merchant', emoji: '💰' },
    ],
    correctSuspect: 's2',
    explanation: 'Sailor\'s rope knot matched the one used in the crime.',
    clueZones: [
      { x: 0.2, y: 0.3, text: '🔍 A unique sailor knot was used to tie the crate', isRedHerring: false },
      { x: 0.6, y: 0.5, text: '🔍 Salt water dripping from someone\'s jacket', isRedHerring: false },
      { x: 0.4, y: 0.8, text: '🔍 Fish scales on the dock — normal for fishermen', isRedHerring: true },
    ],
  },
  {
    id: 'lvl_4',
    title: 'The Library',
    difficulty: 4,
    imageUrl: 'https://wxyz-fatch.b-cdn.net/killer_lvl4.webp',
    timer: 50,
    suspects: [
      { id: 's1', name: 'Professor', emoji: '👓' },
      { id: 's2', name: 'Student', emoji: '📚' },
      { id: 's3', name: 'Janitor', emoji: '🧹' },
      { id: 's4', name: 'Librarian', emoji: '📖' },
    ],
    correctSuspect: 's4',
    explanation: 'Only the librarian had access to the restricted section key.',
    clueZones: [
      { x: 0.3, y: 0.2, text: '🔍 Restricted section door was unlocked', isRedHerring: false },
      { x: 0.7, y: 0.6, text: '🔍 A master key ring on the desk', isRedHerring: false },
      { x: 0.2, y: 0.7, text: '🔍 Coffee stain on a textbook — could be anyone', isRedHerring: true },
      { x: 0.8, y: 0.4, text: '🔍 Security camera was turned off from inside', isRedHerring: false },
    ],
  },
  {
    id: 'lvl_5',
    title: 'The Train',
    difficulty: 5,
    imageUrl: 'https://wxyz-fatch.b-cdn.net/killer_lvl5.webp',
    timer: 45,
    suspects: [
      { id: 's1', name: 'Conductor', emoji: '🚂' },
      { id: 's2', name: 'Mr. Sterling', emoji: '🎩' },
      { id: 's3', name: 'Lady Violet', emoji: '👒' },
      { id: 's4', name: 'Detective', emoji: '🕵️' },
    ],
    correctSuspect: 's1',
    explanation: 'The conductor was the only one with access to the locked compartment.',
    clueZones: [
      { x: 0.5, y: 0.3, text: '🔍 Compartment was locked from the outside', isRedHerring: false },
      { x: 0.2, y: 0.5, text: '🔍 Only staff have universal compartment keys', isRedHerring: false },
      { x: 0.8, y: 0.7, text: '🔍 A detective badge — but is it real?', isRedHerring: true },
      { x: 0.4, y: 0.8, text: '🔍 Schedule shows conductor passed by at the exact time', isRedHerring: false },
    ],
  },
];

const getDifficultyConfig = (level) => {
  if (level <= 5) return { label: 'Easy', emoji: '🟢', color: '#10B981' };
  if (level <= 10) return { label: 'Medium', emoji: '🟡', color: '#F59E0B' };
  if (level <= 15) return { label: 'Hard', emoji: '🟠', color: '#F97316' };
  return { label: 'Expert', emoji: '🔴', color: '#EF4444' };
};

const CONFIDENCE_OPTIONS = [
  { multiplier: 1, label: '1×', color: '#10B981', desc: 'Safe' },
  { multiplier: 2, label: '2×', color: '#F59E0B', desc: 'Risky' },
  { multiplier: 3, label: '3×', color: '#EF4444', desc: 'All In!' },
];

// ── Main Component ──
const FindTheKiller = ({ visible, onClose, screenMode = false }) => {
  const { t } = useTranslation();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;
  const c = getThemeColors(isDarkMode);

  // phases: loading | levelSelect | investigating | betting | reveal | stats
  const [phase, setPhase] = useState('loading');
  const [levels, setLevels] = useState(SAMPLE_LEVELS);
  const [currentLevel, setCurrentLevel] = useState(null);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(0);
  const [selectedSuspect, setSelectedSuspect] = useState(null);
  const [confidenceBet, setConfidenceBet] = useState(1);
  const [foundClues, setFoundClues] = useState([]);
  const [timeLeft, setTimeLeft] = useState(60);
  const [totalScore, setTotalScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [isCorrect, setIsCorrect] = useState(false);
  const [communityStats, setCommunityStats] = useState(null);
  const [completedLevels, setCompletedLevels] = useState({});
  const [adminEditedClues, setAdminEditedClues] = useState([]);
  const [adminSelectedIndex, setAdminSelectedIndex] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  const timerRef = useRef(null);
  const revealAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  // ── Load state & levels from Firestore ──
  useEffect(() => {
    if (!visible) return;
    const loadLevels = async () => {
      try {
        if (!firestoreDB) return;
        const snapshot = await getDocs(collection(firestoreDB, 'mystery_levels'));
        if (!snapshot.empty) {
          const fetchedData = {};
          snapshot.forEach(doc => { fetchedData[doc.id] = doc.data(); });
          
          setLevels(prev => prev.map(baseLevel => {
            const remote = fetchedData[baseLevel.id];
            return remote ? { ...baseLevel, ...remote } : baseLevel;
          }));
        }
      } catch (err) {
        console.warn('[FindTheKiller] load levels error:', err?.message);
      }
    };
    loadLevels();

    const cached = localState?.mysteryProgress;
    if (cached) {
      setTotalScore(cached.totalScore || 0);
      setStreak(cached.streak || 0);
      setCompletedLevels(cached.completed || {});
    }
    setPhase('levelSelect');
  }, [visible, firestoreDB]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timer ──
  useEffect(() => {
    if (phase !== 'investigating') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          // Time up — force move to betting
          triggerHapticFeedback('notificationWarning');
          return 0;
        }
        if (prev <= 10) triggerHapticFeedback('impactLight');
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Init sounds ──
  useEffect(() => {
    let enabled = true;
    try { enabled = soundStorage.getBoolean(SOUND_KEY) !== false; } catch {}
    setSoundOn(enabled);
    setSoundEnabled(GAME_KEY, enabled);
    initGameSounds();
    return () => { releaseGameSounds(); };
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    try { soundStorage.set(SOUND_KEY, next); } catch {}
    setSoundEnabled(GAME_KEY, next);
    triggerHapticFeedback('selection');
  }, [soundOn, triggerHapticFeedback]);

  // ── Streak multiplier ──
  const streakMultiplier = useMemo(() => {
    if (streak >= 10) return 3;
    if (streak >= 5) return 2;
    if (streak >= 3) return 1.5;
    return 1;
  }, [streak]);

  // ── Start level ──
  const startLevel = useCallback((level, index) => {
    setCurrentLevel(level);
    setCurrentLevelIndex(index);
    setSelectedSuspect(null);
    setConfidenceBet(1);
    setFoundClues([]);
    setAdminEditedClues(level.clueZones.map(c => ({ ...c })));
    setAdminSelectedIndex(0);
    setTimeLeft(level.timer);
    setCommunityStats(null);
    setIsCorrect(false);
    revealAnim.setValue(0);
    setPhase('investigating');
    triggerHapticFeedback('impactHeavy');
  }, [triggerHapticFeedback, revealAnim]);

  // ── Discovery of clue ──
  const discoverClue = useCallback((clueIndex) => {
    if (foundClues.includes(clueIndex)) return;
    setFoundClues(prev => [...prev, clueIndex]);
    triggerHapticFeedback('impactMedium');
    playPop(GAME_KEY);
    if (Platform.OS === 'android') Vibration.vibrate(50);
  }, [foundClues, triggerHapticFeedback]);

  // ── Select suspect ──
  const pickSuspect = useCallback((suspectId) => {
    setSelectedSuspect(suspectId);
    triggerHapticFeedback('impactLight');
    playPop(GAME_KEY);
  }, [triggerHapticFeedback]);

  // ── Confirm pick → go to betting ──
  const confirmPick = useCallback(() => {
    if (!selectedSuspect) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('betting');
    triggerHapticFeedback('impactMedium');
  }, [selectedSuspect, triggerHapticFeedback]);

  // ── Submit answer ──
  const submitAnswer = useCallback(async () => {
    const correct = selectedSuspect === currentLevel.correctSuspect;
    setIsCorrect(correct);

    // Calculate score
    const baseScore = correct ? 100 : 0;
    const clueBonus = foundClues.length * 20;
    const speedBonus = timeLeft >= currentLevel.timer * 0.5 ? 50 : (timeLeft >= 10 ? 25 : 0);
    const subtotal = baseScore + clueBonus + speedBonus;
    const betMultiplier = correct ? confidenceBet : 1;
    const penalty = !correct && confidenceBet > 1 ? -50 : 0;
    const earned = Math.round((subtotal * betMultiplier * streakMultiplier) + penalty);

    const newTotalScore = Math.max(0, totalScore + earned);
    setTotalScore(newTotalScore);

    if (correct) {
      setStreak(prev => prev + 1);
      triggerHapticFeedback('notificationSuccess');
      playWoosh(GAME_KEY);
      if (Platform.OS === 'android') Vibration.vibrate([0, 50, 30, 50, 30, 50]);
      Animated.spring(confettiAnim, { toValue: 1, tension: 200, friction: 8, useNativeDriver: true }).start();
    } else {
      setStreak(0);
      triggerHapticFeedback('notificationError');
      playPop(GAME_KEY);
      if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100]);
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }

    // Mark level complete
    const newCompleted = { ...completedLevels, [currentLevel.id]: { correct, earned } };
    setCompletedLevels(newCompleted);

    // Save local progress
    const progress = {
      totalScore: newTotalScore,
      streak: correct ? streak + 1 : 0,
      completed: newCompleted,
    };
    updateLocalState('mysteryProgress', progress);

    // Write answer to Firestore
    try {
      if (firestoreDB && uid) {
        await setDoc(doc(firestoreDB, 'mystery_answers', currentLevel.id, 'answers', uid), {
          selectedSuspect,
          isCorrect: correct,
          timeMs: (currentLevel.timer - timeLeft) * 1000,
          cluesFound: foundClues.length,
          confidenceBet,
          points: earned,
          answeredAt: new Date(),
        });

        // Update community vote counts
        await setDoc(doc(firestoreDB, 'mystery_levels', currentLevel.id), {
          totalAttempts: increment(1),
          correctAttempts: increment(correct ? 1 : 0),
          [`suspectVotes.${selectedSuspect}`]: increment(1),
        }, { merge: true });

        // Push to Global Leaderboard
        let username = 'Detective';
        let avatar = null;
        try {
          const [nameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${uid}/robloxUsername`)),
            get(ref(appdatabase, `users/${uid}/avatar`)),
          ]);
          username = nameSnap.exists() ? nameSnap.val() : (user?.displayName || 'Detective');
          avatar = avatarSnap.exists() ? avatarSnap.val() : null;
        } catch (_) {}

        if (newTotalScore > 0) {
          await setDoc(doc(firestoreDB, 'game_scores', 'killer', 'scores', uid), {
            score: newTotalScore,
            username,
            avatar,
            updatedAt: new Date(),
          }, { merge: true });

          // Update leaderboard cache in real-time
          await updateLeaderboardCacheRealtime(firestoreDB, 'killer', uid, newTotalScore, username, avatar);
        }
      }
    } catch (err) {
      console.warn('[FindTheKiller] save error:', err?.message);
    }

    // Reveal animation
    Animated.timing(revealAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    setPhase('reveal');
  }, [selectedSuspect, currentLevel, foundClues, timeLeft, confidenceBet, streakMultiplier,
    totalScore, streak, completedLevels, triggerHapticFeedback, firestoreDB, appdatabase, uid, user,
    updateLocalState, revealAnim, confettiAnim, shakeAnim]);

  // ── Fetch community stats ──
  const showCommunityStats = useCallback(async () => {
    setPhase('stats');
    try {
      if (firestoreDB) {
        const levelDoc = await getDoc(doc(firestoreDB, 'mystery_levels', currentLevel.id));
        if (levelDoc.exists) {
          const data = levelDoc.data();
          setCommunityStats({
            total: data.totalAttempts || 0,
            correct: data.correctAttempts || 0,
            votes: data.suspectVotes || {},
          });
        }
      }
    } catch (err) {
      console.warn('[FindTheKiller] stats error:', err?.message);
    }
  }, [firestoreDB, currentLevel]);

  // ── Render: Level Select ──
  const renderLevelSelect = () => (
    <ScrollView contentContainerStyle={styles.selectContent} showsVerticalScrollIndicator={false}>
      <Text style={{ fontSize: 64, textAlign: 'center' }}>🕵️</Text>
      <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>{t('killer.title', 'Find the Killer')}</Text>
      <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 8 }]}>
        {t('killer.subtitle', 'Study the scene. Find clues. Catch the killer! 🔍')}
      </Text>

      {/* Score / Streak bar */}
      <View style={[styles.scoreBar, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
        <View style={styles.scoreItem}>
          <Text style={[styles.scoreLabel, { color: c.textSecondary }]}>{t('killer.score', 'Score')}</Text>
          <Text style={[styles.scoreVal, { color: '#F59E0B' }]}>{totalScore}</Text>
        </View>
        <View style={styles.scoreItem}>
          <Text style={[styles.scoreLabel, { color: c.textSecondary }]}>{t('killer.streak', 'Streak')}</Text>
          <Text style={[styles.scoreVal, { color: streak >= 3 ? '#EF4444' : c.text }]}>
            {streak >= 3 ? `🔥${streak}` : streak}
          </Text>
        </View>
        <View style={styles.scoreItem}>
          <Text style={[styles.scoreLabel, { color: c.textSecondary }]}>{t('killer.multi', 'Multi')}</Text>
          <Text style={[styles.scoreVal, { color: streakMultiplier > 1 ? '#F59E0B' : c.textSecondary }]}>
            {streakMultiplier}×
          </Text>
        </View>
      </View>

      {/* Level cards */}
      {levels.map((level, idx) => {
        const diff = getDifficultyConfig(level.difficulty);
        const done = completedLevels[level.id];
        const isLocked = !ADMIN_MODE && idx > 0 && (!completedLevels[levels[idx - 1].id] || !completedLevels[levels[idx - 1].id].correct);
        
        return (
          <TouchableOpacity
            key={level.id}
            style={[styles.levelCard, {
              backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff',
              borderColor: done ? (done.correct ? '#10B981' : '#EF4444') : (isDarkMode ? '#334155' : '#e2e8f0'),
              opacity: done ? 0.7 : (isLocked ? 0.4 : 1),
            }]}
            onPress={() => {
              if (isLocked) {
                triggerHapticFeedback('notificationError');
                return;
              }
              startLevel(level, idx);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.levelNum, { backgroundColor: isLocked ? '#64748b' : diff.color }]}>
              {isLocked ? <Icon name="lock-closed" size={16} color="#fff" /> : <Text style={styles.levelNumText}>{idx + 1}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.levelTitle, { color: c.text }]}>{level.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Text style={{ fontSize: 12, color: isLocked ? '#94a3b8' : diff.color, fontWeight: '700' }}>{diff.emoji} {t(`killer.${diff.label.toLowerCase()}`, diff.label)}</Text>
                <Text style={{ fontSize: 11, color: c.textSecondary }}>{level.suspects.length} {t('killer.suspects', 'suspects')}</Text>
                <Text style={{ fontSize: 11, color: c.textSecondary }}>{level.timer}s</Text>
              </View>
            </View>
            {done && (
              <View style={[styles.doneMarker, { backgroundColor: done.correct ? '#10B981' : '#EF4444' }]}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{done.correct ? '✓' : '✗'}</Text>
              </View>
            )}
            <Icon name="chevron-forward" size={20} color={c.textSecondary} />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // ── Render: Investigation ──
  const renderInvestigation = () => {
    if (!currentLevel) return null;
    const diff = getDifficultyConfig(currentLevel.difficulty);
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* HUD top bar */}
        <View style={[styles.hud, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
          <View style={styles.hudItem}>
            <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('killer.level', 'Level')}</Text>
            <Text style={[styles.hudVal, { color: diff.color }]}>{currentLevelIndex + 1}</Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('killer.clues', 'Clues')}</Text>
            <Text style={[styles.hudVal, { color: '#F59E0B' }]}>
              {foundClues.length}/{currentLevel.clueZones.length}
            </Text>
          </View>
          <View style={styles.hudItem}>
            <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('killer.timer', 'Timer')}</Text>
            <Text style={[styles.hudVal, { color: timeLeft <= 10 ? '#EF4444' : '#10B981' }]}>
              {timeLeft}s
            </Text>
          </View>
        </View>

        {/* Scene image with clue zones */}
        <TouchableOpacity 
          activeOpacity={ADMIN_MODE ? 1 : undefined}
          style={[styles.sceneContainer, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#e2e8f0' }]}
          onPress={(e) => {
            if (!ADMIN_MODE || adminSelectedIndex < 0 || adminSelectedIndex >= adminEditedClues.length) return;
            const containerWidth = SCREEN_WIDTH - 8;
            const { locationX, locationY } = e.nativeEvent;
            const x = parseFloat((locationX / containerWidth).toFixed(3));
            const y = parseFloat((locationY / IMAGE_HEIGHT).toFixed(3));
            setAdminEditedClues(prev => {
              const next = [...prev];
              next[adminSelectedIndex] = { ...next[adminSelectedIndex], x, y };
              return next;
            });
          }}
        >
          {currentLevel.imageUrl ? (
            <Image
              source={{ uri: currentLevel.imageUrl }}
              style={styles.sceneImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.sceneImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkMode ? config.colors.backgroundDark : '#cbd5e1' }]}>
              <Text style={{ fontSize: 64 }}>🏚️</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>{t('killer.scene', 'Scene:')} {currentLevel.title}</Text>
            </View>
          )}
          {/* Clue tap zones */}
          {(ADMIN_MODE ? adminEditedClues : currentLevel.clueZones).map((clue, idx) => {
            const found = foundClues.includes(idx);
            const isActiveAdmin = ADMIN_MODE && adminSelectedIndex === idx;
            return (
              <TouchableOpacity
                key={`cz_${idx}`}
                style={[styles.clueZone, {
                  left: `${clue.x * 100}%`,
                  top: `${clue.y * 100}%`,
                  backgroundColor: isActiveAdmin ? '#EF444450' : (found ? '#F59E0B30' : '#ffffff15'),
                  borderColor: isActiveAdmin ? '#EF4444' : (found ? '#F59E0B' : '#ffffff40'),
                  borderWidth: isActiveAdmin ? 3 : 2,
                  zIndex: isActiveAdmin ? 100 : 1,
                }]}
                onPress={() => discoverClue(idx)}
                activeOpacity={0.6}
              >
                <Text style={{ fontSize: found || isActiveAdmin ? 14 : 18 }}>
                  {isActiveAdmin ? '🎯' : (found ? '🔍' : '❓')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </TouchableOpacity>

        {/* Found clues list */}
        {foundClues.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50, marginHorizontal: 12, marginTop: 6 }}>
            {foundClues.map(idx => (
              <View key={idx} style={[styles.clueBubble, {
                backgroundColor: currentLevel.clueZones[idx].isRedHerring ? '#EF444420' : '#F59E0B20',
                borderColor: currentLevel.clueZones[idx].isRedHerring ? '#EF4444' : '#F59E0B',
              }]}>
                <Text style={[styles.clueText, {
                  color: currentLevel.clueZones[idx].isRedHerring ? '#EF4444' : '#F59E0B',
                }]} numberOfLines={2}>
                  {currentLevel.clueZones[idx].text}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Suspect choices */}
        <View style={styles.suspectsSection}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('killer.whoDidIt', 'Who did it?')}</Text>
          <View style={styles.suspectsRow}>
            {currentLevel.suspects.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.suspectCard, {
                  backgroundColor: selectedSuspect === s.id
                    ? (isDarkMode ? '#1e3a5f' : '#DBEAFE')
                    : (isDarkMode ? config.colors.surfaceDark : '#f8fafc'),
                  borderColor: selectedSuspect === s.id ? '#3B82F6' : (isDarkMode ? '#334155' : '#e2e8f0'),
                  borderWidth: selectedSuspect === s.id ? 2 : 1,
                }]}
                onPress={() => pickSuspect(s.id)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
                <Text style={[styles.suspectName, { color: c.text }]} numberOfLines={1}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Confirm button */}
        <TouchableOpacity
          style={[styles.actionBtn, {
            backgroundColor: selectedSuspect ? '#EF4444' : '#64748b',
            opacity: selectedSuspect ? 1 : 0.5,
            marginHorizontal: 16, marginTop: 16, marginBottom: ADMIN_MODE ? 0 : 12,
          }]}
          onPress={confirmPick}
          disabled={!selectedSuspect}
          activeOpacity={0.7}
        >
          <Icon name="alert-circle" size={22} color="#fff" />
          <Text style={styles.actionBtnText}>{t('killer.accuse', 'Accuse! 🔪')}</Text>
        </TouchableOpacity>

        {ADMIN_MODE && adminEditedClues.length > 0 && (
          <View style={{ padding: 12, backgroundColor: isDarkMode ? config.colors.surfaceDark : '#334155', margin: 16, borderRadius: 12 }}>
            <Text style={{ color: '#10B981', fontWeight: '800', marginBottom: 8, fontSize: 12 }}>ADMIN: TAP IMAGE TO MOVE SELECTED CLUE</Text>
            
            {adminEditedClues.map((clue, i) => (
              <TouchableOpacity
                key={`ae_${i}`}
                style={{ padding: 10, backgroundColor: adminSelectedIndex === i ? '#3B82F6' : config.colors.backgroundDark, marginBottom: 4, borderRadius: 6 }}
                onPress={() => setAdminSelectedIndex(i)}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>
                  {adminSelectedIndex === i ? '👉 ' : ''}
                  {clue.isRedHerring ? '🔴' : '🟢'} Clue {i+1}: {clue.text}
                </Text>
              </TouchableOpacity>
            ))}

            <Text style={{ color: '#10B981', fontWeight: '800', marginTop: 12, marginBottom: 8, fontSize: 12 }}>COPY THESE UPDATED CLUEZONES ↓</Text>
            <Text selectable style={{ color: '#fff', fontSize: 11, backgroundColor: config.colors.backgroundDark, padding: 8, borderRadius: 6 }}>
              {JSON.stringify(adminEditedClues, null, 2)}
            </Text>
            
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity 
                onPress={() => {
                  Clipboard.setString(JSON.stringify(adminEditedClues, null, 2));
                  triggerHapticFeedback('notificationSuccess');
                }} 
                style={{ flex: 1, backgroundColor: '#10B981', padding: 12, borderRadius: 8, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>📋 Copy JSON</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={async () => {
                  if (!firestoreDB) return Alert.alert('Error', 'Firestore is not connected');
                  try {
                    const levelToSave = { ...currentLevel, clueZones: adminEditedClues };
                    await setDoc(doc(firestoreDB, 'mystery_levels', currentLevel.id), levelToSave, { merge: true });
                    
                    const newLevelState = { ...currentLevel, clueZones: adminEditedClues };
                    setLevels(prev => prev.map(l => l.id === currentLevel.id ? newLevelState : l));
                    setCurrentLevel(newLevelState); // Update current view to reflect changes
                    
                    Alert.alert('Saved!', 'Level data successfully pushed to Firestore.');
                    triggerHapticFeedback('notificationSuccess');
                    if (Platform.OS === 'android') Vibration.vibrate(50);
                  } catch (e) {
                    Alert.alert('Save Failed', e.message);
                  }
                }} 
                style={{ flex: 1, backgroundColor: '#3B82F6', padding: 12, borderRadius: 8, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>☁️ Save to DB</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    );
  };

  // ── Render: Betting ──
  const renderBetting = () => (
    <View style={styles.centerContent}>
      <Text style={{ fontSize: 56 }}>🎰</Text>
      <Text style={[styles.bigTitle, { color: c.text }]}>{t('killer.confidenceBet', 'Confidence Bet')}</Text>
      <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 24 }]}>
        {t('killer.betDesc', 'How confident are you in your pick?\nHigher bet = bigger reward (or penalty)!')}
      </Text>

      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
        {CONFIDENCE_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.multiplier}
            style={[styles.betCard, {
              backgroundColor: confidenceBet === opt.multiplier ? opt.color : (isDarkMode ? config.colors.surfaceDark : '#f8fafc'),
              borderColor: confidenceBet === opt.multiplier ? opt.color : (isDarkMode ? '#334155' : '#e2e8f0'),
              borderWidth: confidenceBet === opt.multiplier ? 2 : 1,
            }]}
            onPress={() => { setConfidenceBet(opt.multiplier); triggerHapticFeedback('impactLight'); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.betLabel, { color: confidenceBet === opt.multiplier ? '#fff' : c.text }]}>
              {opt.label}
            </Text>
            <Text style={[styles.betDesc, { color: confidenceBet === opt.multiplier ? '#ffffffCC' : c.textSecondary }]}>
              {t(`killer.bet_${opt.desc.toLowerCase().replace(' ', '')}`, opt.desc)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.subText, { color: c.textSecondary }]}>
        {t('killer.youAccused', 'You accused:')} {currentLevel?.suspects.find(s => s.id === selectedSuspect)?.emoji}{' '}
        {currentLevel?.suspects.find(s => s.id === selectedSuspect)?.name}
      </Text>

      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: '#EF4444', marginTop: 24 }]}
        onPress={submitAnswer}
        activeOpacity={0.7}
      >
        <Text style={styles.actionBtnText}>{t('killer.lockItIn', 'Lock It In! 🔒')}</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Render: Reveal ──
  const renderReveal = () => {
    if (!currentLevel) return null;
    const correctSuspect = currentLevel.suspects.find(s => s.id === currentLevel.correctSuspect);
    const pickedSuspect = currentLevel.suspects.find(s => s.id === selectedSuspect);

    return (
      <Animated.View style={[styles.centerContent, { transform: [{ translateX: shakeAnim }] }]}>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }} showsVerticalScrollIndicator={false}>
          <Animated.Text style={{ fontSize: 80, transform: [{ scale: confettiAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
            {isCorrect ? '🎉' : '💀'}
          </Animated.Text>
          <Text style={[styles.bigTitle, { color: isCorrect ? '#10B981' : '#EF4444' }]}>
            {isCorrect ? t('killer.correct', 'Correct!') : t('killer.wrong', 'Wrong!')}
          </Text>

          {!isCorrect && (
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Text style={[styles.subText, { color: c.textSecondary }]}>{t('killer.youPicked', 'You picked:')} {pickedSuspect?.emoji} {pickedSuspect?.name}</Text>
              <Text style={[styles.subText, { color: '#10B981', fontWeight: '800', marginTop: 4 }]}>
                {t('killer.killerWas', 'Killer was:')} {correctSuspect?.emoji} {correctSuspect?.name}
              </Text>
            </View>
          )}

          {/* Explanation card */}
          <View style={[styles.explanationCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={[styles.hudLabel, { color: c.textSecondary, marginBottom: 6 }]}>📖 {t('killer.howWeKnow', 'HOW WE KNOW')}</Text>
            <Text style={[styles.explanationText, { color: c.text }]}>{currentLevel.explanation}</Text>
          </View>

          {/* Stats */}
          <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('killer.cluesFound', 'Clues Found')}</Text>
              <Text style={[styles.statVal, { color: '#F59E0B' }]}>{foundClues.length}/{currentLevel.clueZones.length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('killer.timeUsed', 'Time Used')}</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{currentLevel.timer - timeLeft}s</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('killer.streak', 'Streak')}</Text>
              <Text style={[styles.statVal, { color: streak >= 3 ? '#EF4444' : c.text }]}>
                {streak >= 3 ? `🔥${streak}` : streak}
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#3B82F6', marginTop: 20, width: '90%', justifyContent: 'center' }]}
            onPress={showCommunityStats}
            activeOpacity={0.7}
          >
            <Icon name="people" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>{t('killer.btnCommunityStats', 'Community Stats 📊')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 10, width: '90%', justifyContent: 'center' }]}
            onPress={() => setPhase('levelSelect')}
            activeOpacity={0.7}
          >
            <Text style={styles.actionBtnText}>{t('killer.btnNextLevel', 'Next Level →')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    );
  };

  // ── Render: Community Stats ──
  const renderCommunityStats = () => {
    const total = communityStats?.total || 0;
    const correctPct = total > 0 ? Math.round((communityStats?.correct / total) * 100) : 0;

    return (
      <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 56 }}>📊</Text>
        <Text style={[styles.bigTitle, { color: c.text }]}>{t('killer.titleCommunityStats', 'Community Stats')}</Text>
        <Text style={[styles.subText, { color: c.textSecondary, marginBottom: 20 }]}>
          {total > 0 ? `${total} ${t('killer.detectivesAttempted', 'detectives attempted')}` : t('killer.beFirst', 'Be the first detective!')}
        </Text>

        {total > 0 && (
          <>
            <View style={[styles.pctCard, { backgroundColor: correctPct >= 50 ? '#10B98120' : '#EF444420', borderColor: correctPct >= 50 ? '#10B981' : '#EF4444' }]}>
              <Text style={{ fontSize: 36, fontWeight: '900', color: correctPct >= 50 ? '#10B981' : '#EF4444' }}>
                {correctPct}%
              </Text>
              <Text style={{ fontSize: 14, color: c.textSecondary, fontWeight: '600' }}>{t('killer.gotItRight', 'got it right')}</Text>
            </View>

            {/* Vote bars */}
            {currentLevel?.suspects.map(s => {
              const votes = communityStats?.votes?.[s.id] || 0;
              const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
              const isAnswer = s.id === currentLevel.correctSuspect;
              return (
                <View key={s.id} style={{ width: '100%', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>
                      {s.emoji} {s.name} {isAnswer ? '✓' : ''}
                    </Text>
                    <Text style={{ color: c.textSecondary, fontWeight: '600', fontSize: 13 }}>{pct}%</Text>
                  </View>
                  <View style={[styles.voteBarBg, { backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
                    <View style={[styles.voteBarFill, {
                      width: `${pct}%`,
                      backgroundColor: isAnswer ? '#10B981' : (isDarkMode ? '#64748b' : '#94a3b8'),
                    }]} />
                  </View>
                </View>
              );
            })}
          </>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 24, width: '100%', justifyContent: 'center' }]}
          onPress={() => setPhase('levelSelect')}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>{t('killer.btnBackToLevels', 'Back to Levels 🗺️')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ── Inner Content ──
  const innerContent = (
    <>
      {!screenMode && (
        <View style={styles.handleBar}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
        </View>
      )}

      {!screenMode && (
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>🕵️ {t('killer.title', 'Find the Killer')}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
              <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={c.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (timerRef.current) clearInterval(timerRef.current); onClose(); }}
              style={styles.closeBtn}
            >
              <Icon name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {screenMode && (
        <View style={{ position: 'absolute', top: 10, right: 12, zIndex: 20 }}>
          <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
            <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {phase === 'loading' && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#EF4444" />
        </View>
      )}
      {phase === 'levelSelect' && renderLevelSelect()}
      {phase === 'investigating' && renderInvestigation()}
      {phase === 'betting' && renderBetting()}
      {phase === 'reveal' && renderReveal()}
      {phase === 'stats' && renderCommunityStats()}
    </>
  );

  if (screenMode) {
    return (
      <View style={[styles.modal, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc', borderRadius: 0, paddingTop: 8 }]}>
        {innerContent}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.7)' }]}>
        <View style={[styles.modal, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc' }]}>
          {innerContent}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: { width: '100%', padding: 16, paddingBottom: 36, borderTopLeftRadius: 24, borderTopRightRadius: 24, minHeight: '95%', flex: 1 },
  handleBar: { alignItems: 'center', marginBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800' },
  closeBtn: { padding: 8 },

  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  selectContent: { paddingVertical: 10, paddingHorizontal: 4 },
  bigTitle: { fontSize: 28, fontWeight: '900', marginTop: 8 },
  subText: { fontSize: 14, marginTop: 4, fontWeight: '500' },

  // Score bar
  scoreBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderRadius: 16, borderWidth: 1, marginVertical: 12 },
  scoreItem: { alignItems: 'center' },
  scoreLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  scoreVal: { fontSize: 22, fontWeight: '900' },

  // Level cards
  levelCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 8, gap: 12 },
  levelNum: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  levelNumText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  levelTitle: { fontSize: 16, fontWeight: '800' },
  doneMarker: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 4 },

  // HUD
  hud: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, marginTop: 6, marginBottom: 8 },
  hudItem: { alignItems: 'center' },
  hudLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  hudVal: { fontSize: 20, fontWeight: '900' },

  // Scene
  sceneContainer: { height: IMAGE_HEIGHT, borderRadius: 16, overflow: 'hidden', position: 'relative', marginHorizontal: 4 },
  sceneImage: { width: '100%', height: '100%' },
  clueZone: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderStyle: 'dashed',
    marginLeft: -22, marginTop: -22,
  },

  // Clue bubbles
  clueBubble: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, marginRight: 8, maxWidth: 200 },
  clueText: { fontSize: 11, fontWeight: '600' },

  // Suspects
  suspectsSection: { paddingHorizontal: 12, marginTop: 8, flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  suspectsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  suspectCard: { flex: 1, minWidth: 70, alignItems: 'center', padding: 12, borderRadius: 14 },
  suspectName: { fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' },

  // Bet cards
  betCard: { flex: 1, alignItems: 'center', padding: 16, borderRadius: 16 },
  betLabel: { fontSize: 28, fontWeight: '900' },
  betDesc: { fontSize: 12, fontWeight: '700', marginTop: 4 },

  // Action buttons
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, alignSelf: 'center' },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },

  // Explanation
  explanationCard: { width: '100%', padding: 16, borderRadius: 16, borderWidth: 2, marginTop: 16 },
  explanationText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },

  // Stats
  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 16 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 14, fontWeight: '600' },
  statVal: { fontSize: 20, fontWeight: '900' },

  // Community
  pctCard: { paddingVertical: 20, paddingHorizontal: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', marginBottom: 20 },
  voteBarBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  voteBarFill: { height: '100%', borderRadius: 4 },
});

export default FindTheKiller;
