import {trackGrowthEvent} from './Code/Helper/growthAnalytics';
import i18n from "i18next";
import { I18nManager, NativeModules, Alert } from "react-native";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/de";
import "dayjs/locale/ru";
import "dayjs/locale/ja";
import "dayjs/locale/ar";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import { createMMKV } from "react-native-mmkv";

// Translation files, required on demand. Together they are ~1.2 MB of
// strings; evaluating all nine on every cold start cost low-end phones JS time
// before the first screen (2026-11-03), though a player only ever reads one
// language plus the English fallback. A switch loads the new one first
// (ensureLanguageLoaded, called by setAppLanguage and LanguageProvider).
const LOCALE_LOADERS = {
  en: () => require("./Code/Translation/en.json"),
  pt: () => require("./Code/Translation/pt.json"),
  es: () => require("./Code/Translation/es.json"), // Latin American Spanish
  'es-ES': () => require("./Code/Translation/es-ES.json"), // Spain; falls back to es, then en
  fr: () => require("./Code/Translation/fr.json"),
  de: () => require("./Code/Translation/de.json"),
  ru: () => require("./Code/Translation/ru.json"),
  ar: () => require("./Code/Translation/ar.json"),
  ja: () => require("./Code/Translation/ja.json"),
};
// i18next resolves es-ES → es → en, so es-ES needs es loaded too.
const bundlesFor = (lng) => (lng === 'es-ES' ? ['es-ES', 'es', 'en'] : [lng, 'en']);

// Initialize MMKV storage
const storage = createMMKV();

// Map country codes to languages
const countryToLanguage = {
  BR: "pt",
  PH: "fil",
  VN: "vi",
  ID: "id",
  US: "en",
  MX: "es",
  FR: "fr",
  DE: "de",
  RU: "ru",
  IN: "en",
  AR: "ar",
};

// Function to get saved language from MMKV
const getStoredLanguage = () => {
  return storage.getString("appLanguage") || null;
};

// Function to get the device language
export const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  return locales.length > 0 ? locales[0].languageCode : 'en';
};

// Filipino, Indonesian and Vietnamese were dropped (owner, 2026-09-28): their
// files covered under a third of the app. Anyone who had picked one falls
// through to their device language or English below.
const SUPPORTED_LANGUAGES = ['en', 'pt', 'es', 'es-ES', 'fr', 'de', 'ru', 'ja', 'ar'];

// Spanish is the one language shipped in two variants, so it needs the region:
// Spain gets es-ES, every other Spanish-speaking region gets Latin American es.
const getDeviceAppLanguage = () => {
  const locale = RNLocalize.getLocales()[0];
  if (!locale) return 'en';
  if (locale.languageCode === 'es') return locale.countryCode === 'ES' ? 'es-ES' : 'es';
  return locale.languageCode;
};

// Determine initial language
const savedLanguage = getStoredLanguage();
const deviceLanguage = getDeviceAppLanguage();
const initialLanguage = SUPPORTED_LANGUAGES.includes(savedLanguage) ? savedLanguage
  : SUPPORTED_LANGUAGES.includes(deviceLanguage) ? deviceLanguage : 'en';

// Initialize i18next
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v3",
    resources: Object.fromEntries(
      bundlesFor(initialLanguage)
        .filter((code) => LOCALE_LOADERS[code])
        .map((code) => [code, { translation: LOCALE_LOADERS[code]() }])
    ),
    lng: initialLanguage, // Set initial language
    fallbackLng: "en", // Default fallback language
    interpolation: {
      escapeValue: false,
    },
  });

// dayjs dates and "5 minutes ago" follow the app language, not English
// (same fix as Adopt Me's i18n.js). Spain uses the shared es locale, and pt
// players are overwhelmingly Brazilian.
const DAYJS_LOCALE = { en: 'en', pt: 'pt-br', es: 'es', 'es-ES': 'es', fr: 'fr', de: 'de', ru: 'ru', ja: 'ja', ar: 'ar' };
const syncDayjsLocale = (lng) => dayjs.locale(DAYJS_LOCALE[lng] || 'en');
syncDayjsLocale(initialLanguage);
i18n.on('languageChanged', syncDayjsLocale);

// ── Layout direction follows the IN-APP language, not the phone ──────────
// Arabic is right-to-left; everything else is left-to-right. Before
// 2026-10-13 the app never called I18nManager, so an Arabic phone got a
// mirrored layout even with English picked in the app, and Arabic picked on
// an English phone got Arabic text in a left-to-right layout.
//
// forceRTL only takes effect when the React host starts, so it is set on
// every launch (correct from the next start) and, on a switch that changes
// direction, the app reloads at once through the AppReload native module:
// android/.../AppReloadModule.kt and ios/bloxfruitevalues/AppReload.m. A
// build without it (iOS builds before 2026-10-13) asks the player to reopen
// the app instead.
export const isRTLLanguage = (lng) => lng === 'ar';
const applyLayoutDirection = (lng) => {
  const rtl = isRTLLanguage(lng);
  try {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  } catch (e) { /* layout direction is cosmetic; never block startup */ }
  return rtl;
};
applyLayoutDirection(initialLanguage);

const reloadForDirection = () => {
  const reload = NativeModules.AppReload?.reload;
  if (typeof reload === 'function') {
    // A reload is not a launch: no launch ad (Code/Ads/openApp.js).
    storage.set('appOpenSkipNextColdStartAt', String(Date.now()));
    // Let the language and MMKV writes land before the JS context goes away.
    setTimeout(() => reload(), 150);
    return;
  }
  Alert.alert(i18n.t('language.restart_title'), i18n.t('language.restart_body'));
};

// Function to update language and store in MMKV
export const ensureLanguageLoaded = (lng) => {
  bundlesFor(lng).forEach((code) => {
    if (LOCALE_LOADERS[code] && !i18n.hasResourceBundle(code, 'translation')) {
      i18n.addResourceBundle(code, 'translation', LOCALE_LOADERS[code]());
    }
  });
};

export const setAppLanguage = (languageCode) => {
  ensureLanguageLoaded(languageCode);
  i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
  trackGrowthEvent("app_language_selected", {language: languageCode});
  const rtl = applyLayoutDirection(languageCode);
  if (rtl !== I18nManager.isRTL) reloadForDirection();
};

export default i18n;
