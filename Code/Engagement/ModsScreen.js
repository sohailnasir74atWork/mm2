/**
 * ModsScreen.js — public staff & community roster.
 *
 * Ported from adoptme-jan7 2026-09-05 (PLAN_2026-09.md P10), widened to cover
 * all five roles rather than just moderators.
 *
 * Reads three small RTDB nodes that Cloud Functions keep in sync:
 *   mods/{uid}    → { displayName, avatar, role: 'mod' | 'jmod', updatedAt }
 *   trusted/{uid} → { displayName, avatar, role: 'trusted',      updatedAt }
 *   cmsr/{uid}    → { displayName, avatar, role: 'cmsr',         updatedAt }
 *   helper/{uid}  → { displayName, avatar, role: 'helper',       updatedAt }
 *
 * Rosters are read through the 6-hour config cache, so opening this screen
 * repeatedly costs nothing. Staff changes are rare; pull-to-refresh forces a
 * re-read for the case where they are not.
 *
 * Why denormalised roster nodes rather than querying /users: an indexed
 * equalTo(true) scan over 81k user records to find ~20 staff would download
 * every matching FULL record. These nodes hold ~60 bytes per member.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, SectionList, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { getConfigNodes, clearConfigCache } from '../Helper/configCache';
import UserBadgePill from '../Helper/UserBadgePill';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const ROSTER_NODES = ['mods', 'trusted', 'cmsr', 'helper'];

// role → the pill type it maps to, and the section it belongs in.
const ROLE_META = {
  mod:     { pill: 'mod',     section: 'staff' },
  jmod:    { pill: 'jmd',     section: 'staff' },
  trusted: { pill: 'trusted', section: 'community' },
  cmsr:    { pill: 'cmsr',    section: 'community' },
  helper:  { pill: 'helper',  section: 'community' },
};

const MemberRow = React.memo(({ member, onPress, isDarkMode, c }) => (
  <TouchableOpacity
    onPress={() => onPress(member)}
    activeOpacity={0.7}
    style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}
  >
    <Image
      source={{ uri: member.avatar || DEFAULT_AVATAR }}
      style={styles.avatar}
    />
    <View style={styles.info}>
      <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
        {member.displayName}
      </Text>
    </View>
    <UserBadgePill
      type={ROLE_META[member.role]?.pill || 'mod'}
      size="sm"
      isDarkMode={isDarkMode}
    />
    <Icon name="chevron-forward" size={16} color={c.textMuted} style={{ marginLeft: 6 }} />
  </TouchableOpacity>
));

const ModsScreen = () => {
  const { theme, user } = useGlobalState();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const { appdatabase } = useGlobalState();

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const fetchRosters = useCallback(async (force = false) => {
    if (!appdatabase) return;
    try {
      if (force) clearConfigCache(ROSTER_NODES);
      const rosters = await getConfigNodes(appdatabase, ROSTER_NODES);

      const list = [];
      for (const node of ROSTER_NODES) {
        const entries = rosters[node];
        if (!entries || typeof entries !== 'object') continue;
        for (const [uid, data] of Object.entries(entries)) {
          if (!data || typeof data !== 'object') continue;
          const role = data.role || (node === 'mods' ? 'mod' : node);
          if (!ROLE_META[role]) continue;
          list.push({
            uid,
            role,
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
          });
        }
      }
      setMembers(list);
    } catch (e) {
      console.warn('[ModsScreen] fetch error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase]);

  useEffect(() => { fetchRosters(false); }, [fetchRosters]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRosters(true);
  }, [fetchRosters]);

  // Staff first, then community. Within a section: rank, then name.
  const sections = useMemo(() => {
    const rank = { mod: 0, jmod: 1, cmsr: 0, trusted: 1, helper: 2 };
    const byName = (a, b) =>
      (rank[a.role] - rank[b.role]) || a.displayName.localeCompare(b.displayName);

    const staff = members.filter((m) => ROLE_META[m.role].section === 'staff').sort(byName);
    const community = members.filter((m) => ROLE_META[m.role].section === 'community').sort(byName);

    return [
      { key: 'staff', title: t('mods.staff', { defaultValue: 'Moderators' }), data: staff },
      { key: 'community', title: t('mods.community', { defaultValue: 'Trusted Members' }), data: community },
    ].filter((s) => s.data.length > 0);
  }, [members, t]);

  const handlePress = useCallback((member) => {
    if (!user?.id) {
      Alert.alert(
        t('signin.title', { defaultValue: 'Sign In' }),
        t('mods.signin_required', { defaultValue: 'Sign in to view profiles.' }),
      );
      return;
    }
    setDrawerUser({ senderId: member.uid, sender: member.displayName, avatar: member.avatar });
    setIsDrawerVisible(true);
  }, [user?.id, t]);

  const handleStartChat = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    // Let the drawer finish dismissing before pushing a screen, otherwise the
    // navigation animation fights the modal dismissal on iOS.
    setTimeout(() => {
      try {
        navigation.navigate('PrivateChatRoot', { selectedUser: drawerUser });
      } catch (e) {
        console.warn('[ModsScreen] chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]}>
          {t('mods.title', { defaultValue: 'Our Team' })}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={c.primary} style={{ marginTop: 40 }} />
      ) : (
        <SectionList removeClippedSubviews={false}
          sections={sections}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <MemberRow member={item} onPress={handlePress} isDarkMode={isDarkMode} c={c} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="shield-outline" size={44} color={c.textMuted} />
              <Text style={[styles.emptyText, { color: c.textMuted }]}>
                {t('mods.empty', { defaultValue: 'No team members listed yet.' })}
              </Text>
            </View>
          }
        />
      )}

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChat}
        selectedUser={drawerUser}
        bannedUsers={[]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: 14, marginBottom: 6, marginLeft: 4,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', padding: 10,
    borderRadius: 14, marginBottom: 8, borderWidth: 1,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DDD' },
  info: { flex: 1, marginLeft: 10 },
  name: { fontSize: 15, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 14 },
});

export default ModsScreen;
