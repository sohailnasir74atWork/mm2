// roleRoster.js — who holds which role, for rendering badges next to names.
//
// Source of truth: the /mods, /trusted, /cmsr and /helper roster nodes, which
// Cloud Functions (functions/syncRoleRosters.js) keep in sync with the role
// flags on /users/{uid}. Clients cannot write them (".write": false), so a
// badge drawn from here cannot be faked.
//
// Why not flags stamped on trades / posts / chat messages: chat_new and
// group_messages are open to any write and Firestore does not validate those
// fields, so anyone could post as "Mod" — a ready-made scam in a trading app.
// Why not the per-user profile cache alone: it is only filled when a screen
// remembers to warm it, and keeps a role for up to 6h after it changes.
//
// The rosters are tiny (~60 bytes per member), so one live listener per node
// costs almost nothing and makes grants and removals show up everywhere at
// once. Admin is not in a roster; it comes from the profile cache
// (users/{uid}.admin, rules-protected).
import { useEffect, useSyncExternalStore } from 'react';
import { ref, onValue } from '@react-native-firebase/database';
import { getCachedProfile, getRoleOverride } from './profileCache';

const NODES = ['mods', 'trusted', 'cmsr', 'helper'];

let rosters = { mods: {}, trusted: {}, cmsr: {}, helper: {} };
let version = 0;
let started = false;
const listeners = new Set();

const bump = () => { version += 1; listeners.forEach((l) => l()); };

export const startRoleRoster = (db) => {
  if (started || !db) return;
  started = true;
  NODES.forEach((node) => {
    onValue(
      ref(db, node),
      (snap) => {
        rosters = { ...rosters, [node]: (snap.exists() && snap.val()) || {} };
        bump();
      },
      () => { /* read denied / offline: keep what we have */ },
    );
  });
};

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => version;

/**
 * Re-render when the rosters (or their first load) change. Returns a number
 * to feed a FlatList's extraData or a memo comparator. Starts the listeners on
 * first use.
 */
export const useRoleRosterVersion = (db) => {
  useEffect(() => { startRoleRoster(db); }, [db]);
  return useSyncExternalStore(subscribe, getSnapshot);
};

/**
 * Role flags for any user, in the shape UserBadgePill's helpers expect.
 * Order of trust: a role this device just wrote (5-min override) > roster >
 * cached profile (admin only).
 */
export const getUserRoles = (uid) => {
  if (!uid) return {};
  const mod = rosters.mods?.[uid];
  const roles = {
    isAdmin: !!getCachedProfile(uid)?.isAdmin,
    isModerator: mod?.role === 'mod',
    isBabyMod: mod?.role === 'jmod',
    isTrusted: !!rosters.trusted?.[uid],
    isCMSR: !!rosters.cmsr?.[uid],
    isHelper: !!rosters.helper?.[uid],
  };
  const override = getRoleOverride(uid);
  return override ? { ...roles, ...override } : roles;
};
