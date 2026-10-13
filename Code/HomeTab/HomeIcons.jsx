import React, { memo } from 'react';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';

// Original 32-unit drawings. No bitmap assets, downloads or extra icon font.
const drawings = {
  values: <>
    <Path d="M5 8h12l9 9-9 9L5 14Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="M5 8h12l9 9-9 9L5 14Z" />
    <Circle cx="10" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <Path d="m14 16 2-2m1 5 3-3" />
    <Path d="m20 5 7 7" opacity={0.5} />
  </>,
  inventory: <>
    <Rect x="5" y="11" width="22" height="16" rx="3" fill="currentColor" fillOpacity={0.12} />
    <Rect x="5" y="11" width="22" height="16" rx="3" />
    <Path d="M11 11V8a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v3M5 17h22m-13-2v5h4v-5" />
  </>,
  friends: <>
    <Circle cx="12" cy="11" r="4" fill="currentColor" fillOpacity={0.12} />
    <Circle cx="12" cy="11" r="4" />
    <Path d="M4 26v-3a8 8 0 0 1 16 0v3M23 7a4 4 0 0 1 0 8m2 4a7 7 0 0 1 3 6" />
  </>,
  star: <>
    <Path d="m16 4 4 8 9 1-6.5 6 1.5 9-8-4-8 4 1.5-9L3 13l9-1Z" fill="currentColor" fillOpacity={0.13} />
    <Path d="m16 4 4 8 9 1-6.5 6 1.5 9-8-4-8 4 1.5-9L3 13l9-1Z" />
  </>,
  trophy: <>
    <Path d="M10 5h12v9a6 6 0 0 1-12 0Z" fill="currentColor" fillOpacity={0.14} />
    <Path d="M10 5h12v9a6 6 0 0 1-12 0ZM10 8H5v3a5 5 0 0 0 5 5m12-8h5v3a5 5 0 0 1-5 5m-6 4v6m-5 2h10" />
  </>,
  shield: <>
    <Path d="m16 3 11 4v9c0 6-7 11-11 13C12 27 5 22 5 16V7Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="m16 3 11 4v9c0 6-7 11-11 13C12 27 5 22 5 16V7Z" />
    <Path d="m11 16 3 3 7-7" />
  </>,
  egg: <>
    <Path d="M26 20c0 6-4 9-10 9S6 26 6 20 11 3 16 3s10 11 10 17Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="M26 20c0 6-4 9-10 9S6 26 6 20 11 3 16 3s10 11 10 17Z" />
    <Path d="m7 19 5-3 4 4 4-4 5 3" opacity={0.6} />
  </>,
  cosmetics: <>
    <Path d="m10 5 6 4 6-4 7 7-5 5-2-2v13H10V15l-2 2-5-5Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="m10 5 6 4 6-4 7 7-5 5-2-2v13H10V15l-2 2-5-5Z" />
    <Path d="m16 15 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" />
  </>,
  settings: <>
    <Circle cx="16" cy="16" r="8" fill="currentColor" fillOpacity={0.12} />
    <Circle cx="16" cy="16" r="8" />
    <Circle cx="16" cy="16" r="3" />
    <Path d="M16 4v4m0 16v4M4 16h4m16 0h4M7.5 7.5l2.8 2.8m11.4 11.4 2.8 2.8M7.5 24.5l2.8-2.8m11.4-11.4 2.8-2.8" strokeWidth={3} />
  </>,
  cake: <>
    <Rect x="5" y="15" width="22" height="12" rx="3" fill="currentColor" fillOpacity={0.12} />
    <Rect x="5" y="15" width="22" height="12" rx="3" />
    <Path d="M5 20c3 2 5-2 8 0s5 2 8 0 4-2 6 0M11 15v-4m5 4v-4m5 4v-4" />
    <Path d="M11 6.5c0 1-1 1.5-1 2.5a1 1 0 0 0 2 0c0-1-1-1.5-1-2.5Zm5 0c0 1-1 1.5-1 2.5a1 1 0 0 0 2 0c0-1-1-1.5-1-2.5Zm5 0c0 1-1 1.5-1 2.5a1 1 0 0 0 2 0c0-1-1-1.5-1-2.5Z" fill="currentColor" fillOpacity={0.5} />
  </>,
  news: <>
    <Rect x="5" y="6" width="19" height="21" rx="3" fill="currentColor" fillOpacity={0.12} />
    <Path d="M24 11h3v13a3 3 0 0 1-6 0V9a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v15a3 3 0 0 0 3 3h16" />
    <Rect x="9" y="10" width="6" height="5" rx="1" />
    <Path d="M9 19h8m-8 3.5h8" />
  </>,
  report: <>
    <Path d="M6 5h20a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H13l-6 5v-5H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="M6 5h20a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H13l-6 5v-5H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    <Path d="M16 10v5" strokeWidth={2.4} />
    <Circle cx="16" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
  </>,
  inbox: <>
    <Path d="M4 18 8 7h16l4 11v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" fill="currentColor" fillOpacity={0.12} />
    <Path d="M4 18 8 7h16l4 11v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm0 0h7l2 3h6l2-3h7" />
  </>,
  // Trade Match: two players' items swapping, with the dream star between.
  match: <>
    <Circle cx="16" cy="16" r="5" fill="currentColor" fillOpacity={0.12} />
    <Path d="M4 9h20m0 0-4-4m4 4-4 4M28 23H8m0 0 4-4m-4 4 4 4" />
    <Path d="m16 13 .9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3Z" fill="currentColor" stroke="none" opacity={0.8} />
  </>,
};

function HomeIcon({ name, size = 24, color = '#6A5ACD' }) {
  return <Svg width={size} height={size} viewBox="0 0 32 32" color={color} accessible={false}>
    <G fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {drawings[name] || drawings.values}
    </G>
  </Svg>;
}
export default memo(HomeIcon);
