import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  doc,
  getDoc,
} from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';

/**
 * ScamSafetyBox — Compact Private-Chat Header
 * ┌──────────────────────────────────────────────────────────┐
 * │ 🛡️ Trade safe: If it's too good to be true, it's a scam │
 * ├──────────────────────────────────────────────────────────┤
 * │  ★ 4.7 (23 reviews) · Joined Jan 2024   [ ⭐ Rate ]    │
 * └──────────────────────────────────────────────────────────┘
 */
export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
  selectedUserId,
}) {
  const { theme, firestoreDB } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const { t } = useTranslation();

  // ── Fetch rating summary for this user ──
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(true);

  useEffect(() => {
    if (!selectedUserId || !firestoreDB) {
      setLoadingRating(false);
      return;
    }

    let cancelled = false;
    setLoadingRating(true);

    const fetchRating = async () => {
      try {
        const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUserId);
        const snap = await getDoc(summaryRef);
        if (!cancelled && snap.exists) {
          const data = snap.data();
          setRatingSummary({
            value: data.averageRating || 0,
            count: data.count || 0,
          });
        }
      } catch (err) {
        console.log('ScamSafetyBox rating fetch error:', err);
      } finally {
        if (!cancelled) setLoadingRating(false);
      }
    };

    fetchRating();
    return () => { cancelled = true; };
  }, [selectedUserId, firestoreDB]);

  const handleOpenRating = useCallback(() => {
    if (setShowRatingModal && typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  }, [setShowRatingModal]);

  // ── Star rendering helper ──
  const renderMiniStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const halfStar = rating - fullStars >= 0.25;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(
          <Icon key={i} name="star" size={10} color="#fbbf24" style={{ marginRight: 1 }} />
        );
      } else if (i === fullStars && halfStar) {
        stars.push(
          <Icon key={i} name="star-half" size={10} color="#fbbf24" style={{ marginRight: 1 }} />
        );
      } else {
        stars.push(
          <Icon key={i} name="star-outline" size={10} color={isDarkMode ? '#475569' : '#d1d5db'} style={{ marginRight: 1 }} />
        );
      }
    }
    return stars;
  };

  return (
    <View style={[styles.wrapper, {
      backgroundColor: isDarkMode ? 'rgba(15,23,42,0.9)' : '#ffffff',
      borderColor: isDarkMode ? 'rgba(71,85,105,0.4)' : 'rgba(226,232,240,0.8)',
    }]}>

      {/* ═══ ROW 1: Scam Warning Strip ═══ */}
      <View style={[styles.warningStrip, {
        backgroundColor: isDarkMode ? 'rgba(251,191,36,0.08)' : 'rgba(255,251,235,0.9)',
        borderBottomColor: isDarkMode ? 'rgba(71,85,105,0.3)' : 'rgba(226,232,240,0.6)',
      }]}>
        <View style={[styles.warningIconBg, {
          backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.12)',
        }]}>
          <Text style={{ fontSize: 11 }}>🛡️</Text>
        </View>
        <Text style={[styles.warningText, {
          color: isDarkMode ? '#CBD5E1' : '#78716C',
        }]} numberOfLines={1}>
          Trade safe · Too good = scam · Never share login
        </Text>
      </View>

      {/* ═══ ROW 2: Review Summary + Rate Chip ═══ */}
      <View style={styles.reviewRow}>
        {/* Left: Rating info */}
        <View style={styles.ratingInfo}>
          {loadingRating ? (
            <ActivityIndicator size="small" color={c.textMuted} />
          ) : ratingSummary && ratingSummary.count > 0 ? (
            <>
              {/* Star display */}
              <View style={styles.starsRow}>
                {renderMiniStars(ratingSummary.value)}
              </View>
              <Text style={[styles.ratingValue, { color: c.text }]}>
                {ratingSummary.value.toFixed(1)}
              </Text>
              <View style={[styles.reviewCountBadge, {
                backgroundColor: isDarkMode ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
              }]}>
                <Text style={[styles.reviewCountText, {
                  color: isDarkMode ? '#a5b4fc' : '#6366f1',
                }]}>
                  {ratingSummary.count} {ratingSummary.count === 1 ? t('private_chat.recent_reviews', { defaultValue: 'review' }).split(' ').pop() : 'reviews'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.starsRow}>
                {renderMiniStars(0)}
              </View>
              <Text style={[styles.noReviews, { color: c.textMuted }]}>
                {t('private_chat.no_reviews')}
              </Text>
            </>
          )}
        </View>

        {/* Right: Rate Chip */}
        {canRate && (
          <TouchableOpacity
            style={[styles.rateChip, {
              backgroundColor: hasRated
                ? (isDarkMode ? 'rgba(71,85,105,0.3)' : 'rgba(226,232,240,0.6)')
                : (isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.12)'),
              borderColor: hasRated
                ? (isDarkMode ? 'rgba(71,85,105,0.5)' : 'rgba(203,213,225,0.8)')
                : (isDarkMode ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.3)'),
            }]}
            onPress={handleOpenRating}
            activeOpacity={0.7}
          >
            <Text style={styles.rateChipIcon}>
              {hasRated ? '✏️' : '⭐'}
            </Text>
            <Text style={[styles.rateChipText, {
              color: hasRated
                ? (isDarkMode ? '#94a3b8' : '#64748b')
                : (isDarkMode ? '#FCD34D' : '#B45309'),
            }]}>
              {hasRated ? t('private_chat.edit_review') : t('private_chat.rate')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 6,
    marginVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },

  /* ── Warning strip ── */
  warningStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    gap: 7,
  },
  warningIconBg: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '500',
    letterSpacing: 0.1,
  },

  /* ── Review row ── */
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ratingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingValue: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  reviewCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reviewCountText: {
    fontSize: 9,
    fontWeight: '600',
  },
  noReviews: {
    fontSize: 11,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  /* ── Rate chip ── */
  rateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginLeft: 8,
  },
  rateChipIcon: {
    fontSize: 11,
  },
  rateChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
