// SubscriptionScreen.js
import React, { useEffect, useRef } from 'react';
import Purchases from 'react-native-purchases';
import { handleOpenPaywall } from './PayWall';
import { useLocalState } from '../LocalGlobelStats';

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly }) => {
  const hasOpenedRef = useRef(false);
  const { updateLocalState } = useLocalState();

  useEffect(() => {
    if (!visible) {
      hasOpenedRef.current = false;
      return;
    }

    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        await handleOpenPaywall(track, showoffer, !!oneWallOnly);
        // Refresh pro status after paywall closes
        const customerInfo = await Purchases.getCustomerInfo();
        const entitlements = customerInfo.entitlements.active;
        const proKey = Object.keys(entitlements).find(
          (key) => key.toLowerCase() === 'pro'
        );
        updateLocalState('isPro', !!(proKey && entitlements[proKey]));
      } finally {
        if (!cancelled && typeof onClose === 'function') {
          onClose();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  return null;
};

export default SubscriptionScreen;
