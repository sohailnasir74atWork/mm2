/**
 * BombDefusal.js — "Defuse the Bomb" quick-decision game
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
const SOUND_KEY = 'game_sound_bomb';
const GAME_KEY = 'bomb';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WIRE_WIDTH = (SCREEN_WIDTH - 100) / 4;
const INITIAL_TIME = 6;     
const MIN_TIME = 3;          

const WIRES = [
  { id: 0, color: '#EF4444', name: 'Red',    emoji: '🔴', symbol: '🌹' },
  { id: 1, color: '#3B82F6', name: 'Blue',   emoji: '🔵', symbol: '🌊' },
  { id: 2, color: '#10B981', name: 'Green',  emoji: '🟢', symbol: '🍀' },
  { id: 3, color: '#F59E0B', name: 'Yellow', emoji: '🟡', symbol: '⭐' },
];

const generateClue = (correctIdx, round) => {
  const correct = WIRES[correctIdx];
  const others = WIRES.filter(w => w.id !== correctIdx);
  const randomOther = others[Math.floor(Math.random() * others.length)];

  const easyClues = [
    { text: `Cut the ${correct.emoji} ${correct.name} wire!`, type: 'direct' },
    { text: `${correct.name} is the safe one. Cut it!`, type: 'direct' },
    { text: `The ${correct.symbol} wire will save you!`, type: 'symbol' },
  ];

  const mediumClues = [
    { text: `Do NOT cut ${randomOther.emoji} ${randomOther.name}!`, type: 'not', exclude: [randomOther.id] },
    { text: `The wire is to the ${correctIdx <= 1 ? 'LEFT' : 'RIGHT'} side`, type: 'position' },
    { text: `Cut wire number ${correctIdx + 1} from the left`, type: 'number' },
    { text: `The answer rhymes with "${correct.name === 'Red' ? 'Bed' : correct.name === 'Blue' ? 'Glue' : correct.name === 'Green' ? 'Bean' : 'Mellow'}"`, type: 'rhyme' },
  ];

  const hardClues = [
    { text: `NOT ${others[0].emoji} and NOT ${others[1].emoji}`, type: 'double_not', exclude: [others[0].id, others[1].id] },
    { text: `Same color as ${correct.symbol}`, type: 'symbol_match' },
    { text: `It's wire #${correctIdx + 1}`, type: 'index' },
    { text: `Between ${WIRES[Math.max(0, correctIdx - 1)].emoji} and ${WIRES[Math.min(3, correctIdx + 1)].emoji}`, type: 'between' },
  ];

  let pool;
  if (round < 3) pool = easyClues;
  else if (round < 6) pool = [...easyClues, ...mediumClues];
  else pool = [...mediumClues, ...hardClues];

  return pool[Math.floor(Math.random() * pool.length)];
};

// ── BombDefusal Component ──
const BombDefusal = ({ visible, onClose, screenMode = false }) => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading'); // loading | rules | playing | defused | exploded | gameover
  const [bestScore, setBestScore] = useState(0);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [correctWire, setCorrectWire] = useState(0);
  const [clue, setClue] = useState({ text: '', type: '' });
  const [cutWire, setCutWire] = useState(null);  
  const [wiresCut, setWiresCut] = useState([]);
  const [soundOn, setSoundOn] = useState(true);

  const timerRef = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const tickAnim = useRef(new Animated.Value(1)).current;
  const gameActiveRef = useRef(false);

  const c = getThemeColors(isDarkMode);

  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setBestScore(data.bombBestScore || 0);
        setPhase('rules');
        setScore(0);
        setRound(0);
      } catch {
        setPhase('rules');
      }
    })();
  }, [visible, firestoreDB, uid]);

  useEffect(() => {
    return () => {
      gameActiveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
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

  const getRoundTime = useCallback((r) => {
    return Math.max(MIN_TIME, INITIAL_TIME - Math.floor(r / 2));
  }, []);

  const setupRound = useCallback((roundNum) => {
    const correctIdx = Math.floor(Math.random() * 4);
    const hint = generateClue(correctIdx, roundNum);
    setCorrectWire(correctIdx);
    setClue(hint);
    setCutWire(null);
    setWiresCut([]);
    const time = getRoundTime(roundNum);
    setTimeLeft(time);
    setPhase('playing');
    gameActiveRef.current = true;
    triggerHapticFeedback('impactLight');

    const doPulse = () => {
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start(() => { if (gameActiveRef.current) doPulse(); });
    };
    doPulse();
  }, [getRoundTime, triggerHapticFeedback, pulseAnim]);

  const explode = useCallback(() => {
    setPhase('exploded');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();

    setTimeout(() => endGame(), 2000);
  }, [shakeAnim]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'playing') return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          gameActiveRef.current = false;
          triggerHapticFeedback('notificationError');
          playPop(GAME_KEY);
          if (Platform.OS === 'android') Vibration.vibrate([0, 200, 100, 200]);
          explode();
          return 0;
        }
        if (prev <= 3) {
          triggerHapticFeedback('impactLight');
          playPop(GAME_KEY);
          Animated.sequence([
            Animated.timing(tickAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
            Animated.timing(tickAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
          ]).start();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [phase, explode, triggerHapticFeedback, tickAnim]);

  const handleCutWire = useCallback((wireId) => {
    if (!gameActiveRef.current || cutWire !== null) return;
    clearInterval(timerRef.current);
    gameActiveRef.current = false;
    setCutWire(wireId);
    setWiresCut([wireId]);

    if (wireId === correctWire) {
      triggerHapticFeedback('notificationSuccess');
      playWoosh(GAME_KEY);
      if (Platform.OS === 'android') Vibration.vibrate([0, 50, 30, 50]);
      setScore(prev => prev + (timeLeft >= 3 ? 20 : 15));
      setPhase('defused');
    } else {
      triggerHapticFeedback('notificationError');
      playPop(GAME_KEY);
      if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100, 50, 200]);
      explode();
    }
  }, [correctWire, cutWire, timeLeft, triggerHapticFeedback, explode]);

  const nextRound = useCallback(() => {
    const next = round + 1;
    setRound(next);
    setupRound(next);
  }, [round, setupRound]);

  const startGame = useCallback(() => {
    setScore(0);
    setRound(0);
    setCutWire(null);
    setWiresCut([]);
    shakeAnim.setValue(0);
    triggerHapticFeedback('impactHeavy');
    setupRound(0);
  }, [setupRound, triggerHapticFeedback, shakeAnim]);

  const endGame = useCallback(async () => {
    setPhase('gameover');
    const finalScore = score;
    try {
      const newBest = Math.max(round, bestScore);
      setBestScore(newBest);
      // Legacy write
      await setDoc(doc(firestoreDB, 'games', uid), {
        lastBombAt: new Date(),
        lastBombScore: round,
        bombBestScore: newBest,
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
        await setDoc(doc(firestoreDB, 'game_scores', 'bomb', 'scores', uid), {
          score: newBest,
          username,
          avatar,
          updatedAt: new Date(),
        }, { merge: true });

        // ── Update leaderboard cache in real-time ──
        await updateLeaderboardCacheRealtime(firestoreDB, 'bomb', uid, newBest, username, avatar);
      }
    } catch (err) {
      console.warn('[BombDefusal] save error:', err?.message);
    }
  }, [score, round, bestScore, firestoreDB, appdatabase, uid, user]);

  const renderWire = (wire) => {
    const isCut = wiresCut.includes(wire.id);
    const isCorrect = wire.id === correctWire;
    const showResult = phase === 'defused' || phase === 'exploded';

    return (
      <TouchableOpacity
        key={wire.id}
        style={[styles.wire, {
          backgroundColor: isCut ? (isDarkMode ? config.colors.surfaceDark : '#f1f5f9') : wire.color,
          width: WIRE_WIDTH,
          borderColor: showResult && isCorrect ? '#10B981' : 'transparent',
          borderWidth: showResult && isCorrect ? 3 : 0,
          opacity: isCut ? 0.3 : 1,
        }]}
        onPress={() => handleCutWire(wire.id)}
        activeOpacity={0.6}
        disabled={!gameActiveRef.current || cutWire !== null}
      >
        <Text style={styles.wireEmoji}>{wire.emoji}</Text>
        <Text style={styles.wireName}>{wire.name}</Text>
        {isCut && <Text style={styles.cutMark}>✂️</Text>}
        {showResult && isCorrect && !isCut && (
          <View style={styles.correctBadge}><Text style={{ fontSize: 10, color: '#fff', fontWeight: '900' }}>✓</Text></View>
        )}
      </TouchableOpacity>
    );
  };

  const innerContent = (
    <>
      {!screenMode && (
        <View style={styles.handleBar}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
        </View>
      )}
        
      {!screenMode && (
        <>
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>💣 Bomb Defusal</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
                <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { gameActiveRef.current = false; if (timerRef.current) clearInterval(timerRef.current); onClose(); }} style={styles.closeBtn}>
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
            <Text style={{ fontSize: 48 }}>💣</Text>
          </View>
        )}

        {phase === 'rules' && (
          <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 64, textAlign: 'center' }}>💣</Text>
            <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Defuse the Bomb!</Text>
            <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
              Read the clue. Cut the right wire. Don't explode! 😱
            </Text>

            <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleEmoji}>📖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ruleTitle, { color: c.text }]}>Read the Clue</Text>
                  <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>A hint tells you which wire to cut. Read carefully!</Text>
                </View>
              </View>
            </View>

            <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#DBEAFE' }]}>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleEmoji}>✂️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ruleTitle, { color: c.text }]}>Cut the Wire!</Text>
                  <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap the correct colored wire before time runs out!</Text>
                </View>
              </View>
            </View>

            <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleEmoji}>💥</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ruleTitle, { color: c.text }]}>Don't Mess Up</Text>
                  <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Wrong wire or time runs out = BOOM! 💥 Game over!</Text>
                </View>
              </View>
            </View>

            <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#F0FDF4' }]}>
              <View style={styles.ruleRow}>
                <Text style={styles.ruleEmoji}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ruleTitle, { color: c.text }]}>Gets Harder!</Text>
                  <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Timer gets shorter & clues get trickier each round!</Text>
                </View>
              </View>
            </View>

            {bestScore > 0 && (
              <Text style={[styles.bestScoreLabel, { color: '#EF4444' }]}>
                🏆 Best: {bestScore} Defused
              </Text>
            )}

            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EF4444', marginTop: 16 }]} onPress={startGame}>
              <Icon name="play" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>LET'S GO! 🎮</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {(phase === 'playing' || phase === 'defused' || phase === 'exploded') && (
          <Animated.View style={[{ flex: 1, alignItems: 'center' }, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={[styles.hud, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
              <View style={styles.hudItem}>
                <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Round</Text>
                <Text style={[styles.hudVal, { color: c.text }]}>{round + 1}</Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Score</Text>
                <Text style={[styles.hudVal, { color: '#F59E0B' }]}>{score}</Text>
              </View>
              <View style={styles.hudItem}>
                <Animated.Text style={[styles.hudLabel, { color: c.textSecondary }]}>Timer</Animated.Text>
                <Animated.Text style={[styles.hudVal, { color: timeLeft <= 2 ? '#EF4444' : timeLeft <= 3 ? '#F59E0B' : '#10B981', transform: [{ scale: tickAnim }] }]}>
                  {timeLeft}s
                </Animated.Text>
              </View>
            </View>

            <Animated.View style={[styles.bombBody, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#374151', transform: [{ scale: pulseAnim }] }]}>
              <Text style={{ fontSize: 56 }}>💣</Text>
              {phase === 'exploded' && <Text style={{ fontSize: 48, position: 'absolute' }}>💥</Text>}
              {phase === 'defused' && <Text style={{ fontSize: 48, position: 'absolute' }}>✅</Text>}
            </Animated.View>

            <View style={[styles.clueBox, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7', borderColor: timeLeft <= 2 ? '#EF4444' : '#F59E0B' }]}>
              <Text style={[styles.clueLabel, { color: c.textSecondary }]}>📖 CLUE:</Text>
              <Text style={[styles.clueText, { color: c.text }]}>{clue.text}</Text>
            </View>

            <View style={styles.wiresRow}>
              {WIRES.map(wire => renderWire(wire))}
            </View>

            {phase === 'defused' && (
              <View style={{ alignItems: 'center', marginTop: 16 }}>
                <Text style={{ fontSize: 48 }}>✅</Text>
                <Text style={[styles.resultTitle, { color: '#10B981' }]}>Defused!</Text>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 12 }]} onPress={nextRound}>
                  <Text style={styles.actionBtnText}>Next Bomb → 💣</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'exploded' && (
              <View style={{ alignItems: 'center', marginTop: 16 }}>
                <Text style={{ fontSize: 48 }}>💥</Text>
                <Text style={[styles.resultTitle, { color: '#EF4444' }]}>BOOM!</Text>
                <Text style={[styles.subText, { color: c.textSecondary, fontSize: 16 }]}>
                  Correct wire was {WIRES[correctWire].emoji} {WIRES[correctWire].name}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {phase === 'gameover' && (
          <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 80 }}>{round >= 10 ? '🏆' : round >= 5 ? '🧨' : round >= 2 ? '💣' : '💥'}</Text>
            <Text style={[styles.bigTitle, { color: '#EF4444' }]}>
              {round >= 10 ? 'Bomb Expert!' : round >= 5 ? 'Great Job!' : round >= 2 ? 'Not Bad!' : 'Ka-Boom!'}
            </Text>

            <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: c.textSecondary }]}>Score</Text>
                <Text style={[styles.statVal, { color: '#F59E0B' }]}>{score}</Text>
              </View>
              <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.statLabel, { color: c.textSecondary }]}>Defused</Text>
                <Text style={[styles.statVal, { color: c.text }]}>{round} {round === 1 ? 'bomb' : 'bombs'}</Text>
              </View>
            </View>

            {bestScore > 0 && (
              <Text style={[styles.bestScoreLabel, { color: '#EF4444', marginTop: 16 }]}>
                {round >= bestScore && round > 0 ? '🎉 NEW HIGH SCORE! 🎉' : `Best Score: ${bestScore} Defused`}
              </Text>
            )}

            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EF4444', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={startGame}>
              <Icon name="refresh" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Play Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={onClose}>
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
  modal: { width: '100%', paddingBottom: 36, borderTopLeftRadius: 24, borderTopRightRadius: 24, minHeight: '95%', flex: 1 },
  handleBar: { alignItems: 'center', paddingTop: 8, marginBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  closeBtn: { padding: 8 },

  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 20 },
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

  hud: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  hudItem: { alignItems: 'center' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  bombBody: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', marginVertical: 16, shadowColor: '#EF4444', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 8 },

  clueBox: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, borderWidth: 2, width: '100%', marginBottom: 20 },
  clueLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  clueText: { fontSize: 18, fontWeight: '800', textAlign: 'center' },

  wiresRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  wire: { height: 100, borderRadius: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  wireEmoji: { fontSize: 24, marginBottom: 4 },
  wireName: { color: '#fff', fontSize: 12, fontWeight: '900' },
  cutMark: { fontSize: 20, position: 'absolute', top: 4, right: 4 },
  correctBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: '#10B981', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },

  resultTitle: { fontSize: 28, fontWeight: '900', marginTop: 4 },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default BombDefusal;
