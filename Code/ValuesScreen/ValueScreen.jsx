import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Modal,
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
import { handleadoptme, handleBloxFruit, handleShareApp } from '../SettingScreen/settinghelper';

const ValueScreen = ({ selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const [filteredData, setFilteredData] = useState([]);
  const { localState, toggleAd } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const filters = !localState.isMM2 ?  ['All', 'Ancient', 'Unique', 'Chroma', 'Godly', 'Legend', 'Rare', 'Uncommon', 'Common', 'Vintage', 'Pets', 'Misc'] : ['All', 'Sets',  'Ancients', 'Evos', 'Uniques', 'Chromas', 'Godlies', 'Legendaries', 'Rares', 'Uncommons', 'Commons', 'Vintages', 'Pets', 'Mis', 'Untradables'];
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // State for pull-to-refresh
  const [showAd1, setShowAd1] = useState(localState.showAd1);

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });

  const openEditModal = (fruit) => {
    if (!fruit) return;
    setSelectedFruit(fruit);

    // Store values in ref, NOT state
    editValuesRef.current = {
      Value: fruit.Value.toString(),
      Permanent: fruit.Permanent.toString(),
      Biliprice: fruit.Biliprice.toString(),
      Robuxprice: fruit.Robuxprice.toString(),
    };

    setIsModalVisible(true);
  };

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

  const CustomAd = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/adoptme.png')} // Replace with your ad icon
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>ADOPT ME Values</Text>
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
  const CustomAd2 = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/icon.webp')} // Replace with your ad icon
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>Blox Fruit Values</Text>
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

  useEffect(() => {
    if (localState.data) {
      try {
        const parsedValues = typeof localState.data === 'string'
          ? JSON.parse(localState.data)
          : localState.data;

        if (typeof parsedValues !== 'object' || parsedValues === null) {
          throw new Error('Parsed data is not a valid object');
        }

        const flattened = Object.entries(parsedValues).flatMap(([category, tiers]) =>
          Object.entries(tiers).flatMap(([tier, items]) =>
            items.map((item) => ({
              ...item,
              category,
              tier,
              type: category // Optional: add this for filtering
            }))
          )
        );

        setValuesData(flattened);
      } catch (error) {
        console.error("❌ Error parsing data:", error, "📝 Raw Data:", localState.data);
        setValuesData([]);
      }
    }
  }, [localState.data]);

  useEffect(() => {
    if (localState.codes) {
      try {
        // ✅ Handle both JSON string & object cases
        const parsedCodes = typeof localState.codes === 'string' ? JSON.parse(localState.codes) : localState.codes;

        // ✅ Ensure parsedCodes is a valid object
        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("❌ Error parsing codes:", error, "📝 Raw Codes Data:", localState.codes);
        setCodesData([]); // Fallback to empty array
      }
    }
  }, [localState.codes]);

  useEffect(() => {
    // Toggle the ad state when the screen is mounted
    const newAdState = toggleAd();
    setShowAd1(newAdState);
  }, []);

  const handleFilterChange = (filter) => {
    triggerHapticFeedback('impactLight');
    setSelectedFilter(filter === 'GAME PASS' ? 'PREMIUM' : filter);
    setFilterDropdownVisible(false);
  };

  const handleSearchChange = debounce((text) => {
    setSearchText(text);
  }, 300);
  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };
  useEffect(() => {
    if (!Array.isArray(valuesData) || valuesData.length === 0) {
      setFilteredData([]);
      return;
    }

    const filtered = valuesData.filter((item) => {
      if (!item?.name || !item?.category) return false;
      const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
      const matchesFilter = selectedFilter === 'All' || item.category === selectedFilter;
      return matchesSearch && matchesFilter;
    });



    setFilteredData(filtered);
  }, [valuesData, searchText, selectedFilter]);
  const EditFruitModal = () => (
    <Modal visible={isModalVisible} transparent={true} animationType="slide">
      <View style={styles.modalContainer}>
        <Text style={styles.modalTitle}>Edit {selectedFruit?.name}</Text>

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Value}
          onChangeText={(text) => (editValuesRef.current.Value = text)}
          keyboardType="numeric"
          placeholder="Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Permanent}
          onChangeText={(text) => (editValuesRef.current.Permanent = text)}
          keyboardType="numeric"
          placeholder="Permanent Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Biliprice}
          onChangeText={(text) => (editValuesRef.current.Biliprice = text)}
          keyboardType="numeric"
          placeholder="Beli Price"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Robuxprice}
          onChangeText={(text) => (editValuesRef.current.Robuxprice = text)}
          keyboardType="default"
          placeholder="Robux Price"
        />


        <TouchableOpacity style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsModalVisible(false)} style={styles.cencelButton}>
          <Text style={styles.saveButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );



  const renderItem = React.useCallback(({ item }) => (
    <View style={styles.itemContainer}>
      <View style={styles.headerContainer}>
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: localState.isMM2 ? `https://supremevaluelist.com/${item.image}` : `https://mm2values.com/${item.image}` }}
            style={styles.icon}
            resizeMode="cover"
          />
          <View>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.value}>Value: {item.value}</Text>
          </View>
        </View>
        <View style={styles.imageContainer}>
          {/* <Image
            source={{ uri: `https://mm2values.com/${item.image}` }}
            style={styles.icon}
            resizeMode="cover"
          /> */}
          <View>
            <Text style={styles.name}>{item.tier}</Text>
            <Text style={styles.value}></Text>
          </View>
        </View>
      </View>

      <View style={styles.headerContainer}>
        
    
        <View style={styles.pointsBox}>
        <View style={{flexDirection:'column'}}>
          <View style={{flexDirection:'row', marginVertical:5}}>
          <Text style={styles.headertext}>Demand:</Text>
          <Text style={styles.value}>{item.demand !== '' ? item.demand : 'N/A'} </Text>
          </View>
          <View style={{flexDirection:'row'}}>
          <Text style={styles.headertext}>Rarity:</Text>
          <Text style={styles.value}>{item.rarity !== '' ? item.rarity : 'N/A'}</Text>
          </View>
        </View>
        </View>
        <View style={styles.pointsBox}>
        <View style={{flexDirection:'column'}}>
          <View style={{flexDirection:'row', marginVertical:5}}>
          <Text style={styles.headertext}>Stability:</Text>
          <Text style={styles.value}>{item.stability ?? 'N/A'}</Text>
          </View>
          <View style={{flexDirection:'row'}}>
          <Text style={styles.headertext}>Range:</Text>
          <Text style={styles.value}>{item.range !== '' ? item.range : 'N/A'}</Text>
          </View>
        </View>
        </View>
      </View>
    

      {isAdmin && (
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
      )}
      <View style={styles.devider}></View>
    </View>
  ), []);


  // console.log(filteredData)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
            {t("value.description")}
          </Text> */}
          {showAd1 ? (
            <CustomAd />
          ) : (
            <CustomAd2 />
          )}

          <View style={styles.searchFilterContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}

            />
            <Menu>
              <MenuTrigger onPress={() => { }}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{displayedFilter}</Text>
                  <Icon name="chevron-down-outline" size={18} color="white" />
                </View>
              </MenuTrigger>

              <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
                {filters.map((filter) => (
                  <MenuOption
                    key={filter}
                    onSelect={() => {
                      applyFilter(filter);
                    }}
                  >
                    <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                      {filter}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>
            </Menu>
            <TouchableOpacity
              style={[styles.filterDropdown, { backgroundColor: config.colors.primary }]}
              onPress={toggleDrawer}
            >
              <Text style={[styles.filterText, { color: 'white' }]}> {t("value.codes")}</Text>
            </TouchableOpacity>
          </View>







          {filteredData.length > 0 ? (
            <>
              <FlatList
                data={filteredData}
                keyExtractor={(item, index) =>
                  `${item.name?.replace(/\s+/g, '_')}_${item.category}_${item.tier}_${index}`
                }

                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                numColumns={!config.isNoman ? 1 : 1}
                refreshing={refreshing}
                onRefresh={handleRefresh}
              // columnWrapperStyle={!config.isNoman ? styles.columnWrapper : styles.columnWrapper}
              />
              {isModalVisible && selectedFruit && <EditFruitModal />}
            </>
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )
          }

        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent />}

      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
    </>
  );
};
export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: { paddingHorizontal: 8, marginHorizontal: 2, flex: 1, backgroundColor:'#141414' },
    searchFilterContainer: { flexDirection: 'row', marginVertical: 5, alignItems: 'center' },
    searchInput: {
      height: 40,
      borderColor: isDarkMode ? config.colors.primary : 'white',
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',

      borderWidth: 1,
      borderRadius: 5,
      marginVertical: 8,
      paddingHorizontal: 10,
      color: isDarkMode ? 'white' : 'black',
      flex: 1,
      borderRadius: 10, marginRight: 10 // Ensure smooth corners
    },
    filterDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E0E0E0', padding: 10, borderRadius: 10, height: 40, marginLeft: 10 },
    filterOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
    filterTextOption: { fontSize: 12 },
    // itemContainer: { alignItems: 'flex-start', backgroundColor: 'red', borderRadius: 10, padding: 10, 
    //    width: '100%', marginVertical: 5 },
    icon: { width: 50, height: 50, borderRadius: 5, marginRight: 10, backgroundColor: 'transparent' },
    infoContainer: { flex: 1 },
    name: {
      fontSize: 16, fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#000',
      lineHeight: 18,
    },
    value: {
      fontSize: 10, fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#fff' : '#000',
      lineHeight: 14,
    },
    permanentValue: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    beliPrice: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    robuxPrice: {
      fontSize: 10, fontFamily: 'Lato-Regular', color: 'white', lineHeight: 14,
    },
    // statusContainer: { alignItems: 'left', alignSelf: 'flex-end', position: 'absolute', bottom: 0 },
    status: {
      paddingHorizontal: 8, paddingVertical: 4, borderTopLeftRadius: 10, borderBottomRightRadius: 10, color: '#FFF', fontSize: 12, fontFamily: 'Lato-Bold'
    },
    filterText: { fontSize: 14, fontFamily: 'Lato-Regular', marginRight: 5 },
    description: {
      fontSize: 14, lineHeight: 18, marginVertical: 10, fontFamily: 'Lato-Regular',
    },
    loadingIndicator: { marginVertical: 20, alignSelf: 'center' },
    containerBannerAd: {
      justifyContent: 'center',
      alignItems: 'center',
    },

    row: {
      justifyContent: 'space-between', // Space items evenly in a row
      marginVertical: 10, // Add vertical spacing between rows
    },
    imageContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      // flex: 1,
      alignItems: 'center',
      padding:5,


    },
    headerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flex: 1,
      alignItems: 'center',
      width: '100%',
      marginBottom: 3,
      backgroundColor:'#1B1B1B',
      borderRadius:10


    },
    devider: {
      width: '100%',
      height: 1,
      backgroundColor: 'lightgrey',
      marginVertical: 10
    },
    columnWrapper: {
      justifyContent: 'space-between', // Distribute items evenly in each row
      marginBottom: 10, // Add space between rows  
      flex: 1
    },
    itemContainer: {
      alignItems: 'flex-start',
      borderRadius: 10,
      paddingVertical: 10,
      // backgroundColor: config.colors.primary,
      width: !config.isNoman ? '99%' : '99%',
      // marginBottom: !config.isNoman ? 10 : 10,
      // ...(!config.isNoman && {
      //   borderWidth: 5,
      //   borderColor: config.colors.hasBlockGreen,
      // }),
    },
    editButton: {
      backgroundColor: "#3498db",
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 5,
      marginTop: 5,
      alignSelf: "flex-end",
    },
    editButtonText: {
      color: "#fff",
      fontSize: 12,
      fontFamily: 'Lato-Bold',
    },
    modalContainer: {
      backgroundColor: "#fff",
      padding: 20,
      borderRadius: 10,
      width: '80%',
      alignSelf: 'center', // Centers the modal horizontally
      position: 'absolute',
      top: '50%', // Moves modal halfway down the screen
      left: '10%', // Centers horizontally considering width: '80%'
      transform: [{ translateY: -150 }], // Adjusts for perfect vertical centering
      justifyContent: 'center',
      // alignItems: 'center',
      elevation: 5, // Adds a shadow on Android
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    }
    ,
    modalTitle: {
      fontSize: 18,
      fontFamily: 'Lato-Bold',
      marginBottom: 10,
    },
    input: {
      borderWidth: 1,
      borderColor: "#ccc",
      padding: 8,
      marginVertical: 5,
      borderRadius: 5,
    },
    saveButton: {
      backgroundColor: "#2ecc71",
      paddingVertical: 10,
      borderRadius: 5,
      marginTop: 10,
    },
    saveButtonText: {
      color: "#fff",
      fontSize: 14,
      fontFamily: 'Lato-Bold',
      textAlign: "center",
    },
    cencelButton: {
      backgroundColor: "red",
      paddingVertical: 10,
      borderRadius: 5,
      marginTop: 10,
    },
    rarity: {
      backgroundColor: '#6A5ACD',
      paddingVertical: 1
      ,
      paddingHorizontal: 5,
      borderRadius: 5,
      color: 'white',
      fontSize: 12
    },
    headertext: {
      backgroundColor: '#6A5ACD',
      paddingVertical: 1,
      paddingHorizontal: 5,
      borderRadius: 5,
      color: 'white',
      fontSize: 10,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: "flex-start",
      marginRight: 10

    },
    pointsBox: {
      width: '49%', // Ensures even spacing
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
      borderRadius: 8,
      // alignItems: 'center',
      padding: 10,
      flexDirection:'row'
    },
    rowcenter: {
      flexDirection: 'row',
      // justifyContent:'center',
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
      paddingHorizontal: 15,
      borderRadius: 8,
    },
    filterText: {
      color: "white",
      fontSize: 14,
      fontFamily: 'Lato-Bold',
      marginRight: 5,
    },
    filterOptionText: {
      fontSize: 14,
      padding: 10,
      color: "#333",
    },
    selectedOption: {
      fontFamily: 'Lato-Bold',
      color: "#34C759",
    },
    adContainer: {
      // backgroundColor: '#F5F5F5', // Light background color for the ad
      padding: 5,
      borderRadius: 10,
      marginBottom: 15,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,

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
      color: 'white',
      // marginBottom: 5, // Adds space below the title
    },
    tryNowText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: '#6A5ACD', // Adds a distinct color for the "Try Now" text
      // marginTop: 5, // Adds space between the title and the "Try Now" text
    },
    downloadButton: {
      backgroundColor: '#34C759',
      paddingVertical: 8,
      paddingHorizontal: 15,
      borderRadius: 5,
      marginTop: 10, // Adds spacing between the text and the button
    },
    downloadButtonText: {
      color: 'white',
      fontSize: 14,
      fontFamily: 'Lato-Bold',
    },
  });

export default ValueScreen;
