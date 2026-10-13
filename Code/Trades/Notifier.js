// NotifierDrawer.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Image, StyleSheet, ScrollView, Modal, ToastAndroid, Platform, Alert } from 'react-native';
import { ref, remove, set, update, get, onChildAdded, onChildChanged, onChildRemoved } from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import InterstitialAdManager from '../Ads/IntAd';
import { requestPermission } from '../Helper/PermissionCheck';
import { showMessage } from 'react-native-flash-message';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { useModalWindowInsets } from '../Helper/useNavBarInset';

const NotifierDrawer = () => {
  const { t } = useTranslation();
  // The item picker is a full-screen modal: on Android it is edge-to-edge, so
  // it clears the status bar and the nav bar itself (iOS: notch and home
  // indicator, since the modal sits outside the root SafeAreaView).
  const insets = useModalWindowInsets();
  const { user, appdatabase, theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';

  const [mode, setMode] = useState('buy');
  const [savedItems, setSavedItems] = useState({ buy: {}, sale: {} });
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [adShown, setAdShown] = useState(false);

  const openDrawerToSelect = ()=> {
    if (!user?.id) {
      showMessage({
        message: t('notifier.login_required'),
        type: 'warning',
        duration: 2500,
      });
      return;
    }
    requestPermission()
    setIsDrawerVisible(true)
  }
  const parsedValuesData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("Error parsing data:", error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  const getImageUrl = useCallback((item, itemNameOverride = null) => {
    const itemName = itemNameOverride || item?.name || item?.Name || '';
    if (!itemName) return '';
    
    // ✅ Generate image URL client-side based on item name
    // This reduces Firebase storage costs (we only store name, not image URL)
    const encoded = encodeURIComponent(itemName);
    if (localState.isGG) {
      return `${localState.imgurlGG?.replace(/"/g, '')}/items/${encoded}.webp`;
    }
    
    // ✅ For non-GG mode, try to get image from item object if available
    if (item?.image) {
      return `${localState.imgurl?.replace(/"/g, '')}/${item.image.replace(/^\/+/, '')}`;
    }
    
    // ✅ Fallback: try to find item in parsedValuesData to get image
    if (itemName && parsedValuesData.length > 0) {
      const foundItem = parsedValuesData.find(
        (i) => (i?.name || i?.Name || '').toLowerCase() === itemName.toLowerCase()
      );
      if (foundItem?.image) {
        return `${localState.imgurl?.replace(/"/g, '')}/${foundItem.image.replace(/^\/+/, '')}`;
      }
    }
    
    return '';
  }, [localState.isGG, localState.imgurlGG, localState.imgurl, parsedValuesData]);

  // const showMessage = (msg) => {
  //   if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  //   else Alert.alert('Info', msg);
  // };

  // ✅ OPTIMIZED: read once, then listen to children. This used onValue on
  // both nodes, so every add/remove re-downloaded the whole list AND re-ran
  // one get(/notifier_index/...) per saved item for the migration below.
  // Now the old-format migration + index check runs once per mount from a
  // single get(), and child listeners deliver only the item that changed.
  // Same technique as Adopt Me's Notifier; same paths and writes as before.
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    const uid = user.id;
    let cancelled = false;

    // A different account starts from an empty list; child_added refills it.
    setSavedItems({ buy: {}, sale: {} });
    const lists = { buy: {}, sale: {} };
    const publish = (kind) => {
      if (cancelled) return;
      const next = { ...lists[kind] };
      setSavedItems(prev => ({ ...prev, [kind]: next }));
    };

    // Migrate old format items to the string format + create missing reverse
    // indexes. Unchanged from the onValue version, but run once per mount.
    const migrateNotifierItems = async (kind, data) => {
      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return;
      const indexUpdates = {};
      const migrationUpdates = {};
      let hasIndexUpdates = false;
      let hasMigrationUpdates = false;

      const checkPromises = Object.entries(data).map(async ([itemKey, itemValue]) => {
        const itemName = typeof itemValue === 'string' ? itemValue : (itemValue?.name || itemValue?.Name || '');
        if (!itemName) return;

        // ✅ MIGRATION: Convert old object format to new string format
        if (typeof itemValue !== 'string') {
          migrationUpdates[`notifier/${kind}/${uid}/${itemKey}`] = itemName;
          hasMigrationUpdates = true;
        }

        // Create reverse index
        const indexRef = ref(appdatabase, `/notifier_index/${kind}/${itemKey}/${uid}`);
        try {
          const indexSnap = await get(indexRef);
          if (!indexSnap.exists()) {
            indexUpdates[`notifier_index/${kind}/${itemKey}/${uid}`] = true;
            hasIndexUpdates = true;
          }
        } catch (error) {
          // Silently fail - index creation is not critical
        }
      });

      await Promise.all(checkPromises);

      // Batch migrate old format items
      if (hasMigrationUpdates && Object.keys(migrationUpdates).length > 0) {
        update(ref(appdatabase), migrationUpdates).catch((error) => {
          console.warn('Error migrating notifier items:', error);
        });
      }

      // Batch create all missing indexes at once
      if (hasIndexUpdates && Object.keys(indexUpdates).length > 0) {
        update(ref(appdatabase), indexUpdates).catch(() => {
          // Silently fail - index creation is not critical for app functionality
        });
      }
    };

    const unsubscribers = [];
    ['buy', 'sale'].forEach((kind) => {
      const listRef = ref(appdatabase, `/notifier/${kind}/${uid}`);

      // Read once for the migration.
      get(listRef)
        .then((snap) => migrateNotifierItems(kind, snap.val() || {}))
        .catch(() => { /* migration is best-effort */ });

      // Child listeners: child_added replays the existing items on attach,
      // then each event carries only the item that changed.
      const upsert = (snap) => {
        if (!snap || !snap.key) return;
        const value = snap.val();
        if (value === null || value === undefined) return;
        lists[kind][snap.key] = value;
        publish(kind);
      };
      const removeChild = (snap) => {
        if (!snap || !snap.key) return;
        delete lists[kind][snap.key];
        publish(kind);
      };
      unsubscribers.push(
        onChildAdded(listRef, upsert),
        onChildChanged(listRef, upsert),
        onChildRemoved(listRef, removeChild),
      );
    });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user?.id, appdatabase]);

  const subtitleText =
  mode === 'buy'
    ? t('notifier.subtitle_buy')
    : t('notifier.subtitle_sale');
    const buttonText =
    mode === 'buy'
      ? "Notify me when offered"
      : "Notify me when wanted";
  

  const handleSelect =  (item) => {
    const itemName = item?.name || item?.Name;
    if (!itemName) return;
    const key = itemName.replace(/[^a-zA-Z0-9]/g, '_');
    const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
    const indexRef = ref(appdatabase, `/notifier_index/${mode}/${key}/${user.id}`);
    
    // ✅ OPTIMIZED: Store only name (not image URL) to reduce Firebase storage/download costs
    // Image URL can be generated client-side using getImageUrl() function which looks up image from parsedValuesData
    // Cloud function only needs 'name' for matching, so storing image is unnecessary
    set(itemRef, itemName); // Store as string value instead of object
    
    // ✅ OPTIMIZED: Create reverse index for cloud function optimization
    // This allows cloud function to query by item name instead of downloading all users' items
    set(indexRef, true).catch((error) => {
      console.error('Error creating notifier index:', error);
    });
    
    showMessage({
      message: mode === 'buy'
        ? t('notifier.added_buy', { item: itemName })
        : t('notifier.added_sale', { item: itemName }),
      type: 'success',
      duration: 2500,
    });
  };

  const handleRemove = (key) => {
    if (!user?.id) return;
  
    const proceedToRemove = () => {
      const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
      const indexRef = ref(appdatabase, `/notifier_index/${mode}/${key}/${user.id}`);
      
      // ✅ OPTIMIZED: Remove both item and reverse index
      remove(itemRef);
      remove(indexRef).catch((error) => {
        console.error('Error removing notifier index:', error);
      });
      
      showMessage({
        message: t('notifier.item_removed'),
        type: 'info',
        duration: 2000,
      });
    };
  
    proceedToRemove();
  };
  

  const renderItem = ({ item }) => {
    const itemName = item?.name || item?.Name || '';
    const key = itemName.replace(/[^a-zA-Z0-9]/g, '_');
    const isSelected = !!savedItems[mode]?.[key];
    return (
      <TouchableOpacity
        style={[styles.itemContainer, isSelected && styles.itemSelected, isDarkMode && styles.itemContainerDark]}
        onPress={() => handleSelect(item)}>
        <Image resizeMethod="resize"
          source={{ uri: getImageUrl(item) }}
          style={styles.itemImage}
        />
        <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000' }]}>{itemName}</Text>
      </TouchableOpacity>
    );
  };

  const renderSavedItem = ([key, data]) => {
    // ✅ OPTIMIZED: Generate image URL from name only (image is inferred from parsedValuesData)
    // This reduces Firebase storage and download costs significantly
    // Handle both old format (object with name) and new format (string value)
    const itemName = typeof data === 'string' ? data : (data?.name || data?.Name || '');
    const imageUrl = getImageUrl({}, itemName); // Pass empty object, name as override
    return (
      <View style={styles.savedItem} key={key}>
        <Image resizeMethod="resize" source={{ uri: imageUrl }} style={styles.itemImageSelected} />
        <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000', marginLeft:5 }]}>{itemName}</Text>
        <TouchableOpacity onPress={() => handleRemove(key)}>
        <Icon name="close-circle" size={20} color="red" style={styles.removeText} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#fff' }]}>
        {/* <Text style={[styles.infoText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#aaa' : '#666' }]}>
        Select items you want to buy or sell — we’ll notify you when someone is offering them or looking for them in a trade.
</Text> */}

      <TouchableOpacity style={styles.fab} onPress={openDrawerToSelect}>
        <Icon name="add-circle" size={44} color={config.colors.primary} />
      </TouchableOpacity>

      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'buy' && styles.active]}
          onPress={() => setMode('buy')}>
          <Text style={{ fontFamily: 'Lato-Bold', color: '#fff', fontSize:13 }}>{t('notifier.when_offered')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'sale' && styles.active]}
          onPress={() => setMode('sale')}>
          <Text style={{ fontFamily: 'Lato-Bold', color: '#fff' , fontSize:13 }}>{t('notifier.when_wanted')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { fontFamily: 'Lato-Bold', color: isDarkMode ? '#fff' : '#000' }]}>{subtitleText}</Text>

      <View style={{ flexWrap: 'wrap', flexDirection: 'row', gap: 8 }}>
  {Object.keys(savedItems[mode] || {}).length > 0
    ? Object.entries(savedItems[mode]).map(renderSavedItem)
    : <Text style={[styles.placeholderText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#aaa' : '#888' }]}>
        {t('notifier.no_items')}
      </Text>}
</View>


      <Modal visible={isDrawerVisible} animationType="slide">
        <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', paddingTop: 12 + insets.top, paddingBottom: 12 + insets.bottom }]}>
          <Text style={[styles.sectionTitle, { fontFamily: 'Lato-Bold', color: isDarkMode ? '#fff' : '#000' }]}>{t('notifier.select_items')}</Text>

          <FlatList removeClippedSubviews={false}
            data={parsedValuesData}
            renderItem={renderItem}
            keyExtractor={(item, index) => item?.name || item?.Name || `item-${index}`}
            numColumns={3}
            contentContainerStyle={styles.grid}
          />

          <TouchableOpacity onPress={() => setIsDrawerVisible(false)} style={styles.closeButton}>
            <Text style={{ fontFamily: 'Lato-Bold', color: '#fff' }}>{t('reward_center.close')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
    textRegular: { fontFamily: 'Lato-Regular' },
    textBold: { fontFamily: 'Lato-Bold' },
  
    container: { flex: 1, padding: 12 },
    drawerContainer: { flex: 1, padding: 12 },
    modeToggle: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
    toggleButton: { padding: 10, marginHorizontal: 5, backgroundColor: '#ccc', borderRadius: 8 },
    active: { backgroundColor: config.colors.primary },
  
    sectionTitle: {
      fontFamily: 'Lato-Bold',
      fontSize: 13,
      marginVertical: 8,
    },
    itemContainer: {
      alignItems: 'center',
      margin: 8,
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 8,
      padding: 5,
      // borderWidth:1
    },
    itemContainerDark: { borderColor: '#333' },
    itemSelected: { borderColor: config.colors.primary, borderWidth: 2 },
  
    itemImage: { width: 50, height: 50, borderRadius: 8 },
    itemImageSelected: { width: 25, height: 25, borderRadius: 8 },
    itemText: {
      fontFamily: 'Lato-Regular',
      fontSize: 12,
      // marginTop: 4,
    },
    savedItem: { alignItems: 'center', justifyContent:'center', marginRight: 5 , borderWidth:1, borderRadius:8, padding:5, flexDirection:'row'},
  
    removeText: {
      fontFamily: 'Lato-Bold',
      color: 'red',
      marginHorizontal:4
      // marginTop: 4,
    },
    placeholderText: {
      fontFamily: 'Lato-Regular',
      padding: 20,
      fontSize: 14,
    },
    infoText: {
      fontFamily: 'Lato-Regular',
    //   textAlign: 'center',
      fontSize: 13,
      marginBottom: 6,
    },
    grid: { paddingBottom: 100 },
  
    fab: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      zIndex: 10,
    },
    closeButton: {
      marginTop: 20,
      alignSelf: 'center',
      backgroundColor: config.colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
  });
  

export default NotifierDrawer;