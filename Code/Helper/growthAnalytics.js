import {getAnalytics, logEvent} from '@react-native-firebase/analytics';

// Uses the app's existing Analytics collection settings. No item names,
// search strings, emails, or account identifiers are sent by these events.
export const trackGrowthEvent = (event, params = {}) => {
  try {
    Promise.resolve(logEvent(getAnalytics(), event, params)).catch(() => {});
  } catch {
    // Measurement must never block the calculator or onboarding.
  }
};

// The events below are meant to be marked as key events in GA4 and imported
// into Google Ads as app-campaign conversions.

// GA4's recommended sign_up event. Only for accounts created just now, not
// for returning users signing in. method: 'google' | 'apple' | 'email'.
export const trackSignUp = method => trackGrowthEvent('sign_up', {method});

// A Pro purchase with its price. Deliberately not GA4's reserved `purchase`
// event: Analytics already auto-logs `in_app_purchase` for store purchases,
// and both count toward total revenue, so `purchase` would double it. Google
// Ads reads value/currency from any key event, so the custom name loses nothing.
export const trackProPurchase = (pkg, source) => {
  const product = pkg?.product || {};
  trackGrowthEvent('pro_purchase', {
    value: Number(product.price) || 0,
    currency: product.currencyCode || 'USD',
    product_id: product.identifier || 'unknown',
    paywall_source: source || 'unknown',
  });
};

// The "engaged user" signal for Google Ads: someone who posted a trade got
// real use out of the app, which an install alone doesn't show.
export const trackTradePosted = valueSource =>
  trackGrowthEvent('trade_posted', {value_source: valueSource || 'mm2'});
