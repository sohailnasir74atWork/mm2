/**
 * MoreNavigator.jsx
 * The More tab's own stack: the card hub (MoreHubScreen) and the screens it
 * opens that are More-only (News, Complaints & ideas, the admin inbox). They
 * sit in this stack so the tab bar stays visible, the same as Adopt Me's
 * (adoptme-jan7/Code/More/MoreNavigator.js). The other hub cards open
 * root-stack screens registered in App.js.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import MoreHubScreen from './MoreHubScreen';
import NewsScreen from '../ValuesScreen/News';
import AdminReportsInbox from '../ValuesScreen/AdminReport';
import ReportScreen from '../Reports/ReportScreen';
import BannerAdComponent from '../Ads/bannerAds';

const Stack = createNativeStackNavigator();

// Module-level `component`s reading the theme from context, not `{() => …}`
// render callbacks: a callback skips React Navigation's StaticContainer, so
// every MoreStack render would re-render every mounted More screen (the
// Adopt Me More hub had exactly that bug, fixed 2026-10-08).
const MoreThemeContext = createContext(null);

// The tool screens were built for Adopt Me's old top-tab body, which had an
// 8 pt side margin. Plain banner, not collapsible: the expanding first load
// stays on Home. BannerAdComponent hides itself for Pro.
const Body = ({ children, ad = true }) => {
  const selectedTheme = useContext(MoreThemeContext);
  return (
    <View style={[styles.flex1, { backgroundColor: selectedTheme?.colors.background }]}>
      <View style={styles.body}>{children}</View>
      {ad && <BannerAdComponent />}
    </View>
  );
};

const HomeScreen = (props) => {
  const selectedTheme = useContext(MoreThemeContext);
  return <MoreHubScreen {...props} selectedTheme={selectedTheme} />;
};
const NewsTabScreen = () => <Body><NewsScreen /></Body>;
// A form with a send button: no banner next to it.
const ReportFormScreen = () => <Body ad={false}><ReportScreen /></Body>;
const AdminScreen = () => <Body ad={false}><AdminReportsInbox /></Body>;

export const MoreStack = ({ selectedTheme }) => {
  const { t } = useTranslation();
  const { isAdmin } = useGlobalState();

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20 },
    headerShadowVisible: false,
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: selectedTheme.colors.background },
    animation: 'slide_from_right',
    freezeOnBlur: true,
  }), [selectedTheme]);

  return (
    <MoreThemeContext.Provider value={selectedTheme}>
      <Stack.Navigator screenOptions={headerOptions}>
        <Stack.Screen name="MoreHome" options={{ headerShown: false }} component={HomeScreen} />
        <Stack.Screen name="MoreNews" options={{ title: t('tabs.news') }} component={NewsTabScreen} />
        <Stack.Screen name="MoreReport" options={{ title: t('reports.title') }} component={ReportFormScreen} />
        {isAdmin && (
          <Stack.Screen name="MoreAdmin" options={{ title: 'Reports inbox' }} component={AdminScreen} />
        )}
      </Stack.Navigator>
    </MoreThemeContext.Provider>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 8 },
});

export default MoreStack;
