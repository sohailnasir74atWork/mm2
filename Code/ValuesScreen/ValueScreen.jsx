import useValueSearchTelemetry from '../Helper/useValueSearchTelemetry';
import {matchesItemName} from '../Helper/itemSearch';
import CatalogStatus from '../Helper/CatalogStatus';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  ActivityIndicator,
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
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import {
  resolveItemImage, buildItemPool, unwrapFeed, priceOf, displayValueText,
  DEFAULT_VALUE_SOURCE, categoryKey, VALUE_SOURCE,
} from '../Helper/valueSources';
import ValueCard from './ValueCard';
import { SCREEN_GUTTER } from '../Helper/layout';


// ✅ MM2: Removed VALUE_TYPES and MODIFIERS - MM2 doesn't use these
// ✅ MM2: Removed ItemBadge and BadgeButton components - MM2 doesn't use badges

// ✅ MM2: Removed ItemImage component - MM2 doesn't use badges



// ✅ Helper function to get stability color
const getStabilityColor = (stability) => {
  if (!stability || stability === 'N/A') return '#888';
  const s = stability.toLowerCase();
  if (s === 'stable') return '#34C759';
  if (s === 'doing well' || s === 'recovering') return '#30D158';
  if (s === 'overpaid for' || s === 'peaking') return '#007AFF';
  if (s === 'fluctuating') return '#FF9500';
  if (s === 'underpaid for') return '#FF6B35';
  if (s === 'decreasing') return '#FF3B30';
  return '#888';
};

const ValueScreen = React.memo(({ selectedTheme, fromChat, selectedFruits, setSelectedFruits, onRequestClose, fromSetting, ownedPets, setOwnedPets, wishlistPets, setWishlistPets, owned, route }) => {
  // Seeded from route params so Home's search bar lands the user on results.
  // The screen is also embedded (chat picker, settings) with no route at all.
  const [searchText, setSearchText] = useState(() => route?.params?.q || '');
  // What the box shows, updated on every keystroke; `searchText` (what filters
  // the list) trails it through the debounce below.
  const [inputText, setInputText] = useState(() => route?.params?.q || '');
  // React Navigation reuses a screen already in the stack instead of
  // remounting it, so a second search from Home arrives as new params only.
  const routeQuery = route?.params?.q;
  useEffect(() => {
    if (typeof routeQuery === 'string') {
      setSearchText(routeQuery);
      setInputText(routeQuery);
    }
  }, [routeQuery]);
  const [selectedFilter, setSelectedFilter] = useState('ALL'); // ✅ MM2: Default to ALL
  // ✅ MM2: Removed selectedValueType, isFlySelected, isRideSelected - MM2 doesn't use modifiers
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const insets = useSafeAreaInsets();
  const bannerBottomPos = Math.max(insets.bottom, 8) + 6;
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { localState, updateLocalState } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  // Chat item picker: default to the user's own My Stuff items with a toggle
  // to the full catalog (adoptme pattern) — the list users attach in chat is
  // their OWN items. Falls back to 'all' when My Stuff is empty.
  const [chatPetSource, setChatPetSource] = useState(() =>
    (Array.isArray(localState?.ownedPets) && localState.ownedPets.length ? 'mine' : 'all'));
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
  const [sortOrder, setSortOrder] = useState('none'); // 'asc', 'desc', or 'none'


  // ✅ MM2 Categories - matching HomeScreen (without INVENTORY for ValueScreen)
  // ✅ Use useMemo to prevent new array reference on every render
  const CATEGORIES = useMemo(() => ['ALL', 'ANCIENT', 'UNIQUE', 'CHROMA', 'GODLY', 'LEGEND', 'RARE', 'UNCOMMON', 'COMMON', 'VINTAGE', 'PETS'], []);
  // Filters stay English constants for logic; ALL and PETS get a translated
  // label (rarity names are MM2 game terms).
  const filterLabel = (f) => (f === 'ALL' ? t('calc.filter_all') : f === 'PETS' ? t('calc.filter_pets') : f);
  const hideBadge = []; // MM2 doesn't use badges for hiding

  // console.log(selectedFruits)

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });


  // Which catalogue prices this screen. See Code/Helper/valueSources.js.
  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;

  // Memoize the parsed data to prevent unnecessary re-parsing
  const parsedValuesData = useMemo(() => {
    const parse = (raw) => {
      try {
        if (!raw) return null;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' ? unwrapFeed(parsed) : null;
      } catch (error) {
        console.error("❌ Error parsing data:", error);
        return null;
      }
    };
    // One deduped pool from both catalogues, same as the calculator.
    // This screen is also the chat item picker (PetsModel embeds it), so what
    // it lists and what it prices is what gets sent into a conversation.
    return buildItemPool(parse(localState.data), parse(localState.suprime));
  }, [localState.data, localState.suprime]);

  // See Code/Helper/valueSources.js.
  const getImageUrl = resolveItemImage;
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


  // Display text for one item under one catalogue: the source's own words
  // when it has no real price ("Priceless", "Award only", "x3 T1
  // Legendaries"), otherwise the number with commas. See
  // Code/Helper/valueSources.js.
  const formatFor = useCallback((item, source) => {
    if (!item) return '0';
    const label = displayValueText(item, source);
    if (label) return label;
    const numericValue = priceOf(item, source).value || 0;
    return numericValue >= 1 ? numericValue.toLocaleString() : numericValue.toString();
  }, []);
  const getItemValue = useCallback((item) => formatFor(item, valueSource), [formatFor, valueSource]);
  // The catalogue NOT selected — every card shows it small under the main value.
  const otherSource = valueSource === VALUE_SOURCE.SUPREME ? VALUE_SOURCE.MM2 : VALUE_SOURCE.SUPREME;
  const filteredData = useMemo(() => {
    if (!Array.isArray(parsedValuesData) || parsedValuesData.length === 0) return [];

    const searchLower = searchText.trim().toLowerCase();
    const filterUpper = selectedFilter.toUpperCase();

    let filtered = parsedValuesData.filter((item) => {
      if (!item?.name) return false;

      // ✅ Search match: if search text is empty, show all items
      const matchesSearch = matchesItemName(item.name, searchLower);
      
      // ✅ Filter match logic
      let matchesFilter = false;
      
      if (filterUpper === 'ALL') {
        matchesFilter = true;
      } else if (CATEGORIES.includes(filterUpper)) {
        // Category filter (ANCIENT, UNIQUE, CHROMA, etc.)
        // categoryKey folds Supreme's plurals ("Godlies") into the chip's name.
        matchesFilter = categoryKey(item.type) === filterUpper ||
                       categoryKey(item.category) === filterUpper ||
                       categoryKey(item.Category) === filterUpper;
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
      // Computed ONCE per item: the comparator used to format and re-parse
      // both values on every comparison (~30k calls for a full catalogue
      // sort). The key is the number, never the display text: toLocaleString
      // writes "5 200" in Russian and "5.200" in German, which parseFloat read
      // back as 5 and 5.2, so High→Low was scrambled outside English. Labels
      // ("Award only", "x3 T1 Legendaries") still sort as 0, as before.
      const keyed = filtered.map((item) => ({
        item,
        v: displayValueText(item, valueSource) ? 0 : (priceOf(item, valueSource).value || 0),
      }));
      keyed.sort((a, b) => (sortOrder === 'asc' ? a.v - b.v : b.v - a.v));
      filtered = keyed.map((k) => k.item);
    }

    return filtered;
  }, [parsedValuesData, searchText, selectedFilter, sortOrder, valueSource, CATEGORIES]);

  // Chat "My Items" mode: the user's My Stuff list matched against the live
  // catalog (fresh values, renderItem works unchanged), deduped, searchable.
  const myPetsView = useMemo(() => {
    if (!(fromChat && chatPetSource === 'mine')) return [];
    const q = searchText.trim().toLowerCase();
    const byName = new Map();
    for (const it of parsedValuesData || []) {
      const k = (it?.name || '').toLowerCase().trim();
      if (k && !byName.has(k)) byName.set(k, it);
    }
    const seen = new Set();
    return (localState?.ownedPets || [])
      .map((p) => byName.get((p?.name || '').toLowerCase().trim()))
      .filter(Boolean)
      .filter((it) => {
        const k = (it.name || '').toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .filter((it) => !q || (it.name || '').toLowerCase().includes(q));
  }, [fromChat, chatPetSource, localState?.ownedPets, parsedValuesData, searchText]);

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

      // image url for this item
      const imageUrl = getImageUrl(item);

      const handlePress = () => {
        const priced = priceOf(item, valueSource);
        const fruitObj = {
          Name: item.name,
          name: item.name,
          // currentValue may be a label ("Priceless"), so take the number from
          // priceOf rather than parsing the display string back.
          value: priced.value || 0,
          imageUrl,
          category: item.type || item.category,
          id: item.id,
          // Provenance travels with the item. Without it a chat message or a
          // saved inventory row cannot say which catalogue priced it, and a
          // bundle-tier rank would later be summed as currency.
          // Null on anything older, which readers treat as MM2 — see isSummable().
          valueSource,
          valueConfidence: priced.valueConfidence || null,
          valueText: priced.valueText || null,
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
        <ValueCard
          item={item}
          imageUrl={imageUrl}
          primary={formatFor(item, valueSource)}
          secondary={formatFor(item, otherSource)}
          source={valueSource}
          otherSource={otherSource}
          stabilityColor={getStabilityColor(item.stability)}
          isDarkMode={isDarkMode}
          onPress={handlePress}
          disabled={!fromChat && !fromSetting}
        />
      );
    },
    [
      getItemValue,
      formatFor,
      otherSource,
      isDarkMode,
      styles,
      selectedFruits,
      ownedPets,
      wishlistPets,
      // Without this the callback keeps whichever source was active when it
      // was created, so an item added after toggling would be priced from the
      // old catalogue.
      valueSource,
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
      const refreshed = await reload();
      if (refreshed === false) throw new Error('Catalog refresh incomplete'); // Re-fetch stock data
      // Show success feedback (silent — no toast dependency needed)
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleDrawer = () => {
    triggerHapticFeedback('impactLight');
    setHasAdBeenShown(true);
    setIsDrawerVisible(!isDrawerVisible);
  }


  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };

  // Created ONCE. It used to be rebuilt on every render — and every keystroke
  // renders (inputText) — so each keystroke got its own fresh timer and the
  // full filter + sort ran once per character instead of once per pause.
  const handleSearchChange = useMemo(() => debounce((text) => {
    setSearchText(text);
  }, 300), []);
  useValueSearchTelemetry(searchText, filteredData.length, parsedValuesData.length);

  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };



  // ✅ MM2: Removed handleBadgePress - MM2 doesn't use badges/modifiers

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
          <CatalogStatus />
          {(fromChat || fromSetting) && selectedList?.length > 0 && (
            <View style={styles.selectedPetsSection}>
              <View style={styles.selectedPetsHeader}>
                <Text style={styles.selectedPetsTitle}>
                  {fromChat
                    ? t('value.selected_pets')
                    : owned
                      ? t('value.owned_pets')
                      : t('value.wishlist')}
                </Text>

                <Text style={styles.selectedPetsCount}>
                  {selectedList.length}
                </Text>
              </View>

              <FlatList removeClippedSubviews={false}
                horizontal
                data={selectedList}
                keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedPetsList}
                renderItem={({ item, index }) => (
                  <TouchableOpacity style={styles.selectedPetCard} onPress={() => handleRemoveSelected(index)}>
                    <Image resizeMethod="resize"
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

          <View style={styles.searchFilterContainer}>

            <TextInput
              style={styles.searchInput}
              placeholder={t('value.search_placeholder')}
              placeholderTextColor={isDarkMode ? config.colors.placeholderDark : config.colors.placeholderLight}
              value={inputText}
              onChangeText={(text) => { setInputText(text); handleSearchChange(text); }}
            />
            {/* Selected / owned pets strip (chat/settings only) */}


            {!fromChat && !fromSetting && <Menu>
              <MenuTrigger onPress={() => { }}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{filterLabel(displayedFilter)}</Text>
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
                      {filterLabel(filter)}
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
                {sortOrder === 'asc' ? t('value.low') : sortOrder === 'desc' ? t('value.high') : t('value.filter')}
              </Text>
            </TouchableOpacity>
            {!fromChat && !fromSetting && (
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => {
                  triggerHapticFeedback('impactLight');
                  handleRefresh();
                }}
                disabled={refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="refresh" size={18} color="white" />
                )}
              </TouchableOpacity>
            )}
            {selectedFruits?.length > 0 && <TouchableOpacity
              style={[styles.filterButton, { backgroundColor: 'purple' }]}
              onPress={onRequestClose}
            >
              <Text style={styles.filterText}>
                {t('value.done')}
              </Text>
            </TouchableOpacity>}
          </View>

          {/* Catalogue switch. Shared with the calculator's toggle (both read
              localState.valueSource); every card also shows the other
              catalogue's figure small, so both are always visible. */}
          <View style={[styles.sourceSwitch, { marginHorizontal: SCREEN_GUTTER }]}>
            {[VALUE_SOURCE.SUPREME, VALUE_SOURCE.MM2].map((src) => {
              const active = valueSource === src;
              return (
                <TouchableOpacity
                  key={src}
                  style={[styles.sourceSwitchBtn, active && styles.sourceSwitchBtnActive]}
                  onPress={() => { if (!active) { triggerHapticFeedback('impactLight'); updateLocalState('valueSource', src); } }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sourceSwitchText, active && styles.sourceSwitchTextActive]}>
                    {src === VALUE_SOURCE.SUPREME ? t('value.source_supreme') : t('value.source_mm2')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {fromChat && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {[
                { key: 'mine', label: `${t('value.my_items', 'My Items')} (${(localState?.ownedPets || []).length})` },
                { key: 'all', label: t('value.all_items', 'All Items') },
              ].map((opt) => {
                const active = chatPetSource === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setChatPetSource(opt.key)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: active ? config.colors.primary : 'transparent',
                      borderWidth: 1,
                      borderColor: active ? config.colors.primary : (isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'),
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : (isDarkMode ? '#E2E8F0' : '#334155') }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {(fromChat && chatPetSource === 'mine' ? myPetsView : filteredData).length > 0 ? (
            <FlatList
              data={fromChat && chatPetSource === 'mine' ? myPetsView : filteredData}
              keyExtractor={(item) => item.id || item.name}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              numColumns={2}
              columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: SCREEN_GUTTER }}
              contentContainerStyle={{ paddingBottom: 180 }}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
            />
          ) : (fromChat && chatPetSource === 'mine') ? (
            <View style={{ alignItems: 'center', marginTop: 24, paddingHorizontal: 24 }}>
              <Text style={[styles.description, { textAlign: 'center', color: 'gray' }]}>
                {t('value.no_my_items', 'No items in your My Stuff yet. Add them from the Home tab, or browse all items.')}
              </Text>
              <TouchableOpacity
                onPress={() => setChatPetSource('all')}
                style={{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: config.colors.primary }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('value.browse_all', 'Browse All Items')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )}
          {/* Full-screen page: rows stop above the Android nav bar. Embedded
              in PetModal's sheet, the sheet pads it instead. */}
          {!fromChat && !fromSetting && <ScreenBottomBanner ad={false} />}
        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && !fromChat && (
        <View style={{ position: 'absolute', bottom: bannerBottomPos, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
          <BannerAdComponent collapsible />
        </View>
      )}
    </>
  );
});
export const getStyles = (isDarkMode) => StyleSheet.create({
  // MM2 | Supreme segmented switch
  sourceSwitch: {
    flexDirection: 'row', padding: 4, borderRadius: 14, marginBottom: 12,
    backgroundColor: isDarkMode ? config.colors.surfaceDark : '#e9ebf1',
  },
  sourceSwitchBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sourceSwitchBtnActive: { backgroundColor: config.colors.primary },
  sourceSwitchText: { fontSize: 13, fontFamily: 'Lato-Bold', color: isDarkMode ? '#8a95a5' : '#65707e' },
  sourceSwitchTextActive: { color: '#ffffff' },
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
    marginTop: 10,
    marginBottom: 10,
    paddingHorizontal: SCREEN_GUTTER,
    gap: 6,
    alignItems: 'center',
  },
  searchInput: {
    height: 44,
    backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    flex: 1,
    fontSize: 14,
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
  tierLabel: {
    fontSize: 10,
    color: config.colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  demandPill: {
    backgroundColor: isDarkMode ? 'rgba(106, 90, 205, 0.2)' : 'rgba(106, 90, 205, 0.12)',
  },
  rarityPill: {
    backgroundColor: isDarkMode ? 'rgba(255, 149, 0, 0.2)' : 'rgba(255, 149, 0, 0.12)',
  },
  pillText: {
    fontSize: 10,
    fontWeight: '600',
    color: isDarkMode ? config.colors.textSecondaryDark : config.colors.textSecondaryLight,
  },
  stabilityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  stabilityDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginRight: 4,
  },
  stabilityText: {
    fontSize: 9,
    fontWeight: '600',
  },
  rangeText: {
    fontSize: 9,
    color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textTertiaryLight,
    fontWeight: '500',
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
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 2,
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
