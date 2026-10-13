import { Alert, Linking, Platform } from "react-native";
import config from "../Helper/Environment";
import Share from 'react-native-share';
import DeviceInfo from 'react-native-device-info';
import Purchases from 'react-native-purchases';
import i18n from 'i18next';

export const getAppDownloadLink = () => {
    return Platform.OS === 'ios'
      ? config.IOsShareLink
      : config.andriodShareLink;
  };

  export const handleShareApp = async () => {
    try {
      const appLink = getAppDownloadLink();
      const shareOptions = {
        message: i18n.t('settings.share_app_message', { link: appLink }),
        title: i18n.t('settings.share_app'),
      };
      await Share.open(shareOptions);
    } catch (error) {
      // console.error('Share error:', error);
    }
  };
  

  

export const handleGetSuggestions = async (user) => {
  try {
    // ✅ Get App Details
    const appName = DeviceInfo.getApplicationName();
    const appVersion = DeviceInfo.getVersion();
    const platform = Platform.OS; // "ios" or "android"

    // ✅ Get User & RevenueCat ID
    const userId = user?.id || 'Guest'; // Default to Guest if not logged in
    const revenueCatInfo = await Purchases.getCustomerInfo();
    const revenueCatUserId = revenueCatInfo?.originalAppUserId || 'Anonymous';

    // ✅ Construct Email Body
    const email = config.supportEmail;
    const subject = `App Feedback and Suggestions (${appName})`;
    const body = `Hi team,

I would like to share the following suggestions:

---

📌 App Name: ${appName}  
📌 App Version: ${appVersion}  
📌 User ID: ${userId}  
📌 RC ID: ${revenueCatUserId}  
📌 Platform: ${platform}  

---`;

    const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // ✅ Open email client
    Linking.openURL(mailtoUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_email'))
    );
  } catch (error) {
    console.error('❌ Error opening feedback email:', error);
    Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_prepare_email'));
  }
};
export const handleReport = async (user) => {
  try {
    // ✅ Get App Details
    const appName = DeviceInfo.getApplicationName();
    const appVersion = DeviceInfo.getVersion();
    const platform = Platform.OS; // "ios" or "android"

    // ✅ Get User & RevenueCat ID
    const userId = user?.id || 'Guest'; // Default to Guest if not logged in
    const revenueCatInfo = await Purchases.getCustomerInfo();
    const revenueCatUserId = revenueCatInfo?.originalAppUserId || 'Anonymous';

    // ✅ Construct Email Body
    const email = 'how2techxyz@gmail.com';
    const subject = `Report About Abusive Content (${appName})`;
    const body = `Hi team,

I would like to report ...

---

📌 App Name: ${appName}  
📌 App Version: ${appVersion}  
📌 User ID: ${userId}  
📌 RC ID: ${revenueCatUserId}  
📌 Platform: ${platform}  

---`;

    const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // ✅ Open email client
    Linking.openURL(mailtoUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_email'))
    );
  } catch (error) {
    console.error('❌ Error opening feedback email:', error);
    Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_prepare_email'));
  }
};

export const handleBloxFruit = () => {
  const websiteUrl = config.otherapplink2;
  Linking.openURL(websiteUrl).catch(() =>
    Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
  );
};

  export const handleRateApp = () => {
    const storeLink =
      Platform.OS === 'ios'
        ? config.IOsShareLink
        : config.andriodShareLink;
    Linking.openURL(storeLink).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_store'))
    );
  };
  export const handleadoptme  = () => {
    const websiteUrl = config.otherapplink;
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
    );
  };

  export const handleOpenFacebook = () => {
    const facebookUrl = 'https://www.facebook.com/share/g/15V1JErjbY/';
    Linking.openURL(facebookUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_facebook'))
    );
  };

  export const handleOpenWebsite = () => {
    const websiteUrl = config.webSite;
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
    );
  };

  export const handleOpenPrivacy = () => {
    const websiteUrl = 'https://mm2values.app/privacy';
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
    );
  };

  export const handleOpenTerms = () => {
    const websiteUrl = 'https://mm2values.app/terms';
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
    );
  };

  export const handleOpenChild = () => {
    const websiteUrl = 'https://mm2values.app/child-safety-standards-policy';
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert(i18n.t('home.alert.error'), i18n.t('settings.err_open_website'))
    );
  };

  export const imageOptions = [
    'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/101.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/102.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/103.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/104.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/105.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/106.png',

    'https://bloxfruitscalc.com/wp-content/uploads/2025/107.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/108.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/109.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/110.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/111.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/woman.png',
    
    'https://bloxfruitscalc.com/wp-content/uploads/2025/eagle.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/patch.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate1.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate2.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate3.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-flag.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-hat.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-hat1.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-ship.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-ship2.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate-skull.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/pirate.png',
    'https://bloxfruitscalc.com/wp-content/uploads/2025/steering-wheel.png',
  ];
 

  export const handleRefresh = async (reload) => {
    // setRefreshing(true);

    try {
      await reload(); // Re-fetch stock data
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      // setRefreshing(false);
    }
  };

  