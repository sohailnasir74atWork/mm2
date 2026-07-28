/**
 * SpotTheFake.js → "Whack the Murderer"
 * Polished, Kid-Friendly, Consistent UI
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import { updateLeaderboardCacheRealtime } from './updateLeaderboardCache';
import { initGameSounds, playPop, playWoosh, setSoundEnabled, releaseGameSounds } from '../Helper/GameSoundService';
import { createMMKV } from 'react-native-mmkv';

const soundStorage = createMMKV({ id: 'game-sounds' });
const SOUND_KEY = 'game_sound_spot';
const GAME_KEY = 'spot';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_SIZE = 3;
const CELL_SIZE = (SCREEN_WIDTH - 80) / GRID_SIZE;
const INITIAL_SPAWN_MS = 1200;
const MIN_SPAWN_MS = 500;
const SPAWN_INTERVAL_MS = 900;
const MIN_INTERVAL_MS = 450;
const SPEED_UP_EVERY = 5;

const CHAR_NONE = 0;
const CHAR_MURDERER = 1;  // 🔪 
const CHAR_INNOCENT = 2;  // 😇 
const CHAR_SHERIFF = 3;   // ⭐ 

const CHAR_EMOJIS = {
  [CHAR_MURDERER]: '🔪',
  [CHAR_INNOCENT]: '😇',
  [CHAR_SHERIFF]: '⭐',
};

// ── Main Component ──
const SpotTheFake = ({ visible, onClose, screenMode = false }) => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading'); // loading | rules | playing | gameover
  const [bestScore, setBestScore] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [catches, setCatches] = useState(0);
  const [grid, setGrid] = useState(Array(9).fill(CHAR_NONE));
  const [feedback, setFeedback] = useState(null);
  const [comboCount, setComboCount] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  const spawnTimerRef = useRef(null);
  const despawnTimersRef = useRef({});
  const gridRef = useRef(Array(9).fill(CHAR_NONE));
  const livesRef = useRef(3);
  const catchesRef = useRef(0);
  const scoreRef = useRef(0);
  const gameActiveRef = useRef(false);
  const scaleAnims = useRef(Array(9).fill(null).map(() => new Animated.Value(0))).current;

  const c = getThemeColors(isDarkMode);

  // ── Load state ──
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setBestScore(data.whackBestScore || 0);
        setPhase('rules');
      } catch {
        setPhase('rules');
      }
    })();
  }, [visible, firestoreDB, uid]);

  // ── Clean up on close ──
  useEffect(() => {
    if (!visible) {
      gameActiveRef.current = false;
      if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
      Object.values(despawnTimersRef.current).forEach(t => clearTimeout(t));
      despawnTimersRef.current = {};
    }
  }, [visible]);

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

  const getSpeed = useCallback(() => {
    const speedLevel = Math.floor(catchesRef.current / SPEED_UP_EVERY);
    const visibleTime = Math.max(MIN_SPAWN_MS, INITIAL_SPAWN_MS - speedLevel * 80);
    const interval = Math.max(MIN_INTERVAL_MS, SPAWN_INTERVAL_MS - speedLevel * 50);
    return { visibleTime, interval };
  }, []);

  const endGame = useCallback(async () => {
    gameActiveRef.current = false;
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    Object.values(despawnTimersRef.current).forEach(t => clearTimeout(t));
    despawnTimersRef.current = {};
    gridRef.current = Array(9).fill(CHAR_NONE);
    setGrid(Array(9).fill(CHAR_NONE));
    setPhase('gameover');

    playPop(GAME_KEY);
    if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100]);

    const finalScore = scoreRef.current;
    try {
      const newBest = Math.max(finalScore, bestScore);
      setBestScore(newBest);
      // Legacy write (backwards compat)
      await setDoc(doc(firestoreDB, 'games', uid), {
        lastWhackAt: new Date(),
        lastWhackScore: finalScore,
        whackBestScore: newBest,
      }, { merge: true });

      // ── Leaderboard dual-write ──
      if (newBest > 0) {
        let username = 'Unknown';
        let avatar = null;
        try {
          const [nameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${uid}/robloxUsername`)),
            get(ref(appdatabase, `users/${uid}/avatar`)),
          ]);
          username = nameSnap.exists() ? nameSnap.val() : (user?.displayName || 'Unknown');
          avatar = avatarSnap.exists() ? avatarSnap.val() : null;
        } catch (_) {}
        await setDoc(doc(firestoreDB, 'game_scores', 'whack', 'scores', uid), {
          score: newBest,
          username,
          avatar,
          updatedAt: new Date(),
        }, { merge: true });

        // ── Update leaderboard cache in real-time ──
        await updateLeaderboardCacheRealtime(firestoreDB, 'whack', uid, newBest, username, avatar);
      }
    } catch (err) {
      console.warn('[WhackMurderer] save error:', err?.message);
    }
  }, [bestScore, firestoreDB, appdatabase, uid, user]);

  const spawnCharacter = useCallback(() => {
    if (!gameActiveRef.current) return;
    const emptyCells = [];
    for (let i = 0; i < 9; i++) {
      if (gridRef.current[i] === CHAR_NONE) emptyCells.push(i);
    }
    if (emptyCells.length === 0) return;

    const cellIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const roll = Math.random();
    let charType = CHAR_SHERIFF;
    if (roll < 0.60) charType = CHAR_MURDERER;
    else if (roll < 0.85) charType = CHAR_INNOCENT;

    const newGrid = [...gridRef.current];
    newGrid[cellIndex] = charType;
    gridRef.current = newGrid;
    setGrid([...newGrid]);

    scaleAnims[cellIndex].setValue(0);
    Animated.spring(scaleAnims[cellIndex], {
      toValue: 1, tension: 200, friction: 8, useNativeDriver: true,
    }).start();

    const { visibleTime } = getSpeed();
    despawnTimersRef.current[cellIndex] = setTimeout(() => {
      if (!gameActiveRef.current) return;
      const current = gridRef.current[cellIndex];
      
      if (current === CHAR_MURDERER) {
        livesRef.current -= 1;
        setLives(livesRef.current);
        setComboCount(0);
        triggerHapticFeedback('notificationError');
        playPop(GAME_KEY);
        setFeedback({ index: cellIndex, type: 'miss' });
        setTimeout(() => setFeedback(null), 400);
        
        if (livesRef.current <= 0) {
          endGame();
          return;
        }
      }

      const cleared = [...gridRef.current];
      cleared[cellIndex] = CHAR_NONE;
      gridRef.current = cleared;
      setGrid([...cleared]);
    }, visibleTime);

    const { interval } = getSpeed();
    spawnTimerRef.current = setTimeout(spawnCharacter, interval);
  }, [getSpeed, triggerHapticFeedback, endGame, scaleAnims]);

  const handleTap = useCallback((index) => {
    if (!gameActiveRef.current) return;
    const charType = gridRef.current[index];
    if (charType === CHAR_NONE) return;

    if (despawnTimersRef.current[index]) {
      clearTimeout(despawnTimersRef.current[index]);
      delete despawnTimersRef.current[index];
    }

    Animated.timing(scaleAnims[index], {
      toValue: 0, duration: 150, useNativeDriver: true,
    }).start();

    if (charType === CHAR_MURDERER) {
      const newCombo = comboCount + 1;
      const comboBonus = newCombo >= 3 ? Math.min(newCombo * 2, 20) : 0;
      const points = 10 + comboBonus;
      scoreRef.current += points;
      catchesRef.current += 1;
      setScore(scoreRef.current);
      setCatches(catchesRef.current);
      setComboCount(newCombo);
      setFeedback({ index, type: 'hit', points });
      triggerHapticFeedback('impactMedium');
      playPop(GAME_KEY);
      if (newCombo >= 3) setTimeout(() => triggerHapticFeedback('impactLight'), 80);
    } else if (charType === CHAR_SHERIFF) {
      scoreRef.current += 25;
      catchesRef.current += 1;
      setScore(scoreRef.current);
      setCatches(catchesRef.current);
      setComboCount(prev => prev + 1);
      setFeedback({ index, type: 'sheriff', points: 25 });
      triggerHapticFeedback('notificationSuccess');
      playWoosh(GAME_KEY);
    } else if (charType === CHAR_INNOCENT) {
      livesRef.current -= 1;
      setLives(livesRef.current);
      setComboCount(0);
      setFeedback({ index, type: 'wrong' });
      triggerHapticFeedback('notificationError');
      playPop(GAME_KEY);
      if (Platform.OS === 'android') Vibration.vibrate([0, 60, 40, 60]);

      if (livesRef.current <= 0) {
        endGame();
        return;
      }
    }

    setTimeout(() => setFeedback(null), 500);
    const cleared = [...gridRef.current];
    cleared[index] = CHAR_NONE;
    gridRef.current = cleared;
    setGrid([...cleared]);
  }, [comboCount, triggerHapticFeedback, endGame, scaleAnims]);

  const startGame = useCallback(() => {
    setScore(0);
    setLives(3);
    setCatches(0);
    setComboCount(0);
    setFeedback(null);
    scoreRef.current = 0;
    livesRef.current = 3;
    catchesRef.current = 0;
    gridRef.current = Array(9).fill(CHAR_NONE);
    setGrid(Array(9).fill(CHAR_NONE));
    scaleAnims.forEach(a => a.setValue(0));
    gameActiveRef.current = true;
    setPhase('playing');
    triggerHapticFeedback('impactHeavy');
    playWoosh(GAME_KEY);
    spawnTimerRef.current = setTimeout(spawnCharacter, 700);
  }, [spawnCharacter, triggerHapticFeedback, scaleAnims]);

  // Inner game content (shared between modal and screen modes)
  const innerContent = (
    <>
      {!screenMode && (
        <>
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>🔪 Whack Murderer</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
                <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { gameActiveRef.current = false; onClose(); }} style={styles.closeBtn}>
                <Icon name="close" size={22} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </>
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
          <Text style={{ fontSize: 48 }}>🔪</Text>
        </View>
      )}

      {phase === 'rules' && (
        <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64, textAlign: 'center' }}>🔪</Text>
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Whack the Murderer</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            Quick reflexes! Catch them before they hide!
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🔪</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Tap to Catch!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap the Murderer quickly! Missing costs 1 life.</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#EFF6FF' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>😇</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Don't Tap Innocents!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tapping an Innocent costs 1 life. You only have 3!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>⭐</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Sheriff Bonus!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap the Sheriff for extra points!</Text>
              </View>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: '#B91C1C' }]}>
              🏆 High Score: {bestScore}
            </Text>
          )}

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#B91C1C', marginTop: 16 }]} onPress={startGame}>
            <Icon name="play" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>LET'S GO! 🎮</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {phase === 'playing' && (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={[styles.hud, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>{score}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Combo</Text>
              <Text style={[styles.hudVal, { color: comboCount >= 3 ? '#F59E0B' : c.textSecondary }]}>x{comboCount}</Text>
            </View>
            <View style={[styles.hudItem, { alignItems: 'flex-end' }]}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Lives</Text>
              <View style={{ flexDirection: 'row' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Icon key={i} name="heart" size={18} color={i < lives ? '#DC2626' : (isDarkMode ? '#334155' : '#cbd5e1')} style={{ marginLeft: 2 }} />
                ))}
              </View>
            </View>
          </View>

          <View style={styles.gridContainer}>
            <View style={styles.grid}>
              {grid.map((cellChar, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.cell, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f1f5f9' }]}
                  onPress={() => handleTap(i)}
                  activeOpacity={1}
                >
                  {cellChar !== CHAR_NONE && (
                    <Animated.View style={[styles.character, { transform: [{ scale: scaleAnims[i] }] }]}>
                      <Text style={styles.charEmoji}>{CHAR_EMOJIS[cellChar]}</Text>
                    </Animated.View>
                  )}
                  {feedback?.index === i && (
                    <View style={styles.feedbackOverlay}>
                      {feedback.type === 'hit' && <Text style={[styles.feedbackText, { color: '#10B981' }]}>+{feedback.points}</Text>}
                      {feedback.type === 'sheriff' && <Text style={[styles.feedbackText, { color: '#F59E0B' }]}>+{feedback.points}</Text>}
                      {feedback.type === 'wrong' && <Text style={[styles.feedbackText, { color: '#EF4444' }]}>❌</Text>}
                      {feedback.type === 'miss' && <Text style={[styles.feedbackText, { color: '#EF4444', fontSize: 16 }]}>Miss!</Text>}
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {phase === 'gameover' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64 }}>{score > bestScore ? '🏆' : '💀'}</Text>
          <Text style={[styles.bigTitle, { color: '#B91C1C' }]}>Game Over!</Text>

          <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.statVal, { color: '#B91C1C' }]}>{score}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Caught</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{catches}</Text>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: '#B91C1C', marginTop: 16 }]}>
              {score >= bestScore && score > 0 ? '🎉 NEW HIGH SCORE! 🎉' : `Best Score: ${bestScore}`}
            </Text>
          )}

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#B91C1C', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={startGame}>
            <Icon name="refresh" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>Play Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={() => { gameActiveRef.current = false; onClose(); }}>
            <Text style={styles.actionBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  closeBtn: { padding: 8 },
  
  centerContent: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 12 },
  bigTitle: { fontSize: 28, fontWeight: '900', marginTop: 8 },
  subText: { fontSize: 14, marginTop: 4 },
  
  ruleCard: { borderRadius: 16, padding: 16, marginBottom: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ruleEmoji: { fontSize: 36 },
  ruleTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  ruleDesc: { fontSize: 13, lineHeight: 18 },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, alignSelf: 'center' },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  
  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 10 },

  hud: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, marginBottom: 24 },
  hudItem: { alignItems: 'flex-start' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  gridContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL_SIZE * 3 + 24, gap: 12 },
  cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(0,0,0,0.05)' },
  character: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  charEmoji: { fontSize: CELL_SIZE * 0.55 },
  
  feedbackOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 18 },
  feedbackText: { fontSize: 24, fontWeight: '900' },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default SpotTheFake;
