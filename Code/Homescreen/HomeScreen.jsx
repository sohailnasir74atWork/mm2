import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Keyboard, Pressable, Platform } from 'react-native';
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
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import DeviceInfo from 'react-native-device-info';
import ShareTradeModal from '../Trades/SharetradeModel';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';


const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, analytics, appdatabase } = useGlobalState();
  const tradesCollection = useMemo(() => firestore().collection('trades_new'), []);
  const initialItems = [null, null, null, null];
  const [hasItems, setHasItems] = useState(initialItems);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [wantsItems, setWantsItems] = useState(initialItems);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState({ price: 0, value: 0 });
  const [wantsTotal, setWantsTotal] = useState({ price: 0, value: 0 });
  const { triggerHapticFeedback } = useHaptic();
  const { localState, updateLocalState } = useLocalState()
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [lastTradeTime, setLastTradeTime] = useState(null); // 🔄 Store last trade timestamp locally
  const [openShareModel, setOpenShareModel] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null); // 🔄 Store last trade timestamp locally
  const [selectedPetType, setSelectedPetType] = useState('All');
  const [isAddingToFavorites, setIsAddingToFavorites] = useState(false);

  const { t } = useTranslation();
  // const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);
  const CATEGORIES = useMemo(() => {
    return localState.isMM2
      ? ['All', 'Ancient', 'Unique', 'Chroma', 'Godly', 'Legend', 'Rare', 'Uncommon', 'Common', 'Vintage', 'Pets', 'Misc', 'FAVORITES']
      : ['All', 'Sets', 'Ancients', 'Evos', 'Uniques', 'Chromas', 'Godlies', 'Legendaries', 'Rares', 'Uncommons', 'Commons', 'Vintages', 'Pets', 'Mis', 'Untradables', 'FAVORITES'];
  }, [localState.isMM2]);

  const extractMM2Values = (data) => {

    const items = [];

    try {
      for (const [category, tiers] of Object.entries(data)) {
        for (const [tier, values] of Object.entries(tiers)) {
          for (const item of values) {
            if (!item?.name || !item?.value || !item?.image) continue;

            const cleanedValue = String(item.value).replace(/,/g, '');
            const numericValue = !isNaN(cleanedValue) ? Number(cleanedValue) : null;

            items.push({
              Name: item.name,
              FormattedValue: numericValue !== null ? numericValue.toLocaleString() : item.value,
              Value: numericValue !== null ? numericValue : 0, // fallback to 0 or any safe number
              Image: !localState.isMM2 ? `https://supremevaluelist.com/${item.image}` : `https://mm2values.com/${item.image}`,
              Category: category,
              Tier: tier,
            });
          }
        }
      }
    } catch (error) {
      console.error("❌ Failed to extract MM2 values:", error);
    }

    return items;
  };

  const toggleFavorite = useCallback((item) => {
    if (!item) return;

    const currentFavorites = localState.favorites || [];
    const isFavorite = currentFavorites.some(fav => fav.Name === item.Name);

    const newFavorites = isFavorite
      ? currentFavorites.filter(fav => fav.Name !== item.Name) // ✅ remove
      : [...currentFavorites, item]; // ✅ add

    updateLocalState('favorites', newFavorites);
    triggerHapticFeedback('impactLight');
  }, [localState.favorites, updateLocalState, triggerHapticFeedback]);




  const renderFavoritesHeader = useCallback(() => {
    if (selectedPetType === 'FAVORITES') {
      return (
        <View style={styles.favoritesHeader}>
          <Text style={styles.favoritesTitle}>Your Favorites</Text>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);

  const keyExtractor = useCallback((item) =>
    item.id?.toString() || Math.random().toString()
    , []);
  const renderGridItem = useCallback(({ item }) => {
    const isFavorite = (localState.favorites || []).some(fav => fav.Name === item.Name);

    return (
      <TouchableOpacity
        style={styles.gridItem}
        onPress={() => {
          if (isAddingToFavorites) {
            toggleFavorite(item);
          } else {
            selectItem(item);
          }
        }}
      >
        <Image
          source={{ uri: item.Image }}
          style={styles.gridItemImage}
          onError={(e) => console.log("Image load error:", e.nativeEvent.error)}
        />
        <Text numberOfLines={1} style={styles.gridItemText}>
          {item.Name}
        </Text>

        {/* Show heart icon in Add-to-Favorites mode */}
        {isAddingToFavorites && (
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => toggleFavorite(item)}
          >
            <Icon
              name={isFavorite ? "heart" : "heart-outline"}
              size={20}
              color={isFavorite ? "#e74c3c" : "#666"}
            />
          </TouchableOpacity>
        )}

        {/* Show delete icon in Favorites category */}
        {selectedPetType === 'FAVORITES' && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => toggleFavorite(item)}
          >
            <Icon
              name="close-circle"
              size={20}
              color="#e74c3c"
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }, [selectItem, toggleFavorite, localState.favorites, isAddingToFavorites, selectedPetType]);


  const getItemLayout = useCallback((data, index) => ({
    length: 100, // Approximate height of each item
    offset: 100 * index,
    index,
  }), []);



  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };

  // useEffect(() => {
  //   setRefreshKey(prev => prev + 1); 
  // }, [localState.isMM2]);



  const isDarkMode = theme === 'dark'
  const viewRef = useRef();

  const resetState = () => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal({ price: 0, value: 0 });
    setWantsTotal({ price: 0, value: 0 });
    setHasItems([null, null, null, null]);
    setWantsItems([null, null, null, null]);
  };

  const handleCreateTradePress = async (type) => {
    if (!user.id & type === 'create') {
      setIsSigninDrawerVisible(true)
      return;
    }
    if (hasItems.filter(Boolean).length === 0 && wantsItems.filter(Boolean).length === 0) {
      showErrorMessage(
        t("home.alert.error"),
        t("home.alert.missing_items_error")
      );
      return;
    }
    if (type === 'create') {
      setType('create')
    } else {
      setType('share')
    }
    const tradeRatio = wantsTotal.value / hasTotal.value;

    if (
      tradeRatio < 0.05 &&
      hasItems.filter(Boolean).length > 0 &&
      wantsItems.filter(Boolean).length > 0 && type !== 'share'
    ) {
      showErrorMessage(
        t("home.unfair_trade"),
        t('home.unfair_trade_description')
      );
      return;
    }


    if (tradeRatio > 1.95 && type !== 'share' &&
      hasItems.filter(Boolean).length > 0 &&
      wantsItems.filter(Boolean).length > 0) {
      showErrorMessage(
        t('home.invalid_trade'),
        t('home.invalid_trade_description')
      );
      return;
    }

    setModalVisible(true)
  };




  // console.log(hasItems)

  const handleCreateTrade = async () => {
    if (isSubmitting) {
      // console.log("🚫 Trade submission blocked: Already submitting.");
      return; // Prevent duplicate submissions
    }

    setIsSubmitting(true);
    // console.log("🚀 Trade submission started...");
    try {
      const database = getDatabase();
      const avgRatingSnap = await ref(database, `averageRatings/${user.id}`).once('value');
      const avgRatingData = avgRatingSnap.val();

      const userRating = avgRatingData?.value || null;
      const ratingCount = avgRatingData?.count || 0; // 👈 total users who rated

      // ✅ Build new trade object
      let newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState.isPro,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && item.Name).map(item => ({ name: item.Name,  value: item.Value, image:item.Image })),
        wantsItems: wantsItems.filter(item => item && item.Name).map(item => ({ name: item.Name,  value: item.Value, image:item.Image })),
        hasTotal: {  value: hasTotal?.value || 0 },
        wantsTotal: {  value: wantsTotal?.value || 0 },
        description: description || "",
        timestamp: firestore.FieldValue.serverTimestamp(),
        rating: userRating,
        ratingCount: ratingCount

      };
      if (type === 'share') {
        setModalVisible(false); // Close modal
        setSelectedTrade(newTrade);
        setOpenShareModel(true)
        mixpanel.track("Start Sharing");

      } else {

        // console.log("📌 New trade object created:", newTrade);

        // ✅ Check last trade locally before querying Firestore
        const now = Date.now();
        if (lastTradeTime && now - lastTradeTime < 1 * 1 * 60 * 1000) {
          showErrorMessage(
            t("home.alert.error"),
            "Please wait for 1 minut before creating new trade"
          );
          setIsSubmitting(false);
          return;
        }

        // console.log("✅ No duplicate trade found. Proceeding with submission...");

        // ✅ Submit trade
        await tradesCollection.add(newTrade);
        // console.log("🎉 Trade successfully submitted!");

        setModalVisible(false); // Close modal
        const callbackfunction = () => {
          showSuccessMessage(
            t("home.alert.success"),
            "Your trade has been posted successfully!"
          );
        };

        // ✅ Update last trade time locally
        setLastTradeTime(now);
        mixpanel.track("Trade Created", { user: user?.id });

        if (!localState.isPro) {
          InterstitialAdManager.showAd(callbackfunction);
        } else {
          callbackfunction()
        }
      }
    } catch (error) {
      console.error("🔥 Error creating trade:", error);
      showErrorMessage(
        t("home.alert.error"),
        "Something went wrong while posting the trade."
      );
    } finally {
      // console.log("🔄 Resetting submission state...");
      setIsSubmitting(false); // Reset submission state
    }
  };




  useEffect(() => {
    let isMounted = true;
    const MM2 = localState.isMM2;

    if (MM2 && localState.data) {
      try {
        const parsed = typeof localState.data === 'string'
          ? JSON.parse(localState.data)
          : localState.data;

        const extracted = extractMM2Values(parsed);
        if (isMounted) {
          setFruitRecords(extracted);
        }
      } catch (err) {
        console.error("❌ Error parsing MM2 data in HomeScreen:", err);
        setFruitRecords([]);
      }
    }
    if (!MM2 && localState.suprime) {
      try {
        const parsed = typeof localState.suprime === 'string'
          ? JSON.parse(localState.suprime)
          : localState.data;

        const extracted = extractMM2Values(parsed);
        if (isMounted) {
          setFruitRecords(extracted);
        }
      } catch (err) {
        console.error("❌ Error parsing MM2 data in HomeScreen:", err);
        setFruitRecords([]);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [localState.isMM2]);



  const openDrawer = (section) => {
    const wantsItemCount = wantsItems.filter((item) => item !== null).length;
    triggerHapticFeedback('impactLight');

    const callbackfunction = () => {
      setSelectedSection(section);
      setIsDrawerVisible(true);
    };

    if (section === 'wants' && wantsItemCount === 1 && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    } else {
      callbackfunction(); // No ad needed
    }
  };



  const closeDrawer = () => {
    setIsDrawerVisible(false);
  };

  const updateTotal = (item, section, add = true, isNew = false) => {
    // console.log(item);

    const price = Number(item.Price) || 0; // Ensure it's a number or default to 0
    const value = Number(item.Value) || 0;

    const priceChange = add ? price : -price;

    // Update value only if item.Type isNew
    const valueChange = isNew ? (add ? value : -value) : 0;

    if (section === 'has') {
      setHasTotal((prev) => ({
        price: prev.price + priceChange,
        value: prev.value + valueChange,
      }));
    } else {
      setWantsTotal((prev) => ({
        price: prev.price + priceChange,
        value: prev.value + valueChange,
      }));
    }
  };




  const selectItem = (item) => {
    // console.log(item)
    triggerHapticFeedback('impactLight');
    const newItem = { ...item, usePermanent: false };
    const updateItems = selectedSection === 'has' ? [...hasItems] : [...wantsItems];
    const nextEmptyIndex = updateItems.indexOf(null);
    if (nextEmptyIndex !== -1) {
      updateItems[nextEmptyIndex] = newItem;
    } else {
      updateItems.push(newItem);
    }
    if (selectedSection === 'has') {
      setHasItems(updateItems);
      updateTotal(newItem, 'has', true, true);
    } else {
      setWantsItems(updateItems);
      updateTotal(newItem, 'wants', true, true);
    }
    closeDrawer();

  };
  const renderFavoritesFooter = useCallback(() => {
    if (selectedPetType === 'FAVORITES') {
      return (
        <View style={styles.badgeContainer}>
          <TouchableOpacity
            style={styles.addToFavoritesButton}
            onPress={() => {
              setIsAddingToFavorites(true);
              setSelectedPetType('All');
            }}
          >
            <Icon name="add-circle" size={30} color={config.colors.primary} />
            <Text style={styles.addToFavoritesText}>Add Items to Favorites</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);
  const removeItem = (index, isHas) => {
    triggerHapticFeedback('impactLight');
    const section = isHas ? 'has' : 'wants';
    const items = isHas ? hasItems : wantsItems;
    const updatedItems = [...items];
    const item = updatedItems[index];

    if (item) {
      updatedItems[index] = null;
      const filteredItems = updatedItems.filter((item, i) => item !== null || i < 4);
      if (isHas) setHasItems(filteredItems);
      else setWantsItems(filteredItems);
      updateTotal(item, section, false, true);
    }
  };

  const filteredData = useMemo(() => {
    const search = searchText.toLowerCase();

    // ✅ Show only favorite items
    if (selectedPetType === 'FAVORITES') {
      return (localState.favorites || []).filter((fav) =>
        fav.Name.toLowerCase().includes(search)
      );
    }

    // ✅ Otherwise, filter normal items by name and category
    return fruitRecords.filter((item) =>
      item.Name.toLowerCase().includes(search) &&
      (selectedPetType === 'All' || item.Category.toLowerCase() === selectedPetType.toLowerCase())
    );
  }, [fruitRecords, localState.favorites, selectedPetType, searchText, localState.isMM2]);


  const profitLoss = wantsTotal.value - hasTotal.value;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;

  const profitPercentage = hasTotal.value > 0
    ? ((profitLoss / hasTotal.value) * 100).toFixed(0)
    : 0;

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const lastFilledIndexHas = hasItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);
  const lastFilledIndexWant = wantsItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);



  return (
    <>
      <GestureHandlerRootView key={localState.isMM2}>

        <View style={styles.container} key={language}>
          <ScrollView showsVerticalScrollIndicator={false}>




            <ViewShot ref={viewRef} style={styles.screenshotView}>
              {config.isNoman && <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <Text style={[styles.summaryText]}>{t('home.you')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {hasTotal.value?.toLocaleString()}</Text>
                  {/* <Text style={styles.priceValue}>{t('home.price')}: ${hasTotal.price?.toLocaleString()}</Text> */}
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <Text style={styles.summaryText}>{t('home.them')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {wantsTotal.value?.toLocaleString()}</Text>
                  {/* <Text style={styles.priceValue}>{t('home.price')}: ${wantsTotal.price?.toLocaleString()}</Text> */}
                </View>
              </View>}
              <View style={styles.profitLossBox}>
                <Text style={[styles.profitLossText, { color: selectedTheme.colors.text }]}>
                  {isProfit ? t('home.profit') : t('home.loss')}:
                </Text>
                <Text style={[styles.profitLossValue, { color: isProfit ? config.colors.primary : config.colors.primary }]}>
                  ${Math.abs(profitLoss).toLocaleString()} ({profitPercentage}%)
                </Text>
                {!neutral && <Icon
                  name={isProfit ? 'arrow-up-outline' : 'arrow-down-outline'}
                  size={20}
                  color={isProfit ? config.colors.primary : config.colors.primary}
                  style={styles.icon}
                />}
              </View>

              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text }]}>{t('home.you')}</Text>
              <View style={styles.itemRow}>


                {config.isNoman && hasItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: '#1B1B1B' }]} onPress={() => { openDrawer('has') }} disabled={item !== null}>
                    {item ? (
                      <>

                        <Image
                          source={{ uri: item.Image }}
                          resizeMode="cover"
                          style={[styles.itemImageOverlay]}
                        />

                        <Text style={[styles.itemText, { color: 'white' }
                        ]}>{item.usePermanent
                          ? (Number(item.Permanent) === 0 ? "Special" : Number(item.Permanent).toLocaleString())
                          : (Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())
                          }</Text>
                        <Text style={[styles.itemText, { color: 'white' }
                        ]}>{item.Type === 'p' && 'Perm'}  {item.Name}</Text>
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, true)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        {index === lastFilledIndexHas + 1 && <Icon name="add-circle" size={30} color="grey" />}
                        {index === lastFilledIndexHas + 1 && <Text style={styles.itemText}>{t('home.add_item')}</Text>}
                      </>
                    )}
                  </TouchableOpacity>
                ))}

              </View>

              <View style={styles.divider}>
                <Image
                  source={require('../../assets/reset.png')} // Replace with your image path
                  style={{ width: 18, height: 18, tintColor: 'white' }} // Customize size and color
                  onTouchEnd={resetState} // Add event handler
                />
              </View>

              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text }]}>{t('home.them')}</Text>
              <View style={[styles.itemRow, { marginBottom: 0 }]}>

                {config.isNoman && wantsItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor:  '#1B1B1B' }]} onPress={() => { openDrawer('wants'); }} disabled={item !== null}>
                    {item ? (
                      <>
                        <Image
                          source={{ uri: item.Image }}
                          resizeMode="cover"
                          style={[styles.itemImageOverlay]}
                        />
                        <Text style={[styles.itemText, { color: 'white' }
                        ]}>{(Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())}</Text>
                        <Text style={[styles.itemText, { color: 'white' }
                        ]}>{item.Name}</Text>
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, false)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>

                    ) : (
                      <>
                        {index === lastFilledIndexWant + 1 && <Icon name="add-circle" size={30} color="grey" />}
                        {index === lastFilledIndexWant + 1 && <Text style={styles.itemText}>{t('home.add_item')}</Text>}
                      </>
                      // <Text style={styles.itemPlaceholder}>{t('home.empty')}</Text>
                    )}
                  </TouchableOpacity>
                ))}


              </View>

            </ViewShot>
            <View style={styles.createtrade} >
              <TouchableOpacity style={styles.createtradeButton} onPress={() => handleCreateTradePress('create')}><Text style={{ color: 'white' }}>{t('home.create_trade')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={() => handleCreateTradePress('share')}><Text style={{ color: 'white' }}>{t('home.share_trade')}</Text></TouchableOpacity></View>
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
                <View style={styles.categoryList}>
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryButton,
                        selectedPetType === category && styles.categoryButtonActive
                      ]}
                      onPress={() => {
                        setSelectedPetType(category);
                        if (category !== 'FAVORITES') {
                          setIsAddingToFavorites(false);
                        }
                      }}
                    >
                      <Text style={[
                        styles.categoryButtonText,
                        selectedPetType === category && styles.categoryButtonTextActive
                      ]}>{category}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.gridContainer}>
                  {renderFavoritesHeader()}
                  <FlatList
                    data={filteredData}
                    keyExtractor={keyExtractor}
                    renderItem={renderGridItem}
                    numColumns={3}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={5}
                    removeClippedSubviews={true}
                    getItemLayout={getItemLayout}
                  />
                  {selectedPetType === 'FAVORITES' && renderFavoritesFooter()}
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={modalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setModalVisible(false)} // Close modal on request
          >
            <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
            <ConditionalKeyboardWrapper>
              <View>
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
                      <Text style={styles.buttonText}>{isSubmitting ? t('home.submit') : t('home.confirm')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ConditionalKeyboardWrapper>
          </Modal>
          <ShareTradeModal
            visible={openShareModel}
            onClose={() => setOpenShareModel(false)}
            tradeData={selectedTrade}
          />
          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            screen='Chat'
            message={t("home.alert.sign_in_required")}

          />
        </View>
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent />}
    </>
  );
}
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#141414' : '#f2f2f7',
      paddingBottom: 5,
    },

    summaryContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    summaryBox: {
      width: config.isNoman ? '48%' : '49%',
      padding: 5,
      borderRadius: 8,
    },
    hasBox: {
      backgroundColor: config.colors.primary,
    },
    wantsBox: {
      backgroundColor: config.colors.primary,
    },
    summaryText: {
      fontSize: 16,
      lineHeight: 20,
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',

    },
    priceValue: {
      color: 'white',
      textAlign: 'center',
      marginTop: 5,
      fontFamily: 'Lato-Bold',

    },
    sectionTitle: {
      fontSize: 14,
      marginBottom: 5,
      fontFamily: 'Lato-Bold',

    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 5,

    },
    addItemBlockNew: {
      width: '48%',
      height: config.isNoman ? 80 : 110,
      backgroundColor: isDarkMode ? '#1B1B1B' : '#CCCCFF', // Dark: darker contrast, Light: White
      borderWidth: Platform.OS === 'android' ? 0 : 1,
      borderColor: 'lightgrey',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 8,
      marginBottom: 5,
      borderWidth: 1,
      borderColor: '#2A3942'

    },
    addItemBlockNewNoman: {
      width: '49%',
      height: config.isNoman ? 80 : 110,
      backgroundColor: isDarkMode ? '#1B1B1B' : '#CCCCFF', // Dark: darker contrast, Light: White
      borderWidth: Platform.OS === 'android' ? 0 : 1,
      borderColor: 'lightgrey',
      justifyContent: 'space-between',
      // alignItems: 'center',
      borderRadius: 8,
      marginBottom: 5,
      borderWidth: 1,
      borderColor: '#2A3942',
      borderWidth: 1,
      borderColor: '#2A3942'

    },
    addItemBlock: {
      width: '32%',
      height: 85,
      backgroundColor: isDarkMode ? '#1B1B1B' : '#CCCCFF', // Dark: darker contrast, Light: White
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: '#2A3942'
    },
    itemBlock: {
      width: '32%',
      height: 110,
      backgroundColor: isDarkMode ? '#1B1B1B' : '#CCCCFF', // Dark: darker contrast, Light: White
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
      position: 'relative',
      borderWidth: 1,
      borderColor: '#2A3942',
      ...(!config.isNoman && {
        borderWidth: 5,
        borderColor: config.colors.primary,
      }),
    },

    itemText: {
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
      fontSize: 12
    },
    itemPlaceholder: {
      color: '#CCC',
      textAlign: 'center',
    },
    favoriteButton: {
      position: 'absolute',
      top: 6,
      right: 6,
    },

    removeButton: {
      position: 'absolute',
      bottom: 6,
      right: 6,
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
      backgroundColor: isDarkMode ? '#1B1B1B' : 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      height: '90%',
      paddingTop: 16,
      paddingHorizontal: 16,
    },
    drawerContainer2: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: isDarkMode ? '#1B1B1B' : 'white',
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
    categoryList: {
      width: '30%',
      paddingRight: 12,
    },
    categoryButton: {
      marginVertical: 4,
      paddingVertical: 8,
      paddingHorizontal: 8,
      backgroundColor: '#2A3942',
      borderRadius: 12,
      alignItems: 'center',
    },
    categoryButtonActive: {
      backgroundColor: config.colors.primary,
    },
    categoryButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: 'white',
    },
    categoryButtonTextActive: {
      color: '#fff',
    },
    gridContainer: {
      flex: 1,
      // paddingBottom: 60,
    },
    gridContainer: {
      flex: 1,
      // paddingBottom: 60,
    },
    gridItem: {
      flex: 1,
      margin: 4,
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 3,
      borderWidth: 1,
      borderColor: '#2A3942'

    },
    gridItemImage: {
      width: 60,
      height: 60,
      borderRadius: 10,
    },
    gridItemText: {
      fontSize: 11,
      marginBottom: 2,
      marginTop: -2,
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

    profitLossBox: { flexDirection: 'row', justifyContent: 'center', marginVertical: 0, alignItems: 'center' },
    profitLossText: { fontSize: 14, fontFamily: 'Lato-Bold' },
    profitLossValue: { fontSize: 14, marginLeft: 5, fontFamily: 'Lato-Bold' },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
    },
    searchInput: {
      width: '75%',
      borderColor: 'grey',
      borderWidth: 1,
      borderRadius: 5,
      height: 48,
      borderColor: '#333',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      backgroundColor: '#fff',
      color: '#000',
    },
    closeButton: {
      backgroundColor: config.colors.primary,
      padding: 10,
      borderRadius: 5,
      height: 48,

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
    flatListContainer: {
      justifyContent: 'space-between',
      paddingBottom: 20
    },
    columnWrapper: {
      flex: 1,
      justifyContent: 'space-around',
    },
    itemImageOverlay: {
      width: 40,
      height: 40,
      borderRadius: 5,
    },
    itemImageOverlayNoman: {
      width: 50,
      height: 50,
      borderRadius: 5,
    },


    screenshotView: {
      padding: 10,
      flex: 1,
      // paddingVertical: 10,
    },
    float: {
      position: 'absolute',
      right: 5,
      bottom: 5,
      // width:40,
      zIndex: 1,
      // height:40,
      // backgroundColor:'red'

    },
    titleText: {
      fontFamily: 'Lato-Regular',
      fontSize: 10
    },
    loaderContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loaderText: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
    noDataContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#f9f9f9',
    },
    noDataText: {
      fontSize: 16,
      color: 'gray',
      fontFamily: 'Lato-Bold',
    },
    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.primary,
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
      backgroundColor: config.colors.primary,
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
      backgroundColor: config.colors.primary,
    },
    confirmButton: {
      backgroundColor: config.colors.primary,
    },
    buttonText: {
      color: 'white',
      fontSize: 14,
      fontFamily: 'Lato-Bold',
    },

    perm: {
      position: 'absolute',
      top: 2,
      left: 10,
      color: 'lightgrey',
      fontFamily: 'Lato-Bold',
      color: 'white',
    },

    text: {
      color: "white",
      fontSize: 12,
      fontFamily: "Lato-Regular",
      lineHeight: 12
    },

    gridItemImage: {
      width: 60,
      height: 60,
      borderRadius: 6,
      marginBottom: 6,
      alignSelf: 'center'
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
      backgroundColor: config.colors.primary,
    },
    confirmButton: {
      backgroundColor: config.colors.primary,
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

    itemBlock: {
      width: '11.11%',
      height: 110,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
      position: 'relative',
      ...(!config.isNoman && {
        borderColor: config.colors.primary,
      }),
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
      padding: 15,
      borderRadius: 8,
      margin: 10,
      width: '100%',
    },
    addToFavoritesText: {
      marginLeft: 8,
      fontSize: 14,
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


  });

export default HomeScreen