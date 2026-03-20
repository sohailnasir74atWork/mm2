import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { debounce } from '../Helper/debounce';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import CodesDrawer from './Code';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { ref, update } from '@react-native-firebase/database';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { handleBloxFruit, handleadoptme } from '../SettingScreen/settinghelper';


// ✅ MM2: Removed VALUE_TYPES and MODIFIERS - MM2 doesn't use these
// ✅ MM2: Removed ItemBadge and BadgeButton components - MM2 doesn't use badges

// ✅ MM2: Removed ItemImage component - MM2 doesn't use badges



const ValueScreen = React.memo(({ selectedTheme, fromChat, selectedFruits, setSelectedFruits, onRequestClose, fromSetting, ownedPets, setOwnedPets, wishlistPets, setWishlistPets, owned }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('ALL'); // ✅ MM2: Default to ALL
  // ✅ MM2: Removed selectedValueType, isFlySelected, isRideSelected - MM2 doesn't use modifiers
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { localState, toggleAd } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  // ✅ Removed filters state - use availableFilters directly to prevent infinite loop
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [itemSelections, setItemSelections] = useState({});
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showAd1, setShowAd1] = useState(localState?.showAd1);
  const [sortOrder, setSortOrder] = useState('none'); // 'asc', 'desc', or 'none'


  // ✅ MM2 Categories - matching HomeScreen (without INVENTORY for ValueScreen)
  // ✅ Use useMemo to prevent new array reference on every render
  const CATEGORIES = useMemo(() => ['ALL', 'ANCIENT', 'UNIQUE', 'CHROMA', 'GODLY', 'LEGEND', 'RARE', 'UNCOMMON', 'COMMON', 'VINTAGE', 'PETS'], []);
  const hideBadge = []; // MM2 doesn't use badges for hiding

  // console.log(selectedFruits)

  // ✅ MM2: Simplified ListItem (no badges needed)
  const ListItem = React.memo(({ item, getItemValue, styles, onPress }) => {
    const currentValue = getItemValue(item);

    return (
      <TouchableOpacity style={[styles.itemContainer]} onPress={onPress} disabled={!fromChat && !fromSetting}>
        <View style={styles.imageContainer}>
          <View style={styles.imageWrapper}>
            <Image source={{ uri: getImageUrl(item) }} style={styles.icon} resizeMode="cover" />
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {/* ✅ Display deprecated names if available */}
            {(item.deprecatedNames && Array.isArray(item.deprecatedNames) && item.deprecatedNames.length > 0) || 
             (item.deprecatedName || item.deprecated_name) ? (
              <Text style={styles.deprecatedName} numberOfLines={1}>
                {item.deprecatedNames?.[0] || item.deprecatedName || item.deprecated_name}
              </Text>
            ) : null}
            <Text style={styles.value}>Value: {Number(currentValue).toLocaleString()}</Text>
            {item.tier && <Text style={styles.rarity}>{item.tier}</Text>}
          </View>
        </View>
      </TouchableOpacity>
    );
  });

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });
  useEffect(() => {
    // Toggle the ad state when the screen is mounted
    const newAdState = toggleAd();
    setShowAd1(newAdState);
  }, []);
  const CustomAd = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/icon.webp')} // Replace with your ad icon
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>Blox Fruits Values</Text>
          <Text style={styles.tryNowText}>Try Our other app</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleBloxFruit(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>Download</Text>
      </TouchableOpacity>
    </View>
  );

  const CustomAd2 = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/MM2logo.webp')}
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>MM2 Values</Text>
          <Text style={styles.tryNowText}>Try Our other app</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleadoptme(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>Download</Text>
      </TouchableOpacity>
    </View>
  );


  // ✅ MM2: Extract values from nested structure {category: {tier: [items]}} - matching HomeScreen structure
  const extractMM2Values = useCallback((data) => {
    const items = [];
    try {
      if (!data || typeof data !== 'object') {
        console.warn("⚠️ extractMM2Values: Invalid data structure", typeof data);
        return items;
      }
      
      for (const [category, tiers] of Object.entries(data)) {
        if (!tiers || typeof tiers !== 'object') continue;
        
        for (const [tier, values] of Object.entries(tiers)) {
          if (!Array.isArray(values)) continue;
          
          for (const item of values) {
            if (!item || !item.name) continue;

            const cleanedValue = String(item.value || 0).replace(/,/g, '');
            const numericValue = !isNaN(cleanedValue) ? Number(cleanedValue) : 0;

            items.push({
              ...item,
              Name: item.name, // ✅ Match HomeScreen structure
              name: item.name,
              FormattedValue: numericValue !== null ? numericValue.toLocaleString() : item.value,
              Value: numericValue !== null ? numericValue : 0,
              value: numericValue !== null ? numericValue : 0,
              Image: item.image ? `https://mm2values.com/${item.image}` : '',
              image: item.image || '',
              Category: category.trim(),
              category: category.trim(),
              Tier: tier.trim(),
              tier: tier.trim(),
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

  // Memoize the parsed data to prevent unnecessary re-parsing
  const parsedValuesData = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      // ✅ MM2: Extract from nested structure
      return typeof parsed === 'object' && parsed !== null ? extractMM2Values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing data:", error);
      return [];
    }
  }, [localState.data, extractMM2Values]);

  // ✅ MM2: Image URL generation
  const getImageUrl = (item) => {
    if (!item || !item.name) return '';

    // ✅ MM2 format: https://mm2values.com/${item.image}
    if (item.image) {
      return `https://mm2values.com/${item.image}`;
    }

    return '';
  };
  // Memoize the parsed codes data
  const parsedCodesData = useMemo(() => {
    if (!localState.codes) return [];
    try {
      const parsed = typeof localState.codes === 'string' ? JSON.parse(localState.codes) : localState.codes;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing codes:", error);
      return [];
    }
  }, [localState.codes]);

  // Memoize the filters - only show categories like HomeScreen (no tier values to keep menu short)
  const availableFilters = useMemo(() => {
    // ✅ Only return CATEGORIES to match HomeScreen - don't include all tier values
    return CATEGORIES;
  }, [CATEGORIES]);

  // Optimize the search and filter logic

  // useEffect(() => {
  //   if (localState.isGG) {
  //     const types = new Set(parsedValuesData.map(i => (i.type || '').toUpperCase()));
  //     // console.log("🧪 GG Types:", Array.from(types));
  //   }
  // }, [parsedValuesData]);


  // ✅ MM2: Simplified getItemValue (no modifiers needed)
  const getItemValue = useCallback((item) => {
    if (!item) return 0;
    // ✅ MM2: Use value directly
    const cleanedValue = String(item.value || 0).replace(/,/g, '');
    const numericValue = !isNaN(cleanedValue) ? Number(cleanedValue) : 0;
    return numericValue.toFixed(2);
  }, []);
  const filteredData = useMemo(() => {
    if (!Array.isArray(parsedValuesData) || parsedValuesData.length === 0) return [];

    const searchLower = searchText.trim().toLowerCase();
    const filterUpper = selectedFilter.toUpperCase();

    let filtered = parsedValuesData.filter((item) => {
      if (!item?.name) return false;

      // ✅ Search match: if search text is empty, show all items
      const matchesSearch = !searchLower || item.name.toLowerCase().includes(searchLower);
      
      // ✅ Filter match logic
      let matchesFilter = false;
      
      if (filterUpper === 'ALL') {
        matchesFilter = true;
      } else if (CATEGORIES.includes(filterUpper)) {
        // Category filter (ANCIENT, UNIQUE, CHROMA, etc.)
        matchesFilter = item.type?.toUpperCase() === filterUpper ||
                       item.category?.toUpperCase() === filterUpper ||
                       item.Category?.toUpperCase() === filterUpper;
      } else {
        // Check if it's a tier filter (numeric value like "1", "1.5", "2", "3.5", "4", "5")
        const itemTier = item.tier || item.Tier || '';
        const tierValue = itemTier.toString().match(/(\d+\.?\d*)/);
        if (tierValue) {
          const itemTierNum = tierValue[1];
          matchesFilter = itemTierNum === selectedFilter || 
                         itemTierNum === filterUpper;
        }
        
        // Also check rarity if not matched by tier
        if (!matchesFilter) {
          matchesFilter = item.rarity?.toUpperCase() === filterUpper;
        }
      }

      return matchesSearch && matchesFilter;
    });

    // Apply sort
    if (sortOrder !== 'none') {
      filtered.sort((a, b) => {
        const aValue = parseFloat(getItemValue(a));
        const bValue = parseFloat(getItemValue(b));
        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      });
    }

    return filtered;
  }, [parsedValuesData, searchText, selectedFilter, sortOrder, getItemValue, CATEGORIES]);


  // ✅ MM2: Removed handleItemBadgePress - MM2 doesn't use badges/modifiers

  // 👇 Add these inside ValueScreen, after your other hooks/useState
  const selectedList = useMemo(() => {
    if (fromChat) {
      return selectedFruits || [];
    }
    if (fromSetting) {
      return owned ? (ownedPets || []) : (wishlistPets || []);
    }
    return [];
  }, [fromChat, fromSetting, owned, selectedFruits, ownedPets, wishlistPets]);

  const handleRemoveSelected = useCallback(
    (index) => {
      if (fromChat) {
        setSelectedFruits?.((prev = []) => prev.filter((_, i) => i !== index));
      } else if (fromSetting) {
        if (owned) {
          setOwnedPets?.((prev = []) => prev.filter((_, i) => i !== index));
        } else {
          setWishlistPets?.((prev = []) => prev.filter((_, i) => i !== index));
        }
      }
    },
    [fromChat, fromSetting, owned, setSelectedFruits, setOwnedPets, setWishlistPets]
  );


  // ✅ MM2: Simplified renderItem
  const renderItem = useCallback(
    ({ item }) => {
      // value for this item
      const currentValue = getItemValue(item);

      // image url for this item
      const imageUrl = getImageUrl(item);

      const handlePress = () => {
        const fruitObj = {
          Name: item.name,
          name: item.name,
          value: Number(currentValue),
          imageUrl,
          category: item.type || item.category,
          id: item.id,
        };

        // 👉 From chat: always add another copy
        if (fromChat) {
          setSelectedFruits(prev => [...(prev || []), fruitObj]);
        }

        // 👉 From settings: always add another copy
        if (fromSetting) {
          if (owned) {
            setOwnedPets(prev => [...(prev || []), fruitObj]);
          } else {
            setWishlistPets(prev => [...(prev || []), fruitObj]);
          }
        }
      };

      return (
        <ListItem
          item={item}
          getItemValue={getItemValue}
          styles={styles}
          onPress={handlePress}
        />
      );
    },
    [
      getItemValue,
      styles,
      selectedFruits,
      ownedPets,
      wishlistPets
    ]
  );


  // Update the useEffect for values data
  useEffect(() => {
    setValuesData(parsedValuesData);
  }, [parsedValuesData]);

  // Update the useEffect for codes data
  useEffect(() => {
    setCodesData(parsedCodesData);
  }, [parsedCodesData]);

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await reload(); // Re-fetch stock data
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleDrawer = () => {
    triggerHapticFeedback('impactLight');
    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setIsDrawerVisible(!isDrawerVisible);
    };

    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    }
    else {
      setIsDrawerVisible(!isDrawerVisible);
    }
    mixpanel.track("Code Drawer Open");
  }


  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };

  const handleSearchChange = debounce((text) => {
    setSearchText(text);
  }, 300);
  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };



  // ✅ MM2: Removed handleBadgePress - MM2 doesn't use badges/modifiers

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
          {(fromChat || fromSetting) && selectedList?.length > 0 && (
            <View style={styles.selectedPetsSection}>
              <View style={styles.selectedPetsHeader}>
                <Text style={styles.selectedPetsTitle}>
                  {fromChat
                    ? 'Selected pets'
                    : owned
                      ? 'Owned pets'
                      : 'Wishlist'}
                </Text>

                <Text style={styles.selectedPetsCount}>
                  {selectedList.length}
                </Text>
              </View>

              <FlatList
                horizontal
                data={selectedList}
                keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedPetsList}
                renderItem={({ item, index }) => (
                  <TouchableOpacity style={styles.selectedPetCard} onPress={() => handleRemoveSelected(index)}>
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.selectedPetImage}
                    />
                    <Text
                      style={styles.selectedPetName}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>

                    <View
                      style={styles.removePetButton}

                    >
                      <Icon name="close" size={8} color="#fff" />
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
          {/* {(!fromChat && !fromSetting) && (
  showAd1 ? <CustomAd /> : <CustomAd2 />
)} */}

          <View style={styles.searchFilterContainer}>

            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}
            />
            {/* Selected / owned pets strip (chat/settings only) */}


            {!fromChat && !fromSetting && <Menu>
              <MenuTrigger onPress={() => { }}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{displayedFilter}</Text>
                  <Icon name="chevron-down-outline" size={18} color="white" />
                </View>
              </MenuTrigger>
              <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
                {availableFilters.map((filter) => (
                  <MenuOption
                    key={filter}
                    onSelect={() => applyFilter(filter)}
                  >
                    <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                      {filter}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>

            </Menu>}
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => {
                setSortOrder(prev =>
                  prev === 'asc' ? 'desc' : prev === 'desc' ? 'none' : 'asc'
                );
              }}
            >
              <Text style={styles.filterText}>
                {sortOrder === 'asc' ? '▲ High' : sortOrder === 'desc' ? '▼ LOw' : 'Filter'}
              </Text>
            </TouchableOpacity>
            {selectedFruits?.length > 0 && <TouchableOpacity
              style={[styles.filterButton, { backgroundColor: 'purple' }]}
              onPress={onRequestClose}
            >
              <Text style={styles.filterText}>
                Done
              </Text>
            </TouchableOpacity>}
          </View>

          {filteredData.length > 0 ? (
            <FlatList
              data={filteredData}
              keyExtractor={(item) => item.id || item.name}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={true}
              numColumns={2}
              columnWrapperStyle={styles.columnWrapper}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
            />
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )}
        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && !fromChat && <BannerAdComponent />}
    </>
  );
});
export const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
    // paddingTop: 16,
  },
  columnWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    // marginBottom: 4,
  },
  searchFilterContainer: {
    flexDirection: 'row',
    marginVertical: 8,
    paddingHorizontal: 8,
    gap: 4,
    alignItems: 'center',
  },
  searchInput: {
    height: 40,
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 20,
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    flex: 1,
    fontSize: 12,
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },

  itemContainer: {
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    borderRadius: 10,
    marginBottom: 8,
    padding: 10,
    width: '49%', // 2 per row with spacing
    alignSelf: 'flex-start',
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  imageContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  imageWrapper: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.backgroundLight,
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  deprecatedName: {
    fontSize: 11,
    fontStyle: 'italic',
    color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight,
    marginBottom: 2,
  },
  value: {
    fontSize: 12,
    color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
    marginBottom: 2,
    fontWeight: '500',
  },
  rarity: {
    fontSize: 10,
    color: config.colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemBadgesContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    flexDirection: 'row',
    gap: 1,
    padding: 1,
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
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
    // padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  badgeButton: {
    paddingVertical: 7,
    paddingHorizontal: 15,
    borderRadius: 15,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.surfaceLight,
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  badgeButtonActive: {
    backgroundColor: config.colors.primary,
  },
  badgeButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: isDarkMode ? config.colors.textDark : config.colors.textSecondaryLight,
    textAlign: 'center',
  },
  badgeButtonTextActive: {
    color: config.colors.white,
  },
  filterText: {
    color: config.colors.white,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,

  },
  filterOptionText: {
    fontSize: 14,
    padding: 10,
    color: isDarkMode ? config.colors.textDark : config.colors.textSecondaryLight,
  },
  selectedOption: {
    fontWeight: '700',
    color: config.colors.primary,
  },
  menuOptions: {
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.surfaceLight,
    borderRadius: 16,
    padding: 8,
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 24,
    color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textSecondaryLight,
    fontWeight: '500',
  },
  modalContainer: {
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    padding: 20,
    borderRadius: 10,
    width: '80%',
    alignSelf: 'center', // Centers the modal horizontally
    position: 'absolute',
    top: '50%', // Moves modal halfway down the screen
    left: '10%', // Centers horizontally considering width: '80%'
    transform: [{ translateY: -150 }], // Adjusts for perfect vertical centering
    justifyContent: 'center',
    elevation: 5, // Adds a shadow on Android
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
    marginBottom: 10,
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
  },
  input: {
    borderWidth: 1,
    borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    padding: 8,
    marginVertical: 5,
    borderRadius: 5,
  },
  saveButton: {
    backgroundColor: config.colors.success,
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  cencelButton: {
    backgroundColor: config.colors.error,
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  headertext: {
    backgroundColor: config.colors.primary,
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 5,
    color: config.colors.white,
    fontSize: 10,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: "flex-start",
    marginRight: 10

  },
  pointsBox: {
    width: '49%', // Ensures even spacing
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.surfaceLight,
    borderRadius: 8,
    padding: 10,
  },
  rowcenter: {
    flexDirection: 'row',
    alignItems: 'center',
    fontSize: 12,
    marginTop: 5,

  },
  menuContainer: {
    alignSelf: "center",
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: config.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    // paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  filterText: {
    color: "white",
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginRight: 5,
  },
  // filterOptionText: {
  //   fontSize: 14,
  //   padding: 10,
  //   color: "#333",
  // },
  selectedOption: {
    fontFamily: 'Lato-Bold',
    color: "#34C759",
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    color: 'white',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
    marginRight: 4,
  },
  badgeFly: {
    backgroundColor: '#3498db',
  },
  badgeRide: {
    backgroundColor: '#e74c3c',
  },
  badgeMega: {
    backgroundColor: '#9b59b6',
  },
  badgeNeon: {
    backgroundColor: '#2ecc71',
  },
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: isDarkMode ? config.colors.dividerDark : config.colors.dividerLight,
    marginTop: 8,
  },
  badgeButton: {
    // marginHorizontal: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
  },
  badgeButtonActive: {
    backgroundColor: config.colors.primary,
  },
  badgeButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: isDarkMode ? config.colors.textDark : config.colors.textSecondaryLight,
  },
  badgeButtonTextActive: {
    color: config.colors.white,
  },
  itemInfo: {
    flex: 1,
  },
  imageWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  itemBadgesContainer: {
    position: 'absolute',
    bottom: -10,
    left: 2,
    flexDirection: 'row',
    gap: 2,
  },
  itemBadge: {
    color: 'white',
    backgroundColor: '#FF6666',
    padding: 2,
    borderRadius: 6,
    fontSize: 7,
    minWidth: 12,
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
  categoryBar: {
    marginBottom: 8,
    paddingVertical: 4,
    backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
  },
  categoryBarContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  categoryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
    marginRight: 8,
  },
  categoryButtonActive: {
    backgroundColor: config.colors.primary,
  },
  categoryButtonText: {
    fontSize: 13,
    color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
    fontWeight: '600',
  },
  categoryButtonTextActive: {
    color: config.colors.white,
  },
  adContainer: {
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
    marginHorizontal: 10

  },
  adContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start', // Aligns text and image in a row
  },
  adIcon: {
    width: 50,
    height: 50,
    borderRadius: 5,
    marginRight: 15,
  },
  adTitle: {
    fontSize: 18,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
    // marginBottom: 5, // Adds space below the title
  },
  tryNowText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    color: config.colors.primary, // Adds a distinct color for the "Try Now" text
    // marginTop: 5, // Adds space between the title and the "Try Now" text
  },
  downloadButton: {
    backgroundColor: config.colors.success,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginTop: 10, // Adds spacing between the text and the button
  },
  downloadButtonText: {
    color: config.colors.white,
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  selectedPetsSection: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  selectedPetsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  selectedPetsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
  },
  selectedPetsCount: {
    fontSize: 11,
    fontWeight: '600',
    color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight,
  },
  selectedPetsList: {
    paddingVertical: 4,
  },
  selectedPetCard: {
    width: 40,
    marginRight: 8,
    borderRadius: 10,
    padding: 6,
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    shadowColor: config.colors.shadowDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedPetImage: {
    width: '100%',
    height: 15,
    borderRadius: 8,
    marginBottom: 1,
    backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
  },
  selectedPetName: {
    fontSize: 8,
    fontWeight: '500',
    color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textLight,
  },
  removePetButton: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: config.colors.overlayDark,
  },

});

export default ValueScreen;
