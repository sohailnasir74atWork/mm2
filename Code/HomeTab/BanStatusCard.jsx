/**
 * BanStatusCard — Home card for a signed-in player under a live ban.
 *
 * Ported from adoptme-jan7 HomeTabScreen's "BAN STATUS CARD" block
 * (2026-10-13). It handles three cases:
 *   1. Account ban: this account's own banned_users_by_email record is live.
 *      Shows account banned (or muted), the strike, time left and reason.
 *   2. Device ban only: another account on this phone was banned (Adopt Me's
 *      "associated" ban). Shows device restricted plus a "why am I seeing
 *      this" note naming that account, so a fresh sign-up understands why it
 *      did not get them back in.
 *   3. Both: the account ban wins, because it is the primary signal.
 *
 * Changes from Adopt Me:
 *   - A mute (strikeCount 0) reads as "muted", not "Strike 1".
 *   - The other account's email is masked (ab•••@gmail.com). On a shared or
 *     family phone it may belong to somebody else.
 *   - Time left uses server time and ticks each minute; Adopt Me computed it
 *     once from the device clock.
 *
 * Renders nothing when signed out or not banned. Reads only global state,
 * so it adds no database traffic.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { serverNowMs } from '../Helper/serverTime';
import { SCREEN_GUTTER } from '../Helper/layout';
import { openReportForm } from '../Reports/openReportForm';

const RED = '#EF4444';
const FONT_BOLD = 'Lato-Bold';
const FONT_REGULAR = 'Lato-Regular';

const isLive = (until, now) => until === 'permanent' || (typeof until === 'number' && until > now);

// ab•••@gmail.com — enough for the phone's owner to recognise the account,
// not enough to hand a stranger someone else's address.
const maskEmail = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const email = raw.replace(/\(dot\)/g, '.').trim();
  const at = email.indexOf('@');
  if (at < 1) return null;
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
};

export default function BanStatusCard() {
  const { t } = useTranslation();
  const { user, theme, currentUserEmail, isUserBlocked, isEmailBanned, strikeInfo, deviceBanInfo } = useGlobalState();
  const dark = theme === 'dark';
  const [now, setNow] = useState(() => serverNowMs());

  const visible = !!user?.id && !!isUserBlocked && !!(strikeInfo || deviceBanInfo);

  // Re-render the time left once a minute while the card is on screen.
  useEffect(() => {
    if (!visible) return undefined;
    setNow(serverNowMs());
    const id = setInterval(() => setNow(serverNowMs()), 60 * 1000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  // strikeInfo is the raw record and can be an expired one, so the account
  // ban counts only while it is live; otherwise the device row explains it.
  const accountBan = isEmailBanned && strikeInfo && isLive(strikeInfo.bannedUntil, now) ? strikeInfo : null;
  const info = accountBan || deviceBanInfo || strikeInfo;
  if (!info) return null;

  const ownEmail = (currentUserEmail || '').trim().toLowerCase();
  const deviceEmail = (deviceBanInfo?.email || '').replace(/\(dot\)/g, '.').trim().toLowerCase();
  const isAssociated = !accountBan && !!deviceBanInfo && deviceEmail !== ownEmail;
  const isPermanent = info.bannedUntil === 'permanent';
  const isMute = !isAssociated && !((info.strikeCount || 0) >= 1);

  let title;
  if (isAssociated) title = isPermanent ? t('home.ban_device_permanent') : t('home.ban_device_temporary');
  else if (isMute) title = t('home.ban_muted');
  else title = isPermanent ? t('home.ban_account_permanent') : t('home.ban_account_temporary');

  let timeLeft;
  if (isPermanent) {
    timeLeft = t('home.ban_permanent');
  } else {
    const diff = (typeof info.bannedUntil === 'number' ? info.bannedUntil : 0) - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (diff <= 0) timeLeft = t('home.ban_expired');
    else if (hrs >= 24) timeLeft = t('home.ban_remaining_days', { days: Math.floor(hrs / 24), hours: hrs % 24 });
    else if (hrs > 0) timeLeft = t('home.ban_remaining_hours', { hours: hrs, minutes: mins });
    else if (mins > 0) timeLeft = t('home.ban_remaining_minutes', { minutes: mins });
    else timeLeft = t('home.ban_remaining_under_minute');
  }
  const status = isMute
    ? timeLeft
    : t('home.ban_strike_status', { strike: info.strikeCount || 1, status: timeLeft });

  const masked = isAssociated ? maskEmail(deviceBanInfo?.email) : null;
  const reason = typeof info.reason === 'string' && info.reason.trim() ? info.reason.trim() : null;

  const bodyBg = dark ? 'rgba(239,68,68,0.06)' : '#FFFBFB';
  const divider = dark ? 'rgba(255,255,255,0.06)' : '#FCE4E4';
  const labelColor = dark ? '#8a95a5' : '#9CA3AF';
  const bodyColor = dark ? '#e5e5e5' : '#374151';

  return (
    <View
      accessibilityRole="alert"
      style={[$.card, { borderColor: dark ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)' }]}
    >
      <View style={[$.header, { backgroundColor: dark ? 'rgba(239,68,68,0.15)' : '#FEF2F2' }]}>
        <View style={[$.iconWrap, { backgroundColor: dark ? 'rgba(239,68,68,0.25)' : '#FEE2E2' }]}>
          <FontAwesome name={isAssociated ? 'mobile-screen' : isMute ? 'volume-xmark' : 'ban'} size={17} color={RED} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={$.title}>{title}</Text>
          <Text style={[$.status, { color: dark ? '#f87171' : '#DC2626' }]}>{status}</Text>
        </View>
      </View>

      {isAssociated && (
        <View style={[$.section, { backgroundColor: bodyBg, borderTopColor: divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[$.label, { color: labelColor }]}>{t('home.ban_why_title')}</Text>
          <Text style={[$.body, { color: bodyColor }]}>
            {masked ? t('home.ban_device_linked_email', { email: masked }) : t('home.ban_device_linked')}
          </Text>
        </View>
      )}

      {reason && (
        <View style={[$.section, { backgroundColor: bodyBg, borderTopColor: divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[$.label, { color: labelColor }]}>{t('home.ban_reason_title')}</Text>
          <Text style={[$.body, { color: bodyColor }]}>{reason}</Text>
        </View>
      )}

      {/* Appeal (bans only): opens More ▸ Complaints & ideas with "Ban appeal"
          picked (2026-10-18; players had no way to appeal and filed appeals
          under any category). */}
      {!isMute && (
        <View style={[$.appealRow, dark ? $.appealRowDark : $.appealRowLight]}>
          <Text style={[$.appealQuestion, dark ? $.appealQuestionDark : $.appealQuestionLight]}>{t('home.ban_appeal_question')}</Text>
          <TouchableOpacity onPress={() => openReportForm({ category: 'ban_appeal' })} activeOpacity={0.85} style={$.appealBtn}>
            <Text style={$.appealBtnText}>{t('home.ban_appeal_button')}</Text>
            <FontAwesome name="chevron-right" size={10} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const $ = StyleSheet.create({
  card: {
    marginHorizontal: SCREEN_GUTTER,
    marginTop: 14,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontFamily: FONT_BOLD, color: RED },
  status: { fontSize: 11.5, fontFamily: FONT_REGULAR, marginTop: 2 },
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  label: { fontSize: 10, fontFamily: FONT_BOLD, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  body: { fontSize: 13, fontFamily: FONT_REGULAR, lineHeight: 18 },
  appealRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  appealRowLight: { borderTopColor: '#FCE4E4' },
  appealRowDark: { borderTopColor: 'rgba(255,255,255,0.06)' },
  appealQuestion: { flex: 1, fontSize: 12.5, fontFamily: FONT_REGULAR },
  appealQuestionLight: { color: '#6B7280' },
  appealQuestionDark: { color: '#bbb' },
  appealBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#7C3AED', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  appealBtnText: { color: '#fff', fontSize: 12.5, fontFamily: FONT_BOLD },
});
