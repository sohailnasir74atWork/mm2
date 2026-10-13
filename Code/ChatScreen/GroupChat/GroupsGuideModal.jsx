import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { MAX_GROUPS_PER_USER } from '../utils/groupUtils';

// Each step / rule / feature is its own key under groups_guide.*, so a
// language can reword one line without touching the others.
const CREATE_STEPS = ['create_step_1', 'create_step_2', 'create_step_3', 'create_step_4', 'create_step_5', 'create_step_6'];
// 'one_group' text takes {{max}} (MAX_GROUPS_PER_USER); the other rules ignore it.
const RULES = ['one_group', 'min_members', 'max_members', 'group_admin', 'admin_transfer', 'leaving', 'invitations'];
const FEATURES = ['feature_messages', 'feature_online', 'feature_members', 'feature_notifications'];

const GroupsGuideModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContent, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FFFFFF' }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
              {t('groups_guide.title')}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close-circle" size={28} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="people" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                {t('groups_guide.how_to_create')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {CREATE_STEPS.map((k, i) => `${i + 1}. ${t(`groups_guide.${k}`)}`).join('\n\n')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="information-circle" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                {t('groups_guide.important_rules')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {RULES.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 ? '\n\n' : ''}• <Text style={styles.boldText}>{t(`groups_guide.rule_${k}_title`)}</Text> {t(`groups_guide.rule_${k}`, { max: MAX_GROUPS_PER_USER })}
                  </React.Fragment>
                ))}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="chatbubbles" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                {t('groups_guide.group_features')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {FEATURES.map((k) => `• ${t(`groups_guide.${k}`)}`).join('\n\n')}
              </Text>
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.gotItButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.gotItButtonText}>{t('chat.got_it')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      width: '90%',
      height: '85%',
      borderRadius: 20,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
      justifyContent: 'space-between',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 24,
      fontFamily: 'Lato-Bold',
    },
    closeButton: {
      padding: 4,
    },
    scrollContainer: {
      flex: 1,
      marginBottom: 20,
    },
    scrollContent: {
      paddingBottom: 10,
    },
    section: {
      marginBottom: 20,
    },
    iconContainer: {
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 18,
      fontFamily: 'Lato-Bold',
      marginBottom: 12,
    },
    sectionText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      lineHeight: 22,
    },
    boldText: {
      fontFamily: 'Lato-Bold',
      color: config.colors.primary,
    },
    divider: {
      height: 1,
      backgroundColor: isDarkMode ? config.colors.surfaceElevatedDark : '#E5E7EB',
      marginVertical: 20,
    },
    gotItButton: {
      paddingVertical: 14,
      paddingHorizontal: 30,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 10,
    },
    gotItButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
  });

export default GroupsGuideModal;

