/**
 * GuidesScreen.js
 * In-app help / tutorial screen with expandable accordion sections.
 * Covers all major features of the MM2 Values app.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useThemeColors } from '../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

const GUIDE_ICONS = [
  'pricetags-outline',
  'swap-horizontal-outline',
  'briefcase-outline',
  'chatbubbles-outline',
  'star-outline',
  'game-controller-outline',
  'trophy-outline',
  'person-outline',
  'shield-checkmark-outline'
];

const GuidesScreen = ({ navigation }) => {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(null);

  const toggle = useCallback((idx) => {
    setExpanded(prev => (prev === idx ? null : idx));
  }, []);

  const translatedSections = t('guides.sections', { returnObjects: true });
  const GUIDE_SECTIONS = Array.isArray(translatedSections) ? translatedSections.map((sec, idx) => ({
    ...sec,
    icon: GUIDE_ICONS[idx] || 'help-circle'
  })) : [];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.divider }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('guides.title')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {t('guides.subtitle')}
        </Text>

        {GUIDE_SECTIONS.map((section, idx) => {
          const isOpen = expanded === idx;

          return (
            <View key={idx}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => toggle(idx)}
                style={[
                  styles.sectionHeader,
                  {
                    backgroundColor: c.bgAlt,
                    borderColor: isOpen ? c.primary : c.border,
                    borderBottomLeftRadius: isOpen ? 0 : 12,
                    borderBottomRightRadius: isOpen ? 0 : 12,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Icon name={section.icon} size={18} color={isOpen ? c.primary : c.textSecondary} />
                  <Text style={[styles.sectionTitle, { color: c.text }]}>
                    {section.title}
                  </Text>
                </View>
                <Icon
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={c.textSecondary}
                />
              </TouchableOpacity>

              {isOpen && (
                <View style={[styles.sectionBody, {
                  backgroundColor: c.bgAlt,
                  borderColor: c.primary,
                  borderTopWidth: 0,
                }]}>
                  {section.content.map((line, lIdx) => (
                    <Text key={lIdx} style={[styles.contentLine, { color: c.textSecondary }]}>
                      {line}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    gap: 10,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  sectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 8,
    borderWidth: 1,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    gap: 6,
  },
  contentLine: {
    fontSize: 13,
    lineHeight: 20,
  },
});

export default React.memo(GuidesScreen);
