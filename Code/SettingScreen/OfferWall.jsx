// OfferWall.jsx — MM2 Values Pro
//
// Ported from FischValues' custom paywall (itself from adoptme-jan7). It
// replaces RevenueCatUI.presentPaywall(), whose template was designed in the
// RevenueCat dashboard and pulled Jetpack Compose + purchases-ui into the APK
// (~3.75 MB of DEX, a fifth of the app's code) just to draw one screen.
//
// The screen has three jobs, in this order —
//   1. say what Pro unlocks, in one screenful,
//   2. show every plan side by side so nothing is hidden,
//   3. make the best plan's saving impossible to miss.
//
// Every discount here is arithmetic on LIVE store prices — never hardcoded — so
// it stays true in every currency and survives a price change. The maths is
// written against planTypeOf() (the product's billing period), so adding or
// dropping a plan in RevenueCat needs no edit here.
//
// ONE wall, one offering ('default'). Owner's call (2026-10-11): no second
// "discount" wall after closing this one. Callers still pass `showoffer` and
// `oneWallOnly`; both are ignored.
//
// It LOOKS LIKE ONBOARDING, on purpose. The first-run flow is welcome → sign
// in → this wall, and a dark storefront at step three read as leaving the app.
// So it follows the app theme on onboarding's own background, shows the same
// logo, and its button is onboarding's Continue button: same colour
// (config.colors.hasBlockGreen), same corners, same word. The Blox Fruit and
// Adopt Me walls are this same screen in their own brand colour.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, Platform, ActivityIndicator,
  Dimensions, Linking, Animated, Easing, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient as SvgRadial, Stop, Rect, Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import Purchases from 'react-native-purchases';
import { useTranslation } from 'react-i18next';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { useLocalState } from '../LocalGlobelStats';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import AppOpenAdManager from '../Ads/openApp';
import { paywallPlacement, trackPaywallView, trackPaywallClose } from '../Helper/growthAnalytics';
import { flipInRTL } from '../Helper/rtl';

const { width, height } = Dimensions.get('window');
const SMALL = height < 700;

const FONT_BOLD = 'Lato-Bold';
const FONT_REGULAR = 'Lato-Regular';

const TERMS_URL = 'https://mm2values.app/terms';
const PRIVACY_URL = 'https://mm2values.app/privacy';

// RevenueCat offering shown on the wall.
const OFFERING = 'default';

const LOGO = require('../../assets/MM2logo.webp'); // the logo onboarding shows
const PRO_BADGE = require('../../assets/pro.png');

// Seconds before the × appears. Nothing is shown in its place while it waits;
// it simply appears. Owner's call (2026-10-11): 7 s on the first-run wall at
// the end of onboarding, 5 s everywhere else.
const CLOSE_DELAY_ONBOARDING = 7;
const CLOSE_DELAY = 5;

// ── Palette ──
const BRAND = '#6A5ACD';   // config.colors.hasBlockGreen — onboarding's Continue button
const ACCENT = '#3E8BFC';  // config.colors.accent
const GOLD = '#E1A900';    // the Pro badge (assets/pro.png)

// '#RRGGBB' + alpha → '#RRGGBBAA'
const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

const makePalette = (isDark) => (isDark
  ? {
    BG: '#040d1a',          // config.colors.backgroundDark — onboarding's dark background
    NAV_STYLE: 'light',
    STATUS_STYLE: 'light-content',
    GLOW: 0.30,
    BRAND_TEXT: '#9D93E6',  // brand lifted so it reads on the dark sea
    TEXT: '#FFFFFF',        // onboarding title
    TEXT_SUB: '#CCCCCC',    // onboarding body text
    TEXT_MUTE: 'rgba(255,255,255,0.5)',
    CARD: 'rgba(255,255,255,0.06)',
    CARD_LINE: 'rgba(255,255,255,0.10)',
    DIVIDER: 'rgba(255,255,255,0.07)',
    TILE_ON: tint(BRAND, 0.22),
    SAVINGS_LINE: tint(BRAND, 0.45),
    CLOSE_BG: 'rgba(255,255,255,0.10)',
    CLOSE_ICON: 'rgba(255,255,255,0.85)',
    DOCK_BG: 'rgba(4,13,26,0.94)',
    DOCK_LINE: 'rgba(255,255,255,0.08)',
    FOOTER: 'rgba(255,255,255,0.45)',
    FOOTER_DOT: 'rgba(255,255,255,0.25)',
  }
  : {
    BG: '#f2f2f7',          // onboarding's light background
    NAV_STYLE: 'dark',
    STATUS_STYLE: 'dark-content',
    GLOW: 0.14,
    BRAND_TEXT: '#5A4BC0',
    TEXT: '#000000',
    TEXT_SUB: '#666666',
    TEXT_MUTE: '#8E8E93',
    CARD: '#FFFFFF',
    CARD_LINE: '#E5E5EA',
    DIVIDER: '#EFEFF4',
    TILE_ON: tint(BRAND, 0.10),
    SAVINGS_LINE: tint(BRAND, 0.30),
    CLOSE_BG: 'rgba(0,0,0,0.06)',
    CLOSE_ICON: '#3C3C43',
    DOCK_BG: 'rgba(242,242,247,0.96)',
    DOCK_LINE: '#E5E5EA',
    FOOTER: '#8E8E93',
    FOOTER_DOT: '#C7C7CC',
  });

// ── What Pro actually unlocks ──
// Every line is a real gate in this codebase, not a marketing claim:
//   noads   → bannerAds / openApp / IntAd / FeedBannerAd skip Pro, and
//             Trades.jsx stops injecting an ad row every 8 trades
//   boost   → Trades.jsx handleMakeFeatureTrade is Pro-only: 2 boosts per 24h,
//             12 hours each, no rewarded video (free users get 1, with a video)
//   badge   → assets/pro.png renders beside the name in trades, chat and posts
//   extra_translate → MessagesList / PrivateMessageList skip the 5-a-day cap
const BENEFITS = [
  { key: 'noads', icon: 'close-circle', tint: BRAND },
  { key: 'boost', icon: 'rocket', tint: ACCENT },
  { key: 'badge', image: PRO_BADGE, tint: GOLD },
];

// A plan's REAL length comes from the store product's billing period, not from
// the RevenueCat package slot it was filed under (Fisch had a 3-month product
// in the LIFETIME slot, labelled "Forever"). The slot is only the fallback, for
// one-time purchases (no period) and Amazon (never reports one).
const PERIOD_TYPE = {
  P1W: 'WEEKLY', P7D: 'WEEKLY', P1M: 'MONTHLY', P2M: 'TWO_MONTH',
  P3M: 'THREE_MONTH', P6M: 'SIX_MONTH', P1Y: 'ANNUAL', P12M: 'ANNUAL',
};
const planTypeOf = (pkg) =>
  PERIOD_TYPE[pkg?.product?.subscriptionPeriod] || pkg?.packageType;

// Longest plan first — the best deal should sit under the thumb, on the left,
// where the eye lands first.
const PLAN_ORDER = { LIFETIME: 0, ANNUAL: 1, SIX_MONTH: 2, THREE_MONTH: 3, TWO_MONTH: 4, MONTHLY: 5, WEEKLY: 6 };
// Months per billing period — the scale every price is compared on.
const MONTHS_IN_PERIOD = { WEEKLY: 0.2301, MONTHLY: 1, TWO_MONTH: 2, THREE_MONTH: 3, SIX_MONTH: 6, ANNUAL: 12 };
const PLAN_KEY = {
  WEEKLY: 'plan_weekly', MONTHLY: 'plan_monthly', TWO_MONTH: 'plan_two_month',
  THREE_MONTH: 'plan_three_month', SIX_MONTH: 'plan_six_month', ANNUAL: 'plan_annual',
  LIFETIME: 'plan_lifetime',
};
const BILLED_KEY = {
  WEEKLY: 'billed_weekly', MONTHLY: 'billed_monthly', TWO_MONTH: 'billed_2months',
  THREE_MONTH: 'billed_3months', SIX_MONTH: 'billed_6months', ANNUAL: 'billed_yearly',
};

// Rebuild a price string at a different amount, keeping the store's currency
// symbol and its position (prefix "$4.99" vs suffix "4,99 €"). The STORE's own
// symbol wins and Intl is only the fallback: Play says "Rs 550.00" where Intl
// says "PKR 550.00", and one screen must not print two currencies.
const formatMoney = (pkg, amount) => {
  const priceString = pkg?.product?.priceString || '';
  const symbol = priceString.replace(/[\d\s.,]/g, '').trim();
  // Whole amounts drop the decimals ("Rs 1,590"); anything with real pence
  // keeps both places ("Rs 137.50", never "Rs 137.5").
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  let value;
  try {
    value = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch (e) {
    value = whole ? String(Math.round(amount)) : amount.toFixed(2);
  }

  if (symbol) {
    const firstDigit = priceString.search(/\d/);
    const symbolIndex = priceString.indexOf(symbol[0]);
    if (firstDigit !== -1 && symbolIndex > firstDigit) return `${value} ${symbol}`;
    const gap = firstDigit > symbolIndex + symbol.length - 1 &&
      /\s/.test(priceString.slice(symbolIndex + symbol.length, firstDigit)) ? ' ' : '';
    return `${symbol}${gap}${value}`;
  }

  const currency = pkg?.product?.currencyCode;
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch (e) {
      // Fall through to the bare number below
    }
  }
  return value;
};

// Play returns a trailing ".00" on every whole price — "Rs 550.00" where the
// shop itself says "Rs 550". Strip a separator followed by exactly two zeros
// when no digit follows, so "Rs 1,006.00" keeps its "1,006".
const trimZeroDecimals = (s) => (typeof s === 'string' ? s.replace(/([.,])00(?!\d)/, '') : s);

// ── Background: onboarding's flat colour, one soft brand glow at the top ──
const Backdrop = ({ P }) => (
  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <SvgRadial id="glowTop" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={BRAND} stopOpacity={P.GLOW} />
        <Stop offset="1" stopColor={BRAND} stopOpacity="0" />
      </SvgRadial>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={P.BG} />
    <Circle cx={width * 0.5} cy={height * 0.04} r={width * 0.8} fill="url(#glowTop)" />
  </Svg>
);

const SubscriptionScreen = ({ visible, onClose, track }) => {
  // App.js nests a SafeAreaProvider inside its padded root SafeAreaView, so on
  // iOS useSafeAreaInsets() reads 0 anywhere inside the app. This Modal covers
  // the whole window, so it needs the window's own insets — otherwise the logo
  // and × sit under the status bar and the footer under the home indicator.
  const contextInsets = useSafeAreaInsets();
  const insets = (Platform.OS === 'ios' && initialWindowMetrics?.insets) || contextInsets;
  const { packages, purchaseProduct, restorePurchases, localState } = useLocalState();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const isDark = theme === 'dark';
  const P = useMemo(() => makePalette(isDark), [isDark]);
  const s = useMemo(() => makeStyles(P), [P]);

  const closeDelay = paywallPlacement(track) === 'onboarding' ? CLOSE_DELAY_ONBOARDING : CLOSE_DELAY;

  // Callers pass inline arrows, so a fresh onClose arrives every render. The
  // async effects below must call the latest one without re-running for it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [offerings, setOfferings] = useState(null); // offerings.all; null while loading
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [canClose, setCanClose] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(28)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const closeFade = useRef(new Animated.Value(0)).current;

  // ── Offerings: fetched on open, the same guard as the old RevenueCatUI path ──
  // No billing (no Play account, emulator without Play) → skip the wall
  // entirely rather than show plans that can never be bought.
  useEffect(() => {
    if (!visible) return;
    setOfferings(null);
    let cancelled = false;
    (async () => {
      try {
        const canPay = await Purchases.canMakePayments().catch(() => false);
        if (!canPay) {
          if (!cancelled) onCloseRef.current?.();
          return;
        }
        const result = await Purchases.getOfferings();
        if (!cancelled) setOfferings(result?.all || {});
      } catch (e) {
        if (!cancelled) setOfferings({});
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // The wall's offering, else the current offering LocalGlobelStats loaded.
  const wallPackages = useMemo(() => {
    if (!offerings) return [];
    const own = offerings[OFFERING]?.availablePackages || [];
    return own.length ? own : (packages || []);
  }, [offerings, packages]);

  // ── Pricing: every plan measured against the priciest per-month rate ──
  // The anchor is what the same stretch of time would cost on the most
  // expensive plan (in practice, monthly). Comparing to it produces both the
  // savings percentage and the amount saved.
  const plans = useMemo(() => {
    const list = wallPackages.slice().sort(
      (a, b) => (PLAN_ORDER[planTypeOf(a)] ?? 9) - (PLAN_ORDER[planTypeOf(b)] ?? 9)
    );
    const monthlyRate = (p) => {
      const months = MONTHS_IN_PERIOD[planTypeOf(p)];
      const price = p.product?.price;
      return months && price > 0 ? price / months : null;
    };
    const rates = list.map(monthlyRate).filter(r => r != null);
    const anchorRate = rates.length ? Math.max(...rates) : null;

    return list.map(pkg => {
      const months = MONTHS_IN_PERIOD[planTypeOf(pkg)];
      const price = pkg.product?.price;
      const rate = monthlyRate(pkg);
      const anchorTotal = (anchorRate && months) ? anchorRate * months : null;

      // Only claim a saving when it is real and worth saying — anything under
      // 5% reads as a rounding artefact and cheapens the yearly plan's real cut.
      const pct = (anchorTotal && price > 0 && anchorTotal > price)
        ? Math.round((1 - price / anchorTotal) * 100)
        : 0;
      const savings = pct >= 5 ? pct : 0;
      const saved = savings ? anchorTotal - price : 0;

      // "Like 6 months free" — the money saved, in months of the anchor plan.
      // Floored on purpose: better to undersell than to round a claim up.
      const freeMonths = (savings && anchorRate) ? Math.floor(saved / anchorRate) : 0;

      return { pkg, rate, savings, saved, freeMonths };
    });
  }, [wallPackages]);

  // Best value = biggest real saving; ties go to the longest plan (list is sorted).
  const recommended = useMemo(() => {
    if (!plans.length) return null;
    return plans.reduce((best, p) => (p.savings > best.savings ? p : best), plans[0]).pkg;
  }, [plans]);

  const selectedPlan = useMemo(
    () => plans.find(p => p.pkg.identifier === selectedPkg?.identifier) || null,
    [plans, selectedPkg]
  );

  // ── Free trial, if the store ever offers one ──
  const getTrial = (pkg) => {
    const product = pkg?.product;
    const intro = product?.introPrice;
    if (intro && intro.price === 0 && intro.periodNumberOfUnits > 0) {
      return { count: intro.periodNumberOfUnits, unit: String(intro.periodUnit || '').toUpperCase() };
    }
    const freePhase = product?.defaultOption?.freePhase?.billingPeriod;
    if (freePhase && freePhase.value > 0) {
      return { count: freePhase.value, unit: String(freePhase.unit || '').toUpperCase() };
    }
    return null;
  };

  const trialLabel = (trial) => {
    if (!trial) return null;
    const key = { DAY: 'trial_days', WEEK: 'trial_weeks', MONTH: 'trial_months' }[trial.unit];
    return key ? t(`paywall.${key}`, { count: trial.count }) : null;
  };

  const trial = trialLabel(getTrial(selectedPkg));

  // ── Analytics: one view per open ──
  useEffect(() => {
    if (visible) trackPaywallView(track);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close once Pro arrives (purchase or restore) ──
  // Watching the state instead of checking it after `await purchaseProduct()`:
  // a callback would read localState from before the purchase and never close.
  // Someone who was already Pro when the wall opened is left alone.
  const proAtOpenRef = useRef(false);
  useEffect(() => {
    if (visible) proAtOpenRef.current = !!localState?.isPro;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (visible && localState?.isPro && !proAtOpenRef.current) onCloseRef.current?.();
  }, [visible, localState?.isPro]);

  // ── The × stays hidden for closeDelay seconds, then appears ──
  useEffect(() => {
    if (!visible) return;
    setCanClose(false);
    closeFade.setValue(0);
    const timer = setTimeout(() => {
      setCanClose(true);
      Animated.timing(closeFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }, closeDelay * 1000);
    return () => clearTimeout(timer);
  }, [visible, closeDelay, closeFade]);

  // ── Android system nav bar: match the wall, restore the app on exit ──
  // The restore repeats App.js's own two calls, so leaving the wall puts the
  // bar back exactly as the app had it.
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    SystemNavigationBar.setNavigationColor(P.BG, P.NAV_STYLE, 'navigation');
    return () => {
      SystemNavigationBar.setNavigationColor(isDark ? '#000000' : '#FFFFFF', !isDark);
      SystemNavigationBar.setBarMode(isDark ? 'dark' : 'light');
    };
  }, [visible, isDark, P.BG, P.NAV_STYLE]);

  // ── Entrance ──
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    riseAnim.setValue(28);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, fadeAnim, riseAnim]);

  // ── CTA breathing ──
  useEffect(() => {
    if (!visible) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim]);

  // Preselect the best-value plan — again if a fresh load replaces the list
  // the current pick came from.
  useEffect(() => {
    if (!visible || !recommended) return;
    if (!selectedPkg || !plans.some(p => p.pkg.identifier === selectedPkg.identifier)) {
      setSelectedPkg(recommended);
    }
  }, [visible, recommended, selectedPkg, plans]);

  // Reset on close
  useEffect(() => {
    if (!visible) {
      setSelectedPkg(null);
      setLoading(false);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    trackPaywallClose(track);
    onCloseRef.current?.();
  }, [track]);

  const handleSelect = useCallback((pkg) => {
    triggerHapticFeedback('impactLight');
    setSelectedPkg(pkg);
  }, [triggerHapticFeedback]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    triggerHapticFeedback('impactMedium');
    // The Play sheet backgrounds the app; coming back must not open an ad.
    AppOpenAdManager.skipNextForeground();
    // Success flips localState.isPro, and the effect above closes the wall.
    // purchaseProduct logs pro_purchase with `track`.
    await purchaseProduct(selectedPkg, setLoading, track);
  }, [selectedPkg, loading, purchaseProduct, track, triggerHapticFeedback]);

  // restorePurchases() swallows its result, so ask RevenueCat afterwards: a
  // Restore tap that silently does nothing reads as a broken button.
  const handleRestore = useCallback(async () => {
    if (restoring) return;
    await restorePurchases(setRestoring);
    try {
      const info = await Purchases.getCustomerInfo();
      const active = info?.entitlements?.active || {};
      const hasPro = Object.keys(active).some(k => k.toLowerCase() === 'pro');
      if (!hasPro) Alert.alert(t('paywall.restore_none_title'), t('paywall.restore_none'));
    } catch (e) {
      Alert.alert(t('paywall.restore_none_title'), t('paywall.restore_none'));
    }
  }, [restoring, restorePurchases, t]);

  // ── The button says "Continue", like every onboarding step before it. ──
  // It never repeats the price: the selected tile shows it, and the line under
  // the button states exactly what gets charged — including any free trial.
  const ctaLabel = t('paywall.cta');

  const ctaSubtitle = (() => {
    if (!selectedPkg) return null;
    const price = trimZeroDecimals(selectedPkg.product?.priceString);
    if (!price) return null;
    const type = planTypeOf(selectedPkg);
    if (type === 'LIFETIME') return t('paywall.cta_sub_lifetime', { price });
    const billedKey = BILLED_KEY[type];
    const billed = billedKey ? t(`paywall.${billedKey}`) : '';
    if (trial) return t('paywall.cta_sub_trial', { trial, price, billed });
    return t('paywall.cta_sub', { price, billed });
  })();

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? handleClose : undefined}>
      <View style={s.container}>
        <StatusBar barStyle={P.STATUS_STYLE} />
        <Backdrop P={P} />

        {/* ══ TOP: what you get ══ */}
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + 18 }]}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: riseAnim }] }}>
            <View style={s.hero}>
              <Image resizeMethod="resize" source={LOGO} style={s.logo} resizeMode="contain" />
              <Text style={s.title}>{t('paywall.title')}</Text>
              <Text style={s.subtitle}>{t('paywall.subtitle')}</Text>
            </View>

            {/* ── One card, three promises, no scrolling to find them ── */}
            <View style={s.card}>
              {BENEFITS.map((b, i) => (
                <View key={b.key} style={[s.benefit, i > 0 && s.benefitDivider]}>
                  <View style={[s.benefitIcon, { backgroundColor: tint(b.tint, 0.15) }]}>
                    {b.image
                      ? <Image resizeMethod="resize" source={b.image} style={s.benefitBadge} resizeMode="contain" />
                      : <Icon name={b.icon} size={19} color={b.tint} />}
                  </View>
                  <View style={s.benefitText}>
                    <Text style={s.benefitTitle}>{t(`paywall.${b.key}_title`)}</Text>
                    <Text style={s.benefitDesc}>{t(`paywall.${b.key}_desc`)}</Text>
                  </View>
                </View>
              ))}

              <View style={s.extrasRow}>
                <Icon name="add-circle" size={13} color={P.TEXT_MUTE} />
                <Text style={s.extras} numberOfLines={2}>
                  {[t('paywall.extra_translate'), t('paywall.extra_support')].join(' · ')}
                </Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* ── Close — pinned, never scrolls away; absent until the delay ends ── */}
        {canClose && (
          <View style={[s.closeWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
            <Animated.View style={{ opacity: closeFade }}>
              <TouchableOpacity
                onPress={handleClose}
                style={s.closeBtn}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              >
                <Icon name="close" size={19} color={P.CLOSE_ICON} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        {/* ══ BOTTOM: the offers, side by side, then one button ══ */}
        <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
          {plans.length > 0 ? (
            <>
              <View style={s.tiles}>
                {plans.map(({ pkg, rate, savings }, i) => {
                  const isSelected = selectedPkg?.identifier === pkg.identifier;
                  // A lone plan is not a "deal" against anything.
                  const isBest = plans.length > 1 && recommended?.identifier === pkg.identifier;
                  const type = planTypeOf(pkg);
                  const planKey = PLAN_KEY[type];
                  const showPerMonth = rate != null && type !== 'MONTHLY' && type !== 'LIFETIME';
                  return (
                    <TouchableOpacity
                      key={pkg.identifier || i}
                      onPress={() => handleSelect(pkg)}
                      activeOpacity={0.9}
                      style={[s.tile, isSelected && s.tileOn]}
                    >
                      {savings > 0 && (
                        <View style={s.saveTag}>
                          <Text style={s.saveTagText}>{t('paywall.save', { percent: savings })}</Text>
                        </View>
                      )}

                      {isBest && <Text style={s.bestLabel}>{t('paywall.best_deal')}</Text>}

                      <Text style={[s.tilePlan, isSelected && s.tilePlanOn]} numberOfLines={1}>
                        {planKey ? t(`paywall.${planKey}`) : (pkg.identifier || t('paywall.plan_default'))}
                      </Text>

                      <Text
                        style={[s.tilePrice, isSelected && s.tilePriceOn]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                      >
                        {trimZeroDecimals(pkg.product?.priceString) || '—'}
                      </Text>

                      {/* Reserved line so all tiles stay the same height */}
                      <Text
                        style={[s.tilePerMonth, isSelected && s.tilePerMonthOn]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {showPerMonth ? t('paywall.per_month', { price: formatMoney(pkg, rate) }) : ' '}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* The saving, said the way someone repeats it out loud */}
              {!!selectedPlan && selectedPlan.savings > 0 && (
                <View style={s.savingsBar}>
                  <Text style={s.savingsText} numberOfLines={1}>
                    {t('paywall.you_save', { amount: formatMoney(selectedPlan.pkg, selectedPlan.saved) })}
                    {selectedPlan.freeMonths >= 1
                      ? '  ·  ' + t('paywall.free_months', { count: selectedPlan.freeMonths })
                      : ''}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={s.loadingWrap}>
              {offerings === null ? (
                <>
                  <ActivityIndicator size="small" color={BRAND} />
                  <Text style={s.loadingText}>{t('paywall.loading')}</Text>
                </>
              ) : (
                <Text style={s.loadingText}>{t('paywall.unavailable')}</Text>
              )}
            </View>
          )}

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[s.cta, (loading || !selectedPkg) && s.ctaOff]}
              onPress={handlePurchase}
              disabled={loading || !selectedPkg}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={s.ctaInner}>
                  <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {ctaLabel}
                  </Text>
                  <Icon name="arrow-forward" size={19} color="#FFFFFF" style={[s.ctaArrow, flipInRTL]} />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2}>{ctaSubtitle}</Text>}

          <View style={s.footer}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring} hitSlop={FOOTER_SLOP}>
              {restoring
                ? <ActivityIndicator size="small" color={BRAND} />
                : <Text style={s.footerLink}>{t('paywall.restore')}</Text>}
            </TouchableOpacity>
            <Text style={s.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} hitSlop={FOOTER_SLOP}>
              <Text style={s.footerLink}>{t('paywall.terms')}</Text>
            </TouchableOpacity>
            <Text style={s.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={FOOTER_SLOP}>
              <Text style={s.footerLink}>{t('paywall.privacy')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Styles ──
// insets.bottom is what actually clears the Android 3-button nav bar (~48dp);
// a fixed constant alone leaves the buy button half-covered there.
const DOCK_PAD = 10;
const FOOTER_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

// Rebuilt whenever the theme flips; memoised by the component. Lato only ships
// Regular and Bold, so every weight is one or the other — never a fontWeight
// that Android would fake on top of the family.
const makeStyles = (P) => StyleSheet.create({
  container: { flex: 1, backgroundColor: P.BG },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 10 },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: SMALL ? 12 : 16,
  },
  logo: {
    width: SMALL ? 88 : 104,
    height: SMALL ? 88 : 104,
    borderRadius: 18,
  },
  title: {
    color: P.TEXT,
    fontSize: SMALL ? 26 : 28,
    fontFamily: FONT_BOLD,
    letterSpacing: -0.5,
    marginTop: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: P.TEXT_SUB,
    fontSize: 13.5,
    fontFamily: FONT_REGULAR,
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },

  // ── Benefits card ──
  card: {
    marginHorizontal: 18,
    backgroundColor: P.CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: P.CARD_LINE,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  benefitDivider: {
    borderTopWidth: 1,
    borderTopColor: P.DIVIDER,
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  benefitBadge: { width: 23, height: 23 },
  benefitText: { flex: 1 },
  benefitTitle: {
    color: P.TEXT,
    fontSize: 15,
    fontFamily: FONT_BOLD,
    letterSpacing: -0.2,
  },
  benefitDesc: {
    color: P.TEXT_SUB,
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    lineHeight: 16,
    marginTop: 2,
  },
  extrasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: P.DIVIDER,
    paddingVertical: 9,
  },
  extras: {
    flex: 1,
    color: P.TEXT_MUTE,
    fontSize: 11.5,
    fontFamily: FONT_REGULAR,
    lineHeight: 16,
  },

  // ── Close ──
  closeWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    elevation: 10, // Android: keep the tap target above the ScrollView
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: P.CLOSE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ══ Dock ══
  dock: {
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: P.DOCK_LINE,
    backgroundColor: P.DOCK_BG,
  },

  // ── Offers, side by side ──
  tiles: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 7, // headroom for the SAVE tag sitting on the border
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: P.CARD_LINE,
    backgroundColor: P.CARD,
    paddingTop: 13,
    paddingBottom: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  // No elevation: a translucent fill with an Android shadow shows the shadow
  // through as a dark box. The brand border carries the selection.
  tileOn: {
    borderColor: BRAND,
    backgroundColor: P.TILE_ON,
  },
  saveTag: {
    position: 'absolute',
    top: -9,
    alignSelf: 'center',
    backgroundColor: BRAND,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  saveTagText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.3,
  },
  bestLabel: {
    color: P.BRAND_TEXT,
    fontSize: 8.5,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  tilePlan: {
    color: P.TEXT_SUB,
    fontSize: 11.5,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.2,
  },
  tilePlanOn: { color: P.TEXT },
  tilePrice: {
    color: P.TEXT,
    fontSize: 21,
    fontFamily: FONT_BOLD,
    letterSpacing: -0.5,
    marginTop: 3,
  },
  tilePriceOn: { color: P.BRAND_TEXT },
  tilePerMonth: {
    color: P.TEXT_MUTE,
    fontSize: 10.5,
    fontFamily: FONT_BOLD,
    marginTop: 2,
  },
  tilePerMonthOn: { color: P.TEXT_SUB },

  // ── Savings line ──
  savingsBar: {
    marginTop: 9,
    alignSelf: 'center',
    backgroundColor: P.TILE_ON,
    borderWidth: 1,
    borderColor: P.SAVINGS_LINE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  savingsText: {
    color: P.BRAND_TEXT,
    fontSize: 12,
    fontFamily: FONT_BOLD,
    textAlign: 'center',
  },

  // ── Loading / unavailable ──
  loadingWrap: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 12 },
  loadingText: { color: P.TEXT_MUTE, fontSize: 12, fontFamily: FONT_REGULAR, marginTop: 8, textAlign: 'center' },

  // ── CTA: onboarding's Continue button, a little taller ──
  cta: {
    height: 54,
    borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 11,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: FONT_BOLD,
    flexShrink: 1,
  },
  ctaArrow: { marginLeft: 8 },
  ctaSub: {
    color: P.TEXT_MUTE,
    fontSize: 11.5,
    fontFamily: FONT_REGULAR,
    textAlign: 'center',
    marginTop: 9,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
    gap: 8,
    flexWrap: 'wrap',
  },
  footerLink: {
    color: P.FOOTER,
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    textDecorationLine: 'underline',
  },
  footerDot: { color: P.FOOTER_DOT, fontSize: 11 },
});

export default SubscriptionScreen;
