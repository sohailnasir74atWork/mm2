import React, {  useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Image } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TradeList from './Trades';
import { useHaptic } from '../Helper/HepticFeedBack';
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useNavigation } from '@react-navigation/native';
import NotifierDrawer from './Notifier';

const Stack = createNativeStackNavigator();

const HighlightedText = ({ text }) => {
  return (
    <Text style={styles.highlightedText}>{text}</Text>
  );
};

const TradeRulesModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';


  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackground}>
        <View style={[styles.modalContainer, { backgroundColor: isDarkMode ? config.colors.surfaceDark : 'white' }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? 'white' : 'black' }]}>
              How Trading Works in Adopt Me
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close-circle" size={28} color={isDarkMode ? '#bbb' : '#333'} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalText, { color: isDarkMode ? '#ccc' : '#333' }]}>
              1. <HighlightedText text="Basics:" /> Players trade pets, items, and vehicles using the in-game trading system.{"\n"}{"\n"}
              2. <HighlightedText text="Trade Window:" /> Each player can offer up to 9 items per trade.{"\n"}{"\n"}
              3. <HighlightedText text="Two-Step Confirmation:" /> Players must first select items, then confirm again to finalize the trade.{"\n"}{"\n"}
              4. <HighlightedText text="Trade License:" /> Required for trading ultra-rare or legendary items (obtained by passing a short test).{"\n"}{"\n"}
              5. <HighlightedText text="Safe Trading:" /> Warnings appear for unfair trades; players should review offers carefully.{"\n"}{"\n"}
              6. <HighlightedText text="Report Feature:" /> Suspicious trades can be reported directly from the trade window.{"\n"}
            </Text>
          </ScrollView>
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.closeButtonText, { color: isDarkMode ? 'white' : 'white' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export const TradeStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  // const navigation = useNavigation()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);


  const headerOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: selectedTheme.colors.background },
      headerTintColor: selectedTheme.colors.text,
      headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
      contentStyle: { backgroundColor: selectedTheme.colors.background },
      freezeOnBlur: true,
      animation: 'fade',
      animationDuration: 300,
    }),
    [selectedTheme]
  );

  const [showMyTrades, setShowMyTrades] = useState(false);

  return (
    <>
      <Stack.Navigator screenOptions={headerOptions}>
        {/* Trade List Screen with Trade Rules Button */}
        <Stack.Screen
          name="TradeScreen"
          component={TradeList}
          initialParams={{ bannedUsers, selectedTheme, showMyTradesOnly: showMyTrades }}
          options={({ navigation }) => ({
            title: showMyTrades ? 'My Trades' : t("tabs.trade"),
            headerRight: () => (
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity
                  onPress={() => {
                    const newVal = !showMyTrades;
                    setShowMyTrades(newVal);
                    navigation.setParams({ showMyTradesOnly: newVal });
                  }}
                  style={{ marginRight: 5 }}
                >
                  <Icon
                    name={showMyTrades ? "person" : "person-outline"}
                    size={24}
                    color={showMyTrades ? config.colors.hasBlockGreen : config.colors.primary}
                  />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => navigation.navigate('Trade Notifier')} style={{ marginRight: 5 }}>
                  <Icon
                    name="notifications"
                    size={24}
                    color={config.colors.primary}
                  />
                </TouchableOpacity>
          
                <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 8 }}>
                  <Icon
                    name="information-circle-outline"
                    size={24}
                    color={config.colors.primary}
                  />
                </TouchableOpacity>
              </View>
            ),
          })}
          
        />

        {/* Private Chat Screen */}
        <Stack.Screen
  name="PrivateChatTrade"
  options={({ route }) => ({
    headerTitle: () => (
      <PrivateChatHeader
        selectedUser={route.params?.selectedUser}
        selectedTheme={selectedTheme}
        bannedUsers={bannedUsers}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
      />
    ),
  })}
>
  {(props) => (
    <PrivateChatScreen
      {...props}
      bannedUsers={bannedUsers}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
    />
  )}
</Stack.Screen>
        <Stack.Screen
          name="Trade Notifier"
          component={NotifierDrawer}
         
        />
      </Stack.Navigator>
      

      {/* Trade Rules Modal */}
      <TradeRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalContainer: {
    width: '98%',
    maxHeight: '90%',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
  },

  modalText: {
    fontSize: 14,
    textAlign: 'left',
    fontFamily: 'Lato-Regular',
    lineHeight: 24,
  },
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
  },
  closeButton: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
});

export default TradeStack;
