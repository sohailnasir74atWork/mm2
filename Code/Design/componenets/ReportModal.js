import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import firestore from '@react-native-firebase/firestore';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState } from '../../GlobelStats';
import { postReportCrossesBan } from '../../Helper/reportLedger';
import { useTranslation } from 'react-i18next';
import { ModalKeyboardView } from '../../Helper/keyboardAvoidingContainer';

const ReportModal = ({ visible, onClose, item, banUserwithEmail }) => {
  const [reportText, setReportText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const {updateLocalState, localState} = useLocalState()
  const { user } = useGlobalState();
  const { t } = useTranslation();
// console.log(localState.bannedUsers)

  // const handleBanToggle = async () => {
  //   const action = isBlock ? t("chat.unblock") : t("chat.block");

  //   Alert.alert(
  //     `${action}`,
  //     `${t("chat.are_you_sure")} ${action.toLowerCase()} ${userName}?`,
  //     [
  //       { text: t("chat.cancel"), style: 'cancel' },
  //       {
  //         text: action,
  //         style: 'destructive',
  //         onPress: async () => {
  //           try {
  //             let updatedBannedUsers;

  //             if (isBlock) {
  //               // ✅ Remove from bannedUsers (Unban)
  //               updatedBannedUsers = bannedUsers.filter(id => id !== selectedUser?.senderId);
  //             } else {
  //               // ✅ Add to bannedUsers (Ban)
  //               updatedBannedUsers = [...bannedUsers, selectedUser?.senderId];
  //             }

  //             // ✅ Update local storage & state
  //             await updateLocalState('bannedUsers', updatedBannedUsers);

  //             // ✅ Wait a bit before showing the confirmation (Fix MMKV Delay)
  //             setTimeout(() => {
  //               showSuccessMessage(
  //                 t("home.alert.success"),
  //                 isBlock ? `${userName} ${t("chat.user_unblocked")}` : `${userName} ${t("chat.user_blocked")}`
  //               );
  //             }, 100); // Small delay to ensure UI updates correctly
  //           } catch (error) {
  //             console.error('❌ Error toggling ban status:', error);
  //           }
  //         },
  //       },
  //     ]
  //   );
  // };
  const REPORT_THRESHOLD = 2; 

  const handleSubmit = async () => {
    if (submitting) return;
    if (!item || !item.id) {
      showMessage({ message: t('feed.invalid_post'), type: 'danger' });
      return;
    }
    if (!reportText.trim()) {
      showMessage({ message: t('feed.enter_reason'), type: 'warning' });
      return;
    }

    setSubmitting(true);
    const postRef = firestore().collection('designPosts').doc(item.id);

    try {
      // 1) Atomically check 'report' and update/delete
      const txResult = await firestore().runTransaction(async (tx) => {
        const snap = await tx.get(postRef);
        if (!snap.exists()) {
          return { status: 'missing' };
        }
  
        const currentCount = snap.get('reportCount') || 0;
        const nextCount = currentCount + 1;

        // No reporter ledger on feed posts: designPosts is world-readable, so a
        // `reportedBy` list would show every reporter's uid to anyone, and the
        // Firestore rules (isPostReport) refuse it. Chat reports keep theirs in
        // RTDB chat_reports. The reporter's app hides the author afterwards
        // (bannedUsers below), and the server bans only at reportCount >= 2.

        // Keep legacy boolean 'report' if your UI needs it
        const updates = {
          reportCount: nextCount,
          report: true,
        };

        // prevent double-ban by storing a flag
        const alreadyBanned = !!snap.get('banned');
        if (!alreadyBanned && nextCount >= REPORT_THRESHOLD) {
          updates.banned = true; // mark so future transactions don't re-ban
        }

        // The same test the server runs (autoBanOnPostReports), on the post
        // as it is now and as this report leaves it.
        const before = {
          banned: snap.get('banned'),
          reportCount: currentCount,
          userId: snap.get('userId'),
        };
        const after = {
          ...before,
          banned: updates.banned === true ? true : before.banned,
          reportCount: nextCount,
        };
        const shouldBan = postReportCrossesBan(before, after);

        tx.update(postRef, updates);
  
        return {
          status: 'ok',
          shouldBan,
          email: snap.get('email') || null,
          userId: snap.get('userId') || null,
        };
      });
  
      if (txResult.status === 'missing') {
        showMessage({ message: t('feed.post_not_found'), type: 'danger' });
        return;
      }
      // Side-effects OUTSIDE the transaction to avoid retries breaking things
      //
      // Only posts made by older builds still carry `email`. For every other
      // post the ban runs server-side when `banned` flips to true
      // (functions/reportAutoBan.js, autoBanOnPostReports), which skips any
      // post that has an email so the two never both fire.
      if (txResult.shouldBan && txResult.email && txResult.userId) {
        try {
          // Argument order: (email, isAdmin, senderId, userInfo, bannerInfo,
          // reason, source). userId used to land in the isAdmin slot, which
          // alerted the REPORTER "User Banned" and saved the record with
          // userId: null.
          await banUserwithEmail(
            txResult.email, false, txResult.userId,
            { id: txResult.userId, displayName: item?.userName || item?.displayName || null, avatar: item?.userAvatar || item?.avatar || null },
            { id: 'system', displayName: 'Auto (post reports)', role: 'system' },
            'Auto-ban: post reported by multiple users', 'report',
          );
        } catch (err) {
          console.error('Ban error:', err);
          // optional: decide if you want to unset 'banned' on the post here
        }
      }
      await updateLocalState('bannedUsers', [...localState.bannedUsers, item.userId]);
      setReportText('');
      onClose();
    } catch (e) {
      console.error('Report submit error:', e);
      showMessage({ message: t('feed.report_failed'), type: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardView style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.title}>{t('feed.report_post')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('feed.report_post_placeholder')}
              placeholderTextColor="#999"
              value={reportText}
              onChangeText={setReportText}
              editable={!submitting}
              multiline
              maxLength={250}
            />
            <Text style={styles.charCount}>{reportText.length}/250</Text>
            <View className="buttonsRow" style={styles.buttonsRow}>
              <TouchableOpacity
                onPress={handleSubmit}
                style={[styles.submitButton, submitting && { opacity: 0.6 }]}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? t('private_chat.submitting') : t('chat.submit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.cancelButton} disabled={submitting}>
                <Text style={styles.buttonText}>{t('feed.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
      </ModalKeyboardView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#fff', width: '85%', padding: 20, borderRadius: 12, elevation: 6 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, height: 100, textAlignVertical: 'top', fontSize: 14, color: '#000' },
  charCount: { alignSelf: 'flex-end', fontSize: 12, color: '#999', marginTop: 4 },
  buttonsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  submitButton: { backgroundColor: '#FF3B30', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, flex: 1, marginRight: 5 },
  cancelButton: { backgroundColor: '#aaa', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, flex: 1, marginLeft: 5 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});

export default ReportModal;
