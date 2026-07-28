import React, { useCallback, useMemo } from 'react';
import { Image, TouchableOpacity, View, Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import HomeTabNavigator from '../HomeTab/HomeTabNavigator';
// import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import DesignUploader from '../Design/DesignMainScreen';
import DesignStack from '../Design/DesignNavigation';


const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ iconName, color, size, focused }) => {
  return (
    <FontAwesome
      name={iconName}
      size={size}
      color={color}
      solid={focused}
    />
  );
});


const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t } = useTranslation();
  const { isAdmin, user, theme } = useGlobalState();
  const insets = useSafeAreaInsets();

  // ✅ Memoize icons object to avoid recreation
  const icons = useMemo(() => ({
    Home: ['house', 'house'],
    Calculator: ['calculator', 'calculator'],
    Stock: ['cart-shopping', 'cart-shopping'],
    Trade: ['handshake', 'handshake'],
    Chat: ['envelope', 'envelope'],
    Designs: ['house-chimney-crack', 'house-chimney-crack'],
  }), []);

  const getTabIcon = useCallback((routeName, focused) => {
    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, [icons]);

  // ✅ Memoize headerRight component to prevent re-renders
  const headerRight = useCallback((navigation) => (
    <>
      {isAdmin && (
        <TouchableOpacity onPress={() => navigation.navigate('Admin')}>
          <Image
            source={require('../../assets/trophy.webp')}
            style={{ width: 20, height: 20, marginRight: 16 }}
          />
        </TouchableOpacity>
      )}
    </>
  ), [isAdmin]);

  // ✅ Memoize isDarkMode to avoid recalculation
  const isDarkMode = useMemo(() => theme === 'dark', [theme]);

  // ✅ Memoize tabBarButton styles
  const tabBarButtonStyles = useMemo(() => ({
    base: {
      flex: 1,
      borderRadius: 14,
      marginHorizontal: 3,
      marginVertical: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }), []);


  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: selectedTheme.colors.background },
        headerTintColor: selectedTheme.colors.text,
        headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
      }}
      tabBar={({ state, descriptors, navigation }) => {
        return (
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            height: 56 + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: selectedTheme.colors.background,
            borderTopWidth: 0.5,
            borderTopColor: isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
          }}>
            {state.routes.map((route, index) => {
                const { options } = descriptors[route.key];
                const label =
                  options.tabBarLabel !== undefined
                    ? options.tabBarLabel
                    : options.title !== undefined
                    ? options.title
                    : route.name;

                const isFocused = state.index === index;

                const onPress = () => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!isFocused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                };

                const activeColor = config.colors.primary;
                const inactiveColor = isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';

                return (
                  <TouchableOpacity
                    key={route.key}
                    onPress={onPress}
                    activeOpacity={0.6}
                    style={{
                      flex: 1,
                      height: 48,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <AnimatedTabIcon
                      focused={isFocused}
                      iconName={getTabIcon(route.name, isFocused)}
                      color={isFocused ? activeColor : inactiveColor}
                      size={isFocused ? 20 : 18}
                    />
                    <Text style={{
                      fontSize: 9,
                      fontFamily: 'Lato-Bold',
                      color: isFocused ? activeColor : inactiveColor,
                      marginTop: 2,
                    }} numberOfLines={1}>
                      {label}
                    </Text>

                    {/* Unread badge */}
                    {options.tabBarBadge !== undefined && options.tabBarBadge !== null && options.tabBarBadge !== "" && (
                      <View style={{
                        position: 'absolute', top: 6, right: 8,
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: config.colors.error,
                      }} />
                    )}
                  </TouchableOpacity>
                );
            })}
          </View>
        );
      }}
    >
      <Tab.Screen
        name="Home"
        options={({ navigation }) => ({
          title: t('tabs.home'),
          headerShown: false,
        })}
      >
        {() => <HomeTabNavigator selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Calculator"
        options={({ navigation }) => ({
          title: t('tabs.calculator'),
          headerRight: () => headerRight(navigation),
        })}
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      {/* <Tab.Screen
        name="Stock"
        options={{
          title: t('tabs.stock'), // Translation applied here
        }}
      >
        {() => <TimerScreen selectedTheme={selectedTheme} />}
      </Tab.Screen> */}

      <Tab.Screen
        name="Trade"
        options={{
          headerShown: false,
          title: t('tabs.trade'), // Translation applied here
        }}
      >
        {() => (
          <TradeStack
            selectedTheme={selectedTheme}
            setChatFocused={setChatFocused}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Designs"
        options={{
          title: t('tabs.feed'), // Translation applied here
          headerShown: false
        }}
      >
        {() => <DesignStack selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Chat"
        options={{
          headerShown: false,
          title: t('tabs.chat'), // Translation applied here
          tabBarBadge: chatFocused ? "" : null,
          tabBarBadgeStyle: {
            maxWidth: 4,
            height: 8,
            borderRadius: 4,
            fontSize: 10,
            backgroundColor: config.colors.error,
            color: config.colors.white,
          },
        }}
      >
        {() => (
          <ChatStack
            selectedTheme={selectedTheme}
            setChatFocused={setChatFocused}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
          />
        )}
      </Tab.Screen>




    </Tab.Navigator>
  );
});

export default MainTabs;
