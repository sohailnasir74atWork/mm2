/**
 * ScreenBottomBanner — the bottom of a full-screen page (a root-stack screen,
 * no tab bar under it): the banner ad, then a spacer as tall as the system
 * navigation bar, painted in the page's colour. Port of Adopt Me's.
 *
 * Android draws every screen edge-to-edge (targetSdk 36), so without this the
 * page runs under the nav buttons. A banner placed last WITHOUT the spacer sat
 * half behind the bar (Trade Match showed only the "Test Ad" label). Padding
 * only the end of the scroll content clears the LAST row, but every row still
 * scrolls behind the buttons on the way there. Place it as the page's last
 * child, after the flex:1 list, and drop insets.bottom from the list's own
 * padding.
 *
 * iOS: the root SafeAreaView in App.js already pads the home indicator and
 * insets read 0 inside it, so the spacer is 0 there.
 *
 * Tab screens don't need it: the tab bar already sits above the nav bar.
 *
 * `ad={false}` gives the spacer only (pages without a banner).
 * BannerAdComponent hides itself for Pro; the isPro check here just skips
 * mounting it at all.
 */

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BannerAdComponent from './bannerAds';
import { useLocalState } from '../LocalGlobelStats';

const ScreenBottomBanner = (props) => {
  const { background, collapsible } = props;
  const ad = props.ad !== false;
  const insets = useSafeAreaInsets();
  const { localState } = useLocalState();
  return (
    <>
      {ad && !localState?.isPro && <BannerAdComponent collapsible={!!collapsible} />}
      <View style={{ height: insets.bottom, backgroundColor: background }} />
    </>
  );
};

export default ScreenBottomBanner;
