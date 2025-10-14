import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  AppState,
  TouchableOpacity,
  Appearance,
  InteractionManager,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import { getTrackingStatus, requestTrackingPermission } from 'react-native-tracking-transparency';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import getAdUnitId from './Code/Ads/ads';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
// import RewardCenterScreen from './Code/SettingScreen/RewardCenter';
// import RewardRulesModal from './Code/SettingScreen/RewardRulesModel';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';



const Stack = createNativeStackNavigator();

// const adUnitId = getAdUnitId('openapp');

function App() {
  const { theme } = useGlobalState();
  const { t } = useTranslation();
  useEffect(() => {
    SystemNavigationBar.setNavigationColor('#000000', true); // black background, light icons
    SystemNavigationBar.setBarMode('dark'); // forces dark mode (light icons)
  }, []);

  const selectedTheme = useMemo(() => {
    return MyDarkTheme; // Always use dark theme
  }, []);

  const { localState, updateLocalState } = useLocalState();
  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);



  useEffect(() => {
    InterstitialAdManager.init();
  }, []);
  useEffect(() => {
    const askPermission = async () => {
      try {
        const status = await getTrackingStatus();
        // console.log('Initial tracking status:', status);
  
        if (status === 'not-determined') {
          const newStatus = await requestTrackingPermission();
          // console.log('User response:', newStatus);
        }
      } catch (error) {
        // console.error('Error requesting tracking permission:', error);
      }
    };
  
    askPermission();
  }, []);

  // useEffect(() => {
  //   const showColdStartAd = async () => {
  //     // console.log('[OpenAd] ⏳ Checking if app is ready to show cold-start ad...');
  
  //     if (
  //       localState.isAppReady &&
  //       !localState.isPro &&
  //       !hasShownColdStartAdRef.current
  //     ) {
  //       // console.log('[OpenAd] ✅ App is ready. Proceeding to show Open App Ad...');
  
  //       try {
  //         // await AppOpenAdManager.init();
  //         // console.log('[OpenAd] 📦 Ad initialized.');
  
  //         setTimeout(async () => {
  //           // console.log('[OpenAd] 🚀 Attempting to show Open App Ad after delay...');
  
  //           await AppOpenAdManager.showAd();
  
  //           hasShownColdStartAdRef.current = true;
  //           // console.log('[OpenAd] 🎉 Cold-start Open App Ad shown successfully.');
  //         }, 3000); // small delay to avoid UI clash
  
  //       } catch (err) {
  //         // console.warn('❌ [OpenAd] Failed to show cold-start ad:', err);
  //       }
  //     } else {
  //       // console.log(
  //       //   '[OpenAd] ❌ Skipping ad show:',
  //       //   `isPro=${localState.isPro},`,
  //       //   `hasShownColdStartAd=${hasShownColdStartAdRef.current}`
  //       // );
  //     }
  //   };
  
  //   showColdStartAd();
  // }, [localState.isPro]);
  
  // useEffect(() => {
  //   let isMounted = true;
  //   let previousState = AppState.currentState;
  
  //   // const initializeAds = async () => {
  //   //   try {
  //   //     await AppOpenAdManager.init();
  //   //   } catch (error) {
  //   //     console.error('❌ Error initializing ads:', error);
  //   //   }
  //   // };
  
  //   const handleAppStateChange = async (nextAppState) => {
  //     if (!isMounted) return;
  //     // console.log(`AppState: ${previousState} → ${nextAppState}`);

  
  //     try {
        

  //       if (
  //         previousState === 'background' &&
  //         nextAppState === 'active' &&
  //         !localState?.isPro
  //       ) {
  //         await AppOpenAdManager.showAd();
  //       }
  //     } catch (error) {
  //       console.error('❌ Error showing ad:', error);
  //     } finally {
  //       previousState = nextAppState; // update for next change
  //     }
  //   };
  
  //   // initializeAds();
  
  //   const subscription = AppState.addEventListener('change', handleAppStateChange);
  
  //   return () => {
  //     isMounted = false;
  //     subscription?.remove();
  //     AppOpenAdManager.cleanup();
  //   };
  // }, [localState?.isPro]);
  



  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }



  

  useEffect(() => {

    const { reviewCount } = localState;
    if (reviewCount % 6 === 0 && reviewCount > 0) {
      requestReview();
    }

    updateLocalState('reviewCount', Number(reviewCount) + 1);
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


  // // Handle Consent
  // useEffect(() => {
  //   handleUserConsent();
  // }, []);
  const navRef = useRef();



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: selectedTheme.colors.background }}>
      <Animated.View style={{ flex: 1 }}>
        <NavigationContainer theme={selectedTheme}>
          <StatusBar
            barStyle="light-content"
            backgroundColor={selectedTheme.colors.background}
          />

          <Stack.Navigator>
            <Stack.Screen name="Home" options={{ headerShown: false }} >
              {() => <MainTabs selectedTheme={selectedTheme} setChatFocused={setChatFocused} chatFocused={chatFocused} setModalVisibleChatinfo={setModalVisibleChatinfo} modalVisibleChatinfo={modalVisibleChatinfo} />}
            </Stack.Screen>
            {/* <Stack.Screen
              name="Reward"
              options={{
                title: "Reward Center",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => <RewardCenterScreen selectedTheme={selectedTheme} />}
            </Stack.Screen> */}

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
          </Stack.Navigator>
        </NavigationContainer>
        {/* {modalVisible && (
          <RewardRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} selectedTheme={selectedTheme} />
        )} */}
      </Animated.View>
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();
  const hasShownColdStartAd = useRef(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (localState.showOnBoardingScreen) return;

    // ✅ Android: Show cold start ad only once
    if (Platform.OS === 'android' && !hasShownColdStartAd.current) {
      // AppOpenAdManager.initAndShow();
      hasShownColdStartAd.current = true;
    }

    // ✅ iOS: Listen for background → active transition
    if (Platform.OS === 'ios') {
      const subscription = AppState.addEventListener('change', nextAppState => {
        const wasBackground = appState.current === 'background';
        const nowActive = nextAppState === 'active';

        appState.current = nextAppState;

        if (wasBackground && nowActive && !localState.isPro) {
          AppOpenAdManager.initAndShow();
        }
      });

      return () => subscription?.remove();
    }

  }, [localState.isPro]);

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