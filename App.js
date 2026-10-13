import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StatusBar,
  TouchableOpacity,
  Appearance,
  Platform,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

// react-native's SafeAreaView was a no-op on Android and only ever inset on
// iOS; react-native-safe-area-context's insets on both. Pinning the edges
// per-platform keeps the layout byte-for-byte what it was before the swap.
const LEGACY_SAFE_AREA_EDGES = Platform.OS === 'ios'
  ? ['top', 'bottom', 'left', 'right']
  : [];

// The root SafeAreaView already pads the notch and home indicator on iOS, so
// screens inside it must measure insets from that padded box, not the window.
// Reading the window's insets there is what doubled the tab bar's bottom and
// the Home / Calculator headers' top. A provider nested inside the padded view
// measures the box itself: zero on iOS, the window's insets on Android (which
// the root does not pad). Seeding it with those values avoids a doubled first
// frame. Onboarding renders outside this view and keeps index.js's provider.
const NAV_INITIAL_METRICS = initialWindowMetrics && Platform.OS === 'ios'
  ? { frame: initialWindowMetrics.frame, insets: { top: 0, right: 0, bottom: 0, left: 0 } }
  : initialWindowMetrics;
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './Code/Helper/navigationService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import EmailOptInGate from './Code/AppHelper/EmailOptInGate';
import MyStuffScreen from './Code/MyStuff/MyStuffScreen';
import ValueScreen from './Code/ValuesScreen/ValueScreen';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import SocialDashboard from './Code/AppHelper/SocialDashboard';
import { getTrackingStatus, requestTrackingPermission } from 'react-native-tracking-transparency';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import getAdUnitId from './Code/Ads/ads';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';

// The splash waits for login (isAppReady) but never longer than this from JS
// start: most logins are well under it; a slower one lets the app open and
// the profile fill in behind it (SigninDrawer never asks a signed-in player to
// sign in meanwhile).
const SPLASH_LOGIN_CAP_MS = 3000;
const JS_STARTED_AT = Date.now();
import { ensureAdsInitialized, canRequestAdsFromLastSession } from './Code/Ads/init';
import { markAdsReady, whenAdsReady } from './Code/Ads/adsGate';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateChecker';
import PrivateChatScreen from './Code/ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from './Code/ChatScreen/PrivateChat/PrivateChatHeader';

const Stack = createNativeStackNavigator();

// Wrapper for PrivateChat used from root stack (SocialDashboard → Chat)
// Manages its own drawer state since it's outside ChatNavigator
const PrivateChatRootWrapper = (props) => {
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  return (
    <PrivateChatScreen
      {...props}
      bannedUsers={[]}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
      noTabBar={true}
    />
  );
};

function App() {
  const { theme, user, appdatabase } = useGlobalState();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  useEffect(() => {
    SystemNavigationBar.setNavigationColor(isDark ? '#000000' : '#FFFFFF', !isDark);
    SystemNavigationBar.setBarMode(isDark ? 'dark' : 'light');
  }, [isDark]);

  const selectedTheme = useMemo(() => {
    return isDark ? MyDarkTheme : MyLightTheme;
  }, [isDark]);

  const { localState, updateLocalState } = useLocalState();
  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false);

  // ✅ Moved before conditional return to satisfy Rules of Hooks
  useEffect(() => {
    const { reviewCount } = localState;
    if (reviewCount % 6 === 0 && reviewCount > 0) {
      requestReview();
    }
    updateLocalState('reviewCount', Number(reviewCount) + 1);
  }, []);



  // ✅ Check for app updates on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

  // ✅ Sequential: ATT (iOS) → UMP Consent → Ads Init
  useEffect(() => {
    const initConsentAndAds = async () => {
      try {
        // Step 1: ATT prompt (iOS only)
        if (Platform.OS === 'ios') {
          const status = await getTrackingStatus();
          if (status === 'not-determined') {
            await requestTrackingPermission();
          }
        }

        // Step 2: UMP / GDPR consent
        await handleUserConsent();

        // Step 3: Apply the AdMob request configuration (maxAdContentRating 'T',
        // child-treatment flag) BEFORE the first ad request, then init ads.
        // ensureAdsInitialized() is a shared one-shot promise; every ad manager
        // also awaits it, so ordering (config-before-load) is guaranteed.
        await ensureAdsInitialized();
        InterstitialAdManager.init();
      } catch (error) {
        // Still init ads even if consent fails, to avoid no ads at all
        InterstitialAdManager.init();
      } finally {
        // Banners and the App Open manager wait for this (Code/Ads/adsGate.js),
        // so nothing requests an ad before ATT + consent have run.
        markAdsReady();
      }
    };

    initConsentAndAds();
  }, []);

  const saveConsentStatus = (status) => {
    updateLocalState('consentStatus', status);
  };

  const handleUserConsent = async () => {
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();

      if (
        consentInfo.status === AdsConsentStatus.OBTAINED ||
        consentInfo.status === AdsConsentStatus.NOT_REQUIRED
      ) {
        saveConsentStatus(consentInfo.status);
        return;
      }

      if (consentInfo.isConsentFormAvailable) {
        const formResult = await AdsConsent.showForm();
        saveConsentStatus(formResult.status);
      }
    } catch (error) {
      console.warn("Consent error:", error);
    }
  };



  const navRef = useRef();



  return (
    <SafeAreaView edges={LEGACY_SAFE_AREA_EDGES} style={{ flex: 1, backgroundColor: selectedTheme.colors.background }} onTouchStartCapture={AppOpenAdManager.noteUserTouch}>
      <SafeAreaProvider initialMetrics={NAV_INITIAL_METRICS}>
        <NavigationContainer ref={navigationRef} theme={selectedTheme}>
          <StatusBar
            barStyle={isDark ? 'light-content' : 'dark-content'}
          />

          <Stack.Navigator
              screenOptions={{
                animation: 'fade',
                animationDuration: 300,
                contentStyle: { backgroundColor: selectedTheme.colors.background },
                // Arrow only on every pushed screen: the label was the previous
                // route's NAME, which read "MainTabs" (Settings, Values, ...).
                headerBackButtonDisplayMode: 'minimal',
              }}
            >
            <Stack.Screen name="MainTabs" options={{ headerShown: false }} >
              {() => <MainTabs selectedTheme={selectedTheme} setChatFocused={setChatFocused} chatFocused={chatFocused} setModalVisibleChatinfo={setModalVisibleChatinfo} modalVisibleChatinfo={modalVisibleChatinfo} />}
            </Stack.Screen>

            {/* Move this outside of <Stack.Navigator> */}


            <Stack.Screen
              name="Setting"
              options={{
                title: t('tabs.settings'),
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
            >
              {() => <SettingsScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen
              name="MyStuff"
              options={{
                title: 'My Stuff',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20 },
              }}
            >
              {() => <MyStuffScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen name="MysteryEggScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MysteryEgg').default} />
            {/* Draws its own header, so the native one stays off. */}
            <Stack.Screen name="ModsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/ModsScreen').default} />
            {/* Moderation console. Draws its own tab bar; the native header
                carries the title and back button. Lazily required so the
                bundle cost lands only on staff who actually open it. */}
            <Stack.Screen
              name="Admin"
              options={{
                title: 'Moderation',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
              getComponent={() => require('./Code/AppHelper/AdminDashboard').default}
            />
            <Stack.Screen name="MyCosmeticsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MyCosmeticsScreen').default} />

            <Stack.Screen
              name="SocialDashboard"
              options={{
                title: 'Social Dashboard',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20 },
              }}
            >
              {() => <SocialDashboard selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen
              name="Values"
              options={{
                title: 'Values',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20 },
              }}
            >
              {(props) => <ValueScreen {...props} selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen
              name="ArrowGameScreen"
              // The screen draws its own header (SafeAreaView + plainHeader),
              // so the native one must stay off or the game shows two headers.
              options={{ headerShown: false }}
              // Lazy: the game screens (and their six mini-games) are no longer on
              // Home, so there is no reason to evaluate them at startup.
              getComponent={() => require('./Code/Engagement/ArrowGameScreen').default}
            />

            <Stack.Screen
              name="GameScreen"
              options={({ route }) => ({
                title: route.params?.title || 'Game',
                headerStyle: { backgroundColor: route.params?.color || '#B91C1C' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20, color: '#fff' },
              })}
              getComponent={() => require('./Code/Engagement/GameScreen').default}
            />

            <Stack.Screen
              name="PrivateChatRoot"
              options={({ route }) => ({
                headerTitle: () => (
                  <PrivateChatHeader
                    selectedUser={route.params?.selectedUser}
                    selectedTheme={selectedTheme}
                    bannedUsers={[]}
                    isDrawerVisible={false}
                    setIsDrawerVisible={() => {}}
                  />
                ),
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              })}
            >
              {(props) => <PrivateChatRootWrapper {...props} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
      {/* Email news-and-updates opt-in: applies the sign-in checkbox, asks
          undecided users once, and backs the Settings switch. Asks for a
          date of birth the first time someone opts in (13+ only). */}
      <EmailOptInGate
        user={user}
        appdatabase={appdatabase}
        isDarkMode={theme === 'dark'}
      />
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();

  // App Open ad: start the manager once, after onboarding, for non-Pro users.
  // It registers its OWN AppState listener and shows on a genuine
  // background→foreground return (both iOS and Android) under the shared
  // policy in Code/Ads/adPolicy.js (APP_OPEN_MIN_INTERVAL_MS /
  // APP_OPEN_MIN_BACKGROUND_MS), Pro-gated, and de-duped against
  // interstitial/rewarded ads via the shared full-screen flag. Pro state is
  // re-read from MMKV on every show, so a purchase mid-session immediately
  // stops App Open ads.
  //
  // The manager starts once consent allows ads: at once when consent from an
  // earlier session still stands, otherwise after this session's consent
  // flow (whenAdsReady).
  // Launch App Open ad: decided once per launch. The splash no longer waits
  // for it; it shows when it loads, over the splash or Home, under the window
  // and no-touch rules in Code/Ads/openApp.js / adPolicy.js (same flow as
  // Adopt Me / Blox).
  const coldStartPrepared = useRef(false);
  useEffect(() => {
    if (!coldStartPrepared.current) {
      coldStartPrepared.current = true;
      if (localState.showOnBoardingScreen || localState.isPro) {
        AppOpenAdManager.skipColdStart();
      } else {
        AppOpenAdManager.prepareColdStart();
      }
    }
    if (localState.showOnBoardingScreen || localState.isPro) return undefined;
    let cancelled = false;
    // Consent from an earlier session lets the launch ad's request go out now,
    // inside the splash window; otherwise wait for this session's consent.
    canRequestAdsFromLastSession()
      .then((alreadyConsented) => (alreadyConsented ? undefined : whenAdsReady()))
      .then(() => { if (!cancelled) AppOpenAdManager.start(); });
    return () => { cancelled = true; };
  }, [localState.isPro, localState.showOnBoardingScreen]);

  const [splashCapReached, setSplashCapReached] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSplashCapReached(true),
      Math.max(0, JS_STARTED_AT + SPLASH_LOGIN_CAP_MS - Date.now()));
    return () => clearTimeout(id);
  }, []);

  // ✅ Hide splash once login is done (or the cap passed).
  useEffect(() => {
    if (localState.isAppReady || splashCapReached) {
      // Was InteractionManager.runAfterInteractions (deprecated in RN 0.83).
      // rAF defers to after the next frame commits, which is what this needed
      // — and unlike requestIdleCallback it cannot be starved, so the splash
      // can never get stuck on screen.
      const raf = requestAnimationFrame(() => {
        // Once the splash has faded, Home is on screen: that starts the launch
        // ad's no-touch rule (Code/Ads/openApp.js).
        Promise.resolve(RNBootSplash.hide({ fade: true }))
          .catch(() => {})
          .then(() => AppOpenAdManager.noteHomeVisible());
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [localState.isAppReady, splashCapReached]);

  const selectedTheme = useMemo(() => {
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);

  const handleSplashFinish = () => {
    updateLocalState('showOnBoardingScreen', false);
  };

  if (localState.showOnBoardingScreen) {
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

  return <App />;
}