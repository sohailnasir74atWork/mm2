import {trackGrowthEvent} from './Code/Helper/growthAnalytics';
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import { createMMKV } from "react-native-mmkv";

// Import translation files
import en from "./Code/Translation/en.json";
import pt from "./Code/Translation/pt.json";
import es from "./Code/Translation/es.json"; // Latin American Spanish
import esES from "./Code/Translation/es-ES.json"; // Spain; falls back to es, then en
import fr from "./Code/Translation/fr.json";
import de from "./Code/Translation/de.json";
import ru from "./Code/Translation/ru.json";
import ar from "./Code/Translation/ar.json";
import ja from "./Code/Translation/ja.json";

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
    resources: {
      en: { translation: en },
      pt: { translation: pt },
      es: { translation: es },
      'es-ES': { translation: esES },
      fr: { translation: fr },
      de: { translation: de },
      ru: { translation: ru },
      ar: { translation: ar },
      ja: { translation: ja },
    },
    lng: initialLanguage, // Set initial language
    fallbackLng: "en", // Default fallback language
    interpolation: {
      escapeValue: false,
    },
  });

// Function to update language and store in MMKV
export const setAppLanguage = (languageCode) => {
  i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
  trackGrowthEvent("app_language_selected", {language: languageCode});
};

export default i18n;
