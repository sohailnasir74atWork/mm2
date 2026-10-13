/**
 * BirthdayVisibilityRow — Settings rows, same style as EmailUpdatesRow
 * (ported from Blox Fruit's Code/Birthdays, 2026-10-13):
 *   "Show my birthday" (month and day only; on by default) — hidden for
 *   under-13s, whose birthday is never public, and while no birthday is on file;
 *   "Change my birthday (once)" — the one-time correction, while unused
 *   (known from the Birthdays screen's last myBirthday answer; Settings
 *   itself makes no HTTPS call).
 * Reads your own birthday from the phone (MMKV) or, the first time, RTDB.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import {
  setBirthdayUser, getOwnBirthday, peekOwnBirthday, peekMyBirthday, setBirthdayVisibility, onBirthdaysChange,
} from './birthdayApi';
import EditBirthdaySheet from './EditBirthdaySheet';
import { flipInRTL } from '../Helper/rtl';

const BirthdayVisibilityRow = ({ uid, styles, onHaptic }) => {
  const { t } = useTranslation();
  const { theme, appdatabase } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const [own, setOwn] = useState(() => peekOwnBirthday());
  const [canEdit, setCanEdit] = useState(() => !!peekMyBirthday()?.canEdit);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    setBirthdayUser(uid);
    getOwnBirthday(appdatabase).then((o) => { if (alive && o) setOwn(o); }).catch(() => {});
    const off = onBirthdaysChange(() => {
      if (!alive) return;
      const o = peekOwnBirthday();
      if (o) setOwn(o);
      setCanEdit(!!peekMyBirthday()?.canEdit);
    });
    return () => { alive = false; off(); };
  }, [uid, appdatabase]);

  const onToggle = useCallback(async (next) => {
    if (busy) return;
    if (onHaptic) onHaptic();
    setBusy(true);
    setOwn((o) => (o ? { ...o, show: next } : o));
    try {
      await setBirthdayVisibility(appdatabase, next);
      trackGrowthEvent('birthday_visibility', { show: next ? 1 : 0, where: 'settings' });
    } catch (_) {
      setOwn((o) => (o ? { ...o, show: !next } : o));
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      setBusy(false);
    }
  }, [busy, onHaptic, appdatabase, t]);

  const onSaved = useCallback(() => {
    setEditing(false);
    setCanEdit(false);
    setOwn(peekOwnBirthday());
    trackGrowthEvent('birthday_edit', { where: 'settings' });
    showSuccessMessage(t('birthdays.edit_saved'), '');
  }, [t]);

  if (!uid || !own?.hasDob) return null;

  return (
    <>
      {!own.minor && (
        <View style={styles.option}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => onToggle(!own.show)}>
              <Icon name="gift-outline" size={18} color={'white'} style={{ backgroundColor: '#EC4899', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.settings_row')}</Text>
            </TouchableOpacity>
            <Switch value={!!own.show} disabled={busy} onValueChange={onToggle} />
          </View>
        </View>
      )}
      {canEdit && own.dob ? (
        <View style={styles.option}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
            onPress={() => { if (onHaptic) onHaptic(); setEditing(true); }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="calendar-outline" size={18} color={'white'} style={{ backgroundColor: '#DB2777', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.edit_row')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.textMuted} style={flipInRTL} />
          </TouchableOpacity>
        </View>
      ) : null}
      <EditBirthdaySheet visible={editing} dob={own.dob} c={c} onClose={() => setEditing(false)} onSaved={onSaved} />
    </>
  );
};

export default React.memo(BirthdayVisibilityRow);
