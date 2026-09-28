import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { isUserOnline } from '../utils';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useGlobalState } from '../../GlobelStats';
import { ref, get, set, remove } from '@react-native-firebase/database';
import FramedAvatar from '../GroupChat/FramedAvatar';
import { getCachedProfile, warmProfileCache, getOrFetchFullProfile } from '../../Helper/profileCache';
import UserBadgePill, { getPrimaryRoleType } from '../../Helper/UserBadgePill';
import { getUserRoles, useRoleRosterVersion } from '../../Helper/roleRoster';

// Presence needs its own two colours. config.colors.hasBlockGreen and
// wantBlockRed are both '#6A5ACD' in the light theme ("use primary for
// consistency"), so the old status line rendered Online and Offline in the
// identical brand purple and told the reader nothing. Green/grey is the
// convention every chat app uses, and grey reads as "away" rather than "error"
// the way a red dot would.
const ONLINE_COLOR = '#10B981';
const OFFLINE_COLOR = '#9CA3AF';

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(false); // ✅ Add state to store online status
  const { triggerHapticFeedback } = useHaptic();
  const { user, appdatabase } = useGlobalState();
  
  // ✅ State for fetched user data (roblox username, etc.)
  const [userData, setUserData] = useState(null);

  // Pull this user's cosmetics into the shared cache so their frame renders.
  const [frameVersion, setFrameVersion] = useState(0);
  useEffect(() => {
    const uid = selectedUser?.senderId || selectedUser?.id;
    if (!uid || !appdatabase || getCachedProfile(uid)) return;
    let cancelled = false;
    warmProfileCache(appdatabase, [uid])
      .then(() => { if (!cancelled) setFrameVersion(v => v + 1); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedUser?.senderId, selectedUser?.id, appdatabase]);

  // ✅ Memoize copyToClipboard
  const copyToClipboard = useCallback((code) => {
    if (!code || typeof code !== 'string') return;
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
  }, [triggerHapticFeedback, t]);

  // ✅ Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    const selectedUserId = selectedUser?.senderId || selectedUser?.id;
    if (!selectedUserId || !appdatabase) return;
    
    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null); // Clear fetched data if already in selectedUser
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        // One cached read of users/{uid} instead of five parallel leaf reads
        // (PLAN_2026-09.md F1); it also carries the role flags the pills need.
        const record = await getOrFetchFullProfile(appdatabase, selectedUserId);

        if (!isMounted) return;

        setUserData(record ? {
          robloxUsername: record.robloxUsername ?? null,
          robloxUserId: record.robloxUserId ?? null,
          robloxUsernameVerified: !!record.robloxUsernameVerified,
          isPro: !!record.isPro,
          lastGameWinAt: record.lastGameWinAt ?? null,
          isAdmin: !!record.admin || !!record.isAdmin,
          isModerator: !!record.isModerator,
          isBabyMod: !!record.isBabyMod,
          isTrusted: !!record.isTrusted,
          isCMSR: !!record.isCMSR,
          isHelper: !!record.isHelper,
        } : null);
      } catch (error) {
        console.error('Error fetching user data in PrivateChatHeader:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    return () => {
      isMounted = false;
    };
  }, [selectedUser?.senderId, selectedUser?.id, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // Role pills come from the roster (Code/Helper/roleRoster.js). userData is
  // skipped whenever selectedUser already carries Roblox fields — which every
  // public-chat message does — so reading roles only from it left a DM opened
  // from chat with no badges at all.
  const roleRosterVersion = useRoleRosterVersion(appdatabase);
  const selectedUid = selectedUser?.senderId || selectedUser?.id;

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    const roles = getUserRoles(selectedUid);
    const roleFields = {
      isAdmin: !!(userData?.isAdmin || roles.isAdmin),
      isModerator: roles.isModerator,
      isBabyMod: roles.isBabyMod,
      isTrusted: roles.isTrusted,
      isCMSR: roles.isCMSR,
      isHelper: roles.isHelper,
    };
    if (!userData) return selectedUser ? { ...selectedUser, ...roleFields } : selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined 
        ? selectedUser.robloxUsernameVerified 
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
      ...roleFields,
      lastGameWinAt: selectedUser?.lastGameWinAt !== undefined 
        ? selectedUser.lastGameWinAt 
        : userData.lastGameWinAt, // ✅ Game win timestamp
    };
    // roleRosterVersion: getUserRoles reads module state, so re-merge on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser, userData, selectedUid, roleRosterVersion]);

  // ✅ Memoize avatarUri and userName
  const avatarUri = useMemo(() => 
    mergedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    [mergedUser?.avatar]
  );
  
  const userName = useMemo(() => 
    mergedUser?.sender || 'User',
    [mergedUser?.sender]
  );

  useEffect(() => {
    const selectedUserId = mergedUser?.senderId || mergedUser?.id;
    if (selectedUserId) {
      isUserOnline(selectedUserId)
        .then(setIsOnline)
        .catch(() => setIsOnline(false));
    } else {
      setIsOnline(false);
    }
  }, [mergedUser?.senderId, mergedUser?.id]); // ✅ Use mergedUser

  // ✅ Check if user is banned with array validation
  const isBanned = useMemo(() => {
    const selectedUserId = mergedUser?.senderId || mergedUser?.id;
    if (!selectedUserId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUserId);
  }, [bannedUsers, mergedUser?.senderId, mergedUser?.id]);

  // ✅ Memoize handleBanToggle
  const handleBanToggle = useCallback(async () => {
    const selectedUserId = mergedUser?.senderId || mergedUser?.id;
    if (!selectedUserId) {
      console.warn('⚠️ Invalid user ID for ban toggle');
      return;
    }

    const action = isBanned ? t('chat.unblock') : t('chat.block');
    Alert.alert(
      `${action}`,
      isBanned
        ? t('chat.confirm_unblock', { name: userName })
        : t('chat.confirm_block', { name: userName }),
      [
        { text: t("chat.cancel"), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              let updatedBannedUsers;
              
              if (isBanned) {
                // 🔹 Unban: Remove from bannedUsers
                updatedBannedUsers = currentBanned.filter(id => id !== selectedUserId);
                
                // 🔹 Unban from Firebase (Remove Node)
                if (user?.id && appdatabase) {
                  await remove(ref(appdatabase, `bannedUsers/${user?.id}/${selectedUserId}`));
                }

              } else {
                // 🔹 Ban: Add to bannedUsers
                updatedBannedUsers = [...currentBanned, selectedUserId];
                
                // 🔹 Ban in Firebase (Add Node)
                if (user?.id && appdatabase) {
                  await set(ref(appdatabase, `bannedUsers/${user?.id}/${selectedUserId}`), {
                    displayName: userName || 'Anonymous',
                    avatar: avatarUri || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                    timestamp: Date.now()
                  });
                }
              }

              // ✅ Update local storage & state
              if (updateLocalState && typeof updateLocalState === 'function') {
                await updateLocalState('bannedUsers', updatedBannedUsers);
              }
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  }, [isBanned, bannedUsers, mergedUser?.senderId, mergedUser?.id, userName, t, updateLocalState]);

  // ✅ Memoize drawer open handler
  const handleOpenDrawer = useCallback(() => {
    if (setIsDrawerVisible && typeof setIsDrawerVisible === 'function') {
      setIsDrawerVisible(true);
    }
  }, [setIsDrawerVisible]);

  // Role tags this user actually holds, in the app's canonical order:
  // one authority pill (admin > mod > jmd, mutually exclusive) followed by any
  // community pills. Only the first one glows, matching every other surface.
  const badgeTypes = useMemo(() => {
    if (!mergedUser) return [];
    const list = [];
    const primary = getPrimaryRoleType(mergedUser);
    if (primary) list.push(primary);
    if (mergedUser.isTrusted) list.push('trusted');
    if (mergedUser.isCMSR) list.push('cmsr');
    if (mergedUser.isHelper) list.push('helper');
    return list;
  }, [mergedUser]);
  const firstBadge = badgeTypes[0] || null;

  const hasRecentWin = useMemo(() => (
    !!mergedUser?.hasRecentGameWin ||
    (typeof mergedUser?.lastGameWinAt === 'number' &&
      Date.now() - mergedUser.lastGameWinAt <= 24 * 60 * 60 * 1000)
  ), [mergedUser?.hasRecentGameWin, mergedUser?.lastGameWinAt]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleOpenDrawer}>
        <FramedAvatar
          avatarUri={avatarUri}
          frame={getCachedProfile(selectedUser?.senderId || selectedUser?.id)?.profileFrame || null}
          isDarkMode={selectedTheme?.dark ?? false}
          avatarSize={40}
          forceDetail
        />
      </TouchableOpacity>
      <TouchableOpacity style={styles.infoContainer} onPress={handleOpenDrawer} activeOpacity={0.7}>
        {/* Line 1 — name, then the small status icons, then copy.
            These used to be nested inside the <Text> alongside the role pills.
            A <View> inside <Text> only lays out on Android with fixed
            dimensions, so the pills (flex rows with padding and a border) were
            squeezed to nothing and a long username pushed everything off the
            end with no way to truncate. They are real siblings now. */}
        <View style={styles.nameRow}>
          <Text
            style={[styles.userName, { color: selectedTheme?.colors?.text || '#000' }]}
            numberOfLines={1}
          >
            {userName}
          </Text>
          {mergedUser?.isPro && (
            <Image source={require('../../../assets/pro.png')} style={styles.inlineIcon} />
          )}
          {mergedUser?.robloxUsernameVerified && (
            <Image source={require('../../../assets/verification.png')} style={styles.inlineIcon} />
          )}
          {hasRecentWin && (
            <Image source={require('../../../assets/trophy.webp')} style={styles.trophyIcon} />
          )}
          <TouchableOpacity
            onPress={() => copyToClipboard(userName)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="copy-outline" size={15} color="#007BFF" />
          </TouchableOpacity>
        </View>

        {/* Line 2 — presence, then whatever role tags this user holds. Giving
            the tags their own line is what "room for them" means here: on the
            name line a single ADMIN pill would eat the width a real username
            needs. The row collapses to just the status when a user has no
            roles, so nobody pays for blank space they never use. */}
        <View style={styles.metaRow}>
          <View
            style={[
              styles.presenceDot,
              { backgroundColor: isOnline ? ONLINE_COLOR : OFFLINE_COLOR },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: isOnline ? ONLINE_COLOR : OFFLINE_COLOR },
            ]}
          >
            {isOnline ? 'Online' : 'Offline'}
          </Text>
          {badgeTypes.map((type) => (
            <UserBadgePill
              key={type}
              type={type}
              size="sm"
              isDarkMode={selectedTheme?.dark ?? false}
              glow={type === firstBadge}
            />
          ))}
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleBanToggle}>
        <Icon
          name={isBanned ? 'shield-checkmark-outline' : 'ban-outline'}
          size={24}
          color={isBanned ? config.colors.hasBlockGreen : config.colors.wantBlockRed}
          style={styles.banIcon}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: 'white',
  },
  infoContainer: {
    flex: 1,
    marginLeft: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    // Shrink before the icons do, so a long username truncates with an
    // ellipsis instead of shoving the verified tick and copy button off-screen.
    flexShrink: 1,
  },
  inlineIcon: {
    width: 13,
    height: 13,
  },
  trophyIcon: {
    width: 11,
    height: 11,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 3,
  },
  presenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'Lato-Bold',
  },
  banIcon: {
    marginLeft: 10,
  },
});

export default PrivateChatHeader;
