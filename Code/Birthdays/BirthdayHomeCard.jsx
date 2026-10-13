/**
 * BirthdayHomeCard — the Home entry to Birthdays (ported from Blox Fruit's
 * Code/Birthdays, 2026-10-13). One of, in this order:
 *   1. It is your birthday: the celebration (claim your stars, wishes).
 *   2. Your birthday is within a week: a countdown.
 *   3. No birthday on file: "Add your birthday 🎂" (with today's count, if any).
 *   4. Other players have a birthday today: "Send a wish".
 * Otherwise nothing. Signed-out players see nothing.
 *
 * Cost: birthday_counts for the local day (one tiny read a day, MMKV) and
 * your own date of birth (MMKV after the first read). myBirthday (HTTPS) only
 * on your birthday, at most every 2 hours. See birthdayApi.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { SCREEN_GUTTER } from '../Helper/layout';
import { useGlobalState } from '../GlobelStats';
import {
  setBirthdayUser, getOwnBirthday, peekOwnBirthday, getTodayCount, getMyBirthday, peekMyBirthday,
  claimBirthdayGift, birthdayErrorKey, onBirthdaysChange, isOwnBirthdayToday, BIRTHDAY_GIFT_STARS,
} from './birthdayApi';
import { daysUntilBirthday } from './birthdayDate';
import { BirthdayGradient, BIRTHDAY_PINK } from './BirthdayBits';
import { flipInRTL } from '../Helper/rtl';

const COUNTDOWN_DAYS = 7;

export default function BirthdayHomeCard({ userId, userName }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { appdatabase } = useGlobalState();
  const [own, setOwn] = useState(() => (userId ? peekOwnBirthday() : null));
  const [mine, setMine] = useState(() => (userId ? peekMyBirthday() : null));
  const [todayCount, setTodayCount] = useState(0);
  const [claiming, setClaiming] = useState(false);

  useFocusEffect(useCallback(() => {
    // Signed-out __DEV__ builds show the mock (birthdayMock.js), as on Blox.
    if (!userId && !__DEV__) { setOwn(null); setMine(null); setTodayCount(0); return undefined; }
    let live = true;
    setBirthdayUser(userId);
    Promise.all([getOwnBirthday(appdatabase), getTodayCount(appdatabase)])
      .then(([o, n]) => {
        if (!live) return;
        setOwn(o);
        setTodayCount(n);
        if (isOwnBirthdayToday(o)) {
          getMyBirthday().then((m) => { if (live) setMine(m); }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [userId, appdatabase]));

  // A change made elsewhere (the Birthdays screen, Settings) shows at once.
  useEffect(() => {
    if (!userId) return undefined;
    return onBirthdaysChange(() => {
      setOwn(peekOwnBirthday());
      setMine(peekMyBirthday());
    });
  }, [userId]);

  const open = useCallback(() => navigation.navigate('Birthdays'), [navigation]);

  const claim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const { stars } = await claimBirthdayGift();
      setMine((m) => (m ? { ...m, giftReady: false, giftOpened: true } : m));
      trackGrowthEvent('birthday_gift_claim', { stars, where: 'home' });
      showSuccessMessage(t('birthdays.stars_added', { stars }), '');
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
      // The server said no: show what it says now.
      getMyBirthday({ force: true }).then(setMine).catch(() => {});
    } finally {
      setClaiming(false);
    }
  }, [claiming, t]);

  if (!userId && !__DEV__) return null;
  const days = own?.month ? daysUntilBirthday(own.month, own.day) : null;

  // 1. Your birthday. Each variant has its own key, so a card never changes
  // into another in place.
  if (days === 0) {
    return (
      <TouchableOpacity key="party" activeOpacity={0.9} onPress={open} style={[styles.card, styles.party]}>
        <BirthdayGradient id="bdayHomeParty" />
        <Text style={styles.art}>🎂</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{userName ? t('birthdays.home_happy', { name: userName }) : t('birthdays.home_happy_noname')}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {mine?.giftReady
              ? t('birthdays.home_gift_stars', { stars: BIRTHDAY_GIFT_STARS })
              : t('birthdays.home_wishes', { count: mine?.wishCount || 0 })}
          </Text>
        </View>
        {mine?.giftReady ? (
          <TouchableOpacity style={styles.claimBtn} onPress={claim} disabled={claiming} activeOpacity={0.85}>
            {claiming
              ? <ActivityIndicator size="small" color={BIRTHDAY_PINK} />
              : <Text style={styles.claimText}>{t('birthdays.claim_stars', { stars: BIRTHDAY_GIFT_STARS })}</Text>}
          </TouchableOpacity>
        ) : (
          <FontAwesome name="chevron-right" size={14} color="#fff" style={flipInRTL} />
        )}
      </TouchableOpacity>
    );
  }

  // 2. Coming up: a countdown.
  if (days != null && days <= COUNTDOWN_DAYS) {
    return (
      <TouchableOpacity key="soon" activeOpacity={0.9} onPress={open} style={styles.card}>
        <BirthdayGradient id="bdayHomeSoon" />
        <Text style={styles.art}>🎈</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {days === 1 ? t('birthdays.home_soon_tomorrow') : t('birthdays.home_soon', { count: days })}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {own.show ? t('birthdays.home_soon_shown') : t('birthdays.home_soon_hidden')}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" style={flipInRTL} />
      </TouchableOpacity>
    );
  }

  // 3. No birthday on file yet.
  if (own && !own.hasDob) {
    return (
      <TouchableOpacity key="add" activeOpacity={0.9} onPress={open} style={styles.card}>
        <BirthdayGradient id="bdayHomeAdd" />
        <Text style={styles.art}>🎁</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_add')}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {todayCount > 0 ? t('birthdays.home_others', { count: todayCount }) : t('birthdays.home_add_sub', { stars: BIRTHDAY_GIFT_STARS })}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" style={flipInRTL} />
      </TouchableOpacity>
    );
  }

  // 4. Other players' birthdays today.
  if (todayCount > 0) {
    return (
      <TouchableOpacity key="others" activeOpacity={0.9} onPress={open} style={styles.card}>
        <BirthdayGradient id="bdayHomeOthers" />
        <Text style={styles.art}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_others', { count: todayCount })}</Text>
          <Text style={styles.sub} numberOfLines={1}>{t('birthdays.home_send_wish')}</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" style={flipInRTL} />
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    marginHorizontal: SCREEN_GUTTER, marginTop: 14, overflow: 'hidden',
  },
  party: { paddingVertical: 16 },
  art: { fontSize: 30 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginTop: 2, lineHeight: 16, fontWeight: '600' },
  claimBtn: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minWidth: 74, alignItems: 'center' },
  claimText: { color: BIRTHDAY_PINK, fontWeight: '900', fontSize: 13 },
});
