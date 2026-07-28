import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { onValue, ref } from '@react-native-firebase/database';
import { showMessage } from 'react-native-flash-message';
import RNFS from 'react-native-fs';
import { validateContent } from '../../Helper/ContentModeration';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';


const CLOUD_NAME = 'djtqw0jb5';
const UPLOAD_PRESET = 'my_upload';
const MAX_IMAGES = 4;

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';     // or your regional host
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2'; // ← rotate this later
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';


const UploadModal = ({ visible, onClose, onUpload, user }) => {
  const [desc, setDesc] = useState('');
  const [imageUris, setImageUris] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState(['Discussion']);
  const {currentUserEmail, appdatabase} = useGlobalState();
  const [strikeInfo, setStrikeInfo] = useState(null)
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const {localState} = useLocalState()
  const { t } = useTranslation();
  
  // ✅ Session-based last post time (resets on app close/reopen - simple state, no storage)
  const [lastPostTime, setLastPostTime] = useState(null);

  const toggleTag = useCallback((tag) => {
    setSelectedTags([tag]);
  }, []);

  useEffect(() => {
    if (!currentUserEmail) return;

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email_post/${encodedEmail}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      setStrikeInfo(banData || null);
    });

    return () => unsubscribe();
  }, [currentUserEmail]);

  // ✅ Reset loading state when modal closes
  useEffect(() => {
    if (!visible) {
      setLoading(false);
    }
  }, [visible]);


const pickAndCompress = useCallback(async () => {
  try {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: MAX_IMAGES,
      quality: 0.8,
      maxWidth: 1920,
      maxHeight: 1920,
    });

    if (result.didCancel) return;
    if (result.errorCode) {
      console.error('❌ ImagePicker error:', result.errorMessage);
      return;
    }

    if (result.assets?.length > 0) {
      const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
      const compressed = [];
      const rejectedCount = [];

      for (const asset of result.assets) {
        try {
          // ✅ Always compress to ensure < 1MB and good quality
          const uri = await CompressorImage.compress(asset.uri, {
            maxWidth: 1024,
            quality: 0.7,
            returnableOutputType: 'uri',
          });
          compressed.push(uri);
        } catch (error) {
          console.error('Compression failed:', error);
          if (asset?.uri) {
            try {
              const filePath = asset.uri.replace('file://', '');
              const fileInfo = await RNFS.stat(filePath);
              const fileSize = fileInfo.size || 0;
              if (fileSize <= MAX_SIZE_BYTES) {
                compressed.push(asset.uri);
              } else {
                rejectedCount.push(asset.fileName || 'image');
              }
            } catch (statError) {
              console.warn('Could not check file size:', statError);
            }
          }
        }
      }

      // Show alert if any images were rejected
      if (rejectedCount.length > 0) {
        Alert.alert(
          t('feed.image_too_large'),
          t('feed.image_size_error', { count: rejectedCount.length })
        );
      }

      // Only update state if we have valid compressed images
      if (compressed.length > 0) {
        setImageUris((prev) => {
          if (prev.length + compressed.length > MAX_IMAGES) {
            return compressed.slice(0, MAX_IMAGES);
          }
          return [...prev, ...compressed];
        });
      }
    }
  } catch (error) {
    console.error('❌ Image picker crash:', error);
    Alert.alert(t('chat.error', { defaultValue: 'Error' }), t('feed.upload_failed_msg'));
  }
}, []);

  

  const uploadToBunny = useCallback(async () => {
    const urls = [];
    const userId = user?.id ?? 'anon';
  
    for (const uri of imageUris) {
      try {
        const filename   = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl  = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;
  
        // Read file as base64 then convert to raw bytes
        const base64 = await RNFS.readFile(uri.replace('file://', ''), 'base64');
  
        // base64 -> Uint8Array (works reliably on RN 0.77)
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  
        // PUT raw bytes
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'AccessKey': BUNNY_ACCESS_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: binary,
        });
  
        const txt = await res.text().catch(() => '');
  
        if (!res.ok) {
          throw new Error(`Bunny upload failed ${res.status}: ${txt}`);
        }
  
        // Public CDN URL to display
        urls.push(`${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`);
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        throw e; // bubble up so your Alert shows
      }
    }
  
    return urls;
  }, [imageUris, user?.id]);
  

  const handleSubmit = useCallback(() => {
    // ✅ Guard: Prevent multiple simultaneous submissions
    if (loading) return;
    
    if (!user?.id) return;
    if (!currentUserEmail) {
      Alert.alert(t('feed.missing_email'), t('feed.missing_email_msg'));
      return;
    }
  
    if (!desc && imageUris.length === 0) {
      return Alert.alert(t('feed.missing_info'), t('feed.missing_info_msg'));
    }
    
    // ✅ Content moderation: Check description for inappropriate content
    const trimmedDesc = (desc || '').trim();
    if (trimmedDesc) {
      const contentValidation = validateContent(trimmedDesc);
      if (!contentValidation.isValid) {
        Alert.alert(t('feed.content_not_allowed'), contentValidation.reason || t('feed.content_not_allowed_msg'));
        return;
      }
    }
    
    // ✅ Check 1-minute cooldown (session-based, resets on app restart)
    const now = Date.now();
    if (lastPostTime && (now - lastPostTime) < 60000) {
      const secondsLeft = Math.ceil((60000 - (now - lastPostTime)) / 1000);
      showMessage({
        message: t('feed.cooldown_active'),
        description: `Please wait ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} before posting again.`,
        type: 'warning',
        duration: 3000,
      });
      return;
    }
    
    if (strikeInfo) {
      const { strikeCount, bannedUntil } = strikeInfo;
      const now = Date.now();

      if (bannedUntil === 'permanent') {
        showMessage({
          message: t('feed.permanently_banned'),
          description: t('feed.banned_msg'),
          type: 'danger',
        });
        return;
      }

      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: `⚠️ Strike ${strikeCount}`,
          description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
          type: 'warning',
          duration: 5000,

        });
        return;
      }
    }
    
    // ✅ Set loading immediately to prevent duplicate submissions
    setLoading(true);
    
    // Extract core logic into a callback
    const callbackfunction = async () => {
      try {
        const uploadedUrls = await uploadToBunny();
        await onUpload(desc, uploadedUrls, selectedTags, currentUserEmail);
        
        // ✅ Clear all inputs after successful upload
        setDesc('');
        setImageUris([]);
        setSelectedTags(['Discussion']);
        
        // ✅ Update last post time (session-based, not persisted - resets on app restart)
        const postTime = Date.now();
        setLastPostTime(postTime);
        
        // ✅ Reset loading before closing modal
        setLoading(false);
        
        onClose();
        showMessage({
          message: t('feed.post_success'),
          description: t('feed.post_success_msg'),
          type: 'success',
        });
      } catch (err) {
        Alert.alert(t('feed.upload_failed'), t('feed.upload_failed_msg'), err);
        console.log(err);
        // ✅ Reset loading on error so user can retry
        setLoading(false);
      }
    };
  
    // Show ad if not Pro, then execute
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!localState.isPro) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                InterstitialAdManager.showAd(callbackfunction);
              } catch (err) {
                console.warn('[AdManager] Failed to show ad:', err);
                callbackfunction();
              }
            }, 400);
          });
        } else {
          callbackfunction();
        }
      }, 500);
    });
  
  }, [loading, user?.id, desc, imageUris, selectedTags, uploadToBunny, onUpload, onClose, localState.isPro, currentUserEmail, lastPostTime, strikeInfo]);
  

  const themedStyles = useMemo(() => getStyles(isDark), [isDark]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={themedStyles.fullScreenContainer}>
        {/* Header - Fixed at top */}
        <View style={themedStyles.header}>
          <Text style={themedStyles.headerTitle}>{t('feed.create_post')}</Text>
          <TouchableOpacity onPress={onClose} style={themedStyles.closeButton}>
            <Icon name="close" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
        </View>

        <ConditionalKeyboardWrapper style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Description Input */}
            <Text style={themedStyles.sectionLabel}>{t('feed.description_label')}</Text>
            <TextInput
              style={themedStyles.input}
              placeholder={t('feed.description_placeholder')}
              placeholderTextColor={isDark ? '#888' : '#aaa'}
              value={desc}
              onChangeText={setDesc}
              multiline
              textAlignVertical="top"
            />

            {/* Tags */}
            <Text style={themedStyles.sectionLabel}>{t('feed.select_topic')}</Text>
            <View style={themedStyles.tagSelector}>
              {['Scam Alert', 'Looking for Trade', 'Discussion', 'Real or Fake', 'Need Help', 'Misc'].map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[
                    themedStyles.tagButton,
                    selectedTags.includes(tag) && themedStyles.tagButtonSelected,
                  ]}
                  onPress={() => toggleTag(tag)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      color: selectedTags.includes(tag) ? '#fff' : isDark ? '#ddd' : '#555',
                      fontSize: 10,
                      fontWeight: '600',
                    }}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Image Picker */}
            <Text style={themedStyles.sectionLabel}>{t('feed.photos_label')}</Text>
            <TouchableOpacity
              style={[themedStyles.imagePicker, imageUris.length > 0 && { justifyContent: 'flex-start', padding: 10 }]}
              onPress={pickAndCompress}
              activeOpacity={0.7}
            >
              {imageUris.length > 0 ? (
                <View style={themedStyles.imageGrid}>
                  {imageUris.map((uri, idx) => (
                    <View key={idx} style={themedStyles.imagePreviewContainer}>
                      <Image source={{ uri }} style={themedStyles.previewImage} />
                      <View style={themedStyles.imageCountBadge}>
                        <Text style={themedStyles.imageCountText}>{idx + 1}</Text>
                      </View>
                    </View>
                  ))}
                  {imageUris.length < MAX_IMAGES && (
                    <View style={themedStyles.addMoreButton}>
                      <Icon name="add" size={24} color={isDark ? '#555' : '#aaa'} />
                    </View>
                  )}
                </View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Icon name="images-outline" size={32} color={config.colors.primary} style={{ marginBottom: 8 }} />
                  <Text style={{ color: isDark ? '#aaa' : '#666', fontSize: 13 }}>{t('feed.tap_to_select')}</Text>
                </View>
              )}
            </TouchableOpacity>
          </ScrollView>

          {/* Submit Button - Fixed at bottom */}
          <View style={themedStyles.footer}>
            <TouchableOpacity
              style={[themedStyles.uploadBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={themedStyles.btnText}>{t('feed.post_now')}</Text>
                  <Icon name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </ConditionalKeyboardWrapper>
      </View>
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    fullScreenContainer: {
      flex: 1,
      backgroundColor: isDark ? config.colors.surfaceDark : '#ffffff',
      padding: 24,
      paddingTop: Platform.OS === 'ios' ? 60 : 24,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: isDark ? '#fff' : '#000',
      letterSpacing: 0.5,
    },
    closeButton: {
      padding: 4,
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#f0f0f0',
      borderRadius: 50,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: '#888',
      marginBottom: 8,
      marginLeft: 4,
      letterSpacing: 1,
    },
    input: {
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#f9f9f9',
      borderRadius: 16,
      padding: 16,
      color: isDark ? '#fff' : '#000',
      fontSize: 15,
      minHeight: 100,
      marginBottom: 20,
    },
    tagSelector: {
      flexDirection: 'row',
      marginBottom: 20,
      flexWrap: 'wrap',
      gap: 8,
    },
    tagButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#f2f2f7',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    tagButtonSelected: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    imagePicker: {
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#f9f9f9',
      borderRadius: 16,
      height: 120,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
      borderWidth: 1,
      borderColor: isDark ? '#333' : '#f0f0f0',
      borderStyle: 'dashed',
    },
    imageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      width: '100%',
    },
    imagePreviewContainer: {
      position: 'relative',
    },
    previewImage: {
      width: 60,
      height: 60,
      borderRadius: 12,
    },
    imageCountBadge: {
      position: 'absolute',
      right: -4,
      top: -4,
      backgroundColor: config.colors.primary,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    imageCountText: {
      fontSize: 9,
      fontWeight: 'bold',
      color: '#fff',
    },
    addMoreButton: {
      width: 60,
      height: 60,
      borderRadius: 12,
      backgroundColor: isDark ? config.colors.surfaceElevatedDark : '#eee',
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      paddingTop: 12,
    },
    uploadBtn: {
      backgroundColor: config.colors.secondary,
      height: 56,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      shadowColor: config.colors.secondary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 10,
      elevation: 5,
    },
    btnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
  });

export default UploadModal;
