import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { useLocalState } from '../LocalGlobelStats';

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
  // OPT-IN per screen (matches Blox Fruit / adoptme): pass `collapsible` on
  // bottom-anchored MAIN screens only. Keep it OFF (default) on chat screens
  // whose input bar sits directly above the banner, and NEVER render a banner
  // inside the arrow game at all.
  collapsible = false,
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
}) => {
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState } = useLocalState();
  const unitId = getAdUnitId(adType);

  // No-fill retry: a banner's FIRST load can fail (no fill / transient
  // network). The <BannerAd> won't re-request on its own until something
  // forces a remount, so the slot would stay blank for the whole screen
  // visit — a silently lost impression on every such screen. We bump
  // reloadKey (used as the BannerAd `key`) after a delay to force one fresh
  // request. Once an ad has loaded, the SDK's own auto-refresh takes over and
  // we stop interfering, so we never remount a working banner.
  const [reloadKey, setReloadKey] = useState(0);
  const hasEverLoaded = useRef(false);
  const retryTimer = useRef(null);

  const handleAdLoaded = useCallback(() => {
    hasEverLoaded.current = true;
    setIsAdLoaded(true);
  }, []);

  const handleAdFailedToLoad = useCallback(() => {
    setIsAdLoaded(false);
    // Only nudge the first-ever load; let the SDK own refresh failures.
    if (hasEverLoaded.current || retryTimer.current) return;
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
  // networkExtras.collapsible enables Google's Collapsible Banner format:
  // the first impression renders as a larger expanded ad that the user
  // can collapse to a small inline strip. Higher eCPM (~2-3× a static
  // banner). The SDK only treats the FIRST request as collapsible per
  // session; auto-refreshes downgrade back to standard banners.
  //
  // 2026-07-20 (owner decision): the "Encouraging accidental clicks: Layout"
  // enforcement traced to the banner INSIDE the arrow game (removed there
  // entirely), not to the collapsible format itself. The old blanket
  // Android force-off is replaced by per-screen opt-in on both platforms —
  // main screens pass `collapsible`; chat screens don't.
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
      ...(collapsible ? { networkExtras: { collapsible: 'bottom' } } : {}),
    }),
    [localState?.consentStatus, collapsible],
  );

  // Every reason this slot renders nothing at all: Pro users and an explicitly
  // hidden slot. Computed (not early-returned) so the onHeightChange effects
  // below still run and tell the screen to collapse its reserved space — an
  // early return would leave a stale `true` behind.
  // What the ad actually rendered as. The collapsed wrapper measures 0, so
  // this is 0 until an ad loads and exactly the ad's height afterwards.
  const [measuredHeight, setMeasuredHeight] = useState(0);

  const suppressed = !!localState?.isPro || !visible;
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
    <View
      style={containerStyle}
      onLayout={(e) => setMeasuredHeight(e.nativeEvent.layout.height)}
    >
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
      />
    </View>
  );
};

export default BannerAdComponent;
