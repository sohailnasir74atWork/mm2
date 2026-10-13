// rtl.js — small helpers for right-to-left (Arabic) layouts.
//
// i18n.js sets I18nManager.forceRTL from the in-app language and reloads the
// app when the direction changes, so I18nManager.isRTL is fixed for the life
// of a JS run and can be read once here.
//
// Flexbox, margins, padding and absolute left/right already mirror on their
// own. What does not: icons that point a direction (back arrows, chevrons,
// "go" arrows) and translateX offsets. Use these for those.
import { I18nManager } from 'react-native';

export const isRTL = I18nManager.isRTL;

// Style for a directional icon: mirrors it in RTL so "forward" points left.
export const flipInRTL = isRTL ? { transform: [{ scaleX: -1 }] } : null;

// Horizontal offset for translateX: RN does not mirror transforms.
export const rtlX = (x) => (isRTL ? -x : x);
