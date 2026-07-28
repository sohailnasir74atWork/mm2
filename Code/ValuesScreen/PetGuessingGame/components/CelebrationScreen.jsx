// CelebrationScreen.jsx
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import config from '../../../Helper/Environment';

const CelebrationScreen = ({ winner, onPlayAgain, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { t } = require('react-i18next').useTranslation();

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    // Entrance animations
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(confettiAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  if (!winner) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
      <Animated.View
        style={[
          styles.container,
          {
            transform: [{ scale: scaleAnim }],
            backgroundColor: isDarkMode ? config.colors.surfaceDark : '#ffffff',
          },
        ]}
      >
        {/* Confetti Effect */}
        <Animated.View
          style={[
            styles.confettiContainer,
            {
              opacity: confettiAnim,
            },
          ]}
        >
          <Text style={styles.confetti}>🎉</Text>
          <Text style={[styles.confetti, { left: 50 }]}>✨</Text>
          <Text style={[styles.confetti, { right: 50 }]}>🎊</Text>
          <Text style={[styles.confetti, { top: 100 }]}>⭐</Text>
          <Text style={[styles.confetti, { bottom: 100 }]}>💫</Text>
        </Animated.View>

        {/* Winner Card */}
        <View style={styles.winnerCard}>
          <Text style={styles.congratsText}>{t('game.congratulations')}</Text>
          
          <View style={styles.winnerInfo}>
            <Text style={[styles.winnerName, { color: isDarkMode ? '#fff' : '#000' }]}>
              {winner.playerName}
            </Text>
            <Text style={[styles.winnerLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
              {t('game.is_winner')}
            </Text>
          </View>

          {winner.petImage && (
            <Image
              source={{ uri: winner.petImage }}
              style={styles.winnerPetImage}
              resizeMode="contain"
            />
          )}

          <Text style={[styles.petName, { color: isDarkMode ? '#fff' : '#000' }]}>
            {winner.petName}
          </Text>

          {/* Pet Trait Reveal */}
          <View style={styles.traitContainer}>
            <Text style={[styles.traitLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
              {t('game.pet_trait')}
            </Text>
            <Text style={[styles.traitText, { color: '#8B5CF6' }]}>
              {getRandomTrait(t)}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <Animated.View
          style={[
            styles.actionsContainer,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity style={styles.playAgainButton} onPress={onPlayAgain}>
            <Icon name="refresh" size={20} color="#fff" />
            <Text style={styles.playAgainText}>{t('game.play_again')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={[styles.closeText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
              {t('game.close')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const getRandomTrait = (t) => {
  const traits = [
    t('game.trait_lucky'),
    t('game.trait_shy'),
    t('game.trait_chaos'),
    t('game.trait_radiant'),
    t('game.trait_focused'),
    t('game.trait_rare'),
  ];
  return traits[Math.floor(Math.random() * traits.length)];
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  container: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  confettiContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  confetti: {
    position: 'absolute',
    fontSize: 30,
    fontFamily: 'Lato-Regular',
  },
  winnerCard: {
    alignItems: 'center',
    marginBottom: 24,
  },
  congratsText: {
    fontSize: 24,
    fontFamily: 'Lato-Bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  winnerInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  winnerName: {
    fontSize: 28,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  winnerLabel: {
    fontSize: 16,
    fontFamily: 'Lato-Regular',
  },
  winnerPetImage: {
    width: 150,
    height: 150,
    marginBottom: 12,
  },
  petName: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 16,
  },
  traitContainer: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  traitLabel: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    marginBottom: 4,
  },
  traitText: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  actionsContainer: {
    width: '100%',
    gap: 12,
  },
  playAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  playAgainText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  closeButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
});

export default CelebrationScreen;



