import React, { memo, useMemo, useState, useCallback } from 'react';
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
import { mixpanel } from '../../AppHelper/MixPenel';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import ScamSafetyBox from './Scamwarning';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';



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

  // ✅ Helper function to get MM2 image URL (matching Trades.jsx getImageUrl)
  const getImageUrl = useCallback((item) => {
    if (!item) return '';
    
    // If imageUrl is already a full URL, return as is
    if (item.imageUrl && (item.imageUrl.startsWith('http://') || item.imageUrl.startsWith('https://'))) {
      return item.imageUrl;
    }
    
    // ✅ Handle new format: { name, type, value, image }
    if (item.image) {
      // If image is already a full URL, return as is
      if (item.image.startsWith('http://') || item.image.startsWith('https://')) {
        return item.image;
      }
      // Otherwise, use MM2 format: https://mm2values.com/${item.image}
      return `https://mm2values.com/${item.image}`;
    }
    
    // ✅ Handle old format: { name, image, value } - image might be directly accessible
    // This is a fallback for backward compatibility
    return '';
  }, []);

  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('home.alert.success'), t('private_chat.msg_copied'));
  }, [triggerHapticFeedback]);

  // ✅ Memoize filteredMessages
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    if (isBanned && userId) {
      return messages.filter((message) => message?.senderId === userId);
    }
    return messages;
  }, [messages, isBanned, userId]);

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
      mixpanel.track("Translation", {lang:targetLang});

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
        : (getRemainingTranslationTries && getRemainingTranslationTries() === 1 ? t('private_chat.remaining_tries_singular', { count: 1 }) : t('private_chat.remaining_tries_plural', { count: getRemainingTranslationTries ? getRemainingTranslationTries() : 0 }));
      const upgradeLabel = isUnlimited ? '' : `\n\n🔓 ${t('private_chat.upgrade_pro')}`;
  
      Alert.alert(
        t('private_chat.translated_title'),
        `${translated}\n\n🧠 ${t('private_chat.daily_limit')}: ${remainingLabel}${upgradeLabel}`
      );
    } else {
      Alert.alert(t('home.alert.error'), t('private_chat.translate_failed'));
    }
  }, [freeTranslation, localState?.isPro, canTranslate, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage]);
  
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

  // ✅ Memoize renderMessage — WhatsApp-style bubbles (no avatars)
  const renderMessage = useCallback(({ item, index }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const isMyMessage = item.senderId === userId;

    // fruits helpers
    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
      : 0;

    const msgBubble = (
      <View
        style={{
          alignSelf: isMyMessage ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
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
          paddingHorizontal: 10,
          paddingVertical: 6,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        }}>

        {/* Message Content */}

        <Menu>
        {/* Images - Support multiple images */}
        {(item.imageUrls || item.imageUrl) && (() => {
          const imageArray = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
            ? item.imageUrls
            : (item.imageUrl ? [item.imageUrl] : []);

          if (imageArray.length === 0) return null;

          return (
            <View style={{ marginBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {imageArray.map((imageUri, imgIndex) => {
                const imageSize = imageArray.length === 1 ? 250 : imageArray.length === 2 ? 150 : 110;

                return (
                  <TouchableOpacity
                    key={`img-${imgIndex}`}
                    activeOpacity={0.8}
                    onPress={() =>
                      navigation.navigate('ImageViewerScreenChat', {
                        images: imageArray,
                        initialIndex: imgIndex,
                      })
                    }
                  >
                    <Image
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
            onLongPress={() => triggerHapticFeedback('impactMedium')}
            customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
          >

            {/* 🐾 Fruits list */}
            {hasFruits && (
              <View style={[fruitStyles.fruitsWrapper]}>
                {fruits.map((fruit, index) => {
                  const valueType = (fruit.valueType || 'd').toLowerCase();

                  let valueBadgeStyle = fruitStyles.badgeDefault;
                  if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
                  if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;

                  return (
                    <View
                      key={`${fruit.id || fruit.name}-${index}`}
                      style={fruitStyles.fruitCard}
                    >
                      <Image
                        source={{ uri: getImageUrl(fruit) || fruit.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
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
                          · Value: {Number(fruit.value || 0).toLocaleString()}{' '}
                        </Text>
                        <View style={fruitStyles.badgeRow}>
                          <View style={[fruitStyles.badge, valueBadgeStyle]}>
                            <Text style={fruitStyles.badgeText}>{valueType.toUpperCase()}</Text>
                          </View>
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
              </View>
            )}

            {/* Normal text */}
            {!!item.text && (
              <Text style={{
                fontSize: 13,
                color: isDarkMode ? '#FFFFFF' : '#000000',
                lineHeight: 18,
              }}>
                {item.text}
              </Text>
            )}
          </MenuTrigger>

          {/* Menu options */}
          <MenuOptions
            customStyles={{
              optionsContainer: styles.menuoptions,
              optionWrapper: styles.menuOption,
              optionText: styles.menuOptionText,
            }}
          >
            <MenuOption onSelect={() => handleCopy(item)}>
              <Text style={styles.menuOptionText}>{t('private_chat.copy')}</Text>
            </MenuOption>
            <MenuOption onSelect={() => handleTranslate(item)}>
              <Text style={styles.menuOptionText}>{t('private_chat.translate')}</Text>
            </MenuOption>
            {!isMyMessage && (
              <MenuOption onSelect={() => handleReport(item)}>
                <Text style={styles.menuOptionText}>{t('chat.report')}</Text>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>

          {/* Timestamp + Read receipts inside bubble — WhatsApp style */}
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, gap: 3 }}>
            <Text style={{
              fontSize: 10,
              color: isMyMessage
                ? (isDarkMode ? '#ffffffaa' : '#00000066')
                : (isDarkMode ? '#ffffff77' : '#00000055'),
            }}>
              {item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }) : ''}
            </Text>
            {/* ✅ Read receipt ticks for own messages */}
            {isMyMessage && (localState?.showReadReceipts ?? true) && (
              <Text style={{
                fontSize: 12,
                fontWeight: '700',
                color: (otherLastRead && item.timestamp && item.timestamp <= otherLastRead)
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

    // Date separator: in inverted list, next item in array is older
    const nextMsg = filteredMessages[index + 1];
    const showDateSep = !nextMsg || getDateLabel(item.timestamp) !== getDateLabel(nextMsg.timestamp);

    return (
      <>
        {msgBubble}
        {showDateSep && (
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
                {getDateLabel(item.timestamp)}
              </Text>
            </View>
          </View>
        )}
      </>
    );
  }, [userId, selectedUser, user, styles, fruitColors, handleCopy, handleTranslate, handleReport, onReply, navigation, t, filteredMessages, getDateLabel, otherLastRead, localState?.showReadReceipts, isDarkMode]);

  // ✅ Memoize keyExtractor
  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <View style={{paddingBottom:140}}>  
        <>   
        <ScamSafetyBox setShowRatingModal={setShowRatingModal} canRate={canRate} hasRated={hasRated} selectedUserId={selectedUser?.senderId} />
     
        <FlatList
          data={filteredMessages}
          removeClippedSubviews={true}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          inverted
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          onScroll={() => Keyboard.dismiss()}
          onTouchStart={() => Keyboard.dismiss()}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={15}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
        </>     
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
export const fruitStyles = StyleSheet.create({
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

    flex:1,


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
