import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeTabScreen from './HomeTabScreen';
import LeaderboardScreen from '../ChatScreen/GroupChat/LeaderboardScreen';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';

const Stack = createNativeStackNavigator();

const HomeTabNavigator = ({ selectedTheme }) => {
  const { theme } = useGlobalState();
  const { t } = useTranslation();

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: selectedTheme.colors.background },
    animation: 'fade',
    animationDuration: 300,
  }), [selectedTheme]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="HomeMain"
        options={{ headerShown: false }}
      >
        {() => <HomeTabScreen selectedTheme={selectedTheme} />}
      </Stack.Screen>

      <Stack.Screen
        name="Leaderboard"
        options={{ title: t('nav.top_rated_users') }}
      >
        {props => <LeaderboardScreen {...props} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
};

export default HomeTabNavigator;
