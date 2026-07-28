/**
 * DailyQuiz.js
 * Daily MM2 trivia quiz — 5 questions, 12s timer, XP rewards.
 *
 * State: Firestore games/{uid} → lastQuizAt, quizBestScore
 * XP:    +20 per correct, +50 bonus for 5/5 perfect
 *
 * Adapted for MM2: Murder Mystery 2 questions,
 * no SwipeableBottomDrawer, no badge utils, sober colors.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import { useTranslation } from 'react-i18next';

// ── MM2 Question Bank ──
const QUESTION_BANK = [
  { q: 'What type of knife is "Chroma Luger"?', a: 'Chroma', opts: ['Chroma', 'Godly', 'Vintage', 'Legendary'] },
  { q: 'Who is the developer of Murder Mystery 2?', a: 'Nikilis', opts: ['Nikilis', 'Builderman', 'Shedletsky', 'JJ5x5'] },
  { q: 'What rarity tier is above Legendary?', a: 'Godly', opts: ['Godly', 'Chroma', 'Supreme', 'Ancient'] },
  { q: 'Which MM2 crate has the best odds for Godly items?', a: 'Knife Box 5', opts: ['Knife Box 5', 'Knife Box 1', 'Gun Box 1', 'Holiday Box'] },
  { q: 'What are the three roles in MM2?', a: 'Innocent, Sheriff, Murderer', opts: ['Innocent, Sheriff, Murderer', 'Hunter, Prey, Guard', 'Killer, Cop, Civilian', 'Seeker, Hider, Runner'] },
  { q: 'What is the rarest type of weapon in MM2?', a: 'Chroma Godly', opts: ['Chroma Godly', 'Vintage', 'Legendary', 'Common'] },
  { q: 'Which holiday event features the "Elf" knife?', a: 'Christmas', opts: ['Christmas', 'Halloween', 'Easter', 'Valentine\'s'] },
  { q: 'What does "W" mean in MM2 trading?', a: 'Win', opts: ['Win', 'Want', 'Worth', 'Wait'] },
  { q: 'What is the "Corrupt" set known for?', a: 'Glowing dark effects', opts: ['Glowing dark effects', 'Fire animations', 'Rainbow colors', 'Ice particles'] },
  { q: 'How do you get Godly items in MM2?', a: 'Unboxing or trading', opts: ['Unboxing or trading', 'Completing missions', 'Leveling up', 'Buying with Robux only'] },
  { q: 'What does "OP" mean in trading terms?', a: 'Overpay', opts: ['Overpay', 'Original Price', 'Option Play', 'Out of Print'] },
  { q: 'What is "Vintage" rarity in MM2?', a: 'Old limited items', opts: ['Old limited items', 'New release items', 'Common tier', 'Event exclusives'] },
  { q: 'Which knife is considered the most valuable Godly?', a: 'Chroma Darkbringer', opts: ['Chroma Darkbringer', 'Seer', 'Luger', 'Pixel'] },
  { q: 'What happens when the Sheriff dies in MM2?', a: 'Gun drops for Innocents', opts: ['Gun drops for Innocents', 'Game ends', 'Murderer wins', 'New Sheriff spawns'] },
  { q: 'What was the first Godly knife in MM2?', a: 'Seer', opts: ['Seer', 'Luger', 'Chroma Heat', 'Corrupt'] },
  { q: 'What does "demand" mean for an item?', a: 'How many people want it', opts: ['How many people want it', 'Its rarity level', 'Its in-game power', 'How fast it drops'] },
  { q: 'Which rarity comes between Rare and Godly?', a: 'Legendary', opts: ['Legendary', 'Epic', 'Ultra-Rare', 'Supreme'] },
  { q: 'What is a "set" in MM2?', a: 'Matching knife and gun', opts: ['Matching knife and gun', 'Collection of pets', 'Group of players', 'Event items only'] },
  { q: 'What is "duping" in MM2?', a: 'Illegally duplicating items', opts: ['Illegally duplicating items', 'Trading up', 'Legitimate crafting', 'Double unboxing'] },
  { q: 'Where can you trade items in MM2?', a: 'In the trading server', opts: ['In the trading server', 'Only in Discord', 'In the shop', 'During gameplay only'] },
];

const TIMER_SECONDS = 12;
const XP_PER_CORRECT = 20;
const XP_PERFECT_BONUS = 50;

const isSameDay = (timestamp) => {
  if (!timestamp) return false;
  const d = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const DailyQuiz = ({ visible, onClose }) => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;
  const { t } = useTranslation();

  const [phase, setPhase] = useState('loading'); // loading | ready | playing | result
  const [hasPlayedToday, setHasPlayedToday] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [bestScore, setBestScore] = useState(0);
  const timerRef = useRef(null);
  const progressAnim = useRef(new Animated.Value(1)).current;

  // Load state on open
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        const played = isSameDay(data.lastQuizAt);
        setHasPlayedToday(played);
        setBestScore(data.quizBestScore || 0);
        setPhase(played ? 'result' : 'ready');
        setScore(played ? (data.lastQuizScore || 0) : 0);
        setCurrentQ(0);
        setSelected(null);
      } catch {
        setPhase('ready');
      }
    })();
  }, [visible, firestoreDB, uid]);

  // Start quiz
  const startQuiz = () => {
    const picked = shuffle(QUESTION_BANK).slice(0, 5).map(q => ({
      ...q,
      opts: shuffle(q.opts),
    }));
    setQuestions(picked);
    setCurrentQ(0);
    setScore(0);
    setSelected(null);
    setTimeLeft(TIMER_SECONDS);
    setPhase('playing');
    triggerHapticFeedback('impactLight');
  };

  // Timer countdown
  useEffect(() => {
    if (phase !== 'playing' || selected !== null) return;

    progressAnim.setValue(1);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: TIMER_SECONDS * 1000,
      useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleAnswer(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [phase, currentQ, selected]);

  const handleAnswer = useCallback((answer) => {
    if (selected !== null) return;
    clearInterval(timerRef.current);

    const correct = answer === questions[currentQ]?.a;
    setSelected(answer || '__timeout__');
    if (correct) {
      setScore(prev => prev + 1);
      triggerHapticFeedback('notificationSuccess');
    } else {
      triggerHapticFeedback('notificationError');
    }

    setTimeout(() => {
      if (currentQ < questions.length - 1) {
        setCurrentQ(prev => prev + 1);
        setSelected(null);
        setTimeLeft(TIMER_SECONDS);
      } else {
        finishQuiz(correct ? score + 1 : score);
      }
    }, 1200);
  }, [selected, currentQ, questions, score]);

  const finishQuiz = async (finalScore) => {
    setPhase('result');
    setHasPlayedToday(true);

    const xpEarned = (finalScore * XP_PER_CORRECT) + (finalScore === 5 ? XP_PERFECT_BONUS : 0);

    try {
      const newBest = Math.max(finalScore, bestScore);
      setBestScore(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastQuizAt: new Date(),
        lastQuizScore: finalScore,
        quizBestScore: newBest,
      }, { merge: true });

      if (appdatabase && xpEarned > 0) await addXP(appdatabase, uid, xpEarned);
    } catch (err) {
      console.warn('[DailyQuiz] save error:', err?.message);
    }
  };

  const q = questions[currentQ];
  const c = getThemeColors(isDarkMode);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.7)' }]}>
        <View style={[styles.modal, { backgroundColor: c.bgAlt }]}>
          {/* Drag handle */}
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>{t('engagement.quiz_title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* Loading state */}
            {phase === 'loading' && (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color="#4A7FB5" />
                <Text style={[styles.readySub, { color: c.textSecondary, marginTop: 12 }]}>{t('engagement.loading_quiz')}</Text>
              </View>
            )}

            {/* Ready state */}
            {phase === 'ready' && (
              <View style={styles.centerContent}>
                <Text style={{ fontSize: 48 }}>🔪</Text>
                <Text style={[styles.readyTitle, { color: c.text }]}>{t('engagement.mm2_trivia')}</Text>
                <Text style={[styles.readySub, { color: c.textSecondary }]}>
                  5 questions • {TIMER_SECONDS}s each • +{XP_PER_CORRECT} XP per correct
                </Text>
                {bestScore > 0 && (
                  <Text style={[styles.bestScore, { color: '#C49530' }]}>🏆 Best: {bestScore}/5</Text>
                )}
                <TouchableOpacity style={[styles.startBtn, { backgroundColor: '#4A7FB5' }]} onPress={startQuiz}>
                  <Icon name="play-circle" size={22} color="#fff" />
                  <Text style={styles.startBtnText}>{t('engagement.start_quiz')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Playing state */}
            {phase === 'playing' && q && (
              <View style={{ flex: 1 }}>
                {/* Progress dots */}
                <View style={styles.progressRow}>
                  <Text style={[styles.qNum, { color: c.textSecondary }]}>Q{currentQ + 1}/5</Text>
                  <View style={{ flex: 1, height: 10, marginHorizontal: 10, position: 'relative' }}>
                    {[0, 1, 2, 3, 4].map(i => (
                      <View key={i} style={[styles.dot, {
                        backgroundColor: i < currentQ ? '#10B981' : i === currentQ ? '#4A7FB5' : (isDarkMode ? '#334155' : '#e2e8f0'),
                        position: 'absolute', left: `${i * 22}%`,
                      }]} />
                    ))}
                  </View>
                  <View style={[styles.timerBadge, { backgroundColor: isDarkMode ? '#2a2015' : '#FEF3C7' }]}>
                    <Text style={[styles.timerText, { color: timeLeft <= 3 ? '#EF4444' : '#C49530' }]}>
                      {timeLeft}s
                    </Text>
                  </View>
                </View>

                {/* Timer bar */}
                <Animated.View style={[styles.timerBar, {
                  width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  backgroundColor: timeLeft <= 3 ? '#EF4444' : '#4A7FB5',
                }]} />

                {/* Question */}
                <Text style={[styles.question, { color: c.text }]}>{q.q}</Text>

                {/* Options */}
                <View style={styles.optsWrap}>
                  {q.opts.map((opt, i) => {
                    const isCorrect = opt === q.a;
                    const isSelected = selected === opt;
                    const showResult = selected !== null;
                    const optBg = showResult
                      ? isCorrect ? '#10B981' : isSelected ? '#EF4444' : (isDarkMode ? config.colors.surfaceDark : '#f1f5f9')
                      : isDarkMode ? config.colors.surfaceDark : '#f1f5f9';
                    const optTextColor = showResult && (isCorrect || isSelected) ? '#fff' : c.text;

                    return (
                      <TouchableOpacity
                        key={i}
                        style={[styles.optBtn, { backgroundColor: optBg, borderColor: showResult && isCorrect ? '#10B981' : 'transparent' }]}
                        onPress={() => handleAnswer(opt)}
                        disabled={selected !== null}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.optLetter, { color: optTextColor }]}>
                          {String.fromCharCode(65 + i)}
                        </Text>
                        <Text style={[styles.optText, { color: optTextColor }]}>{opt}</Text>
                        {showResult && isCorrect && <Icon name="checkmark-circle" size={18} color="#fff" />}
                        {showResult && isSelected && !isCorrect && <Icon name="close-circle" size={18} color="#fff" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.scoreLive, { color: c.textSecondary }]}>
                  Score: {score}/{currentQ + (selected ? 1 : 0)}
                </Text>
              </View>
            )}

            {/* Result state */}
            {phase === 'result' && (
              <View style={styles.centerContent}>
                <Text style={{ fontSize: 48 }}>{score === 5 ? '🏆' : score >= 3 ? '🌟' : '📝'}</Text>
                <Text style={[styles.readyTitle, { color: c.text }]}>
                  {score === 5 ? t('engagement.perfect_score') : score >= 3 ? t('engagement.great_job') : t('engagement.nice_try')}
                </Text>
                <Text style={[styles.resultScore, { color: '#4A7FB5' }]}>{t('engagement.correct_count', { score })}</Text>
                <Text style={[styles.readySub, { color: c.textSecondary }]}>
                  {score === 5
                    ? `+${score * XP_PER_CORRECT + XP_PERFECT_BONUS} XP (includes ${XP_PERFECT_BONUS} bonus!)`
                    : `+${score * XP_PER_CORRECT} XP earned`}
                </Text>
                {bestScore > 0 && (
                  <Text style={[styles.bestScore, { color: '#C49530' }]}>🏆 Best: {bestScore}/5</Text>
                )}
                <TouchableOpacity style={[styles.startBtn, { backgroundColor: '#6b7c8d' }]} onPress={onClose}>
                  <Text style={styles.startBtnText}>
                    {hasPlayedToday ? t('engagement.come_back') : t('engagement.done')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: {
    width: '100%', padding: 20, paddingBottom: 36,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  handleBar: { alignItems: 'center', marginBottom: 8 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 8 },

  centerContent: { alignItems: 'center', paddingVertical: 24 },
  readyTitle: { fontSize: 24, fontWeight: '800', marginTop: 8 },
  readySub: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  bestScore: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  resultScore: { fontSize: 32, fontWeight: '800', marginTop: 4 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 28, borderRadius: 16, marginTop: 20,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  qNum: { fontSize: 12, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  timerBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  timerText: { fontSize: 13, fontWeight: '800' },
  timerBar: { height: 4, borderRadius: 2, marginBottom: 16 },

  question: { fontSize: 16, fontWeight: '700', marginBottom: 16, lineHeight: 22 },

  optsWrap: { gap: 10 },
  optBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 2,
  },
  optLetter: { fontSize: 14, fontWeight: '800', width: 22, textAlign: 'center' },
  optText: { fontSize: 13, fontWeight: '600', flex: 1 },

  scoreLive: { fontSize: 12, textAlign: 'center', marginTop: 12, fontWeight: '600' },
});

export default DailyQuiz;
