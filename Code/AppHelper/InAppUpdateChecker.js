import { Platform } from 'react-native';
import i18n from 'i18next';
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
          title: i18n.t('app_update.title'),
          message: i18n.t('app_update.message'),
          buttonUpgradeText: i18n.t('app_update.update'),
          buttonCancelText: i18n.t('app_update.later'),
          forceUpgrade: false,
        },
      });

      // The Play update sheet backgrounds the app: no app-open ad on return.
      require('../Ads/openApp').default.skipNextForeground(2 * 60 * 1000);
      await inAppUpdates.startUpdate(updateOptions);
    }
  } catch (err) {
    console.warn('In-app update check failed:', err?.message || err);
  }
};
