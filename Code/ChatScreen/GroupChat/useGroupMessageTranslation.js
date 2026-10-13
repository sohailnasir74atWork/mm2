/**
 * useGroupMessageTranslation — "Translate" for group chat messages.
 *
 * Adopt Me moved its community-chat translation into a shared hook
 * (Code/Helper/useMessageTranslation.js) so group chat could use it. MM2 still
 * has that logic inline in GroupChat/MessagesList.jsx (community chat) and
 * PrivateChat/PrivateMessageList.jsx; this is the same code lifted for group
 * chat, with the same behaviour:
 *   - item names (FRUIT_KEYWORDS) are masked before the request and restored
 *     afterwards, so Google doesn't translate them;
 *   - Pro and the `free_translation` RTDB flag are unlimited; everyone else
 *     draws on useLocalState's daily counter, the SAME counter community and
 *     private chat use, so group chat adds no extra allowance;
 *   - the counter only moves on a successful translation;
 *   - the result shows in an Alert with the remaining-tries line.
 * Same strings as community chat, so no new translation keys.
 */
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import { getDeviceLanguage } from '../../../i18n';

export const useGroupMessageTranslation = () => {
  const { t } = useTranslation();
  const { api, freeTranslation } = useGlobalState();
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // Pre-compile once — FRUIT_KEYWORDS is long and this runs per translation.
  const fruitRegexPatterns = useMemo(
    () =>
      FRUIT_KEYWORDS.map((word, index) => ({
        regex: new RegExp(`\\b${word}\\b`, 'gi'),
        placeholder: `__FRUIT_${index}__`,
        word,
      })),
    [],
  );

  const translateText = useCallback(
    async (text, targetLang) => {
      if (!text || typeof text !== 'string') return null;

      const placeholders = {};
      let maskedText = text;
      fruitRegexPatterns.forEach(({ regex, placeholder, word }) => {
        maskedText = maskedText.replace(regex, placeholder);
        placeholders[placeholder] = word;
      });

      try {
        const response = await axios.post(
          'https://translation.googleapis.com/language/translate/v2',
          {},
          { params: { q: maskedText, target: targetLang || deviceLanguage, key: api } },
        );
        let translated = response.data.data.translations[0].translatedText;
        Object.entries(placeholders).forEach(([placeholder, word]) => {
          translated = translated.replace(new RegExp(placeholder, 'g'), word);
        });
        return translated;
      } catch (err) {
        console.error('Translation Error:', err);
        return null;
      }
    },
    [fruitRegexPatterns, deviceLanguage, api],
  );

  const handleTranslate = useCallback(
    async (item) => {
      if (!item || !item.text) {
        Alert.alert(t('chat.error'), t('private_chat.invalid_translate'));
        return;
      }
      const isUnlimited = freeTranslation || localState?.isPro;

      if (!isUnlimited && typeof canTranslate === 'function' && !canTranslate()) {
        Alert.alert(t('private_chat.limit_reached'), t('private_chat.translate_limit'));
        return;
      }

      const translated = await translateText(item.text, deviceLanguage);

      if (translated) {
        if (!isUnlimited) incrementTranslationCount();

        const remaining = isUnlimited
          ? t('private_chat.unlimited')
          : t('chat.translations_remaining', { count: getRemainingTranslationTries() });

        Alert.alert(
          t('private_chat.translated_title'),
          `${translated}\n\n${t('chat.daily_limit_line', { remaining })}${isUnlimited
            ? ''
            : `\n\n🔓 ${t('private_chat.upgrade_pro')}`
          }`,
        );
      } else {
        Alert.alert(t('chat.error'), t('private_chat.translate_failed'));
      }
    },
    [canTranslate, freeTranslation, localState?.isPro, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage, t],
  );

  return { handleTranslate };
};
