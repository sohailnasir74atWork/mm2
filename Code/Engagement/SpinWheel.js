/**
 * SpinWheel.js
 * Daily reward spin wheel — SVG pie-slice wheel with XP segments.
 *
 * Rewards: XP bonuses (10-100 XP)
 * Limits:  1 free spin/day
 * State:   Firestore games/{uid} → lastSpinAt, totalSpins
 *
 * Adapted for MM2: no SwipeableBottomDrawer, sober colors.
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
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WHEEL_SIZE = Math.floor(Math.min(SCREEN_WIDTH - 40, 320) / 2) * 2;
const CENTER = WHEEL_SIZE / 2;
const RADIUS = CENTER - 12;
const CENTER_BTN = 56;
const POINTER_W = 28;
const POINTER_H = 32;

// ── Reward segments (sober palette) ──
const REWARDS = [
  { label: '+10 XP',  xp: 10,  emoji: '⚡', color: '#4A7FB5' },
  { label: '+25 XP',  xp: 25,  emoji: '✨', color: '#6B7C8D' },
  { label: '+50 XP',  xp: 50,  emoji: '🔥', color: '#B06048' },
  { label: '+100 XP', xp: 100, emoji: '💎', color: '#7E6CB5' },
  { label: '+15 XP',  xp: 15,  emoji: '⭐', color: '#C49530' },
  { label: '+30 XP',  xp: 30,  emoji: '🌟', color: '#3D9B7A' },
  { label: '+75 XP',  xp: 75,  emoji: '🎉', color: '#5A94AA' },
  { label: '+20 XP',  xp: 20,  emoji: '🚀', color: '#7A8A4A' },
];

const isSameDay = (timestamp) => {
  if (!timestamp) return false;
  const d = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

const SpinWheel = ({ visible, onClose }) => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const uid = user?.id;
  const { t } = useTranslation();

  const spinValue = useRef(new Animated.Value(0)).current;
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpunToday, setHasSpunToday] = useState(false);
  const [reward, setReward] = useState(null);
  const [totalSpins, setTotalSpins] = useState(0);
  const celebrateAnim = useRef(new Animated.Value(0)).current;

  const segmentAngle = 360 / REWARDS.length;

  // Check if user already spun today
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setHasSpunToday(isSameDay(data.lastSpinAt));
        setTotalSpins(data.totalSpins || 0);
        setReward(null);
      } catch {}
    })();
  }, [visible, firestoreDB, uid]);

  const createSlicePath = (startAngle, endAngle) => {
    const s = { x: CENTER + RADIUS * Math.cos((startAngle * Math.PI) / 180), y: CENTER + RADIUS * Math.sin((startAngle * Math.PI) / 180) };
    const e = { x: CENTER + RADIUS * Math.cos((endAngle * Math.PI) / 180), y: CENTER + RADIUS * Math.sin((endAngle * Math.PI) / 180) };
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${CENTER} ${CENTER} L ${s.x} ${s.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${e.x} ${e.y} Z`;
  };

  const handleSpin = useCallback(async () => {
    if (isSpinning || hasSpunToday || !firestoreDB || !uid) return;

    setIsSpinning(true);
    setReward(null);

    const spins = 4 + Math.random() * 3;
    const extra = Math.random() * 360;
    const total = spins * 360 + extra;

    spinValue.setValue(0);
    Animated.timing(spinValue, {
      toValue: total,
      duration: 3500,
      useNativeDriver: true,
      easing: (t) => 1 - Math.pow(1 - t, 3.5),
    }).start(async () => {
      setIsSpinning(false);

      // Calculate winner
      const norm = ((total % 360) + 360) % 360;
      const relative = (0 - norm - 270 + 720) % 360;
      const idx = Math.floor(relative / segmentAngle) % REWARDS.length;
      const won = REWARDS[idx];

      setReward(won);
      setHasSpunToday(true);

      // Celebrate animation
      celebrateAnim.setValue(0);
      Animated.spring(celebrateAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 5 }).start();

      // Save + award XP
      try {
        await setDoc(doc(firestoreDB, 'games', uid), {
          lastSpinAt: new Date(),
          totalSpins: (totalSpins || 0) + 1,
        }, { merge: true });
        if (appdatabase) await addXP(appdatabase, uid, won.xp);
      } catch (err) {
        console.warn('[SpinWheel] save error:', err?.message);
      }
    });
  }, [isSpinning, hasSpunToday, firestoreDB, appdatabase, uid, spinValue, segmentAngle, totalSpins, celebrateAnim]);

  const spinRotation = spinValue.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  const celebrateScale = celebrateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.5, 1.2, 1],
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.6)' }]}>
        <View style={[styles.modal, { backgroundColor: c.bgAlt }]}>
          {/* Handle */}
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>{t('engagement.spin_title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {t('engagement.spin_subtitle')}
          </Text>

          {/* Wheel */}
          <View style={styles.wheelWrap}>
            <View style={styles.wheelContainer}>
              <View style={styles.wheelClip}>
                <Animated.View style={[styles.wheelSpin, { transform: [{ rotate: spinRotation }] }]}
                  renderToHardwareTextureAndroid shouldRasterizeIOS>
                  <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
                    {REWARDS.map((r, i) => (
                      <Path key={i}
                        d={createSlicePath(i * segmentAngle - 90, (i + 1) * segmentAngle - 90)}
                        fill={r.color} stroke="#fff" strokeWidth={2}
                      />
                    ))}
                  </Svg>

                  {/* Labels */}
                  {REWARDS.map((r, i) => {
                    const mid = i * segmentAngle - 90 + segmentAngle / 2;
                    const rad = (mid * Math.PI) / 180;
                    const labelR = RADIUS * 0.65;
                    const x = CENTER + labelR * Math.cos(rad);
                    const y = CENTER + labelR * Math.sin(rad);
                    const rot = mid > 90 && mid < 270 ? mid + 180 : mid;
                    return (
                      <View key={`l-${i}`} style={[styles.segLabel, {
                        left: x - 30, top: y - 12,
                        transform: [{ rotate: `${rot}deg` }],
                      }]}>
                        <Text style={styles.segEmoji}>{r.emoji}</Text>
                        <Text style={styles.segText}>{r.label}</Text>
                      </View>
                    );
                  })}
                </Animated.View>
              </View>

              <View pointerEvents="none" style={styles.outerRing} />
              <View style={styles.centerCircle}>
                <Text style={{ fontSize: 22 }}>🔪</Text>
              </View>
            </View>

            <View style={styles.pointerWrap} pointerEvents="none">
              <View style={styles.pointer} />
            </View>
          </View>

          {/* Reward */}
          {reward && (
            <Animated.View style={[styles.rewardCard, {
              backgroundColor: reward.color + '20', borderColor: reward.color,
              transform: [{ scale: celebrateScale }],
            }]}>
              <Text style={{ fontSize: 32 }}>{reward.emoji}</Text>
              <Text style={[styles.rewardText, { color: reward.color }]}>{reward.label}</Text>
              <Text style={[styles.rewardSub, { color: c.textSecondary }]}>{t('engagement.xp_added')}</Text>
            </Animated.View>
          )}

          {/* Spin button */}
          <TouchableOpacity
            style={[styles.spinBtn, (isSpinning || hasSpunToday) && styles.spinBtnDisabled]}
            onPress={handleSpin}
            disabled={isSpinning || hasSpunToday}
            activeOpacity={0.8}
          >
            <Icon name={isSpinning ? 'sync' : 'play-circle'} size={22} color="#fff" />
            <Text style={styles.spinBtnText}>
              {isSpinning ? t('engagement.spinning') : hasSpunToday ? t('engagement.come_back') : t('engagement.spin_btn')}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.spinCount, { color: c.textMuted }]}>
            {t('engagement.total_spins')} {totalSpins}
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: {
    width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36,
    maxHeight: '90%',
  },
  handleBar: { alignItems: 'center', marginBottom: 8 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 8 },
  subtitle: { fontSize: 12, marginTop: 2, marginBottom: 12 },

  wheelWrap: { alignSelf: 'center', width: WHEEL_SIZE, height: WHEEL_SIZE, position: 'relative', marginBottom: 12 },
  wheelContainer: { width: WHEEL_SIZE, height: WHEEL_SIZE, position: 'relative' },
  wheelClip: { width: WHEEL_SIZE, height: WHEEL_SIZE, borderRadius: WHEEL_SIZE / 2, overflow: 'hidden', backgroundColor: '#fff' },
  wheelSpin: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  outerRing: { position: 'absolute', top: 0, left: 0, width: WHEEL_SIZE, height: WHEEL_SIZE, borderRadius: WHEEL_SIZE / 2, borderWidth: 5, borderColor: '#fff' },
  centerCircle: {
    position: 'absolute', left: '50%', top: '50%',
    width: CENTER_BTN, height: CENTER_BTN, borderRadius: CENTER_BTN / 2,
    transform: [{ translateX: -CENTER_BTN / 2 }, { translateY: -CENTER_BTN / 2 }],
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: '#C49530', zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 5 },
    }),
  },

  segLabel: { position: 'absolute', width: 60, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  segEmoji: { fontSize: 14 },
  segText: { fontSize: 9, fontWeight: '800', color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  pointerWrap: { position: 'absolute', right: -POINTER_W + 2, top: CENTER - POINTER_H / 2, width: POINTER_W, height: POINTER_H, zIndex: 100 },
  pointer: { width: 0, height: 0, borderTopWidth: POINTER_H / 2, borderBottomWidth: POINTER_H / 2, borderRightWidth: POINTER_W, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#B06048' },

  rewardCard: { alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 2, marginBottom: 12 },
  rewardText: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  rewardSub: { fontSize: 11, marginTop: 2 },

  spinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#C49530', paddingVertical: 14, borderRadius: 16,
  },
  spinBtnDisabled: { backgroundColor: '#6b7c8d', shadowOpacity: 0 },
  spinBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  spinCount: { textAlign: 'center', fontSize: 11, marginTop: 8, fontWeight: '500' },
});

export default SpinWheel;
