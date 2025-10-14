import { Alert, Linking, Platform } from "react-native";
import config from "../Helper/Environment";
import Share from 'react-native-share';
import DeviceInfo from 'react-native-device-info';
import Purchases from 'react-native-purchases';

export const getAppDownloadLink = () => {
    return Platform.OS === 'ios'
      ? config.IOsShareLink
      : config.andriodShareLink;
  };

  export const handleShareApp = async () => {
    try {
      const appLink = getAppDownloadLink();
      const shareOptions = {
        message: `Explore the MM2 value calculator! Check values, and make smarter trades. Download now: ${appLink}`,
        title: 'Share App',
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
      Alert.alert('Error', 'Unable to open the email client. Please try again later.')
    );
  } catch (error) {
    console.error('❌ Error opening feedback email:', error);
    Alert.alert('Error', 'Could not prepare the email. Please try again.');
  }
};


  export const handleRateApp = () => {
    const storeLink =
      Platform.OS === 'ios'
        ? config.IOsShareLink
        : config.andriodShareLink;
    Linking.openURL(storeLink).catch(() =>
      Alert.alert('Error', 'Unable to open the app store. Please try again later.')
    );
  };

  export const handleOpenFacebook = () => {
    const facebookUrl = 'https://www.facebook.com/share/g/15V1JErjbY/';
    Linking.openURL(facebookUrl).catch(() =>
      Alert.alert('Error', 'Unable to open Facebook. Please try again later.')
    );
  };

  export const handleOpenWebsite = () => {
    const websiteUrl = config.webSite;
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert('Error', 'Unable to open the website. Please try again later.')
    );
  };

  export const handleadoptme = () => {
    const websiteUrl = config.otherapplink;
    console.log(websiteUrl)
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert('Error', 'Unable to open the website. Please try again later.')
    );
  };

  export const handleBloxFruit = () => {
    const websiteUrl = config.otherapplink2;
    Linking.openURL(websiteUrl).catch(() =>
      Alert.alert('Error', 'Unable to open the website. Please try again later.')
    );
  };

  export const imageOptions = [
    'https://mm2values.app/wp-content/uploads/2025/profile/anatomy.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/axe.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/blood-knife.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/bow.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/crime-scene-2.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/crime-scene-3.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/crime-scene.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/detective.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/gun.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/knife.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/murder.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/murderer.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/Rainbow_Knife.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/self-murder.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/soldier.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/stone-axe.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/target.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/weapon-2.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/weapon-3.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/weapon.png',
    'https://mm2values.app/wp-content/uploads/2025/profile/weapons.png'
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

  