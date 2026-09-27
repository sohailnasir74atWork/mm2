// 🏆 Optimize performance by enabling screens before any imports
import { enableScreens, enableFreeze } from 'react-native-screens';
enableScreens(); 
enableFreeze(true);

import React, { lazy, Suspense } from 'react';
import { AppRegistry, Text } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { LanguageProvider } from './Code/Translation/LanguageProvider';
import messaging from '@react-native-firebase/messaging';
import FlashMessage from 'react-native-flash-message';

// Removed deleted dynamic imports

// ✅ Background Notification Handler
messaging().setBackgroundMessageHandler(async remoteMessage => {
});

// ✅ Foreground display for value-change alerts — background/killed pushes
// auto-display, but foreground ones are dropped unless shown manually.
import { initValueAlertForegroundHandler } from './Code/Helper/valueAlerts';
initValueAlertForegroundHandler();
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('Caught in ErrorBoundary:', error, info);
  }
  render() {
    return this.state.hasError ? <Text>Something went wrong.</Text> : this.props.children;
  }
}

// ✅ Memoized App component to prevent unnecessary re-renders
// SafeAreaProvider is required by every react-native-safe-area-context
// consumer (SafeAreaView, useSafeAreaInsets). This one reports the WINDOW's
// insets, which is right for onboarding (rendered outside App's padded root).
// The navigator must not read it: App.js nests its own provider inside the
// root SafeAreaView, or every tab screen adds the iOS insets a second time.
// initialWindowMetrics seeds the first frame so nothing shifts after mount.
const App = React.memo(() => (
  <SafeAreaProvider initialMetrics={initialWindowMetrics}>
  <MenuProvider skipInstanceCheck>
  <LanguageProvider>
    <LocalStateProvider>
      <GlobalStateProvider > 
        <ErrorBoundary>
          <AppWrapper />
        </ErrorBoundary>
        <FlashMessage position="top" />
        <Suspense fallback={null}>
        </Suspense>
      </GlobalStateProvider>
    </LocalStateProvider>                
  </LanguageProvider>
</MenuProvider>
  </SafeAreaProvider>
));

AppRegistry.registerComponent(appName, () => App);
