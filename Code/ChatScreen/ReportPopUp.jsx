import React, { useState, useMemo } from "react";
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
import { ref, get, update } from "@react-native-firebase/database";
import { useTranslation } from "react-i18next";
import { DEFAULT_CHANNEL } from './chatChannels';
import { ModalKeyboardView } from '../Helper/keyboardAvoidingContainer';


const ReportPopup = ({ visible, message, onClose, channelPath = DEFAULT_CHANNEL.path }) => {
  const [selectedReason, setSelectedReason] = useState("Spam");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, appdatabase, user } = useGlobalState();
  const isDarkMode = theme === "dark";
  const { t } = useTranslation();

  // ✅ Memoize reason options array
  const reasonOptions = useMemo(() => [
    t("chat.spam"),
    t("chat.religious"),
    t("chat.hate_speech")
  ], [t]);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const handleSubmit = () => {
    // ✅ Safety checks
    if (!message || !message.id) {
      Alert.alert(t("home.alert.error"), t("report_popup.invalid_message"));
      return;
    }

    if (!appdatabase) {
      Alert.alert(t("home.alert.error"), t("report_popup.no_db"));
      return;
    }

    const messageId = message.id || '';
    const sanitizedId = messageId.startsWith("chat-")
      ? messageId.replace("chat-", "")
      : messageId;
  
    if (!sanitizedId || sanitizedId.trim().length === 0) {
      Alert.alert(t("home.alert.error"), t("report_popup.invalid_message"));
      return;
    }
  
    setLoading(true);
    // The room the message was reported from. Defaults to English so the
    // trade-report caller, which has no channel, keeps working unchanged.
    const messageRef = ref(appdatabase, `${channelPath}/${sanitizedId}`);
    const reporterId = user?.id || null;
    // Report ledger (Code/Helper/reportLedger.js): one marker per reporter,
    // so one account reporting twice cannot trigger the auto-ban.
    const ledgerPath = reporterId ? `chat_reports/${channelPath}/${sanitizedId}/${reporterId}` : null;

    // Already reported it? Readable only by its owner. A failed read (rules
    // not deployed yet, offline) just means "unknown": carry on.
    const alreadyReported = ledgerPath
      ? get(ref(appdatabase, ledgerPath)).then((s) => s.val() === true).catch(() => false)
      : Promise.resolve(false);

    alreadyReported
      .then((already) => {
        if (already) return { action: 'duplicate' };
        return get(messageRef).then((snapshot) => recordReport(snapshot));
      })
      .then((res) => {
        setLoading(false);
        if (res?.action === 'duplicate') {
          Alert.alert(t("chat.report_submitted"), t("report_popup.already_reported"));
          onClose(true);
          return;
        }
        Alert.alert(t("chat.report_submitted"), t("chat.report_submitted_message"));
        onClose(true);
      })
      .catch((error) => {
        console.error("Error reporting message:", error);
        setLoading(false);
        Alert.alert(t("home.alert.error"), t("report_popup.submit_failed"));
      });

    function recordReport(snapshot) {
      if (!snapshot.exists()) throw new Error("Message not found");

      const data = snapshot.val();
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid message data");
      }

      // Chat rooms are publicly writable, so reportCount can hold anything.
      // NaN/Infinity in an RTDB write kills the process natively (RNFB), so
      // only a finite, non-negative integer is ever incremented.
      const rawCount = Number(data?.reportCount);
      const reportCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;

      // Only RECORD the report. The second one (reportCount reaching 2)
      // is acted on server-side by functions/reportAutoBan.js
      // (autoBanOnMessageReports): it bans the sender with the same record
      // this screen used to write, then deletes the message.
      //
      // It used to happen here, with the email copied into every public
      // message as `currentUserEmail`. Messages no longer carry it, and a
      // reporter cannot read anyone's email, so the ban needs the Admin SDK.
      // Older builds still ban from the reporter's device and delete the
      // message on the second report; their `if (message.currentUserEmail)`
      // guard skips the ban once messages stop carrying the email.
      //
      // The +1 and the ledger marker go in ONE multi-path update, so the
      // function never sees the count without the reporter. The marker is
      // create-only: a second report by the same account is refused whole.
      // Until the chat_reports rule is deployed the marker is refused too;
      // then the +1 alone goes through, exactly as older builds write it.
      const action = reportCount >= 1 ? "escalated" : "reported";
      const countOnly = () => update(messageRef, { reportCount: reportCount + 1 }).then(() => ({ action }));
      if (!ledgerPath) return countOnly();
      return update(ref(appdatabase), {
        [`${channelPath}/${sanitizedId}/reportCount`]: reportCount + 1,
        [ledgerPath]: true,
      })
        .then(() => ({ action }))
        .catch(() => get(ref(appdatabase, ledgerPath))
          .then((s) => s.val() === true)
          .catch(() => false)
          .then((mine) => (mine ? { action: 'duplicate' } : countOnly())));
    }
  };

  // ✅ Early return if no message
  if (!message) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardView style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>{t("report_popup.title")}</Text>
          <Text style={styles.messageText}>{`${t("report_popup.message_label")}: "${message?.text}"`}</Text>
          <Text style={styles.messageText}>{`${t("report_popup.sender_label")}: ${message?.sender || t("private_chat.anonymous")}`}</Text>

          {/* Standard Reasons */}
          <View style={styles.optionsContainer}>
            {reasonOptions.map((reason) => (
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
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Custom Option */}
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
                { t("chat.other")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Custom Input for "Other" */}
          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder={t("report_popup.custom_reason_placeholder")}
              placeholderTextColor={isDarkMode ? '#999' : '#888'}
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{t("home.cancel")}</Text>
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
                <Text style={styles.buttonText}> {t("chat.submit")}</Text>
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
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    popup: {
      width: "80%",
      backgroundColor: isDarkMode ? config.colors.backgroundDark : "#f2f2f7",
      borderRadius: 10,
      padding: 20,
      elevation: 5,
    },
    title: {
      fontSize: 18,
      fontFamily: "Lato-Bold",
      marginBottom: 10,
      color: isDarkMode ? "white" : "black",
    },
    messageText: {
      fontSize: 14,
      color: isDarkMode ? "white" : "black",
      marginBottom: 15,
    },
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 10,
    },
    option: {
      paddingHorizontal: 3,
      backgroundColor: "#ddd",
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
      color: isDarkMode ? "#888" : "#444",
      paddingHorizontal: 5,
    },
    selectedOptionText: {
      color: "white",
    },
    input: {
      borderWidth: 1,
      borderColor: "#ddd",
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
      color: "white",
      fontSize: 16,
    },
  });

export default ReportPopup;
