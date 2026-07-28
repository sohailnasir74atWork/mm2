import { Platform } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';

const inAppUpdates = new SpInAppUpdates(false); // set true for debug logs

export const checkForUpdate = async () => {
  if (__DEV__) return;

  try {
    const result = await inAppUpdates.checkNeedsUpdate();

    if (result.shouldUpdate) {
      const updateOptions = Platform.select({
        android: {
          updateType: IAUUpdateKind.IMMEDIATE,
        },
        ios: {
          title: 'Update Available',
          message:
            'A new version of the app is available. Please update for the best experience.',
          buttonUpgradeText: 'Update',
          buttonCancelText: 'Later',
          forceUpgrade: false,
        },
      });

      await inAppUpdates.startUpdate(updateOptions);
    }
  } catch (err) {
    console.warn('In-app update check failed:', err?.message || err);
  }
};
