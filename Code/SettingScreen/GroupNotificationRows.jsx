import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ref, get, set } from '@react-native-firebase/database';
import { showErrorMessage } from '../Helper/MessageHelper';

// Settings switches for the three group pushes. Each is an opt-out the server
// reads at users/{uid}/notificationSettings/<key> (functions/notifyGroupMessage,
// notifyGroupInvitation, notifyGroupJoinRequest): only an explicit `false`
// silences it, so absent means ON. Signed-in only.
const ROWS = [
  { key: 'groupChatNotifications', labelKey: 'settings.group_chat_notifications', icon: 'people-outline', color: '#10B981' },
  { key: 'groupInvitationNotifications', labelKey: 'settings.group_invitation_notifications', icon: 'mail-unread-outline', color: '#6366F1' },
  { key: 'groupJoinRequestNotifications', labelKey: 'settings.group_join_request_notifications', icon: 'person-add-outline', color: '#EC4899' },
];

const ALL_ON = { groupChatNotifications: true, groupInvitationNotifications: true, groupJoinRequestNotifications: true };

const GroupNotificationRows = ({ uid, appdatabase, styles, onHaptic }) => {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState(ALL_ON);
  // Latest value per key, so two quick flips end on the last one picked.
  const pending = useRef({});

  useEffect(() => {
    if (!uid || !appdatabase) return undefined;
    let alive = true;
    setPrefs(ALL_ON);
    get(ref(appdatabase, `users/${uid}/notificationSettings`))
      .then((snap) => {
        if (!alive) return;
        const v = snap.val() || {};
        setPrefs({
          groupChatNotifications: v.groupChatNotifications !== false,
          groupInvitationNotifications: v.groupInvitationNotifications !== false,
          groupJoinRequestNotifications: v.groupJoinRequestNotifications !== false,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [uid, appdatabase]);

  const onToggle = useCallback((key, next) => {
    if (!uid || !appdatabase) return;
    if (onHaptic) onHaptic();
    const value = !!next;
    pending.current[key] = value;
    setPrefs((p) => ({ ...p, [key]: value }));
    set(ref(appdatabase, `users/${uid}/notificationSettings/${key}`), value).catch(() => {
      // Only roll back if nothing newer was picked meanwhile.
      if (pending.current[key] !== value) return;
      setPrefs((p) => ({ ...p, [key]: !value }));
      showErrorMessage(t('home.alert.error'), t('settings.notification_setting_save_failed'));
    });
  }, [uid, appdatabase, onHaptic, t]);

  if (!uid) return null;

  return (
    <>
      {ROWS.map((row) => (
        <View style={styles.option} key={row.key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
              onPress={() => onToggle(row.key, !prefs[row.key])}
            >
              <Icon name={row.icon} size={18} color={'white'} style={{ backgroundColor: row.color, padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t(row.labelKey)}</Text>
            </TouchableOpacity>
            <Switch value={prefs[row.key]} onValueChange={(v) => onToggle(row.key, v)} />
          </View>
        </View>
      ))}
    </>
  );
};

export default React.memo(GroupNotificationRows);
