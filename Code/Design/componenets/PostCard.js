import React, { useState, useCallback, memo, useEffect, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, Alert, Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import InterstitialAdManager from '../../Ads/IntAd';
import { useNavigation } from '@react-navigation/native';
import CommentModal from './CommentsModal';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { showMessage } from 'react-native-flash-message';
import ReportModal from './ReportModal';
import dayjs from 'dayjs';
import { get, getDatabase, ref, set } from '@react-native-firebase/database';
import ProfileBottomDrawer from '../../ChatScreen/GroupChat/BottomDrawer';
import { isUserOnline } from '../../ChatScreen/utils';
import FramedAvatar from '../../ChatScreen/GroupChat/FramedAvatar';
import { getCachedProfile } from '../../Helper/profileCache';
import { getUserRoles } from '../../Helper/roleRoster';
import { getUserEmail } from '../../Helper/privateProfile';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import ChatPillButton from '../../Helper/ChatPillButton';
import { logModAction, resolveActorRole } from '../../Helper/modLog';

const REACTION_EMOJIS = ['❤️', '🔥', '😍', '💀', '🎯'];

const TAG_CONFIG = {
  'scam alert': { color: '#FF3B30', icon: 'shield-halved' },
  'looking for trade': { color: '#10B981', icon: 'handshake' },
  'discussion': { color: '#3B82F6', icon: 'comments' },
  'real or fake': { color: '#8B5CF6', icon: 'magnifying-glass' },
  'need help': { color: '#F59E0B', icon: 'circle-question' },
  'misc': { color: '#6B7280', icon: 'ellipsis' },
  'misc.': { color: '#6B7280', icon: 'ellipsis' },
};

const PostCard = ({ item, userId, onLike, onReaction, localState, appdatabase, onDelete, onDeleteAll }) => {
  const navigation = useNavigation();

  // Support both old onLike and new onReaction
  const handleReaction = onReaction || onLike;

  // Merge likes + reactions into a unified map
  const mergedReactions = useMemo(() => {
    const map = {};
    if (item.likes) {
      Object.keys(item.likes).forEach(uid => {
        if (!item.reactions?.[uid]) map[uid] = '❤️';
      });
    }
    if (item.reactions) {
      Object.entries(item.reactions).forEach(([uid, emoji]) => {
        map[uid] = emoji;
      });
    }
    return map;
  }, [item.likes, item.reactions]);

  const myReaction = mergedReactions[userId] || null;
  const totalReactions = Object.keys(mergedReactions).length;

  const reactionCounts = useMemo(() => {
    const counts = {};
    Object.values(mergedReactions).forEach(emoji => {
      counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [mergedReactions]);

  const [showComments, setShowComments] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  // The comment, report and profile modals mount on first open and then stay
  // mounted: the drawer has to outlive its own close while a staff reason
  // prompt is up. Mounting all three in every card put a 2,500-line drawer
  // plus two modals behind each post, and deep scrolls in the feed froze.
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [reportMounted, setReportMounted] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [heartScale] = useState(new Animated.Value(1));
  const [bannedUsers, setBannedUsers] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setBannedUsers(localState.bannedUsers);
  }, [localState.bannedUsers]);

  const { theme, isAdmin, user } = useGlobalState();
  // Moderators may delete ANY post (owner decision 2026-09-27); JMDs may not.
  // This is a UI gate only: firestore.rules lets any signed-in user delete a
  // designPosts document, so real enforcement needs a rules change.
  const isMod = !!user?.isModerator;
  const isOwnPost = userId === item.userId;
  const isDark = theme === 'dark';

  const getTagConfig = (tag) => TAG_CONFIG[tag.toLowerCase()] || { color: config.colors.primary, icon: 'tag' };

  // Both callers (the staff menu below and ReportModal) pass the chat ban's
  // argument order — (email, isAdmin, senderId, userInfo, bannerInfo, reason,
  // source) — so the author's uid is the THIRD argument. Taking it second
  // handed true/false to onDeleteAll and the author's posts were never
  // removed. Strike maths still follows this viewer's own isAdmin.
  const banUserwithEmail = async (email, _isAdminArg, userId) => {
    const encodeEmail = (email) => email.replace(/\./g, '(dot)');
    try {
      const db = getDatabase();
      const banRef = ref(db, `banned_users_by_email_post/${encodeEmail(email)}`);
      const snap = await get(banRef);
      let strikeCount = 1;
      let bannedUntil = Date.now() + 24 * 60 * 60 * 1000;
      if (snap.exists()) {
        const data = snap.val();
        // Fallbacks matter here, and not just for tidiness: without them
        // `data.strikeCount + 1` is NaN whenever the stored record has no
        // strikeCount, and a NaN anywhere in a set() payload kills the process
        // rather than rejecting the promise — the native write throws a raw
        // DatabaseException ("Value cannot be NaN or Inf") that
        // @react-native-firebase blind-casts, so it surfaces as an uncaught
        // ClassCastException on a Play-services worker thread that no JS
        // try/catch can reach.
        //
        // The old code also *created* that state: the non-admin branch assigned
        // `undefined`, Firebase drops undefined keys, so the record came back
        // without a strikeCount and the next admin ban on the same user crashed.
        // Same hardening as banUserByEmail() in ChatScreen/utils.js.
        if (data && typeof data === 'object') {
          strikeCount = isAdmin ? (data.strikeCount || 0) + 1 : (data.strikeCount || 1);
        }
        if (strikeCount === 2) bannedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
        else if (strikeCount >= 3) bannedUntil = "permanent";
      }
      await set(banRef, { strikeCount, bannedUntil, reason: `Strike ${strikeCount}` });
      if (userId) await onDeleteAll(userId);
      if (isAdmin) { Alert.alert('User Banned', `Strike ${strikeCount} applied.`); }
    } catch (err) {
      console.error('Ban error:', err);
      if (isAdmin) { Alert.alert('Error', 'Could not ban user.'); }
    }
  };

  // Staff "Ban User" on a post. Posts no longer carry the author's email
  // (designPosts is world-readable), so it comes from users_private, which
  // only staff can read. Posts made by older builds still carry `email`
  // until the cutover scrub removes it; that is the fallback.
  const resolveAuthorEmail = async () =>
    (await getUserEmail(appdatabase || getDatabase(), item.userId)) || item.email || null;

  const closeProfileDrawer = () => setIsDrawerVisible(false);

  const openProfileDrawer = async () => {
    if (!userId) {
      showMessage({ message: 'Please sign in to message', type: 'warning' });
      return;
    }
    setIsOnline(false);
    try {
      const online = await isUserOnline(item?.userId);
      setIsOnline(online);
    } catch (error) {
      setIsOnline(false);
    }
    setDrawerMounted(true);
    setIsDrawerVisible(true);
  };

  const selectedUser = {
    senderId: item.userId,
    sender: item.displayName,
    avatar: item.avatar,
    flage: item.flage ? item.flage : null,
    robloxUsername: item?.robloxUsername || null,
    robloxUsernameVerified: item?.robloxUsernameVerified || false,
  };

  const handleChatNavigation = useCallback(() => {
    const callback = () => {
      if (!userId) {
        showMessage({ message: 'Please sign in to message', type: 'warning' });
        return;
      }
      // Close drawer first (iOS doesn't auto-dismiss modals on navigation)
      setIsDrawerVisible(false);
      setTimeout(() => {
        navigation.navigate('PrivateChatDesign', { selectedUser, item });
      }, 300);
    };
    if (!localState?.isPro) {
      InterstitialAdManager.showAd(callback);
    } else {
      callback();
    }
  }, [userId, item, navigation, localState?.isPro]);

  const handleEmojiTap = useCallback((emoji) => {
    setShowEmojiPicker(false);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1.0, useNativeDriver: true, speed: 40 }),
    ]).start();
    if (handleReaction) {
      handleReaction(item, emoji);
    }
  }, [item, handleReaction]);

  const handleQuickReact = useCallback(() => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1.0, useNativeDriver: true, speed: 40 }),
    ]).start();
    if (handleReaction) {
      if (myReaction) {
        handleReaction(item, myReaction);
      } else {
        handleReaction(item, '❤️');
      }
    }
  }, [myReaction, item, handleReaction]);

  const s = useMemo(() => getStyles(isDark), [isDark]);
  const formattedTime = item.createdAt ? dayjs(item.createdAt.toDate()).fromNow() : 'Anonymous';
  const hasNoImages = !Array.isArray(item.imageUrl) || item.imageUrl.length === 0;

  // Posts arrive with padding blank lines that turned a two-line post into a
  // screen-tall card; trim them and collapse runs of blank lines to one.
  const descText = useMemo(
    () => (typeof item?.desc === 'string' ? item.desc.trim().replace(/\n\s*\n(\s*\n)+/g, '\n\n') : ''),
    [item?.desc],
  );
  const DESC_MAX_LINES = 6;
  const isLongDesc = descText.length > 280 || descText.split('\n').length > DESC_MAX_LINES;
  const tags = Array.isArray(item.selectedTags) ? item.selectedTags.filter(Boolean) : [];

  return (
    <View style={s.card}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={openProfileDrawer} activeOpacity={0.8}>
          <View style={s.avatarWrapper}>
            {/* Newer posts stamp the poster's frame; older ones fall back to
                the shared profile cache. */}
            <FramedAvatar
              avatarUri={item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={item.profileFrame || getCachedProfile(item.userId)?.profileFrame || null}
              isDarkMode={isDark}
              avatarSize={28}
              forceDetail
            />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={{ marginLeft: 10, flex: 1 }} onPress={openProfileDrawer} activeOpacity={0.8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <Text style={s.name} numberOfLines={1}>{item.displayName}</Text>
            {item.isPro && (
              <Image source={require('../../../assets/pro.png')} style={s.badge} />
            )}
            {item.robloxUsernameVerified && (
              <Image source={require('../../../assets/verification.png')} style={s.badge} />
            )}

            {/* Role pills from the roster (Code/Helper/roleRoster.js), never
                from flags on the document: those are client-written, so they
                could be faked. Works for old and new rows alike. */}
            {(() => {
              const rp = getUserRoles(item.userId);
              const firstBadge = getFirstBadgeType(rp);
              return (
                <>
                  {rp.isAdmin && <UserBadgePill type="admin" size="sm" isDarkMode={isDark} glow={firstBadge === 'admin'} />}
                  {!rp.isAdmin && rp.isModerator && <UserBadgePill type="mod" size="sm" isDarkMode={isDark} glow={firstBadge === 'mod'} />}
                  {!rp.isAdmin && !rp.isModerator && rp.isBabyMod && <UserBadgePill type="jmd" size="sm" isDarkMode={isDark} glow={firstBadge === 'jmd'} />}
                  {rp.isTrusted && <UserBadgePill type="trusted" size="sm" isDarkMode={isDark} glow={firstBadge === 'trusted'} />}
                  {rp.isCMSR && <UserBadgePill type="cmsr" size="sm" isDarkMode={isDark} glow={firstBadge === 'cmsr'} />}
                  {rp.isHelper && <UserBadgePill type="helper" size="sm" isDarkMode={isDark} glow={firstBadge === 'helper'} />}
                </>
              );
            })()}
            {(() => {
              const hasRecentWin =
                !!item?.hasRecentGameWin ||
                (typeof item?.lastGameWinAt === 'number' &&
                  Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
              return hasRecentWin ? (
                <Image source={require('../../../assets/trophy.webp')} style={s.badge} />
              ) : null;
            })()}
          </View>
          <View style={s.metaRow}>
            <Text style={s.time}>{formattedTime}</Text>
          </View>
        </TouchableOpacity>

        {/* Topic tags, right-aligned and top-aligned (level with the name)
            like the badges on trade cards */}
        {tags.length > 0 && (
          <View style={s.tagColumn}>
            {tags.map((tag) => {
              const cfg = getTagConfig(tag);
              return (
                <View key={tag} style={[s.tagChip, { backgroundColor: `${cfg.color}${isDark ? '2E' : '1A'}`, borderColor: `${cfg.color}${isDark ? '55' : '33'}` }]}>
                  <FontAwesome6 name={cfg.icon} size={8} color={cfg.color} solid />
                  <Text style={[s.tagChipText, { color: cfg.color }]} numberOfLines={1}>{tag}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Kebab menu */}
        <Menu style={{ alignSelf: 'flex-start' }}>
          <MenuTrigger customStyles={{ triggerTouchable: { hitSlop: { top: 8, bottom: 8, left: 8, right: 8 } } }}>
            <View style={s.menuBtn}>
              <Icon name="ellipsis-v" size={14} color={isDark ? '#94a3b8' : '#64748b'} />
            </View>
          </MenuTrigger>
          <MenuOptions customStyles={{ optionsContainer: { borderRadius: 14, overflow: 'hidden', backgroundColor: isDark ? config.colors.surfaceDark : '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 8, minWidth: 160 } }}>
            <MenuOption onSelect={() => { setReportMounted(true); setShowReportModal(true); }}>
              <View style={s.menuItem}>
                <FontAwesome6 name="flag" size={12} color="#F59E0B" solid />
                <Text style={[s.menuItemText, { color: '#F59E0B' }]}>Report</Text>
              </View>
            </MenuOption>
            {(isOwnPost || isAdmin || isMod) && (
              <MenuOption onSelect={() => Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', onPress: () => {
                  onDelete(item.id);
                  // Removing someone ELSE's post is a moderation action: record
                  // it in the Mod Log (Admin dashboard) like review/status removals.
                  if (!isOwnPost) {
                    logModAction({
                      action: 'post_delete',
                      targetUid: item.userId || null,
                      targetName: item.displayName || null,
                      reason: item.desc ? `Removed post: "${String(item.desc).slice(0, 140)}"` : 'Removed an image post',
                      source: 'feed',
                      actorUid: user?.id || null,
                      actorName: user?.displayName || null,
                      actorRole: resolveActorRole({ isAdmin, isModerator: user?.isModerator, isBabyMod: user?.isBabyMod }),
                      meta: { postId: item.id, imageUrl: Array.isArray(item.imageUrl) ? item.imageUrl[0] || null : item.imageUrl || null },
                    });
                  }
                }, style: 'destructive' },
              ])}>
                <View style={[s.menuItem, { borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  <FontAwesome6 name="trash" size={12} color="#EF4444" solid />
                  <Text style={[s.menuItemText, { color: '#EF4444' }]}>Delete</Text>
                </View>
              </MenuOption>
            )}
            {isAdmin && (
              <MenuOption onSelect={async () => {
                const authorEmail = await resolveAuthorEmail();
                if (!authorEmail) {
                  Alert.alert('No email on record', 'Bans are keyed by email, and this account has none.');
                  return;
                }
                banUserwithEmail(
                // (email, isAdmin, senderId, userInfo, bannerInfo, reason, source).
                // userId used to sit in the isAdmin slot and senderId was never
                // passed, so the record saved userId: null.
                authorEmail, true, item.userId,
                { id: item.userId, displayName: item.displayName, avatar: item.avatar },
                null, 'Banned from a feed post', 'feed',
                );
              }}>
                <View style={[s.menuItem, { borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  <FontAwesome6 name="ban" size={12} color="#EF4444" solid />
                  <Text style={[s.menuItemText, { color: '#EF4444' }]}>Ban User</Text>
                </View>
              </MenuOption>
            )}
            {isAdmin && (
              <MenuOption onSelect={() => Alert.alert('Delete All', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', onPress: () => onDeleteAll(item.userId), style: 'destructive' },
              ])}>
                <View style={[s.menuItem, { borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9' }]}>
                  <FontAwesome6 name="trash-can" size={12} color="#EF4444" solid />
                  <Text style={[s.menuItemText, { color: '#EF4444' }]}>Delete All</Text>
                </View>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>
      </View>

      {/* ── Body text ── */}
      {!!descText && (
        <View style={s.body}>
          <Text style={s.desc} numberOfLines={expanded || !isLongDesc ? undefined : DESC_MAX_LINES}>
            {descText}
          </Text>
          {isLongDesc && (
            <Text style={s.showMore} onPress={() => setExpanded(v => !v)} suppressHighlighting>
              {expanded ? 'Show less' : 'Show more'}
            </Text>
          )}
        </View>
      )}

      {/* ── Image(s) ── */}
      {!hasNoImages && (
        <View style={s.imageWrapper}>
          <View style={s.imageContainer}>
            {item.imageUrl.length === 1 ? (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => navigation.navigate('ImageViewerScreen', { images: item.imageUrl, initialIndex: 0 })}
              >
                <Image source={{ uri: item.imageUrl[0] }} style={s.singleImage} />
              </TouchableOpacity>
            ) : (
              <View style={s.multiGrid}>
                {item.imageUrl.slice(0, 4).map((url, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      s.gridCell,
                      item.imageUrl.length === 3 && idx === 0 && s.gridCellWide,
                    ]}
                    activeOpacity={0.9}
                    onPress={() => navigation.navigate('ImageViewerScreen', { images: item.imageUrl, initialIndex: idx })}
                  >
                    <Image source={{ uri: url }} style={s.gridImage} />
                    {idx === 3 && item.imageUrl.length > 4 && (
                      <View style={s.moreOverlay}>
                        <Text style={s.moreText}>+{item.imageUrl.length - 4}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {reportMounted && (
            <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} banUserwithEmail={banUserwithEmail} />
          )}
        </View>
      )}

      {hasNoImages && reportMounted && (
        <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} banUserwithEmail={banUserwithEmail} />
      )}

      {/* ── Reaction summary ── */}
      {totalReactions > 0 && (
        <View style={s.reactionSummary}>
          <View style={s.reactionStack}>
            {reactionCounts.map(([emoji], idx) => (
              <View key={emoji} style={[s.reactionBubble, idx > 0 && { marginLeft: -6 }, { zIndex: 3 - idx }]}>
                <Text style={{ fontSize: 10 }}>{emoji}</Text>
              </View>
            ))}
          </View>
          <Text style={s.totalReactionsText}>
            {myReaction && totalReactions > 1
              ? `You and ${totalReactions - 1} ${totalReactions - 1 === 1 ? 'other' : 'others'}`
              : myReaction ? 'You reacted' : `${totalReactions} ${totalReactions === 1 ? 'reaction' : 'reactions'}`}
          </Text>
          {!!item.commentCount && (
            <Text style={[s.totalReactionsText, { marginLeft: 'auto' }]}>
              {item.commentCount} {item.commentCount === 1 ? 'comment' : 'comments'}
            </Text>
          )}
        </View>
      )}

      {/* ── Action Bar ── */}
      <View style={s.actionBar}>
        {/* React button */}
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <TouchableOpacity
            style={[s.actionBtn, myReaction && s.actionBtnActive]}
            onPress={() => setShowEmojiPicker(v => !v)}
            activeOpacity={0.75}
          >
            {myReaction
              ? <Text style={{ fontSize: 15 }}>{myReaction}</Text>
              : <Icon name="heart-o" size={15} color={isDark ? '#94a3b8' : '#64748b'} />}
            <Text style={[s.actionBtnLabel, myReaction && { color: config.colors.primary }]}>
              {myReaction ? 'Reacted' : 'React'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Comment button */}
        <TouchableOpacity
          style={s.actionBtn}
          onPress={() => { setCommentsMounted(true); setShowComments(true); }}
          activeOpacity={0.75}
        >
          <Icon name="comment-o" size={15} color={isDark ? '#94a3b8' : '#64748b'} />
          <Text style={s.actionBtnLabel}>
            {item.commentCount ? `Comment · ${item.commentCount}` : 'Comment'}
          </Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Chat / DM button */}
        <ChatPillButton onPress={openProfileDrawer} />
      </View>

      {/* ── Emoji Picker ── */}
      {showEmojiPicker && (
        <View style={s.emojiPicker}>
          {REACTION_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[s.emojiBtn, myReaction === emoji && s.emojiBtnActive]}
              onPress={() => handleEmojiTap(emoji)}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {commentsMounted && (
        <CommentModal
          visible={showComments}
          onClose={() => setShowComments(false)}
          postId={item.id}
          appdatabase={appdatabase}
        />
      )}

      {drawerMounted && (
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}
          startChat={handleChatNavigation}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />
      )}
    </View>
  );
};

const getStyles = (isDark) => {
  const border = isDark ? '#22304d' : '#eef1f6';
  const muted = isDark ? '#8b9ab4' : '#64748b';
  return StyleSheet.create({
    card: {
      marginHorizontal: 12,
      marginVertical: 6,
      borderRadius: 10,
      backgroundColor: isDark ? '#111c33' : '#ffffff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.3 : 0.06,
      shadowRadius: 10,
      elevation: 2,
      overflow: 'hidden',
    },

    /* Header */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingTop: 10,
      paddingBottom: 8,
    },
    avatarWrapper: {
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 5,
    },
    badge: {
      width: 12,
      height: 12,
    },
    name: {
      fontWeight: '700',
      fontSize: 15,
      color: isDark ? '#f1f5f9' : '#0f172a',
      flexShrink: 1,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 3,
    },
    time: {
      fontSize: 12,
      color: isDark ? '#64748b' : '#94a3b8',
    },
    tagColumn: {
      alignSelf: 'flex-start',
      alignItems: 'flex-end',
      gap: 4,
      marginLeft: 8,
      maxWidth: '45%',
    },
    tagChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
    },
    tagChipText: {
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.2,
      flexShrink: 1,
    },
    // Narrow and right-aligned so the dots sit on the card's 10pt inset,
    // matching the left edge; hitSlop on the trigger keeps it easy to tap.
    menuBtn: {
      width: 14,
      height: 18,
      marginLeft: 6,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    menuItemText: {
      fontSize: 13,
      fontWeight: '600',
    },

    /* Body */
    body: {
      paddingHorizontal: 10,
      paddingBottom: 12,
    },
    desc: {
      fontSize: 15,
      lineHeight: 22,
      color: isDark ? '#d6deeb' : '#1e293b',
    },
    showMore: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: '700',
      color: config.colors.primary,
      alignSelf: 'flex-start',
    },

    /* Images */
    imageWrapper: {
      marginHorizontal: 10,
      marginBottom: 12,
    },
    imageContainer: {
      borderRadius: 6,
      overflow: 'hidden',
      backgroundColor: isDark ? '#0b1426' : '#f1f5f9',
    },
    singleImage: {
      width: '100%',
      height: 240,
      resizeMode: 'cover',
    },
    multiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 3,
    },
    gridCell: {
      width: '49.3%',
      height: 140,
      overflow: 'hidden',
    },
    gridCellWide: {
      width: '100%',
      height: 180,
    },
    gridImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    moreOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    moreText: {
      color: '#fff',
      fontSize: 22,
      fontWeight: '800',
    },

    /* Reaction summary */
    reactionSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingBottom: 10,
    },
    reactionStack: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    reactionBubble: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#1c2a47' : '#f1f5f9',
      borderWidth: 1.5,
      borderColor: isDark ? '#111c33' : '#ffffff',
    },
    totalReactionsText: {
      fontSize: 12,
      color: muted,
    },

    /* Action bar */
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: border,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
    },
    actionBtnActive: {
      backgroundColor: isDark ? 'rgba(106,90,205,0.18)' : 'rgba(106,90,205,0.08)',
    },
    actionBtnLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: muted,
    },

    /* Emoji picker */
    emojiPicker: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      marginHorizontal: 10,
      marginBottom: 10,
      backgroundColor: isDark ? config.colors.backgroundDark : '#f8fafc',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    emojiBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? config.colors.surfaceDark : '#ffffff',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    emojiBtnActive: {
      backgroundColor: isDark ? '#1e3a5f' : '#eff6ff',
      borderWidth: 2,
      borderColor: config.colors.primary,
    },
  });
};

export default memo(PostCard, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.likes === nextProps.item.likes &&
    prevProps.item.reactions === nextProps.item.reactions &&
    prevProps.item.commentCount === nextProps.item.commentCount &&
    prevProps.item.imageUrl === nextProps.item.imageUrl &&
    prevProps.userId === nextProps.userId &&
    // Role badges come from the roster, outside the props; this bumps when it loads.
    prevProps.roleRosterVersion === nextProps.roleRosterVersion &&
    prevProps.localState?.isPro === nextProps.localState?.isPro &&
    prevProps.appdatabase === nextProps.appdatabase &&
    prevProps.onReaction === nextProps.onReaction &&
    prevProps.onLike === nextProps.onLike &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onDeleteAll === nextProps.onDeleteAll
  );
});
