// themeColors.js — Centralized theme color system for MM2 Values
// Sober palette: steel-blue / graphite dark, warm neutral light
// Usage: const c = useThemeColors();  then use c.bg, c.text, etc.
// Or:    const c = getThemeColors(isDark);

import { useGlobalState } from '../GlobelStats';
import { useMemo } from 'react';
import config from './Environment';

/* ───────────────────────────────────────────
   DARK  PALETTE — Cool graphite / steel-blue
   ─────────────────────────────────────────── */
const darkPalette = {
  // Backgrounds — aligned with config.colors ocean-blue theme
  bg: config.colors.backgroundDark,          // '#040d1a' Deep ocean midnight blue
  bgAlt: config.colors.surfaceDark,          // '#071629' Dark navy card surface
  bgElevated: config.colors.surfaceElevatedDark, // '#0d2137' Elevated deep blue
  bgAccent: 'rgba(106,90,205,0.08)', // Subtle primary accent areas

  // Text
  text: '#e8ecf1',            // Primary text (warm off-white)
  textSecondary: '#8a95a5',   // Muted text, timestamps
  textMuted: '#5a6575',       // Placeholder, disabled
  textInverse: '#111518',     // Text on light backgrounds

  // Borders & Dividers
  border: config.colors.borderDark,     // Deep navy border
  borderLight: 'rgba(255,255,255,0.06)', // Subtle borders
  borderAccent: '#3a4555',    // Emphasized borders
  divider: config.colors.dividerDark,

  // Interactive / Cards
  cardBg: config.colors.surfaceDark,
  cardBorder: config.colors.borderDark,
  inputBg: config.colors.surfaceDark,
  inputBorder: config.colors.borderDark,
  inputText: config.colors.textDark,
  placeholder: config.colors.placeholderDark,

  // Status bar
  statusBar: 'light-content',
  statusBarBg: config.colors.backgroundDark,

  // Close / overlay
  overlay: 'rgba(0,0,0,0.65)',
  closeBg: 'rgba(255,255,255,0.08)',
  closeIcon: 'rgba(255,255,255,0.65)',

  // Badges & Tags
  tagBg: 'rgba(255,255,255,0.07)',
  tagText: '#8a95a5',
  proBg: '#1a1530',
  proBorder: '#3b2e6e',
  proText: '#FFD93D',

  // Footer / Links
  footerLink: 'rgba(255,255,255,0.32)',
  footerMuted: 'rgba(255,255,255,0.18)',
  footerDot: 'rgba(255,255,255,0.12)',

  // System navigation
  navBarBg: config.colors.backgroundDark,
  navBarStyle: 'light',

  // Shadows
  shadow: '#000',
  shadowOpacity: 0.35,

  // ── Feature-specific tokens ──

  // Games & engagement surfaces
  gameBg: config.colors.backgroundDark,
  gameCard: config.colors.surfaceDark,
  gameCardBorder: config.colors.borderDark,
  gameHighlight: 'rgba(106,90,205,0.15)',

  // XP / Progress
  xpBarBg: config.colors.surfaceDark,
  xpBarFill: config.colors.primary, // Uses brand primary
  xpBarText: '#e8ecf1',

  // Streak / Rewards
  rewardGold: '#D4A44C',      // Sober gold (not bright yellow)
  rewardSilver: '#9AADBD',    // Cool silver
  rewardBronze: '#B08D6F',    // Warm bronze
  starActive: '#D4A44C',
  starInactive: config.colors.borderDark,

  // Success / Error / Warning — from config
  success: config.colors.success,
  error: config.colors.error,
  warning: config.colors.warning,
  info: config.colors.info,

  // Accent from brand
  primary: config.colors.primary,
  primaryMuted: 'rgba(106,90,205,0.2)',
  secondary: config.colors.secondary,
  accent: config.colors.accent,
};

/* ───────────────────────────────────────────
   LIGHT PALETTE — Warm neutral / clean white
   ─────────────────────────────────────────── */
const lightPalette = {
  // Backgrounds
  bg: '#f4f5f7',              // Soft warm gray — main screen
  bgAlt: '#ffffff',           // Cards, sections, inputs
  bgElevated: '#ffffff',      // Modals, drawers, popovers
  bgAccent: 'rgba(106,90,205,0.04)', // Subtle primary accent areas

  // Text
  text: '#1c1e21',            // True dark (not pure black, easier on eyes)
  textSecondary: '#65707e',   // Muted text, timestamps
  textMuted: '#9aa4b0',       // Placeholder, disabled
  textInverse: '#ffffff',     // Text on dark backgrounds

  // Borders & Dividers
  border: '#dfe2e6',          // Standard border
  borderLight: 'rgba(0,0,0,0.05)', // Subtle borders
  borderAccent: '#c8cdd4',    // Emphasized borders
  divider: 'rgba(0,0,0,0.06)',

  // Interactive / Cards
  cardBg: '#ffffff',
  cardBorder: 'rgba(0,0,0,0.07)',
  inputBg: '#f0f2f4',
  inputBorder: '#dfe2e6',
  inputText: '#1c1e21',
  placeholder: '#9aa4b0',

  // Status bar
  statusBar: 'dark-content',
  statusBarBg: '#f4f5f7',

  // Close / overlay
  overlay: 'rgba(0,0,0,0.4)',
  closeBg: 'rgba(0,0,0,0.05)',
  closeIcon: 'rgba(0,0,0,0.45)',

  // Badges & Tags
  tagBg: 'rgba(0,0,0,0.04)',
  tagText: '#65707e',
  proBg: '#fef9eb',
  proBorder: '#e8c84a',
  proText: '#7a5c10',

  // Footer / Links
  footerLink: 'rgba(0,0,0,0.32)',
  footerMuted: 'rgba(0,0,0,0.18)',
  footerDot: 'rgba(0,0,0,0.10)',

  // System navigation
  navBarBg: '#ffffff',
  navBarStyle: 'dark',

  // Shadows
  shadow: '#000',
  shadowOpacity: 0.06,

  // ── Feature-specific tokens ──

  // Games & engagement surfaces
  gameBg: '#f0f2f4',
  gameCard: '#ffffff',
  gameCardBorder: '#dfe2e6',
  gameHighlight: 'rgba(106,90,205,0.08)',

  // XP / Progress
  xpBarBg: '#e8eaee',
  xpBarFill: config.colors.primary,
  xpBarText: '#1c1e21',

  // Streak / Rewards
  rewardGold: '#C49530',
  rewardSilver: '#7A8B98',
  rewardBronze: '#9A7755',
  starActive: '#C49530',
  starInactive: '#dfe2e6',

  // Success / Error / Warning — from config
  success: config.colors.success,
  error: config.colors.error,
  warning: config.colors.warning,
  info: config.colors.info,

  // Accent from brand
  primary: config.colors.primary,
  primaryMuted: 'rgba(106,90,205,0.1)',
  secondary: config.colors.secondary,
  accent: config.colors.accent,
};

/* ───────────────────
   PUBLIC  API
   ─────────────────── */

/**
 * Hook: useThemeColors()
 * Returns the full color palette for the current theme.
 *
 * Example:
 *   const c = useThemeColors();
 *   <View style={{ backgroundColor: c.bg }}>
 *     <Text style={{ color: c.text }}>Hello</Text>
 *   </View>
 */
export const useThemeColors = () => {
  const { theme } = useGlobalState();
  return useMemo(() => (theme === 'dark' ? darkPalette : lightPalette), [theme]);
};

/**
 * Function: getThemeColors(isDarkMode)
 * For non-hook contexts or components that already have isDarkMode.
 */
export const getThemeColors = (isDark) => (isDark ? darkPalette : lightPalette);

export { darkPalette, lightPalette };
