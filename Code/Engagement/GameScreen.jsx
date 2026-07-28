/**
 * GameScreen.jsx
 * Navigation screen wrapper for all mini-games.
 * Receives { gameId } via route.params and renders the matching game.
 * The Modal inside each game is removed here — the screen IS the game.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import SpotTheFake from './SpotTheFake';
import SafeCracker from './SafeCracker';
import QuickDraw from './QuickDraw';
import BombDefusal from './BombDefusal';
import MemoryMatch from './MemoryMatch';
import FindTheKiller from './FindTheKiller';

const GameScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { gameId } = route.params || {};

  const handleClose = () => navigation.goBack();

  const renderGame = () => {
    switch (gameId) {
      case 'spot':
        return <SpotTheFake visible={true} onClose={handleClose} screenMode={true} />;
      case 'safe':
        return <SafeCracker visible={true} onClose={handleClose} screenMode={true} />;
      case 'draw':
        return <QuickDraw visible={true} onClose={handleClose} screenMode={true} />;
      case 'bomb':
        return <BombDefusal visible={true} onClose={handleClose} screenMode={true} />;
      case 'memory':
        return <MemoryMatch visible={true} onClose={handleClose} screenMode={true} />;
      case 'killer':
        return <FindTheKiller visible={true} onClose={handleClose} screenMode={true} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderGame()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default GameScreen;
