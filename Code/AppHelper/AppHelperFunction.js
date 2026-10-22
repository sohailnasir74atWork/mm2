// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import config from '../Helper/Environment';

export const MyLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: config.colors.backgroundLight,
    card: config.colors.surfaceLight,
    text: config.colors.textLight,
    primary: config.colors.primary,
    border: config.colors.borderLight,
    notification: config.colors.primary,
  },
};

export const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: config.colors.backgroundDark,
    card: config.colors.surfaceDark,
    text: config.colors.textDark,
    primary: config.colors.primary,
    border: config.colors.borderDark,
    notification: config.colors.primary,
  },
};


// adHelper.js

export const initializeAds = async () => {
  await mobileAds().initialize();
};


export const loadAppOpenAd = async (
  adUnitId,
  lastAdShownTime,
  adCooldown,
  setLastAdShownTime,
  setIsAdLoaded,
  isPro
) => {
  if (isPro) return; // Return immediately if the user is Pro

  const now = Date.now();
  if (now - lastAdShownTime < adCooldown) return; // Ensure cooldown is respected

  try {
    const appOpenAd = AppOpenAd.createForAdRequest(adUnitId);

    appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
      setIsAdLoaded(true); // Mark ad as loaded
      appOpenAd.show();
      setLastAdShownTime(Date.now());
      setIsAdLoaded(false); // Reset ad loaded state
    });

    appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
      // console.error('Ad Error:', error);
      setIsAdLoaded(false);
    });

    await appOpenAd.load(); // Load the ad
  } catch (error) {
    // console.error('Error loading App Open Ad:', error);
    setIsAdLoaded(false);
  }
};


// The store review prompt lives in reviewPrompt.js.


// consentHelper.js

export const handleUserConsent = async (setConsentStatus, setLoading) => {
  try {
    const consentInfo = await AdsConsent.requestInfoUpdate();
    if (consentInfo.isConsentFormAvailable) {
      if (consentInfo.status === AdsConsentStatus.REQUIRED) {
        const formResult = await AdsConsent.showForm();
        setConsentStatus(formResult.status);
      } else {
        setConsentStatus(consentInfo.status);
      }
    }
  } catch (error) {
    // console.error('Error handling consent:', error);
  } finally {
    setLoading(false);
  }
};
