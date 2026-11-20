import React, { memo, useMemo, useState, useCallback, useRef } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  Vibration,
  Keyboard,
  Alert,
  StyleSheet,
  TouchableOpacity,          // 👈 add this
  useWindowDimensions,
} from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import ReportPopup from '../ReportPopUp';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useLocalState } from '../../LocalGlobelStats';
import axios from 'axios';
import { getDeviceLanguage } from '../../../i18n';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import ScamSafetyBox from './Scamwarning';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { resolveItemImage } from '../../Helper/valueSources';
import { sourceLabelForItems } from '../../Helper/valueSources';
import { hideTranslateTip } from '../TranslateTip';
import TradeOfferCard from '../../CounterOffer/TradeOfferCard';
import { tradeStatus as wflStatus } from '../../Helper/tradeStatus';
import {
  mm2VariantText,
  isOfferStatusReply,
  offerStatusReplyText,
  offerUnpricedCount,
} from '../../Helper/counterOfferMM2';



const dismissKeyboard = () => Keyboard.dismiss();

// Counter offer card glue — the MM2 specifics TradeOfferCard takes as props.
// Same number style as the calculator (HomeScreen formatValue).
const formatOfferValue = (value) => {
  const n = Number(value);
  if (!n || Number.isNaN(n)) return '0';
  if (n % 1 !== 0) return n.toFixed(2).replace(/\.?0+$/, '');
  return n.toLocaleString();
};
const offerImageUrl = (it) => resolveItemImage(it);
// Which catalogue priced the offer (Supreme or MM2), plus how many items it
// had no price for — those are 0 in the totals, so the verdict leaves them out.
const offerFooterText = (offer, t) => {
  const base = t('chat.based_on_values', { source: sourceLabelForItems([{ valueSource: offer?.valueSource }]) });
  const unpriced = offerUnpricedCount(offer);
  return unpriced
    ? `${base} · ${t('counter_offer.unpriced_note', { count: unpriced, defaultValue: '{{count}} unpriced' })}`
    : base;
};

// Bubble geometry, shared by the bubble itself and the image grid it holds so
// the two cannot drift apart.
const BUBBLE_MAX_WIDTH_RATIO = 0.8;
const BUBBLE_PADDING_H = 10;
const IMAGE_GAP = 4;
const SINGLE_IMAGE_MAX = 250;

// Text for the quoted reply inside a bubble, built only from the snapshot the
// sender stored on the message (no read of the original).
const replyPreviewText = (replyTo, t) => {
  if (!replyTo || typeof replyTo !== 'object') return t('chat.reply_deleted');
  if (typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) return replyTo.text;
  const images = replyTo.imagesCount
    || (Array.isArray(replyTo.imageUrls) ? replyTo.imageUrls.length : (replyTo.imageUrl ? 1 : 0));
  if (images > 0) return t('chat.reply_images', { count: images });
  if (replyTo.hasFruits) {
    return replyTo.fruitsCount > 0
      ? t('chat.reply_items', { count: replyTo.fruitsCount })
      : t('chat.reply_items_message');
  }
  return t('chat.reply_deleted');
};

// One DM bubble (plus its day separator). Memoised, so a new message
// re-renders only the rows whose props changed instead of every row on
// screen. `actions` keeps one identity for the list's lifetime (it calls
// through a ref); styles / fruitColors / t change only with theme or language.
const PrivateMessageRow = memo(function PrivateMessageRow(props) {
  const {
    item, isMyMessage, showDateSep, dateLabel, showReadTicks, isRead,
    isDarkMode, styles, fruitColors, t, maxImageRowWidth, actions, offerActionsDisabled,
  } = props;

  const menuOptions = (
    <MenuOptions
      customStyles={{
        optionsContainer: styles.menuoptions,
        optionWrapper: styles.menuOption,
        optionText: styles.menuOptionText,
      }}
    >
      <MenuOption onSelect={() => actions.copy(item)}>
        <Text style={styles.menuOptionText}>{t('private_chat.copy')}</Text>
      </MenuOption>
      <MenuOption onSelect={() => actions.translate(item)}>
        <Text style={styles.menuOptionText}>{t('private_chat.translate')}</Text>
      </MenuOption>
      <MenuOption onSelect={() => actions.reply(item)}>
        <Text style={styles.menuOptionText}>{t('chat.reply')}</Text>
      </MenuOption>
      {!isMyMessage && (
        <MenuOption onSelect={() => actions.report(item)}>
          <Text style={styles.menuOptionText}>{t('chat.report')}</Text>
        </MenuOption>
      )}
    </MenuOptions>
  );

  const timeText = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  }) : '';

  const dateSeparator = showDateSep ? (
    <View style={{ alignItems: 'center', marginVertical: 10 }}>
      <View style={{
        backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#e0e0e0',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 4,
      }}>
        <Text style={{
          fontSize: 11,
          color: isDarkMode ? '#aaaaaa' : '#666666',
          fontWeight: '600',
        }}>
          {dateLabel}
        </Text>
      </View>
    </View>
  ) : null;

  // Counter offer: a standalone card instead of a text bubble. `text` holds
  // the fallback for older app versions, so it is not drawn here. Long-press
  // keeps the usual menu (copy / reply / report). One wrapping View, like the
  // bubble below (inverted-list ordering).
  if (item.tradeOffer && typeof item.tradeOffer === 'object' && Array.isArray(item.tradeOffer.give) && Array.isArray(item.tradeOffer.get)) {
    const offer = item.tradeOffer;
    return (
      <View>
        {dateSeparator}
        <View style={[offerStyles.wrap, isMyMessage ? offerStyles.mine : offerStyles.theirs]}>
          <Menu>
            <MenuTrigger
              triggerOnLongPress
              onPress={actions.longPress}
              customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
            >
              <TradeOfferCard
                offer={offer}
                isMine={isMyMessage}
                isDarkMode={isDarkMode}
                primaryColor={config.colors.primary}
                getImageUrl={offerImageUrl}
                formatValue={formatOfferValue}
                statusFn={wflStatus}
                variantText={mm2VariantText}
                footerText={offerFooterText(offer, t)}
                disabled={offerActionsDisabled}
                onAction={(action) => actions.offerAction(item, action)}
              />
            </MenuTrigger>
            {menuOptions}
          </Menu>
          <View style={offerStyles.timeRow}>
            <Text style={[offerStyles.time, isDarkMode ? offerStyles.timeDark : offerStyles.timeLight]}>
              {timeText}
            </Text>
            {showReadTicks && (
              <Text style={[offerStyles.ticks, isRead ? offerStyles.ticksRead : (isDarkMode ? offerStyles.ticksDark : offerStyles.ticksLight)]}>
                ✓✓
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  // A counter offer status reply reads in the READER's language; its stored
  // text is the sender's (and what older builds show).
  const bodyText = isOfferStatusReply(item.offerStatus)
    ? offerStatusReplyText(item.offerStatus.action, t)
    : item.text;

  // fruits helpers
  const fruits = Array.isArray(item.fruits) ? item.fruits : [];
  const hasFruits = fruits.length > 0;
  const totalFruitValue = hasFruits
    ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
    : 0;

  // Fruit images: see Code/Helper/valueSources.js. resolveItemImage reads
  // Image / image / imageUrl, so the imageUrl passthrough is covered.
  const msgBubble = (
    <View
      style={{
        alignSelf: isMyMessage ? 'flex-end' : 'flex-start',
        maxWidth: `${BUBBLE_MAX_WIDTH_RATIO * 100}%`,
        marginBottom: 4,
        marginHorizontal: 10,
      }}
    >
      {/* WhatsApp-style bubble — no avatar */}
      <View style={{
        backgroundColor: isMyMessage
          ? (isDarkMode ? '#0B5E3F' : '#DCF8C6')
          : (isDarkMode ? config.colors.surfaceDark : '#FFFFFF'),
        borderRadius: 16,
        borderTopLeftRadius: isMyMessage ? 16 : 4,
        borderTopRightRadius: isMyMessage ? 4 : 16,
        paddingHorizontal: BUBBLE_PADDING_H,
        paddingVertical: 6,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}>

      {/* Reply preview: tap jumps to the quoted message */}
      {item.replyTo && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => actions.scrollTo(item.replyTo.id)}
          style={{
            backgroundColor: isDarkMode ? '#ffffff15' : '#00000008',
            borderLeftWidth: 2,
            borderLeftColor: '#1E88E5',
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 3,
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280' }} numberOfLines={2}>
            {t('chat.replying_to_preview', { text: replyPreviewText(item.replyTo, t) })}
          </Text>
        </TouchableOpacity>
      )}

      {/* Message Content */}

      <Menu>
      {/* Images - Support multiple images */}
      {(item.imageUrls || item.imageUrl) && (() => {
        const imageArray = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
          ? item.imageUrls
          : (item.imageUrl ? [item.imageUrl] : []);

        if (imageArray.length === 0) return null;

        return (
          <View style={{ marginBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: IMAGE_GAP }}>
            {imageArray.map((imageUri, imgIndex) => {
              const perRow = Math.min(imageArray.length, 3);
              const imageSize = Math.min(
                SINGLE_IMAGE_MAX,
                Math.floor((maxImageRowWidth - IMAGE_GAP * (perRow - 1)) / perRow),
              );

              return (
                <TouchableOpacity
                  key={`img-${imgIndex}`}
                  activeOpacity={0.8}
                  onPress={() => actions.openImages(imageArray, imgIndex)}
                >
                  <Image resizeMethod="resize"
                    source={{ uri: imageUri }}
                    style={{
                      width: imageSize,
                      height: imageSize,
                      borderRadius: 8,
                      resizeMode: 'cover',
                    }}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })()}
        <MenuTrigger
          onLongPress={actions.longPress}
          customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
        >

          {/* 🐾 Fruits list */}
          {hasFruits && (
            <View style={[fruitStyles.fruitsWrapper]}>
              {fruits.map((fruit, index) => {
                return (
                  <View
                    key={`${fruit.id || fruit.name}-${index}`}
                    style={fruitStyles.fruitCard}
                  >
                    <Image resizeMethod="resize"
                      source={{ uri: resolveItemImage(fruit) || fruit.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                      style={fruitStyles.fruitImage}
                    />
                    <View style={fruitStyles.fruitInfo}>
                      <Text
                        style={[fruitStyles.fruitName, { color: fruitColors.name }]}
                        numberOfLines={1}
                      >
                        {`${fruit.name || fruit.Name}  `}
                      </Text>
                      <Text style={[fruitStyles.fruitValue, { color: fruitColors.value }]}>
                        {t('chat.item_value', { value: Number(fruit.value || 0).toLocaleString() })}{' '}
                      </Text>
                      <View style={fruitStyles.badgeRow}>
                        {fruit.isFly && (
                          <View style={[fruitStyles.badge, fruitStyles.badgeFly]}>
                            <Text style={fruitStyles.badgeText}>F</Text>
                          </View>
                        )}
                        {fruit.isRide && (
                          <View style={[fruitStyles.badge, fruitStyles.badgeRide]}>
                            <Text style={fruitStyles.badgeText}>R</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}

              {/* ✅ Total row – only if more than one fruit */}
              {fruits.length > 1 && (
                <View style={[fruitStyles.totalRow, { borderTopColor: fruitColors.divider }]}>
                  <Text style={[fruitStyles.totalLabel, { color: fruitColors.totalLabel }]}>{t('private_chat.total_value')}</Text>
                  <Text style={[fruitStyles.totalValue, { color: fruitColors.totalValue }]}>
                    {totalFruitValue.toLocaleString()}
                  </Text>
                </View>
              )}

              {/* Which catalogue priced this list. Replaces a 'D' badge that
                  was an Adopt Me leftover (Default/Neon/Mega) — MM2 has no such
                  variants, so it rendered 'D' on every item and meant nothing.
                  The two catalogues disagree on 70% of the items they share, so
                  a reader needs to know which one these numbers came from. */}
              <Text style={[fruitStyles.sourceNote, { color: fruitColors.value }]}>
                {t('chat.based_on_values', { source: sourceLabelForItems(fruits) })}
              </Text>
            </View>
          )}

          {/* Normal text */}
          {!!bodyText && (
            <Text style={{
              fontSize: 13,
              color: isDarkMode ? '#FFFFFF' : '#000000',
              lineHeight: 18,
            }}>
              {bodyText}
            </Text>
          )}
        </MenuTrigger>

        {/* Menu options */}
        {menuOptions}
      </Menu>

        {/* Timestamp + Read receipts inside bubble — WhatsApp style */}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, gap: 3 }}>
          <Text style={{
            fontSize: 10,
            color: isMyMessage
              ? (isDarkMode ? '#ffffffaa' : '#00000066')
              : (isDarkMode ? '#ffffff77' : '#00000055'),
          }}>
            {timeText}
          </Text>
          {/* ✅ Read receipt ticks for own messages */}
          {showReadTicks && (
            <Text style={{
              fontSize: 12,
              fontWeight: '700',
              color: isRead
                ? '#53BDEB'  // Blue ticks = read
                : (isDarkMode ? '#ffffff77' : '#00000044'),
              marginLeft: 1,
            }}>
              ✓✓
            </Text>
          )}
        </View>
      </View>
    </View>
  );

  // ONE wrapping View, not a Fragment: since RN 0.7x an inverted list lays
  // each cell out with column-reverse before flipping it, so a Fragment's
  // two children came out swapped and the day label sat BELOW the message
  // ("Today" under the message you just sent). A single child keeps its own
  // top-to-bottom order.
  return (
    <View>
      {dateSeparator}
      {msgBubble}
    </View>
  );
});

const PrivateMessageList = ({
  messages,
  userId,
  user,
  selectedUser,
  handleLoadMore,
  refreshing,
  onRefresh,
  isBanned,
  onReply,
  onReportSubmit,
  loading,
  canRate,
  hasRated,
  setShowRatingModal,
  isPaginating,        // 👈 add this
  otherLastRead, // 👈 Other user's lastRead timestamp for read receipts
  onOfferAction, // (message, action) => Promise — counter offer status buttons; null when the chat is closed
}) => {
  const { theme, isAdmin, api, freeTranslation } = useGlobalState();
  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  
  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? `${config.colors.surfaceDark}55` : '#e5e7eb55',
      name:      isDarkMode ? '#f9fafb' : '#111827',
      value:     isDarkMode ? '#e5e7eb' : '#4b5563',
      divider:   isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel:isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue:isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );
  const { t } = useTranslation();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // Widest a row of images can be: the bubble is capped at 80% of the screen
  // and adds 10pt of padding either side. The sizes used to be hard-coded
  // (250 / 150 / 110), so on a 360pt-wide screen a pair of 150s needed 304pt
  // of a 268pt box and flex-wrapped into a single stacked column.
  const { width: screenWidth } = useWindowDimensions();
  const maxImageRowWidth = Math.floor(screenWidth * BUBBLE_MAX_WIDTH_RATIO) - BUBBLE_PADDING_H * 2;

  // ✅ Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);


  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const navigation = useNavigation()


  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('home.alert.success'), t('private_chat.msg_copied'));
  }, [triggerHapticFeedback, t]);

  // ✅ Memoize filteredMessages
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    if (isBanned && userId) {
      return messages.filter((message) => message?.senderId === userId);
    }
    return messages;
  }, [messages, isBanned, userId]);

  // ✅ PERF: Hold the list in a ref so renderMessage doesn't depend on the array
  const filteredMessagesRef = useRef(filteredMessages);
  filteredMessagesRef.current = filteredMessages;

  // ✅ Memoize handleReport
  const handleReport = useCallback((message) => {
    if (!message) return;
    setSelectedMessage(message);
    setShowReportPopup(true);
  }, []);

  // ✅ Memoize handleSubmitReport
  const handleSubmitReport = useCallback((message, reason) => {
    if (onReportSubmit && typeof onReportSubmit === 'function') {
      onReportSubmit(message, reason);
    }
    setShowReportPopup(false);
  }, [onReportSubmit]);
  // console.log(selectedUserId === userId)
 


  // ✅ Memoize translateText
  const translateText = useCallback(async (text, targetLang = deviceLanguage) => {
    if (!text || typeof text !== 'string') return null;

    const placeholders = {};
    let maskedText = text;

    // Step 1: Replace fruit names with placeholders using pre-compiled regex
    fruitRegexPatterns.forEach(({ regex, placeholder, word }) => {
      maskedText = maskedText.replace(regex, placeholder);
      placeholders[placeholder] = word;
    });

    try {
      // Step 2: Send masked text for translation
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2`,
        {},
        {
          params: {
            q: maskedText,
            target: targetLang,
            key: api,
          },
        }
      );

      let translated = response.data.data.translations[0].translatedText;

      // Step 3: Replace placeholders back with original fruit names
      Object.entries(placeholders).forEach(([placeholder, word]) => {
        translated = translated.replace(new RegExp(placeholder, 'g'), word);
      });

      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  }, [fruitRegexPatterns, deviceLanguage, api]);

  // ✅ Memoize handleTranslate
  const handleTranslate = useCallback(async (item) => {
    if (!item || !item.text) {
      Alert.alert(t('home.alert.error'), t('private_chat.invalid_translate'));
      return;
    }
    hideTranslateTip(); // they found Translate: the one-time tip is done

    const isUnlimited = freeTranslation || localState?.isPro;
  
    if (!isUnlimited && canTranslate && typeof canTranslate === 'function' && !canTranslate()) {
      Alert.alert(t('private_chat.limit_reached'), t('private_chat.translate_limit'));
      return;
    }
  
    const translated = await translateText(item.text, deviceLanguage);
  
    if (translated) {
      if (!isUnlimited && incrementTranslationCount && typeof incrementTranslationCount === 'function') {
        incrementTranslationCount();
      }
  
      const remainingLabel = isUnlimited 
        ? t('private_chat.unlimited') 
        : t('chat.translations_remaining', { count: getRemainingTranslationTries ? getRemainingTranslationTries() : 0 });
      const upgradeLabel = isUnlimited ? '' : `\n\n🔓 ${t('private_chat.upgrade_pro')}`;
  
      Alert.alert(
        t('private_chat.translated_title'),
        `${translated}\n\n${t('chat.daily_limit_line', { remaining: remainingLabel })}${upgradeLabel}`
      );
    } else {
      Alert.alert(t('home.alert.error'), t('private_chat.translate_failed'));
    }
  }, [freeTranslation, localState?.isPro, canTranslate, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage, t]);
  
  // ✅ Date separator helper
  const getDateLabel = useCallback((timestamp) => {
    if (!timestamp) return '';
    const msgDate = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (msgDate.toDateString() === today.toDateString()) return t('chat.today', { defaultValue: 'Today' });
    if (msgDate.toDateString() === yesterday.toDateString()) return t('chat.yesterday', { defaultValue: 'Yesterday' });
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [t]);

  const showReadReceipts = localState?.showReadReceipts;

  // Tapping a quoted reply scrolls to the original if it is loaded; older
  // messages are not fetched for it.
  const flatListRef = useRef(null);
  const scrollToMessage = useCallback((messageId) => {
    const index = filteredMessagesRef.current.findIndex((m) => String(m?.id) === String(messageId));
    if (index === -1 || !flatListRef.current) {
      Alert.alert(t('chat.message_not_found', { defaultValue: 'Message not found or too old.' }));
      return;
    }
    flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [t]);

  // The row isn't laid out yet: get close by the average row height, then
  // retry (same as the group chat list, from Adopt Me).
  const scrollRetryRef = useRef(0);
  const handleScrollToIndexFailed = useCallback((info) => {
    const list = flatListRef.current;
    if (!list) return;
    list.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    // At most three retries per jump; the window reopens after 2 s.
    if (scrollRetryRef.current >= 3) return;
    scrollRetryRef.current += 1;
    if (scrollRetryRef.current === 1) setTimeout(() => { scrollRetryRef.current = 0; }, 2000);
    setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
      } catch (e) { /* the next failure callback retries */ }
    }, 250);
  }, []);

  // Row callbacks, read through a ref so `rowActions` keeps one identity for
  // the life of the list; the memoised rows still call the latest handlers.
  const rowActionsRef = useRef(null);
  rowActionsRef.current = {
    openImages: (images, initialIndex) => navigation.navigate('ImageViewerScreenChat', { images, initialIndex }),
    longPress: () => triggerHapticFeedback('impactMedium'),
    copy: handleCopy,
    translate: handleTranslate,
    reply: (message) => {
      if (!onReply) return;
      triggerHapticFeedback('impactLight');
      onReply(message);
    },
    scrollTo: scrollToMessage,
    report: handleReport,
    offerAction: (message, action) => (onOfferAction ? onOfferAction(message, action) : undefined),
  };
  const rowActions = useMemo(() => {
    const call = (name) => (...args) => rowActionsRef.current?.[name]?.(...args);
    return {
      openImages: call('openImages'),
      longPress: call('longPress'),
      copy: call('copy'),
      translate: call('translate'),
      reply: call('reply'),
      scrollTo: call('scrollTo'),
      report: call('report'),
      offerAction: call('offerAction'),
    };
  }, []);

  // ✅ PERF: renderMessage reads the list through filteredMessagesRef and
  // passes each row only primitives + stable objects, so its identity no
  // longer changes on every incoming message and PrivateMessageRow's memo can
  // skip the rows that did not change.
  const renderMessage = useCallback(({ item, index }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const isMyMessage = item.senderId === userId;

    // Date separator: in an inverted list the next item in the array is older,
    // so this is true for the oldest message of each day — the one that shows
    // highest up the screen in that day's run. The separator therefore has to
    // render BEFORE the bubble: a row's own children are not inverted, only
    // the row order is, so emitting it after the bubble (as this did) dropped
    // each day's heading below its first message and left it sitting in the
    // middle of the previous day's run.
    const nextMsg = filteredMessagesRef.current[index + 1];
    const dateLabel = getDateLabel(item.timestamp);
    const showDateSep = !nextMsg || dateLabel !== getDateLabel(nextMsg.timestamp);

    return (
      <PrivateMessageRow
        item={item}
        isMyMessage={isMyMessage}
        showDateSep={showDateSep}
        dateLabel={dateLabel}
        showReadTicks={isMyMessage && (showReadReceipts ?? true)}
        isRead={!!(otherLastRead && item.timestamp && item.timestamp <= otherLastRead)}
        isDarkMode={isDarkMode}
        styles={styles}
        fruitColors={fruitColors}
        t={t}
        maxImageRowWidth={maxImageRowWidth}
        actions={rowActions}
        offerActionsDisabled={!onOfferAction || !!isBanned}
      />
    );
  }, [userId, getDateLabel, showReadReceipts, otherLastRead, isDarkMode, styles, fruitColors, t, maxImageRowWidth, rowActions, onOfferAction, isBanned]);

  // ✅ Memoize keyExtractor
  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        /* flex:1, not a content-sized wrapper. A FlatList with no bounded
            height lays every row out past the viewport: the list then has
            nothing to scroll (the overflow is simply clipped) and Android's
            view clipping detaches the tall rows, which is why image bubbles
            arrived as empty white rectangles. The 140pt bottom padding that
            used to sit here was dead space above the message input — the
            input is a sibling in normal flow, so nothing had to be reserved
            for it. */
        <View style={{ flex: 1 }}>
        <ScamSafetyBox setShowRatingModal={setShowRatingModal} canRate={canRate} hasRated={hasRated} selectedUserId={selectedUser?.senderId} />

        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={filteredMessages}
          removeClippedSubviews={false}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          inverted
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          // Once per drag, not on every scroll frame.
          onScrollBeginDrag={dismissKeyboard}
          onTouchStart={() => Keyboard.dismiss()}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={15}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
        </View>

      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        onClose={() => setShowReportPopup(false)}
        onSubmit={handleSubmitReport}
      />
    </View>
  );
};
// Counter offer row (the card itself styles in CounterOffer/TradeOfferCard).
const offerStyles = StyleSheet.create({
  wrap: { marginBottom: 6, marginHorizontal: 10 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  timeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, gap: 3 },
  time: { fontSize: 10 },
  timeDark: { color: '#ffffff77' },
  timeLight: { color: '#00000055' },
  ticks: { fontSize: 12, fontWeight: '700', marginLeft: 1 },
  ticksRead: { color: '#53BDEB' },
  ticksDark: { color: '#ffffff77' },
  ticksLight: { color: '#00000044' },
});

export const fruitStyles = StyleSheet.create({
  // Colour comes from fruitColors.value at the call site: with no colour it
  // rendered black, unreadable in dark mode (MM2 suggestion 2026-10-19).
  sourceNote: {
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.85,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  fruitsWrapper: {
    marginTop: 1,
    // gap: 1,
    padding: 4,
    // borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:'flex-start',
    marginBottom:3,
    alignSelf: 'stretch',
  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
  },
  fruitInfo: {
    // flex: 1,
    flexDirection:'row',
    justifyContent:'flex-start',
    // backgroundColor:'red',
    alignItems:'center',
  },
  fruitName: {
    fontSize: 12,
    fontWeight: '500',
    // color: '#fff',
  },
  fruitValue: {
    fontSize: 11,
    // color: '#e5e5e5',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // marginTop: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    // minWidth: 16,
    // justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  badgeDefault: {
    backgroundColor: '#FF6666', // D
  },
  badgeNeon: {
    backgroundColor: '#2ecc71', // N
  },
  badgeMega: {
    backgroundColor: '#9b59b6', // M
  },
  badgeFly: {
    backgroundColor: '#3498db', // F
  },
  badgeRide: {
    backgroundColor: '#e74c3c', // R
  },
  totalRow: {
    flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6666',
  },
});

export default memo(PrivateMessageList);
