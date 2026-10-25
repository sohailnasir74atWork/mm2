import { Platform } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';
import { startIosUpdatePrompt } from './iosUpdatePrompt';

// Android only: Play in-app updates. iOS is iosUpdatePrompt.js.
const inAppUpdates = new SpInAppUpdates(false); // set true for debug logs

export const checkForUpdate = async () => {
  if (__DEV__) return;

  if (Platform.OS === 'ios') {
    startIosUpdatePrompt();
    return;
  }
  if (Platform.OS !== 'android') return;

  try {
    const result = await inAppUpdates.checkNeedsUpdate();

    if (result.shouldUpdate) {
      // The Play update sheet backgrounds the app: no app-open ad on return.
      require('../Ads/openApp').default.skipNextForeground(2 * 60 * 1000);
      await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
    }
  } catch (err) {
    console.warn('In-app update check failed:', err?.message || err);
  }
};
