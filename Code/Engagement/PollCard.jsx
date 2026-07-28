/**
 * PollCard.jsx
 * Community poll card with voting, animated bars, and vote-change support.
 *
 * Firestore structure: polls/{pollId}
 *   ├── question: "Which is more valuable?"
 *   ├── options: [{ text: "Option A", votes: 5 }, ...]
 *   ├── totalVotes: 10
 *   ├── voters: { uid: optionIndex }
 *   ├── createdAt: Timestamp
 *   └── createdBy: uid
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated,
  StyleSheet, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { doc, updateDoc } from '@react-native-firebase/firestore';
import { getThemeColors } from '../Helper/themeColors';

dayjs.extend(relativeTime);

const OPTION_COLORS = ['#4A7FB5', '#3D9B7A', '#C49530', '#7E6CB5', '#B06048', '#5A94AA'];

const PollCard = ({ poll, user, firestoreDB, isDarkMode, onRequireSignIn }) => {
  const [voted, setVoted] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [options, setOptions] = useState(poll?.options || []);
  const [totalVotes, setTotalVotes] = useState(poll?.totalVotes || 0);
  const [voting, setVoting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const barAnims = useRef(options.map(() => new Animated.Value(0))).current;
  const c = getThemeColors(isDarkMode);

  useEffect(() => {
    if (poll?.voters && user?.id) {
      const prev = poll.voters[user.id];
      if (prev !== undefined && prev !== null) {
        setVoted(true);
        setSelectedOption(prev);
      }
    }
  }, [poll, user]);

  const animateBars = useCallback((opts, total) => {
    if (!total) return;
    const anims = opts.map((opt, i) => {
      const pct = opt.votes / total;
      return Animated.timing(barAnims[i], {
        toValue: pct,
        duration: 600,
        useNativeDriver: false,
      });
    });
    Animated.stagger(80, anims).start();
  }, [barAnims]);

  const toggleExpand = useCallback(() => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && voted) {
      setTimeout(() => animateBars(options, totalVotes), 100);
    }
  }, [expanded, voted, options, totalVotes, animateBars]);

  const handleVote = useCallback(async (index) => {
    if (voting) return;
    if (!user?.id) {
      if (onRequireSignIn) onRequireSignIn();
      return;
    }
    if (!poll?.id) return;
    if (voted && selectedOption === index) return;

    setVoting(true);
    try {
      const pollRef = doc(firestoreDB, 'polls', poll.id);
      const newOptions = [...options];
      let newTotal = totalVotes;

      if (voted && selectedOption !== null) {
        // Change vote
        newOptions[selectedOption] = {
          ...newOptions[selectedOption],
          votes: Math.max((newOptions[selectedOption].votes || 0) - 1, 0),
        };
        newOptions[index] = {
          ...newOptions[index],
          votes: (newOptions[index].votes || 0) + 1,
        };
      } else {
        // First vote
        newOptions[index] = {
          ...newOptions[index],
          votes: (newOptions[index].votes || 0) + 1,
        };
        newTotal = totalVotes + 1;
      }

      await updateDoc(pollRef, {
        options: newOptions,
        totalVotes: newTotal,
        [`voters.${user.id}`]: index,
      });

      setOptions(newOptions);
      setTotalVotes(newTotal);
      setSelectedOption(index);
      setVoted(true);

      setTimeout(() => animateBars(newOptions, newTotal), 100);
    } catch (err) {
      console.warn('[PollCard] Vote error:', err?.message);
    } finally {
      setVoting(false);
    }
  }, [voting, user, poll, firestoreDB, options, totalVotes, voted, selectedOption, animateBars]);

  const timeAgo = poll?.createdAt?.toDate ? dayjs(poll.createdAt.toDate()).fromNow() : '';

  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
      {/* Header */}
      <TouchableOpacity style={styles.header} onPress={toggleExpand} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>📊</Text>
            <Text style={[styles.question, { color: c.text }]} numberOfLines={expanded ? 0 : 2}>
              {poll?.question || 'Poll'}
            </Text>
          </View>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            {totalVotes} vote{totalVotes !== 1 ? 's' : ''} · {timeAgo}
          </Text>
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
      </TouchableOpacity>

      {/* Options */}
      {expanded && (
        <View style={styles.optionsList}>
          {options.map((opt, idx) => {
            const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
            const isSelected = selectedOption === idx;
            const color = OPTION_COLORS[idx % OPTION_COLORS.length];

            return (
              <TouchableOpacity
                key={idx}
                style={[styles.optionRow, {
                  borderColor: isSelected ? color : c.border,
                  borderWidth: isSelected ? 2 : 1,
                }]}
                onPress={() => handleVote(idx)}
                disabled={voting}
                activeOpacity={0.7}
              >
                {/* Bar background */}
                {voted && (
                  <Animated.View style={[styles.barBg, {
                    backgroundColor: color + '18',
                    width: barAnims[idx]?.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }) || '0%',
                  }]} />
                )}

                <View style={styles.optionContent}>
                  <Text style={[styles.optionText, { color: c.text }]}>{opt.text}</Text>
                  {voted && (
                    <Text style={[styles.pctText, { color }]}>{pct}%</Text>
                  )}
                </View>

                {isSelected && (
                  <Icon name="checkmark-circle" size={16} color={color} style={{ position: 'absolute', right: 10 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8,
  },
  question: { fontSize: 14, fontWeight: '700', flex: 1 },
  meta: { fontSize: 10, marginTop: 3 },

  optionsList: { paddingHorizontal: 12, paddingBottom: 14, gap: 6 },
  optionRow: {
    borderRadius: 10, overflow: 'hidden', position: 'relative',
    padding: 12,
  },
  barBg: {
    position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 10,
  },
  optionContent: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  optionText: { fontSize: 13, fontWeight: '600', flex: 1 },
  pctText: { fontSize: 13, fontWeight: '800', marginLeft: 8 },
});

export default PollCard;
