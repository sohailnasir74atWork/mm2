import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { useLocalState } from '../LocalGlobelStats';
import { useAdsReady } from './adsGate';
import { logAdRevenue } from './adTelemetry';

// NPA gating: only force non-personalized ads when we truly have to.
// Forcing NPA on every user (the old behaviour) cut eCPM ~40-60% for ~80%
// of traffic that's outside the EEA and would happily take personalized
// ads. Decision rules:
//   * NOT_REQUIRED → user is outside the EEA; personalized ads are fine.
//   * OBTAINED     → consent form completed in the EEA; the SDK already
//                    reads the IAB TCF v2 string and serves the right
//                    flavour automatically — we must NOT override it.
//   * REQUIRED / UNKNOWN → form not completed; default to NPA so we stay
//                    compliant until the user makes a choice.
const npaRequiredFor = (status) =>
  status !== 'OBTAINED' && status !== 'NOT_REQUIRED';

const BannerAdComponent = ({
  adType = 'banner',
  visible = true,
  // Called with the banner's MEASURED height in dp whenever it changes, and
  // with 0 whenever nothing is on screen (no-fill, Pro member, hidden slot,
  // unmount). The banner is absolutely positioned, so screens reserve its
  // space with a spacer View of their own; reporting the real height means
  // that spacer is always exactly right.
  //
  // A constant will not do here. ANCHORED_ADAPTIVE_BANNER resolves to
  // AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize() natively, so
  // the SDK picks the height per device at runtime — a fixed guess
  // under-reserves on tall phones (content ends up behind the ad) and
  // over-reserves on short ones (the dead gap comes back).
  onHeightChange,
  // Collapsible banner, Android only: pass it on main screens, never on chat
  // screens (their input bar sits right above the banner, and the expanded
  // first impression would cover it). See requestOptions below.
  collapsible = false,
}) => {
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState } = useLocalState();
  const unitId = getAdUnitId(adType);

  // No-fill retry: a banner's FIRST load can fail (no fill / transient
  // network). The <BannerAd> won't re-request on its own until something
  // forces a remount, so the slot would stay blank for the whole screen
  // visit — a silently lost impression on every such screen. We bump
  // reloadKey (used as the BannerAd `key`) after a delay to force exactly
  // ONE fresh request. Once an ad has loaded, the SDK's own auto-refresh takes
  // over and we stop interfering, so we never remount a working banner.
  //
  // Exactly one: the timer ref is nulled when it fires and hasEverLoaded
  // stays false after a second no-fill, so without `retriedOnce` the retry
  // re-armed every 30s for as long as the banner was mounted — an unbounded
  // request loop per slot in no-fill geos (the same answer every time).
  const [reloadKey, setReloadKey] = useState(0);
  const hasEverLoaded = useRef(false);
  const retriedOnce = useRef(false);
  const retryTimer = useRef(null);

  const handleAdLoaded = useCallback(() => {
    hasEverLoaded.current = true;
    setIsAdLoaded(true);
  }, []);

  const handleAdFailedToLoad = useCallback(() => {
    setIsAdLoaded(false);
    // Only nudge the first-ever load, and only once; let the SDK own refresh
    // failures.
    if (hasEverLoaded.current || retriedOnce.current || retryTimer.current) return;
    retriedOnce.current = true;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setReloadKey((k) => k + 1);
    }, 30000);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Stable request options — recomputed only when consent flips so the
  // BannerAd component below doesn't see a new object reference on every
  // render (which would otherwise force a fresh ad request).
  //
  // Collapsible banners are back on Android main screens (owner decision,
  // 2026-10-07). Removing them on 2026-09-27 (shipped in 1.5.0) cut what an
  // Android banner earned by more than half (AdMob, same days, 1.4.5 vs 1.5.0:
  // US $0.99 → $0.42 eCPM). The first request of a session expands over the
  // content above the banner until the user collapses it; refreshes are
  // ordinary banners. iOS banners earned the same without it, so iOS stays a
  // plain strip.
  const isCollapsible = collapsible && Platform.OS === 'android';
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
      ...(isCollapsible ? { networkExtras: { collapsible: 'bottom' } } : {}),
    }),
    [localState?.consentStatus, isCollapsible],
  );

  // Every reason this slot renders nothing at all: Pro users and an explicitly
  // hidden slot. Computed (not early-returned) so the onHeightChange effects
  // below still run and tell the screen to collapse its reserved space — an
  // early return would leave a stale `true` behind.
  // What the ad actually rendered as. The collapsed wrapper measures 0, so
  // this is 0 until an ad loads and exactly the ad's height afterwards.
  const [measuredHeight, setMeasuredHeight] = useState(0);

  // Not before consent + SDK init (adsGate.js). Mounting a BannerAd creates
  // the ad WebView on the UI thread, so doing it during Home's first render
  // also cost the first frame on low-end Android.
  const adsReady = useAdsReady();
  const handlePaid = useCallback(
    (paid) => logAdRevenue('banner', isCollapsible ? 'banner_collapsible' : 'banner', paid, unitId),
    [isCollapsible, unitId],
  );
  const suppressed = !!localState?.isPro || !visible || !adsReady;
  const showingAd = !suppressed && isAdLoaded;

  // Hold the callback in a ref so an inline arrow from the parent can't make
  // the reporting effect re-fire on every render.
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    onHeightChangeRef.current?.(showingAd ? measuredHeight : 0);
  }, [showingAd, measuredHeight]);

  // Banner going away entirely (screen unmounted) — reclaim the space.
  useEffect(() => () => onHeightChangeRef.current?.(0), []);

  if (suppressed) return null;

  // The BannerAd is mounted ONCE and never unmounted while visible. The
  // old code conditionally re-rendered a *different* BannerAd once
  // isAdLoaded flipped — React unmounted the loaded ad and started a
  // fresh request, so roughly half of every banner's load never became
  // an impression. Now we just toggle the wrapper's layout: zero-height
  // while loading (so it reserves no space and doesn't flash an empty
  // box), full-height with the layout container once loaded.
  const containerStyle = isAdLoaded
    ? { alignItems: 'center', justifyContent: 'center' }
    : { height: 0, overflow: 'hidden' };

  return (
    // collapsable={false}: keeps this wrapper a real view under Fabric (the
    // addViewAt IndexOutOfBounds crash fixed in Adopt Me 04aa038 / Blox 2b9ab6e).
    <View
      collapsable={false}
      style={containerStyle}
      onLayout={(e) => setMeasuredHeight(e.nativeEvent.layout.height)}
    >
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        // Fixed 320x50 on every screen (owner decision 2026-09-27). Adaptive
        // banners change height per device and read as the banner
        // "stretching"; a standard banner is the same small strip everywhere.
        // (The collapsible format, see requestOptions, expands on its own.)
        size={BannerAdSize.BANNER}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
        onPaid={handlePaid}
      />
    </View>
  );
};

export default BannerAdComponent;
