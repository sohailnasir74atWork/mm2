import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,

  TouchableOpacity,
  Appearance,
  InteractionManager,
  Platform,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './Code/Helper/navigationService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import MyStuffScreen from './Code/MyStuff/MyStuffScreen';
import ValueScreen from './Code/ValuesScreen/ValueScreen';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import SocialDashboard from './Code/AppHelper/SocialDashboard';
import GameScreen from './Code/Engagement/GameScreen';
import ArrowGameScreen from './Code/Engagement/ArrowGameScreen';
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
import { ensureAdsInitialized } from './Code/Ads/init';
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
  const { theme } = useGlobalState();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: selectedTheme.colors.background }}>
      <View style={{ flex: 1 }}>
        <NavigationContainer ref={navigationRef} theme={selectedTheme}>
          <StatusBar
            barStyle={isDark ? 'light-content' : 'dark-content'}
            backgroundColor={selectedTheme.colors.background}
          />

          <Stack.Navigator
              screenOptions={{
                animation: 'fade',
                animationDuration: 300,
                contentStyle: { backgroundColor: selectedTheme.colors.background },
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
              {() => <ValueScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen
              name="ArrowGameScreen"
              // The screen draws its own header (SafeAreaView + plainHeader),
              // so the native one must stay off or the game shows two headers.
              options={{ headerShown: false }}
              component={ArrowGameScreen}
            />

            <Stack.Screen
              name="GameScreen"
              options={({ route }) => ({
                title: route.params?.title || 'Game',
                headerStyle: { backgroundColor: route.params?.color || '#B91C1C' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 20, color: '#fff' },
              })}
              component={GameScreen}
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
      </View>
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();

  // App Open ad: start the manager once, after onboarding, for non-Pro users.
  // It registers its OWN AppState listener and shows on every genuine
  // background→foreground return (both iOS and Android) — frequency-capped,
  // Pro-gated, and de-duped against interstitial/rewarded ads via the shared
  // full-screen flag. Pro state is re-read from MMKV on every show, so a
  // purchase mid-session immediately stops App Open ads.
  useEffect(() => {
    if (localState.showOnBoardingScreen || localState.isPro) return;
    AppOpenAdManager.start();
  }, [localState.isPro, localState.showOnBoardingScreen]);

  // ✅ Hide splash after UI ready
  useEffect(() => {
    if (localState.isAppReady) {
      InteractionManager.runAfterInteractions(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);

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