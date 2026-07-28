/**
 * NotificationFeed.js
 * In-app notification center for MM2 Values.
 *
 * Shows: trade pings, value alerts, XP milestones, badge unlocks.
 * Data from Firestore notifications collection,
 * paginated with FlatList + load-more.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  collection, query, where, orderBy, limit, getDocs,
  startAfter, writeBatch, doc,
} from '@react-native-firebase/firestore';

dayjs.extend(relativeTime);

const NOTIF_ICONS = {
  trade_accepted: { icon: 'checkmark-circle', color: '#3D9B7A', emoji: '🤝' },
  trade_ping:     { icon: 'notifications',    color: '#4A7FB5', emoji: '📢' },
  xp_milestone:   { icon: 'trending-up',      color: '#C49530', emoji: '⭐' },
  badge_unlock:   { icon: 'trophy',            color: '#7E6CB5', emoji: '🏆' },
  value_alert:    { icon: 'analytics',         color: '#B06048', emoji: '📈' },
  system:         { icon: 'information-circle', color: '#5A94AA', emoji: 'ℹ️' },
};

const PAGE_SIZE = 20;

const NotificationFeed = ({ navigation }) => {
  const { user, theme, firestoreDB } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [clearing, setClearing] = useState(false);
  const hasMarkedRead = useRef(false);

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!user?.id || !firestoreDB) {
      setLoading(false);
      return;
    }

    try {
      if (isRefresh) {
        setRefreshing(true);
        setLastDoc(null);
      }

      let q = query(
        collection(firestoreDB, 'notifications'),
        where('toUid', '==', user.id),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );

      if (!isRefresh && lastDoc) {
        q = query(
          collection(firestoreDB, 'notifications'),
          where('toUid', '==', user.id),
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE),
        );
      }

      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (isRefresh) {
        setNotifications(items);
      } else {
        setNotifications(prev => [...prev, ...items]);
      }

      setLastDoc(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
      setHasMore(snap.docs.length >= PAGE_SIZE);
    } catch (e) {
      console.warn('[NotificationFeed] Error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, firestoreDB, lastDoc]);

  useEffect(() => {
    fetchNotifications(true);
  }, [user?.id]);

  // Mark all as read
  const markAllRead = useCallback(async () => {
    if (!user?.id || !firestoreDB || hasMarkedRead.current) return;
    hasMarkedRead.current = true;

    try {
      const unread = notifications.filter(n => !n.read);
      if (unread.length === 0) return;

      const batch = writeBatch(firestoreDB);
      unread.forEach(n => {
        batch.update(doc(firestoreDB, 'notifications', n.id), { read: true });
      });
      await batch.commit();

      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      console.warn('[NotificationFeed] markAllRead error:', e?.message);
    }
  }, [notifications, user?.id, firestoreDB]);

  // Clear all
  const clearAll = useCallback(async () => {
    if (!user?.id || !firestoreDB || clearing) return;
    setClearing(true);

    try {
      const batch = writeBatch(firestoreDB);
      notifications.forEach(n => {
        batch.delete(doc(firestoreDB, 'notifications', n.id));
      });
      await batch.commit();
      setNotifications([]);
    } catch (e) {
      console.warn('[NotificationFeed] clearAll error:', e?.message);
    } finally {
      setClearing(false);
    }
  }, [notifications, user?.id, firestoreDB, clearing]);

  const renderItem = useCallback(({ item }) => {
    const info = NOTIF_ICONS[item.type] || NOTIF_ICONS.system;
    const time = item.createdAt?.toDate ? dayjs(item.createdAt.toDate()).fromNow() : '';

    return (
      <View style={[styles.notifCard, {
        backgroundColor: item.read ? c.bgAlt : (c.primary + '08'),
        borderColor: c.border,
      }]}>
        <View style={[styles.iconCircle, { backgroundColor: info.color + '18' }]}>
          <Icon name={info.icon} size={18} color={info.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.notifTitle, { color: c.text }]} numberOfLines={2}>
            {item.title || item.message || 'Notification'}
          </Text>
          {item.body && (
            <Text style={[styles.notifBody, { color: c.textSecondary }]} numberOfLines={2}>
              {item.body}
            </Text>
          )}
          <Text style={[styles.notifTime, { color: c.textMuted }]}>{time}</Text>
        </View>
        {!item.read && <View style={[styles.unreadDot, { backgroundColor: c.primary }]} />}
      </View>
    );
  }, [c]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.divider }]}>
        {navigation?.goBack && (
          <TouchableOpacity onPress={navigation.goBack} style={styles.backBtn}>
            <Icon name="arrow-back" size={22} color={c.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: c.text }]}>
          🔔 Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead}>
              <Icon name="checkmark-done" size={20} color={c.primary} />
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity onPress={clearAll}>
              <Icon name="trash-outline" size={20} color={c.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!user?.id ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 36 }}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>Sign In Required</Text>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            Sign in to see your notifications.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 180 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchNotifications(true)} />
          }
          onEndReached={() => hasMore && !loading && fetchNotifications(false)}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loading && notifications.length > 0 ? (
            <ActivityIndicator size="small" color={c.primary} style={{ marginVertical: 16 }} />
          ) : null}
          ListEmptyComponent={!loading ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 36 }}>🔔</Text>
              <Text style={[styles.emptyTitle, { color: c.text }]}>All Caught Up!</Text>
              <Text style={[styles.emptyText, { color: c.textMuted }]}>
                No notifications yet.{'\n'}You'll see trade pings, value alerts & more here.
              </Text>
            </View>
          ) : (
            <ActivityIndicator size="large" color={c.primary} style={{ marginTop: 40 }} />
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, marginLeft: 8 },

  notifCard: {
    flexDirection: 'row', padding: 14, borderRadius: 14, borderWidth: 1,
    marginBottom: 8, gap: 12, alignItems: 'flex-start',
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  notifTitle: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  notifBody: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  notifTime: { fontSize: 10, marginTop: 4, fontWeight: '500' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },

  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptyText: { fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },
});

export default NotificationFeed;
