import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useGlobalState } from "../GlobelStats";
import config from "../Helper/Environment";
import { ref, push } from "@react-native-firebase/database";
import { ModalKeyboardView } from '../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';

// `value` is what gets saved in tradeReports (kept in English for the mods);
// only the label is translated.
const TRADE_REPORT_REASONS = [
  { value: "Inappropriate", labelKey: "report_popup.reason_inappropriate" },
  { value: "Fraud", labelKey: "report_popup.reason_fraud" },
];

const ReportTradePopup = ({ visible, trade, onClose }) => {
  const [selectedReason, setSelectedReason] = useState("Inappropriate");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, appdatabase } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();

  const handleSubmit = () => {
    if (showCustomInput && !customReason.trim()) {
      Alert.alert(t("home.alert.error"), t("report_popup.enter_reason"));
      return;
    }

    if (!trade?.id) {
      Alert.alert(t("home.alert.error"), t("report_popup.invalid_trade"));
      return;
    }

    setLoading(true);

    
    const reportsRef = ref(appdatabase, "tradeReports"); // New node for trade reports
    const reportData = {
      tradeId: trade.id,
      reportedBy: user?.id,
      reason: showCustomInput ? customReason : selectedReason,
      timestamp: Date.now(),
    };

    push(reportsRef, reportData)
      .then(() => {
        setLoading(false); // Stop loader
        const reasonKey = TRADE_REPORT_REASONS.find((r) => r.value === selectedReason)?.labelKey;
        Alert.alert(
          t("chat.report_submitted"),
          t("report_popup.trade_report_submitted_msg", {
            id: trade.id,
            reason: showCustomInput ? customReason : (reasonKey ? t(reasonKey) : selectedReason),
          })
        );
        onClose(true); // Indicate success
      })
      .catch((error) => {
        console.error("Error reporting trade:", error);
        setLoading(false); // Stop loader
        Alert.alert(t("home.alert.error"), t("report_popup.submit_failed"));
      });
  };

  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardView style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>{t("report_popup.report_trade")}</Text>
          <Text style={styles.messageText}>{t("report_popup.trade_id", { id: trade?.id || t("group_chat.anonymous") })}</Text>
          <Text style={styles.messageText}>{t("report_popup.trader_name", { name: trade?.traderName || t("group_chat.anonymous") })}</Text>

          <View style={styles.optionsContainer}>
            {TRADE_REPORT_REASONS.map(({ value: reason, labelKey }) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.option,
                  selectedReason === reason && styles.selectedOption,
                ]}
                onPress={() => {
                  setSelectedReason(reason);
                  setShowCustomInput(false);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedReason === reason && styles.selectedOptionText,
                  ]}
                >
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[
                styles.option,
                showCustomInput && styles.selectedOption,
              ]}
              onPress={() => setShowCustomInput(true)}
            >
              <Text
                style={[
                  styles.optionText,
                  showCustomInput && styles.selectedOptionText,
                ]}
              >
                {t("report_popup.reason_other")}
              </Text>
            </TouchableOpacity>
          </View>

          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder={t("report_popup.custom_reason_placeholder")}
              placeholderTextColor={isDarkMode ? '#999' : '#888'}
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{t("trade.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: config.colors.hasBlockGreen },
              ]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t("chat.submit")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ModalKeyboardView>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: config.colors.overlayDark,
      justifyContent: "center",
      alignItems: "center",
    },
    popup: {
      width: "90%",
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
      borderRadius: 10,
      padding: 20,
      elevation: 5,
    },
    title: {
      fontSize: 18,
      fontFamily: "Lato-Bold",
      marginBottom: 10,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
    },
    messageText: {
      fontSize: 14,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      marginBottom: 15,
    },
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 10,
    },
    option: {
      paddingHorizontal: 3,
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : config.colors.dividerLight,
      borderRadius: 10,
      marginRight: 10,
      marginBottom: 10,
    },
    selectedOption: {
      borderColor: config.colors.primary,
      backgroundColor: config.colors.hasBlockGreen,
    },
    optionText: {
      fontSize: 14,
      color: isDarkMode ? config.colors.textTertiaryDark : config.colors.textSecondaryLight,
      paddingHorizontal: 5,
    },
    selectedOptionText: {
      color: config.colors.white,
    },
    input: {
      borderWidth: 1,
      borderColor: isDarkMode ? config.colors.borderDark : config.colors.borderLight,
      backgroundColor: isDarkMode ? config.colors.surfaceDark : config.colors.surfaceLight,
      color: isDarkMode ? config.colors.textDark : config.colors.textLight,
      borderRadius: 5,
      padding: 5,
      marginTop: 10,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 15,
    },
    button: {
      paddingVertical: 5,
      paddingHorizontal: 20,
      backgroundColor: config.colors.primary,
      borderRadius: 5,
    },
    buttonText: {
      color: config.colors.white,
      fontSize: 16,
    },
  });

export default ReportTradePopup;
