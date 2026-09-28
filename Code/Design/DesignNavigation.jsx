import React, { useMemo, useState, useCallback } from 'react';
import { Text, StyleSheet, View, Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';

import DesignFeedScreen from './DesignMainScreen';
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import ImageViewerScreen from './componenets/ImageViewer';

const Stack = createNativeStackNavigator();

const HighlightedText = ({ text }) => (
  <Text style={styles.highlightedText}>{text}</Text>
);

export const DesignStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const openDrawer = useCallback(() => setIsDrawerVisible(true), []);
  const closeDrawer = useCallback(() => setIsDrawerVisible(false), []);
  // console.log('dsignnavigator')

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    contentStyle: { backgroundColor: selectedTheme.colors.background },
    freezeOnBlur: true,
    animation: 'fade',
    animationDuration: 300,
  }), [selectedTheme]);

  const sharedParams = useMemo(() => ({
    bannedUsers,
    selectedTheme,
  }), [bannedUsers, selectedTheme]);

  const getPrivateChatOptions = useCallback(
    ({ route }) => {
      const { selectedUser, isOnline } = route.params || {};
      return {
        headerTitle: () => (
          <PrivateChatHeader
            selectedUser={selectedUser}
            isOnline={isOnline}
            selectedTheme={selectedTheme}
            bannedUsers={bannedUsers}
            setBannedUsers={setBannedUsers}
            triggerHapticFeedback={triggerHapticFeedback}
            setIsDrawerVisible={setIsDrawerVisible}
            
            openDrawer={openDrawer}   // ✅ add this
          />
        ),
      };
    },
    [selectedTheme, bannedUsers, triggerHapticFeedback, openDrawer]
  );

  return (
    <Stack.Navigator screenOptions={headerOptions}>
    <Stack.Screen
      name="DesignScreen"
      component={DesignFeedScreen}
      initialParams={sharedParams}
      options={{
        title: 'Feed',
        // iOS: the native navigation bar renders ~64pt tall here (the root
        // SafeAreaView in App.js already clears the status bar), 20pt taller
        // than the 44pt JS header the Calculator tab gets, so Feed's lone
        // centred title floated in empty space. Draw the same compact bar.
        // Android keeps the native header, which already matches.
        ...(Platform.OS === 'ios' ? {
          header: () => (
            <View style={[styles.compactHeader, {
              backgroundColor: selectedTheme.colors.background,
              borderBottomColor: selectedTheme.colors.border,
            }]}>
              <Text style={[styles.compactHeaderTitle, { color: selectedTheme.colors.text }]}>Feed</Text>
            </View>
          ),
        } : {}),
      }}
    />

    <Stack.Screen name="PrivateChatDesign" options={getPrivateChatOptions}>
      {(props) => (
        <PrivateChatScreen
          {...props}
          bannedUsers={bannedUsers}
          isDrawerVisible={isDrawerVisible}
          setIsDrawerVisible={setIsDrawerVisible}
          closeProfileDrawer={closeDrawer} // ✅ optional convenience prop
        />
      )}
    </Stack.Screen>

    <Stack.Screen
      name="ImageViewerScreen"
      component={ImageViewerScreen}
      options={{ title: 'Image' }}
    />
  </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  compactHeader: {
    height: 44, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compactHeaderTitle: { fontFamily: 'Lato-Bold', fontSize: 24 },
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
  },
});

export default React.memo(DesignStack);
