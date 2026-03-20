import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Pressable, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref } from '@react-native-firebase/database';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import Share from 'react-native-share';
import ShareTradeModal from '../Trades/ShareTradeModal';
import { addDoc, collection, serverTimestamp, doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import SubscriptionScreen from '../SettingScreen/OfferWall';

const GRID_STEPS = [9, 12, 15, 18];

const createEmptySlots = (count) => Array(count).fill(null);



// ✅ MM2: Removed VALUE_TYPES, MODIFIERS, and hideBadge - MM2 doesn't use these

// ✅ MM2: Removed getItemValue function - MM2 uses simple value field

const getTradeStatus = (hasTotal, wantsTotal) => {
  // If both are 0 (initial state), show WIN
  if (hasTotal === 0 && wantsTotal === 0) return 'win';

  // If only has items are selected (wantsTotal is 0), show LOSE
  if (hasTotal > wantsTotal) return 'lose';

  // If only wants items are selected (hasTotal is 0), show WIN
  if (hasTotal < wantsTotal) return 'win';

  // If both have equal values, show FAIR
  return 'fair';
};

// ✅ Format values with K, M, T abbreviations
const formatValue = (value) => {
  if (!value || value === 0) return '0';
  const numValue = Number(value);
  
  if (numValue >= 1_000_000_000_000) {
    return `${(numValue / 1_000_000_000_000).toFixed(1)}T`; // Trillions
  } else if (numValue >= 1_000_000_000) {
    return `${(numValue / 1_000_000_000).toFixed(1)}B`; // Billions
  } else if (numValue >= 1_000_000) {
    return `${(numValue / 1_000_000).toFixed(1)}M`; // Millions
  } else if (numValue >= 1_000) {
    return `${(numValue / 1_000).toFixed(1)}K`; // Thousands
  } else {
    return numValue.toLocaleString(); // Default formatting for numbers < 1000
  }
};

const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, firestoreDB, single_offer_wall } = useGlobalState();
  const tradesCollection = collection(firestoreDB, 'trades_new');
  const [gridStepIndex, setGridStepIndex] = useState(0); // 0 -> 9, 1 -> 12, 2 -> 15, 3 -> 18
const [hasItems, setHasItems] = useState(() => createEmptySlots(GRID_STEPS[0]));
const [wantsItems, setWantsItems] = useState(() => createEmptySlots(GRID_STEPS[0]));

  const [fruitRecords, setFruitRecords] = useState([]);
  const [selectedPetType, setSelectedPetType] = useState('INVENTORY');
  // const [wantsItems, setWantsItems] = useState(INITIAL_ITEMS);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState(0);
  const [wantsTotal, setWantsTotal] = useState(0);
  const { triggerHapticFeedback } = useHaptic();
  const { localState, updateLocalState } = useLocalState();
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [lastTradeTime, setLastTradeTime] = useState(null);
  const [adShowen, setadShowen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null);
  const platform = Platform.OS.toLowerCase();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const viewRef = useRef();
  // ✅ Add refs to track timeouts and animation frames for cleanup
  const timeoutRefs = useRef({});
  const rafRefs = useRef({});
  const isMountedRef = useRef(true);
  // ✅ MM2: Removed value type and modifier states - MM2 doesn't use these
  const [isAddingToFavorites, setIsAddingToFavorites] = useState(false);
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);
  const [debouncedSearchText, setDebouncedSearchText] = useState(searchText);
  const [showofferwall, setShowofferwall] = useState(false);

  // ✅ Cleanup all timeouts and animation frames on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear all timeouts
      Object.values(timeoutRefs.current).forEach(id => {
        if (id) clearTimeout(id);
      });
      timeoutRefs.current = {};
      // Cancel all animation frames
      Object.values(rafRefs.current).forEach(id => {
        if (id) cancelAnimationFrame(id);
      });
      rafRefs.current = {};
    };
  }, []);



  // ✅ MM2 Categories
  const CATEGORIES = useMemo(() => {
    return ['INVENTORY', 'ALL', 'ANCIENT', 'UNIQUE', 'CHROMA', 'GODLY', 'LEGEND', 'RARE', 'UNCOMMON', 'COMMON', 'VINTAGE', 'PETS'];
  }, []);

  const tradeStatus = useMemo(() =>
    getTradeStatus(hasTotal, wantsTotal)
    , [hasTotal, wantsTotal]);


  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300); // Adjust delay as needed

    return () => clearTimeout(timeout);
  }, [searchText]);
  const progressBarStyle = useMemo(() => {
    // When both sides are empty, show a balanced fair state (50-50)
    if (!hasTotal && !wantsTotal) return { left: '50%', right: '50%' };

    const total = hasTotal + wantsTotal;
    const hasPercentage = (hasTotal / total) * 100;
    const wantsPercentage = (wantsTotal / total) * 100;

    return {
      left: `${hasPercentage}%`,
      right: `${wantsPercentage}%`
    };
  }, [hasTotal, wantsTotal]);



  const handleLoginSuccess = useCallback(() => {
    setIsSigninDrawerVisible(false);
  }, []);

  const resetState = useCallback(() => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal(0);
    setWantsTotal(0);
    setGridStepIndex(0);
    setHasItems(createEmptySlots(GRID_STEPS[0]));
    setWantsItems(createEmptySlots(GRID_STEPS[0]));
  }, [triggerHapticFeedback]);
  

  // ✅ MM2 image URL generation
  const getImageUrl = useCallback((item) => {
    if (!item || !item.name) return '';

    // ✅ MM2 format: https://mm2values.com/${item.image}
    if (item.image) {
      return `https://mm2values.com/${item.image}`;
    }

    // Fallback: try Image property (from extractMM2Values)
    if (item.Image) {
      return item.Image;
    }

    return '';
  }, []);


  const updateTotal = useCallback((item, section, add = true, isNew = false) => {
    if (!item) return;

    // ✅ MM2: Use Value property directly (no valueType/modifiers needed)
    const value = Number(item.Value || item.selectedValue || 0);
    const valueChange = isNew ? (add ? value : -value) : 0;

    if (section === 'has') {
      setHasTotal(prev => prev + valueChange);
    } else {
      setWantsTotal(prev => prev + valueChange);
    }
  }, []);

  // ✅ MM2: Removed handleBadgePress - MM2 doesn't use badges
  const maybeExpandGrid = useCallback(
    (nextHasItems, nextWantsItems) => {
      const currentSize = GRID_STEPS[gridStepIndex];
      const maxStepIndex = GRID_STEPS.length - 1;
  
      const hasCount = nextHasItems.filter(Boolean).length;
      const wantsCount = nextWantsItems.filter(Boolean).length;
  
      // Already at max (18 slots per side)
      if (gridStepIndex === maxStepIndex) {
        setHasItems(nextHasItems);
        setWantsItems(nextWantsItems);
        return;
      }
  
      // If either side filled all current slots -> grow to next step
      if (hasCount >= currentSize || wantsCount >= currentSize) {
        const nextSize = GRID_STEPS[gridStepIndex + 1];
        const diff = nextSize - currentSize;
  
        setGridStepIndex((prev) => prev + 1);
        setHasItems([...nextHasItems, ...createEmptySlots(diff)]);
        setWantsItems([...nextWantsItems, ...createEmptySlots(diff)]);
      } else {
        setHasItems(nextHasItems);
        setWantsItems(nextWantsItems);
      }
    },
    [gridStepIndex]
  );
  

  const selectItem = useCallback(
    (item) => {
      if (!item || !selectedSection) return;
  
      triggerHapticFeedback('impactLight');
  
      // ✅ MM2: Use Value directly (no modifiers needed)
      const value = Number(item.Value || 0);
  
      const selectedItem = {
        ...item,
        selectedValue: value,
        Value: value,
      };
  
      // Work on copies of both sides so we can decide expansion
      const nextHasItems = [...hasItems];
      const nextWantsItems = [...wantsItems];
  
      const targetArray =
        selectedSection === 'has' ? nextHasItems : nextWantsItems;
  
      let nextEmptyIndex = targetArray.indexOf(null);
  
      // No empty slot left even at 18 → do nothing
      if (nextEmptyIndex === -1) {
        return;
      }
  
      targetArray[nextEmptyIndex] = selectedItem;
  
      // Update totals for the side we modified
      updateTotal(
        selectedItem,
        selectedSection === 'has' ? 'has' : 'wants',
        true,
        true
      );
  
      // This will also expand 9→12→15→18 if needed
      maybeExpandGrid(nextHasItems, nextWantsItems);
  
      setIsDrawerVisible(false);
    },
    [
      hasItems,
      wantsItems,
      selectedSection,
      triggerHapticFeedback,
      updateTotal,
      maybeExpandGrid,
    ]
  );
  

  const handleCellPress = useCallback((index, isHas) => {
    const items = isHas ? hasItems : wantsItems;

    const callbackfunction = () => {};

    if (items[index]) {
      triggerHapticFeedback('impactLight');
      const item = items[index];
      const updatedItems = [...items];
      updatedItems[index] = null;

      if (isHas) {
        setHasItems(updatedItems);
        updateTotal(item, 'has', false, true);
      } else {
        setWantsItems(updatedItems);
        updateTotal(item, 'wants', false, true);
      }
    } else {
      triggerHapticFeedback('impactLight');
      setSelectedSection(isHas ? 'has' : 'wants');
      setIsDrawerVisible(true);

      // ✅ Store timeout and animation frame IDs for cleanup
      const rafKey1 = `cellPress_${Date.now()}_1`;
      const timeoutKey1 = `cellPress_${Date.now()}_2`;
      const rafKey2 = `cellPress_${Date.now()}_3`;
      const timeoutKey2 = `cellPress_${Date.now()}_4`;

      rafRefs.current[rafKey1] = requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        
        timeoutRefs.current[timeoutKey1] = setTimeout(() => {
          if (!isMountedRef.current) return;
          
          if (!adShowen && index === 1 && !localState.isPro && !isHas) {
            rafRefs.current[rafKey2] = requestAnimationFrame(() => {
              if (!isMountedRef.current) return;
              
              timeoutRefs.current[timeoutKey2] = setTimeout(() => {
                if (!isMountedRef.current) return;
                
                try {
                  callbackfunction();
                } catch (err) {
                  console.warn('[AdManager] Failed to show ad:', err);
                  callbackfunction();
                }
                // Clean up after execution
                delete timeoutRefs.current[timeoutKey2];
              }, 400);
            });
          } else {
            callbackfunction();
          }
          // Clean up after execution
          delete timeoutRefs.current[timeoutKey1];
        }, 500);
      });
    }
  }, [hasItems, wantsItems, triggerHapticFeedback, updateTotal, adShowen, localState.isPro]);

  // ✅ MM2: Removed mode change effect - MM2 doesn't use Shark/Frost mode
  // ✅ MM2: Simplified toggleFavorite (no type needed)
  const toggleFavorite = useCallback((item) => {
    if (!item || (!item.name && !item.Name)) return;

    const currentFavorites = localState.favorites || [];
    const itemName = item.name || item.Name;
    // ✅ Save only identifiers to keep favorites updated with latest values
    const favoriteIdentifier = {
      name: itemName,
      id: item.id,
    };
    
    const isFavorite = currentFavorites.some(
      fav => (fav.id && fav.id === item.id) || 
             (fav.name && fav.name.toLowerCase() === itemName.toLowerCase())
    );

    let newFavorites;
    if (isFavorite) {
      // Remove by matching id or name
      newFavorites = currentFavorites.filter(
        fav => !((fav.id && fav.id === item.id) || 
                 (fav.name && fav.name.toLowerCase() === itemName.toLowerCase()))
      );
    } else {
      newFavorites = [...currentFavorites, favoriteIdentifier];
    }

    updateLocalState('favorites', newFavorites);
    triggerHapticFeedback('impactLight');
  }, [localState.favorites, updateLocalState, triggerHapticFeedback]);

  // ✅ MM2: Simplified filteredData (no value types/modifiers needed)
  const filteredData = useMemo(() => {
    let list;
    if (selectedPetType === 'INVENTORY') {
      // ✅ Match favorite identifiers with current fruitRecords to get latest data
      const favoriteIdentifiers = localState.favorites || [];
      list = favoriteIdentifiers
        .map(favIdentifier => {
          // Find matching item in fruitRecords by id or name
          const foundItem = fruitRecords.find(
            item => item && (
              (favIdentifier.id && item.id === favIdentifier.id) ||
              (favIdentifier.name && item.name && 
               item.name.toLowerCase() === favIdentifier.name.toLowerCase())
            )
          );
          return foundItem || null;
        })
        .filter(Boolean); // Remove nulls (items that no longer exist)
    } else {
      list = fruitRecords;
    }
    return list
      .filter(item => {
        if (!item) return false;
        const matchesSearch = item.name?.toLowerCase().includes(debouncedSearchText.toLowerCase());
        const matchesType = selectedPetType === 'INVENTORY' || 
                           selectedPetType === 'ALL' || 
                           selectedPetType.toLowerCase() === item.Category?.toLowerCase() ||
                           selectedPetType.toLowerCase() === item.type?.toLowerCase();
        return matchesSearch && matchesType;
      })
      .sort((a, b) => (b.Value || 0) - (a.Value || 0));
  }, [
    fruitRecords,
    debouncedSearchText,
    selectedPetType,
    localState.favorites,
  ]);
  // ✅ MM2: Removed badge handlers - MM2 doesn't use badges

  // ✅ MM2: Simplified favorite item render (no badges needed)
  const renderFavoriteItem = useCallback(({ item }) => {
    const imageUrl = getImageUrl(item);
    const currentValue = Number(item.Value || 0);

    // Handler to add item to calculator
    const handleAddToCalculator = () => {
      if (!selectedSection) return;
      triggerHapticFeedback('impactLight');
      
      const selectedItem = {
        ...item,
        selectedValue: currentValue,
        Value: currentValue,
      };

      const nextHasItems = [...hasItems];
      const nextWantsItems = [...wantsItems];
      const targetArray = selectedSection === 'has' ? nextHasItems : nextWantsItems;
      let nextEmptyIndex = targetArray.indexOf(null);

      if (nextEmptyIndex === -1) return;

      targetArray[nextEmptyIndex] = selectedItem;
      updateTotal(selectedItem, selectedSection === 'has' ? 'has' : 'wants', true, true);
      maybeExpandGrid(nextHasItems, nextWantsItems);
      setIsDrawerVisible(false);
    };

    return (
      <View style={styles.favoriteRowItem}>
        {/* Left side: Image and Info (clickable to add to calculator) */}
        <TouchableOpacity
          style={styles.favoriteClickableArea}
          onPress={handleAddToCalculator}
          activeOpacity={0.7}
        >
          <View style={styles.favoriteImageContainer}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.favoriteItemImage} />
            ) : (
              <View style={[styles.favoriteItemImage, { backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight, justifyContent: 'center', alignItems: 'center' }]}>
              <Icon name="image-outline" size={18} color={isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight} />
              </View>
            )}
          </View>

          <View style={styles.favoriteItemInfo}>
            <Text style={styles.favoriteItemName} numberOfLines={1}>{item.name || item.Name}</Text>
            <Text style={styles.favoriteItemValue}>Value: {formatValue(currentValue)}</Text>
            {item.Tier && (
              <Text style={styles.favoriteItemRarity}>{item.Tier}</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Right side: Delete button (only removes from favorites) */}
        <TouchableOpacity
          style={styles.favoriteDeleteButton}
          activeOpacity={0.8}
          onPress={() => {
            triggerHapticFeedback('impactLight');
            toggleFavorite(item);
          }}
        >
          <Icon name="close-circle" size={20} color={config.colors.error} />
        </TouchableOpacity>
      </View>
    );
  }, [selectedSection, hasItems, wantsItems, updateTotal, maybeExpandGrid, triggerHapticFeedback, toggleFavorite, isDarkMode, getImageUrl]);

  // ✅ MM2: Simplified grid item render
  const renderGridItem = useCallback(({ item }) => {
    const imageUrl = getImageUrl(item);
    const isFavorite = (localState.favorites || []).some(
      fav => (fav.id && fav.id === item.id) || 
             (fav.name && fav.name.toLowerCase() === (item.name || item.Name)?.toLowerCase())
    );
    
    return (
      <TouchableOpacity
        style={styles.gridItem}
        onPress={() => {
          if (isAddingToFavorites) {
            // When in "add to favorites" mode, clicking toggles favorite
            toggleFavorite(item);
          } else {
            // Normal mode: clicking adds item to calculator
            selectItem(item);
          }
        }}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.gridItemImage}
          />
        ) : (
          <View style={[styles.gridItemImage, { backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight, justifyContent: 'center', alignItems: 'center' }]}>
            <Icon name="image-outline" size={30} color={isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight} />
          </View>
        )}
      <Text numberOfLines={1} style={styles.gridItemText}>
        {item.name || item.Name}
      </Text>
      {isAddingToFavorites && (
        <TouchableOpacity
          style={styles.favoriteButton}
          activeOpacity={0.8}
          onPress={() => {
            toggleFavorite(item);
          }}
        >
          <Icon
            name={isFavorite ? "heart" : "heart-outline"}
            size={20}
            color={isFavorite ? "#e74c3c" : "#666"}
          />
        </TouchableOpacity>
      )}
      </TouchableOpacity>
    );
  }, [selectItem, toggleFavorite, localState.favorites, isAddingToFavorites, isDarkMode, getImageUrl]);

  // Update renderFavoritesHeader function
  const renderFavoritesHeader = useCallback(() => {
    if (selectedPetType === 'INVENTORY') {
      return (
        <View style={styles.favoritesHeader}>
          <Text style={styles.favoritesTitle}>My Inventory</Text>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);

  // Update renderFavoritesFooter function
  const renderFavoritesFooter = useCallback(() => {
    if (selectedPetType === 'INVENTORY') {
      return (
        <View style={styles.badgeContainer}>
          <TouchableOpacity
            style={styles.addToFavoritesButton}
            onPress={() => {
              setIsAddingToFavorites(true);
              setSelectedPetType('ALL');
            }}
          >
            <Icon name="add-circle" size={30} color={config.colors.hasBlockGreen} />
            <Text style={styles.addToFavoritesText}>Add Items to Inventory</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);

  // Memoize key extractor
  const keyExtractor = useCallback((item, index) =>
    item.id?.toString() || `${item.name}-${item.type}-${index}`, []);


  // Optimize FlatList performance
  const getItemLayout = useCallback((data, index) => {
    // For favorites: row layout with larger height, for grid: smaller height
    const itemHeight = selectedPetType === 'INVENTORY' && !isAddingToFavorites ? 100 : 100;
    return {
      length: itemHeight,
      offset: itemHeight * index,
      index,
    };
  }, [selectedPetType, isAddingToFavorites]);



  // ✅ MM2: Removed factor fetching - MM2 doesn't use Shark/Frost mode factor

  // console.log(localState.isGG)

  // ✅ Extract MM2 values from nested structure {category: {tier: [items]}}
  const extractMM2Values = useCallback((data) => {
    const items = [];

    try {
      for (const [category, tiers] of Object.entries(data)) {
        for (const [tier, values] of Object.entries(tiers)) {
          for (const item of values) {
            if (!item?.name) continue;

            const cleanedValue = String(item.value).replace(/,/g, '');
            const numericValue = !isNaN(cleanedValue) ? Number(cleanedValue) : null;

            items.push({
              Name: item.name,
              name: item.name,
              FormattedValue: numericValue !== null ? formatValue(numericValue) : item.value,
              Value: numericValue !== null ? numericValue : 0,
              Image: `https://mm2values.com/${item.image}`,
              image: item.image,
              Category: category.trim(),
              category: category.trim(),
              Tier: tier,
              tier: tier,
              type: category.trim(), // For compatibility with existing code
              id: `${category}-${tier}-${item.name}`, // Generate unique ID
            });
          }
        }
      }
    } catch (error) {
      console.error("❌ Failed to extract MM2 values:", error);
    }

    return items;
  }, []);

  useEffect(() => {
    let isMounted = true;

    const parseAndSetData = async () => {
      try {
        const source = localState.data;

        if (!source) {
          if (isMounted) setFruitRecords([]);
          return;
        }

        const parsed = typeof source === 'string' ? JSON.parse(source) : source;

        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          // ✅ MM2 data structure: {category: {tier: [items]}}
          const extracted = extractMM2Values(parsed);
          if (isMounted) {
            setFruitRecords(extracted);
          }
        } else {
          if (isMounted) setFruitRecords([]);
        }
      } catch (err) {
        console.error("❌ Error parsing data in HomeScreen:", err);
        if (isMounted) setFruitRecords([]);
      }
    };

    parseAndSetData();

    return () => {
      isMounted = false;
    };
  }, [localState.data, extractMM2Values]);

  // console.log(filteredData.length)





  const handleCreateTradePress = useCallback(() => {
    // console.log(user.id);
    if (!user?.id) {
      setIsSigninDrawerVisible(true); // Open SignInDrawer if not logged in
      return;
    }

    // ✅ Store timeout ID for cleanup
    const timeoutKey = `createTrade_${Date.now()}`;
    timeoutRefs.current[timeoutKey] = setTimeout(() => {
      if (!isMountedRef.current) return;
      
      const hasItemsCount = hasItems.filter(Boolean).length;
      const wantsItemsCount = wantsItems.filter(Boolean).length;

      if (hasItemsCount === 0 && wantsItemsCount === 0) {
        showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
        return;
      }

      setType('create');
      setModalVisible(true);
      // Clean up after execution
      delete timeoutRefs.current[timeoutKey];
    }, 100); // Small delay to allow React state to settle
  }, [hasItems, wantsItems, t, user?.id]);

  const handleCreateTrade = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      // ✅ FIRESTORE ONLY: Read rating summary from user_ratings_summary (single source of truth)
      let userRating = null;
      let ratingCount = 0;
      
      if (firestoreDB && user?.id) {
        const summaryDocSnap = await getDoc(doc(firestoreDB, 'user_ratings_summary', user.id));
        if (summaryDocSnap.exists) {
          const summaryData = summaryDocSnap.data();
          userRating = summaryData.averageRating || null;
          ratingCount = summaryData.count || 0;
        } else {
          // ✅ ONE-TIME MIGRATION: If Firestore summary doesn't exist, check RTDB and migrate (legacy data only)
          // This is a temporary migration path for existing data. New ratings only use Firestore.
          const database = getDatabase();
          const avgRatingSnap = await ref(database, `averageRatings/${user.id}`).once('value');
          const avgRatingData = avgRatingSnap.val();
          
          if (avgRatingData) {
            userRating = avgRatingData.value || null;
            ratingCount = avgRatingData.count || 0;
            
            // ✅ ONE-TIME MIGRATION: Copy to Firestore (async, don't wait)
            if (userRating || ratingCount > 0) {
              setDoc(
                doc(firestoreDB, 'user_ratings_summary', user.id),
                {
                  averageRating: userRating || 0,
                  count: ratingCount || 0,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch(err => console.error('Error migrating rating summary to Firestore:', err));
            }
          }
        }
      }
      const now = Date.now(); // ✅ Use Date.now() for cooldown comparison
      const timestamp = serverTimestamp(); // ✅ Use serverTimestamp() for Firestore

      // ✅ Calculate hasRecentGameWin (similar to Trader.jsx)
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

      // ✅ MM2: Simplified trade item mapping - save full URL for backward compatibility with old apps
      const mapTradeItem = item => {
        // ✅ Prioritize Image (full URL) over image (relative path) for old app compatibility
        let imageUrl = item.Image || item.image || '';
        
        // ✅ If we have a relative path, convert it to full URL (for backward compatibility)
        if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          imageUrl = `https://mm2values.com/${imageUrl}`;
        }
        
        return {
          name: item.name || item.Name,
          type: item.type || item.Category || item.Type,
          value: item.Value || item.value || 0,
          image: imageUrl, // ✅ Save full URL like old app expects
          // ✅ Include deprecated names if available
          deprecatedNames: item.deprecatedNames || item.deprecated_names || null,
          deprecatedName: item.deprecatedName || item.deprecated_name || null,
        };
      };
      
      // ✅ Calculate trade status and convert to single letter: 'w' (win), 'l' (lose), 'f' (fair)
      const tradeStatus = getTradeStatus(hasTotal, wantsTotal);
      const statusLetter = tradeStatus === 'win' ? 'w' : tradeStatus === 'lose' ? 'l' : 'f';
      
      const newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState.isPro,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        wantsItems: wantsItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        // ✅ Migration: Save in old format { value: number } for backward compatibility with old apps
        hasTotal: { value: hasTotal || 0 },
        wantsTotal: { value: wantsTotal || 0 },
        description: description || "",
        timestamp: timestamp, // ✅ Use serverTimestamp for Firestore
        status: statusLetter, // ✅ Trade status: 'w' (win), 'l' (lose), 'f' (fair)
        rating: userRating,
        ratingCount,
        flage: user.flage ? user.flage : null,
        robloxUsername: user?.robloxUsername || null,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        hasRecentGameWin: hasRecentWin, // ✅ Game win info
        lastGameWinAt: user?.lastGameWinAt || null, // ✅ Game win timestamp


      };
      
      // ✅ 2-minute cooldown check (using Date.now() for accurate comparison)
      const COOLDOWN_MS = 120000; // 2 minutes
      if (lastTradeTime && (now - lastTradeTime) < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000);
        const minutesLeft = Math.floor(secondsLeft / 60);
        const remainingSeconds = secondsLeft % 60;
        const timeMessage = minutesLeft > 0 
          ? `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`
          : `${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;
        showErrorMessage(t("home.alert.error"), `Please wait ${timeMessage} before creating a new trade.`);
        setIsSubmitting(false);
        return;
      }


await addDoc(tradesCollection, newTrade);
      // Step 1: Close modal first
      setModalVisible(false);

      // Step 2: Reset calculator (both sides) after successful trade creation
      resetState();
      setDescription(''); // ✅ Clear description input

      // Step 3: Define the success callback
      const callbackfunction = () => {
        if (!isMountedRef.current) return;
        showSuccessMessage(t("home.alert.success"), "Your trade has been posted successfully!");
      };

      // Step 4: Update timestamp and analytics
      setLastTradeTime(now); // ✅ Use Date.now() for cooldown tracking
      mixpanel.track("Trade Created", { user: user?.id });

      // ✅ Store timeout and animation frame IDs for cleanup
      const rafKey1 = `createTrade_raf_${Date.now()}_1`;
      const timeoutKey1 = `createTrade_timeout_${Date.now()}_1`;
      const rafKey2 = `createTrade_raf_${Date.now()}_2`;
      const timeoutKey2 = `createTrade_timeout_${Date.now()}_2`;

      // Step 5: Wait for next frame (modal animation finish) then delay for iOS
      rafRefs.current[rafKey1] = requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        
        // Wait for modal animation to finish before showing ad
        timeoutRefs.current[timeoutKey1] = setTimeout(() => {
          if (!isMountedRef.current) return;
          
          if (!localState.isPro) {
            rafRefs.current[rafKey2] = requestAnimationFrame(() => {
              if (!isMountedRef.current) return;
              
              timeoutRefs.current[timeoutKey2] = setTimeout(() => {
                if (!isMountedRef.current) return;
                
                try {
                  InterstitialAdManager.showAd(callbackfunction);
                } catch (err) {
                  console.warn('[AdManager] Failed to show ad:', err);
                  callbackfunction();
                }
                // Clean up after execution
                delete timeoutRefs.current[timeoutKey2];
              }, 400); // Adjust based on animation time
            });
          } else {
            callbackfunction();
          }
          // Clean up after execution
          delete timeoutRefs.current[timeoutKey1];
        }, 500); // Give modal time to fully disappear on iOS
      });

    } catch (error) {
      console.error("Error creating trade:", error);
      showErrorMessage(t("home.alert.error"), "Something went wrong while posting the trade.");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, user, localState.isPro, hasItems, wantsItems, description, type, lastTradeTime, tradesCollection, t, resetState]);

  const handleShareTrade = useCallback(() => {
    const hasItemsCount = hasItems.filter(Boolean).length;
    const wantsItemsCount = wantsItems.filter(Boolean).length;

    if (hasItemsCount === 0 && wantsItemsCount === 0) {
      showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
      return;
    }

    setIsShareModalVisible(true);
  }, [hasItems, wantsItems, t]);

  const profitLoss = wantsTotal - hasTotal;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;

  const  isGG = localState.isGG

  const styles = useMemo(() => getStyles(isDarkMode, isGG), [isDarkMode, isGG]);

  const lastFilledIndexHas = useMemo(() =>
    hasItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1)
    , [hasItems]);

  const lastFilledIndexWant = useMemo(() =>
    wantsItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1)
    , [wantsItems]);

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container} key={language}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <ViewShot ref={viewRef} style={styles.screenshotView}>
              {config.isNoman && (
                <View style={styles.summaryContainer}>
                  <View style={styles.summaryInner}>
                    <View style={styles.topSection}>
                      <Text style={styles.bigNumber}>{formatValue(hasTotal) || '0'}</Text>
                      <View style={styles.statusContainer}>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'fair' ? {
                            ...styles.statusActive,
                            backgroundColor: config.colors.secondary // Blue for fair
                          } : styles.statusInactive
                        ]}>FAIR</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'win' ? {
                            ...styles.statusActive,
                            backgroundColor: '#10B981' // Green for win
                          } : styles.statusInactive
                        ]}>WIN</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'lose' ? {
                            ...styles.statusActive,
                            backgroundColor: config.colors.primary // Primary color for lose
                          } : styles.statusInactive
                        ]}>LOSE</Text>
                      </View>
                      <Text style={styles.bigNumber}>{formatValue(wantsTotal) || '0'}</Text>
                    </View>
                    {/* <View style={styles.progressContainer}>
                      <View style={styles.progressBar}>
                        <View
                          style={[
                            styles.progressLeft,
                            { width: progressBarStyle.left }
                          ]}
                        />
                        <View
                          style={[
                            styles.progressRight,
                            { width: progressBarStyle.right }
                          ]}
                        />
                      </View>
                    </View> */}
                   
                     <View style={styles.profitLossBox}>
                <Text style={[styles.bigNumber2, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                  {formatValue(Math.abs(profitLoss))}
                </Text>
                <View style={[styles.divider, { position: 'absolute', right: 0 , bottom:0}]}>
                  <Image
                    source={require('../../assets/reset.png')}
                    style={{ width: 18, height: 18, tintColor: 'white' }}
                    onTouchEnd={resetState}
                  />
                </View>
              </View>
                  </View>
                </View>
              )}
             
 <View style={styles.labelContainer}>
                      <Text style={styles.offerLabel}>ME</Text>
                      <Text style={styles.dividerText}></Text>
                      <Text style={styles.offerLabel}>YOU</Text>
                    </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={styles.itemRow}>
                  {hasItems?.map((item, index) => {
                    // For 3 columns
                    const isLastColumn = (index + 1) % 3 === 0;
                    const isLastRow = index >= hasItems.length - 3;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, true)}
                      >
                        {item ? (
                          <>
                            <Image
                              source={{ uri: getImageUrl(item) }}
                              style={[styles.itemImageOverlay]}
                            />
                            {/* ✅ MM2: Show tier badge if available */}
                            {item.Tier && (
                              <View style={styles.itemBadgesContainer}>
                                <Text style={[styles.itemBadge]}>{item.Tier}</Text>
                              </View>
                            )}
                          </>
                        ) : (
                          index === lastFilledIndexHas + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : 'grey'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[styles.itemRow]}>
                  {wantsItems?.map((item, index) => {
                    const isLastColumn = (index + 1) % 3 === 0;
                    const isLastRow = index >= wantsItems.length - 3;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, false)}
                      >
                        {item ? (
                          <>
                            <Image
                              source={{ uri: getImageUrl(item) }}
                              style={[styles.itemImageOverlay]}
                            />
                            {/* ✅ MM2: Show tier badge if available */}
                            {item.Tier && (
                              <View style={styles.itemBadgesContainer}>
                                <Text style={[styles.itemBadge]}>{item.Tier}</Text>
                              </View>
                            )}
                          </>
                        ) : (
                          index === lastFilledIndexWant + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : 'grey'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              {/* ✅ MM2: Removed Shark/Frost mode toggle - MM2 doesn't use these modes */}

              {!config.isNoman && (
                <View style={styles.summaryContainer}>
                  <View style={[styles.summaryBox, styles.hasBox]}>
                    <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                    <View style={{ justifyContent: 'space-between', flexDirection: 'row' }} >
                      <Text style={styles.priceValue}>{t('home.value')}:</Text>
                      <Text style={styles.priceValue}>${formatValue(hasTotal)}</Text>
                    </View>
                  </View>
                  <View style={[styles.summaryBox, styles.wantsBox]}>
                    <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                    <View style={{ justifyContent: 'space-between', flexDirection: 'row' }} >
                      <Text style={styles.priceValue}>{t('home.value')}:</Text>
                      <Text style={styles.priceValue}>${formatValue(wantsTotal)}</Text>
                    </View>
                  </View>
                </View>
              )}
            </ViewShot>
            <View style={styles.createtrade}>
              <TouchableOpacity
                style={styles.createtradeButton}
                onPress={() => handleCreateTradePress()}
              >
                <Text style={{ color: 'white' }}>{t('home.create_trade')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareTradeButton}
                onPress={handleShareTrade}
              >
                <Text style={{ color: 'white' }}>{t('home.share_trade')}</Text>
              </TouchableOpacity>
            </View>
          {!localState.isPro &&  <View style={styles.createtradeAds}>
  <TouchableOpacity
    style={styles.removeAdsButton}
    activeOpacity={0.9}
    onPress={()=>setShowofferwall(true)}
  >
    <View style={styles.removeAdsContent}>
      {/* Crown icon / image */}
      <View style={styles.crownWrapper}>
        {/* <Icon name="trophy" size={18} color="#3b2500" /> */}
       
        <Image
          source={require('../../assets/pro.png')}
          style={{ width: 20, height: 20 }}
          resizeMode="contain"
        />
        
      </View>

      <View style={styles.removeAdsTextWrapper}>
        <Text style={styles.removeAdsTitle}>Remove Ads</Text>
        {/* <Text style={styles.removeAdsSubtitle}>Unlock a clean experience</Text> */}
      </View>
    </View>
  </TouchableOpacity>
</View>}

          </ScrollView>
          <Modal
            visible={isDrawerVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setIsDrawerVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setIsDrawerVisible(false)} />
            <View style={styles.drawerContainer}>
              <View style={styles.drawerHeader}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search..."
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholderTextColor={isDarkMode ? '#999' : '#666'}
                />
                <TouchableOpacity
                  onPress={() => setIsDrawerVisible(false)}
                  style={styles.closeButton}
                >
                  <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.drawerContent}>
                <ScrollView 
                  showsVerticalScrollIndicator={false}
                  style={styles.categoryListScroll}
                  contentContainerStyle={styles.categoryList}
                >
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryButton,
                        selectedPetType === category && styles.categoryButtonActive
                      ]}
                      onPress={() => {
                        setSelectedPetType(category);
                        if (category !== 'INVENTORY') {
                          setIsAddingToFavorites(false);
                        } else {
                          // ✅ Force refresh when switching to INVENTORY tab
                          setIsAddingToFavorites(false);
                          // Trigger a re-render by updating a dummy state
                          // The filteredData will recalculate because it depends on localState.favorites
                        }
                      }}
                    >
                      <Text style={[
                        styles.categoryButtonText,
                        selectedPetType === category && styles.categoryButtonTextActive
                      ]}>{category}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.gridContainer}>
                  {renderFavoritesHeader()}
                  <FlatList
                    key={`${selectedPetType}-${isAddingToFavorites ? 'add' : 'view'}-${(localState.favorites || []).length}`}
                    data={filteredData}
                    keyExtractor={keyExtractor}
                    renderItem={selectedPetType === 'INVENTORY' && !isAddingToFavorites ? renderFavoriteItem : renderGridItem}
                    numColumns={selectedPetType === 'INVENTORY' && !isAddingToFavorites ? 1 : 3}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={5}
                    removeClippedSubviews={true}
                    getItemLayout={selectedPetType === 'INVENTORY' && !isAddingToFavorites ? undefined : getItemLayout}
                  />
                  {selectedPetType === 'INVENTORY' ? renderFavoritesFooter() : null}
                  {/* ✅ MM2: Removed badge buttons (N, F, M, R, D) - MM2 doesn't use value type/modifier badges */}
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={modalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setModalVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
            <ConditionalKeyboardWrapper>
              <View style={{ flexDirection: 'row', flex: 1 }}>
                <View style={[styles.drawerContainer2, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
                  <Text style={styles.modalMessage}>
                    {t("home.trade_description")}
                  </Text>
                  <Text style={styles.modalMessagefooter}>
                    {t("home.trade_description_hint")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t("home.write_description")}
                    maxLength={40}
                    value={description}
                    onChangeText={setDescription}
                  />
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.button, styles.cancelButton]}
                      onPress={() => setModalVisible(false)}
                    >
                      <Text style={styles.buttonText}>{t('home.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.confirmButton]}
                      onPress={handleCreateTrade}
                      disabled={isSubmitting}
                    >
                      <Text style={styles.buttonText}>
                        {isSubmitting ? t('home.submit') : t('home.confirm')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ConditionalKeyboardWrapper>
          </Modal>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            screen='Chat'
            message={t("home.alert.sign_in_required")}
          />
        </View>
        <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Home' oneWallOnly={single_offer_wall} showoffer={!single_offer_wall}/>
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent />}
      <ShareTradeModal
        visible={isShareModalVisible}
        onClose={() => setIsShareModalVisible(false)}
        hasItems={hasItems}
        wantsItems={wantsItems}
        hasTotal={hasTotal}
        wantsTotal={wantsTotal}
        description={description}
      />
    </>
  );
};

const getStyles = (isDarkMode,isGG) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
      paddingBottom: 5,
    },
    summaryContainer: {
      width: '100%',
      
    },
    summaryInner: {
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
      borderRadius: 15,
      marginBottom: 10,
      
      padding: 10,
      shadowColor: config.colors.shadowDark,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 2,
    },
    topSection: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      // marginBottom: 10,
      

    },
    bigNumber: {
      fontSize: 22,
      fontWeight: 'bold',
      textAlign: 'center',
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      minWidth: 100

    },
    bigNumber2: {
      fontSize: 40,
      fontWeight: 'bold',
      textAlign: 'center',
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,

    },
    statusContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
      borderRadius: 20,
      padding: 5,
      paddingHorizontal: 8,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 10,
    },
    statusActive: {
      color: config.colors.white,
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 20,
    },
    statusInactive: {
      color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight,
    },
    progressContainer: {
      marginVertical: 5,

    },
    progressBar: {
      height: 6,
      flexDirection: 'row',
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
    },
    progressLeft: {
      height: '100%',
      backgroundColor: config.colors.hasBlockGreen,
      transition: 'width 0.3s ease',
    },
    progressRight: {
      height: '100%',
      backgroundColor: config.colors.wantBlockRed,
      transition: 'width 0.3s ease',
    },
    labelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-evenly',
      // marginTop: 5,
      flex:1,
      width:'100%',
      // backgroundColor:'red',

    },
    offerLabel: {
      fontSize: 12,
      color: isDarkMode ? '#999' : '#666',
      fontFamily: 'Lato-Bold',
      paddingBottom: 5,
    },
    dividerText: {
      fontSize: 14,
      color: '#999',
      paddingHorizontal: 5,
    },
    summaryBox: {
      width: '48%',
      padding: 5,
      borderRadius: 8,
    },
    profitLossBox: {
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      // paddingVertical: 10,
    },
    hasBox: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantsBox: {
      backgroundColor: config.colors.wantBlockRed,
    },
    priceValue: {
      color: 'white',
      textAlign: 'center',
      marginTop: 5,
      fontFamily: 'Lato-Bold',
    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      width: '49%',
      alignItems: 'center',
      marginBottom: 5,
      borderWidth: 1,
      borderColor: isGG ? config.colors.borderDark : config.colors.primary,
      marginHorizontal: 'auto',
      borderRadius: 4,
      overflow: 'hidden',
    },
    addItemBlockNew: {
      width: '33.33%',
      height: 60,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: isGG ? config.colors.borderDark : config.colors.primary,
    },
    itemText: {
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
      fontSize: 12
    },
    removeButton: {
      position: 'absolute',
      top: 2,
      right: 2,
      // backgroundColor: config.colors.wantBlockRed,
      borderRadius: 50,
      opacity: .7
    },
    divider: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary,
      margin: 'auto',
      borderRadius: 12,
      padding: 5,
    },
    drawerContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.surfaceLight,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      height: '80%',
      paddingTop: 16,
      paddingHorizontal: 16,
    },
    drawerContainer2: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.surfaceLight,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      // height: '80%',
      paddingTop: 16,
      paddingHorizontal: 16,
    },
    drawerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    drawerContent: {
      flex: 1,
      flexDirection: 'row',
    },
    categoryListScroll: {
      maxWidth: '25%',
      width: '25%',
      paddingRight: 12,
    },
    categoryList: {
      paddingVertical: 2,
    },
    categoryButton: {
      marginVertical: 2,
      marginHorizontal: 4,
      paddingVertical: 8,
      paddingHorizontal: 6,
      backgroundColor: '#f0f0f0',
      borderRadius: 6,
      alignItems: 'center',
      minWidth: 40,
    },
    categoryButtonActive: {
      backgroundColor: '#FF9999',
    },
    categoryButtonText: {
      fontSize: 8,
      fontWeight: '600',
      color: '#666',
    },
    categoryButtonTextActive: {
      color: '#fff',
    },
    gridContainer: {
      flex: 1,
      flexShrink: 1,
      flex: 1,
      // paddingBottom: 60,
    },
    gridItem: {
      flex: 1,
      margin: 4,
      alignItems: 'center',
    },
    gridItemImage: {
      width: 60,
      height: 60,
      borderRadius: 10,
    },
    gridItemText: {
      fontSize: 11,
      marginTop: 4,
      color: isDarkMode ? '#fff' : '#333',
    },
    badgeContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#4A4A4A' : '#E0E0E0',
      // marginTop: 8,
    },
    badge: {
      color: 'white',
      padding: 0.5,
      borderRadius: 10,
      fontSize: 6,
      minWidth: 10,
      textAlign: 'center',
      overflow: 'hidden',
      fontWeight: '600',
    },
    badgeButton: {
      marginHorizontal: 4,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
    },
    badgeButtonActive: {
      backgroundColor: '#3498db',
    },
    badgeButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: isDarkMode ? '#fff' : '#666',
    },
    badgeButtonTextActive: {
      color: '#fff',
    },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
    },
    searchInput: {
      width: '75%',
      borderColor: '#333',
      borderWidth: 1,
      borderRadius: 5,
      height: 40,
      paddingHorizontal: 10,
      backgroundColor: '#fff',
      color: '#000',
    },
    closeButton: {
      backgroundColor: config.colors.wantBlockRed,
      padding: 10,
      borderRadius: 5,
      height: 40,

      width: '24%',
      alignItems: 'center',
      justifyContent: 'center'
    },
    closeButtonText: {
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Regular',
      fontSize: 12
    },
    itemImageOverlay: {
      width: 40,
      height: 40,
      borderRadius: 5,
      resizeMode: 'contain',
    },
    screenshotView: {
      padding: 10,
      flex: 1,
    },


    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      alignSelf: 'center',
      padding: 10,
      justifyContent: 'center',
      flexDirection: 'row',
      minWidth: 120,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      marginRight: 1
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      alignSelf: 'center',
      padding: 10,
      flexDirection: 'row',
      justifyContent: 'center',
      minWidth: 120,
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
      marginLeft: 1
    },
    modalMessage: {
      fontSize: 12,
      marginBottom: 4,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular'
    },
    modalMessagefooter: {
      fontSize: 10,
      marginBottom: 10,
      color: isDarkMode ? 'grey' : 'grey',
      fontFamily: 'Lato-Regular'
    },
    input: {
      width: '100%',
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Ragular'
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 10,
      paddingHorizontal: 20
    },
    button: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 5,
    },
    cancelButton: {
      backgroundColor: config.colors.wantBlockRed,
    },
    confirmButton: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    buttonText: {
      color: 'white',
      fontSize: 14,
      fontFamily: 'Lato-Bold',
    },

    text: {
      color: "white",
      fontSize: 12,
      fontFamily: "Lato-Regular",
      lineHeight: 12
    },


    typeContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      marginBottom: 20,
      position: 'relative',
    },
    recommendedContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    recommendedText: {
      fontSize: 12,
      color: '#666',
      marginLeft: 4,
      fontWeight: '500',
    },
    curvedArrow: {
      transform: [{ rotate: '-90deg' }],
      marginRight: 2,
    },
    typeButtonsContainer: {
      flexDirection: 'row',
      backgroundColor: 'rgb(253, 229, 229)',
      borderRadius: 20,
      padding: 4,
    },
    typeButton: {
      paddingVertical: 8,
      paddingHorizontal: 20,
      borderRadius: 16,
    },
    typeButtonActive: {
      backgroundColor: 'rgb(255, 102, 102)',
    },
    typeButtonText: {
      fontSize: 14,
      color: '#666',
      fontWeight: '500',
    },
    typeButtonTextActive: {
      color: 'white',
      fontWeight: '600',
    },
    valueText: {
      fontSize: 10,
      color: isDarkMode ? '#aaa' : '#666',
      marginTop: 2,
    },
    itemBadgesContainer: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      flexDirection: 'row',
      gap: 2,
      padding: 2,
    },
    itemBadge: {
      color: 'white',
      padding: 1,
      borderRadius: 5,
      fontSize: 6,
      minWidth: 10,
      textAlign: 'center',
      overflow: 'hidden',
      fontWeight: '600',
    },
    itemBadgeFly: {
      backgroundColor: '#3498db',
    },
    itemBadgeRide: {
      backgroundColor: '#e74c3c',
    },
    itemBadgeMega: {
      backgroundColor: '#9b59b6',
    },
    itemBadgeNeon: {
      backgroundColor: '#2ecc71',
    },
    // ✅ Favorites row layout styles - matching ValueScreen.js (compact version)
    favoriteRowItem: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      borderRadius: 6,
      marginHorizontal: 4,
      marginBottom: 4,
      padding: 6,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      position: 'relative',
    },
    favoriteClickableArea: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 4,
    },
    favoriteImageContainer: {
      position: 'relative',
    },
    favoriteItemImage: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa',
    },
    favoriteItemInfo: {
      flex: 1,
      justifyContent: 'center',
    },
    favoriteItemName: {
      fontSize: 11,
      fontWeight: '700',
      color: isDarkMode ? '#ffffff' : '#000000',
      marginBottom: 1,
      letterSpacing: -0.3,
    },
    favoriteItemValue: {
      fontSize: 9,
      color: isDarkMode ? '#e0e0e0' : '#333333',
      marginBottom: 1,
      fontWeight: '500',
    },
    favoriteItemRarity: {
      fontSize: 8,
      color: config.colors.primary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    favoriteBadgesContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 2,
      backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
      borderRadius: 8,
      padding: 4,
      marginTop: 2,
    },
    favoriteBadgeButton: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#3a3a3a' : '#ffffff',
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      minWidth: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    favoriteBadgeButtonActive: {
      backgroundColor: config.colors.primary,
    },
    favoriteBadgeButtonText: {
      fontSize: 8,
      fontWeight: '600',
      color: isDarkMode ? '#ffffff' : '#666666',
      textAlign: 'center',
    },
    favoriteBadgeButtonTextActive: {
      color: '#ffffff',
    },
    favoriteDeleteButton: {
      position: 'absolute',
      top: 4,
      right: 4,
      padding: 2,
      zIndex: 10,
    },
    favoriteButton: {
      position: 'absolute',
      top: 5,
      right: 5,
      padding: 5,
      borderRadius: 50,
    },
    emptyFavoritesContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      marginTop: 50,
    },
    emptyFavoritesText: {
      fontSize: 16,
      color: isDarkMode ? '#fff' : '#666',
      marginTop: 10,
      marginBottom: 20,
    },
    addToFavoritesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
      padding: 10,
      borderRadius: 8,
      margin: 10,
      width: '100%',
    },
    addToFavoritesText: {
      marginLeft: 8,
      fontSize: 10,
      color: isDarkMode ? '#fff' : '#666',
    },
    favoritesHeader: {
      padding: 10,
      alignItems: 'center',
    },
    favoritesTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#fff' : '#333',
    },
    createtradeAds: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flex:1,
      justifyContent:'center',
      alignItems:'center',
    },
    
    removeAdsButton: {
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: '#fbbf24', // warm gold
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
      // minWidth:244
      marginTop:20

    },
    
    removeAdsContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    crownWrapper: {
      width: 25,
      height: 25,
      borderRadius: 12,
      backgroundColor: '#fde68a',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    
    removeAdsTextWrapper: {
      flexDirection: 'column',
    },
    
    removeAdsTitle: {
      color: '#1f2933',
      fontSize: 12,
      fontFamily: 'Lato-Bold',
    },
    
    removeAdsSubtitle: {
      color: '#374151',
      fontSize: 10,
      fontFamily: 'Lato-Regular',
      opacity: 0.9,
    },
    
  });

export default HomeScreen;