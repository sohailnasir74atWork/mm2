import {trackGrowthEvent} from './Helper/growthAnalytics';
import { fetchCatalog, refreshCatalog, usableCatalog, withDeadline } from './Helper/catalogNetwork';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue, remove, query, orderByValue, equalTo } from '@react-native-firebase/database';
import { getFirestore, doc, onSnapshot, getDoc } from '@react-native-firebase/firestore';
import { syncValueAlertTopics } from './Helper/valueAlerts';
import { initValueNotificationTapHandlers, initValueUpdatesOnStartup } from './Helper/valueUpdateNotifications';
import { ensurePostChannel } from './Helper/postNotifications';
import { createNewUser, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, AppState } from 'react-native';
import { getFlag } from './Helper/CountryCheck';
import { getConfigNodes } from './Helper/configCache';
import { indexMM2Images, indexSupremePrices, unwrapFeed } from './Helper/valueSources';
import { getServerTime } from './Helper/serverTime';
import { saveOwnPrivateProfile } from './Helper/privateProfile';
import { getDeviceFingerprint, stampOwnDeviceId } from './Helper/deviceFingerprint';
import { generateOnePieceUsername } from './Helper/RendomNamegen';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';



// ── Startup instrumentation (2026-09-21) ────────────────────────────────
// Ported from adoptme-jan7; see HANDOFF_2026-09-21.md there for the reasoning.
//
// `am start -W` measures time to FIRST DRAW, which is only the splash
// appearing. What users experience as "the app is slow to open" is the time
// until isAppReady flips and the real UI renders, which sits behind
// handleUserLogin's network work. Nothing has ever measured that here.
//
// Sent to Analytics rather than Crashlytics on purpose: a Crashlytics log is a
// breadcrumb visible only if that session later crashes, which is a useless
// sample for typical startup time. Analytics aggregates across all users.
const _launchedAt = Date.now();
const logStartupTiming = (name, params) => {
  try {
    logEvent(getAnalytics(), name, params);
  } catch (_) {}
};

// Profile-read robustness (2026-10-13, ported from adoptme-jan7's 2026-10-01
// stuck-profile fix). The login read of users/{uid} is capped (10 s, 20 s on a
// background reload), and a failed one is retried after RTDB reports
// connected, backing off by these delays. The array's length is the
// per-launch reload cap.
const PROFILE_READ_TIMEOUT_MS = 10000;
const PROFILE_RELOAD_TIMEOUT_MS = 20000;
const PROFILE_RELOAD_DELAYS = [2000, 8000, 20000, 45000, 90000];

// The profile's "Joined" date: when the Firebase Auth account was created,
// not when this login ran. Stamping Date.now() gave every account whose record
// was recreated the date of a later login (21,683 Adopt Me users corrected
// 2026-10-21). In @react-native-firebase 25 metadata.creationTime is an ISO
// string and the getter throws when absent.
const authCreatedAtMs = (authUser) => {
  try {
    const ms = Date.parse(authUser?.metadata?.creationTime);
    if (Number.isFinite(ms) && ms > 0) return ms;
  } catch (_) {}
  return Date.now();
};

// Grace before signing out an unverified email/password user (see the auth
// listener). Long enough for SigninDrawer to send the verification email and
// sign out by itself.
const UNVERIFIED_SIGNOUT_GRACE_MS = 3000;

const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();



// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const { localState, updateLocalState } = useLocalState()

  const colorScheme = useColorScheme(); // 'light' or 'dark'

  const resolvedTheme = localState.theme === 'system' ? colorScheme : localState.theme;
  const [theme, setTheme] = useState(resolvedTheme);
  const [api, setApi] = useState(null);
  const [freeTranslation, setFreeTranslation] = useState(null);
  const [currentUserEmail, setCurrentuserEmail] = useState('')
  const [single_offer_wall, setSingle_offer_wall] = useState(false)
  const [tradingServerLink, setTradingServerLink] = useState(null); // Trading server link from admin servers



  const [isAdmin, setIsAdmin] = useState(false);

  // ── Moderation state (PLAN_2026-09.md P4/P6/P7) ──
  // Ban payload from banned_users_by_email — drives the ban card and the
  // "Strike N, Xh left" copy in chat.
  const [strikeInfo, setStrikeInfo] = useState(null);
  // Email-keyed and device-keyed bans are tracked separately (as in
  // adoptme-jan7) so a banned player cannot escape by signing up again with
  // a fresh account on the same phone.
  const [isEmailBanned, setIsEmailBanned] = useState(false);
  const [isDeviceBanned, setIsDeviceBanned] = useState(false);
  // Full banned_devices/{fp} row while this device is under a live ban. It
  // names the email + uid of the account that was banned, so the Home ban
  // card can explain a ban the signed-in account did not earn itself.
  const [deviceBanInfo, setDeviceBanInfo] = useState(null);
  // Canonical gate. Every send/post path should read THIS, not strikeInfo,
  // because it is validated against server time rather than the device clock.
  // It is the OR of the email ban and the device ban.
  const isUserBlocked = isEmailBanned || isDeviceBanned;
  // Admin kill switch for moderator ban/mute (RTDB /mod_controls_enabled).
  // Default ON: only an explicit `false` disables it, so a denied or offline
  // read leaves moderators working.
  const [modControlsEnabled, setModControlsEnabled] = useState(true);
  // Delegated "can grant Junior Mod" permission (RTDB /jmd_granters/{uid}).
  // Fails CLOSED — a denied read means no permission.
  const [canGrantJmd, setCanGrantJmd] = useState(false);

  const [isInActiveGame, setIsInActiveGame] = useState(false); // ✅ Track if user is in active game
  const [acceptedInviteRoom, setAcceptedInviteRoom] = useState(null); // ✅ { roomId, gameType } from toast accept
  const [user, setUser] = useState({
    id: null,
    // selectedFruits: [],
    // isReminderEnabled: false,
    // isSelectedReminderEnabled: false,
    displayName: '',
    avatar: null,
    // rewardPoints: 0,
    isBlock: false,
    fcmToken: null,
    lastActivity: null,
    online: false,
    isPro: false,
    createdAt: null


  });

  const [loading, setLoading] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState('ready');
  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');


  // Track theme changes
  useEffect(() => {
    setTheme(localState.theme === 'system' ? colorScheme : localState.theme);
  }, [localState.theme, colorScheme]);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false

  // ✅ Store updateLocalState in ref to avoid dependency issues
  const updateLocalStateRef = useRef(updateLocalState);
  useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  // ✅ Memoize updateLocalStateAndDatabase to prevent infinite loops and duplicate writes
  const updateLocalStateAndDatabase = useCallback(async (keyOrUpdates, value) => {
    try {
      let updates = {};

      if (typeof keyOrUpdates === 'string') {
        updates = { [keyOrUpdates]: value };
        await updateLocalStateRef.current(keyOrUpdates, value); // ✅ Use ref to avoid dependency
      } else if (typeof keyOrUpdates === 'object') {
        updates = keyOrUpdates;
        for (const [key, val] of Object.entries(updates)) {
          await updateLocalStateRef.current(key, val); // ✅ Use ref to avoid dependency
        }
      } else {
        throw new Error('Invalid arguments for update.');
      }

      // ✅ Update in-memory user state and Firebase in one functional update (prevents duplicate writes)
      setUser((prev) => {
        // ✅ Check if updates are actually different to prevent duplicate writes
        const hasChanges = Object.keys(updates).some(key => prev[key] !== updates[key]);
        if (!hasChanges && prev?.id) {
          // No changes, skip Firebase write
          return prev;
        }

        const updatedUser = { ...prev, ...updates };
        
        // ✅ Update Firebase only if user is logged in and there are actual changes
        // ✅ Exclude 'online' field from user data (it's stored in presence/{uid} node)
        if (prev?.id && appdatabase && hasChanges) {
          const userRef = ref(appdatabase, `users/${prev.id}`);
          const userDataUpdates = { ...updates };
          delete userDataUpdates.online; // ✅ Don't sync online to user data
          update(userRef, userDataUpdates).catch((error) => {
            // Silently handle Firebase errors
          });
        }
        
        return updatedUser;
      });
    } catch (error) {
      // console.error('❌ Error updating user state or database:', error);
    }
  }, [appdatabase]); // ✅ Removed updateLocalState from deps, using ref instead



  // ✅ Use ref to track if flag has been set for current user (prevents infinite loop)
  const flagSetForUserRef = useRef(null);
  const updateLocalStateAndDatabaseRef = useRef(updateLocalStateAndDatabase);
  
  // ✅ Keep ref updated with latest function
  useEffect(() => {
    updateLocalStateAndDatabaseRef.current = updateLocalStateAndDatabase;
  }, [updateLocalStateAndDatabase]);
  
  // ✅ Value alerts for EXISTING users: their My Stuff portfolio is already
  // saved in Firestore, so subscribe their items' FCM topics at app start —
  // they don't need to open the My Stuff screen after updating the app.
  // One read per sign-in; syncValueAlertTopics MMKV-diffs so repeats no-op.
  const valueAlertSyncedRef = useRef(null);
  useEffect(() => {
    if (!user?.id || valueAlertSyncedRef.current === user.id) return;
    valueAlertSyncedRef.current = user.id;
    getDoc(doc(firestoreDB, 'reviews', user.id))
      .then((snap) => {
        const d = snap.exists() ? snap.data() : null;
        const owned = Array.isArray(d?.ownedPets) ? d.ownedPets : [];
        const wishlist = Array.isArray(d?.wishlistPets) ? d.wishlistPets : [];
        // Mirror into localState so the calculator INVENTORY tab and chat
        // picker have the user's items from the first app open (existing
        // users never need to visit My Stuff for these to work).
        updateLocalState('ownedPets', owned);
        updateLocalState('wishlistPets', wishlist);
        const names = [...owned, ...wishlist].map((p) => p?.name).filter(Boolean);
        if (names.length) syncValueAlertTopics(names);
      })
      .catch(() => {});
  }, [user?.id]);

  // ✅ "Values updated" broadcast push (topic value-updates): every install,
  // guest or signed in, unless switched off in Settings. Also makes a tap on
  // any value push open the Values screen. Both are fire-and-forget and
  // swallow their own errors, so they can never hold up or break startup.
  useEffect(() => {
    initValueNotificationTapHandlers();
    initValueUpdatesOnStartup();
    // The Android channel comment/like pushes name. Made up front so a push
    // that arrives in the background is high importance, not FCM's fallback.
    ensurePostChannel();
  }, []);

  // ✅ Handle flag setting based on user preference (saves Firebase data costs)
  useEffect(() => {
    if (!isAdmin && user?.id && appdatabase) {
      // ✅ Only set flag once per user.id to prevent infinite loop
      if (flagSetForUserRef.current !== user.id) {
        flagSetForUserRef.current = user.id;
        
        // ✅ Only store flag if user wants to show it (saves Firebase data costs)
        if (localState?.showFlag !== false) {
          // User wants to show flag - store it
          updateLocalStateAndDatabaseRef.current({ flage: getFlag() });
        }
        // If showFlag is false, don't store flag (saves data)
      } else {
        // ✅ Handle flag toggle changes after initial setup
        if (localState?.showFlag === false && user?.flage) {
          // ✅ User toggled flag off - remove it from Firebase to save data
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: null }).catch(() => {});
          setUser((prev) => ({ ...prev, flage: null }));
        } else if (localState?.showFlag !== false && !user?.flage) {
          // ✅ User toggled flag on - add it
          const flagValue = getFlag();
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: flagValue }).catch(() => {});
          setUser((prev) => ({ ...prev, flage: flagValue }));
        }
      }
    }
  }, [user?.id, isAdmin, localState?.showFlag, appdatabase, user?.flage]) // ✅ Check showFlag preference

  // ✅ Memoize resetUserState to prevent unnecessary re-renders
  const resetUserState = useCallback(() => {
    setUser({
      id: null,
      // selectedFruits: [],
      // isReminderEnabled: false,
      // isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      // rewardPoints: 0,
      isBlock: false,
      fcmToken: null,
      lastActivity: null,
      online: false,
      isPro: false,
      createdAt: null
    });
  }, []); // No dependencies, so it never re-creates

  // ── Failed-profile-read recovery (2026-10-13, from adoptme-jan7) ──
  //
  // When the login read of users/{uid} fails, handleUserLogin keeps the user
  // signed in on a stub profile (see its catch). Nothing used to re-run it
  // before the next auth change, so the stub (no roles, no admin, no stored
  // name) lasted the whole session. This waits for RTDB to report connected
  // (at once if it already is), backs off, and re-runs it for the same user.
  // A connected socket is not a fast one: retrying immediately on a slow
  // phone just timed out again, hence the growing delays.
  const handleUserLoginRef = useRef(null);
  const profileReloadRef = useRef({ uid: null, unsub: null, timer: null, runs: 0 });
  const cancelProfileReload = useCallback(() => {
    const pending = profileReloadRef.current;
    if (pending.unsub) {
      try { pending.unsub(); } catch (e) { /* noop */ }
      pending.unsub = null;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
  }, []);
  const reloadProfileWhenConnected = useCallback((uid) => {
    const pending = profileReloadRef.current;
    if (pending.uid !== uid) {
      pending.uid = uid;
      pending.runs = 0;
    }
    if (pending.unsub || pending.timer || pending.runs >= PROFILE_RELOAD_DELAYS.length) return;
    pending.unsub = onValue(ref(appdatabase, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      cancelProfileReload();
      pending.timer = setTimeout(() => {
        pending.timer = null;
        pending.runs += 1;
        if (auth.currentUser?.uid === uid) handleUserLoginRef.current?.(auth.currentUser, { reload: true });
      }, PROFILE_RELOAD_DELAYS[pending.runs]);
    }, () => { /* denied / offline → the next auth change retries */ });
  }, [cancelProfileReload]);

  // ✅ Memoize handleUserLogin
  // `options.reload` marks a background retry from reloadProfileWhenConnected.
  // (No destructured parameter default: Hermes rejects some of those.)
  const handleUserLogin = useCallback(async (loggedInUser, options) => {
    if (!loggedInUser) {
      resetUserState(); // No longer recreates resetUserState
      return;
    }
    const reload = !!(options && options.reload);
    const userId = loggedInUser.uid;
    try {
      const userRef = ref(appdatabase, `users/${userId}`);

      // 🔄 Fetch user data, capped. A hung socket used to hold this await
      // (and isAppReady behind it) forever. A read that fails or times out
      // throws to the catch below, which NEVER treats it as "no record":
      // only a successful read that finds nothing runs the new-user branch.
      // Reloads run behind the UI, not the splash, so they can wait longer.
      let readTimer = null;
      const snapshot = await Promise.race([
        get(userRef),
        new Promise((_, reject) => {
          readTimer = setTimeout(
            () => reject(new Error('read-timeout')),
            reload ? PROFILE_RELOAD_TIMEOUT_MS : PROFILE_READ_TIMEOUT_MS,
          );
        }),
      ]).finally(() => { if (readTimer) clearTimeout(readTimer); });

      // Signed out or switched account while the read was in flight: this
      // result belongs to nobody on screen any more.
      if (auth.currentUser?.uid !== userId) return;

      let userData;

      // Admin comes from the real RTDB role flag (`users/{uid}/admin`) — the
      // same field the badge pills and the roster functions read. The founder
      // emails stay ONLY as a bootstrap, so the first admin can always sign in
      // and grant the flag to others, and can never be locked out by a bad
      // write. Assigned unconditionally so a REVOKED flag actually clears
      // instead of surviving until the app is killed.
      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'sohailnasir74business@gmail.com' || loggedInUser.email === 'sohailnasir74@gmail.com';
      const existingSnap = snapshot.exists() ? snapshot.val() : null;
      setIsAdmin(makeadmin || existingSnap?.admin === true || existingSnap?.isAdmin === true);
      setCurrentuserEmail(loggedInUser.email)

      // The email staff need for moderation goes to users_private (owner +
      // staff only), never users/{uid}, which anyone can read. Fire-and-forget:
      // sign-in must never wait on, or fail because of, this write.
      saveOwnPrivateProfile(appdatabase, userId, { email: loggedInUser.email }).catch(() => {});

      // Record this device on the account (users_private/{uid}/deviceId) so
      // a later staff ban can lock the device too. Same fire-and-forget
      // contract: a failure only weakens the device ban, never sign-in.
      stampOwnDeviceId(appdatabase, userId).catch(() => {});

      if (snapshot.exists()) {
        // ⏳ USER EXISTS → Keep existing createdAt
        const existing = snapshot.val();
        userData = {
          ...existing,
          id: userId,
          createdAt: existing.createdAt || authCreatedAtMs(loggedInUser)   // fallback if missing (local only, never written)
        };

        // 🛡️ Fix: If displayName is empty/falsy, regenerate one and save it.
        // Safe to write: this is a SUCCESSFUL whole-node read, so an empty
        // name here really is empty (a failed read never reaches this line).
        if (!userData.displayName || !userData.displayName.trim()) {
          const newName = loggedInUser.displayName || generateOnePieceUsername() || 'Player';
          userData.displayName = newName;
          // Save the fixed displayName back to Firebase
          await update(userRef, { displayName: newName });
        }

      } else {
        // 🆕 NEW USER → Set createdAt once
        userData = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: authCreatedAtMs(loggedInUser)
        };

        // update() instead of set(): identical for a genuinely new node, but
        // if this branch is ever reached for an existing user it merges
        // instead of wiping the fields it does not carry (roles, createdAt…).
        await update(userRef, userData);
      }

      // A successful read replaces the stub (and its profileIncomplete flag).
      setUser(userData);
      if (reload) {
        logStartupTiming('profile_reload_ok', { runs: profileReloadRef.current.runs });
      }

      // (FCM token registration is NOT done here: the `user?.id` effect below
      // does it once. It used to run here, in that effect, AND after login in
      // onAuthStateChanged — three permission requests + getToken + RTDB reads
      // per launch, two of them awaited before the app was marked ready.)

    } catch (error) {
      // ⚠️ A failed profile read must NOT look like a logout.
      //
      // Firebase Auth still holds a valid session at this point — only the
      // RTDB round-trip failed (or hit the cap). An empty catch here used to
      // leave `user.id` null, so every screen rendered the signed-out UI and
      // popped the sign-in drawer ("I keep getting logged out").
      //
      // Keep the session alive using the identity we already have from the
      // auth record, and reload the real profile once RTDB is reachable.
      // NOTHING from this stub is ever written back: the name, join date and
      // roles stay as stored, and the next successful read replaces it.
      console.warn('[Auth] profile read failed, keeping session:', error?.message);
      if (auth.currentUser?.uid !== userId) return; // signed out meanwhile
      // The ban listener keys off the email, so it must run on the stub too.
      setCurrentuserEmail(loggedInUser.email);
      // A failed RELOAD keeps whatever profile is already on screen; only a
      // user with nothing loaded yet gets the stub.
      setUser((prev) => (prev?.id === userId ? prev : {
        id: userId,
        displayName: loggedInUser.displayName || 'Player',
        avatar: loggedInUser.photoURL || null,
        isBlock: false,
        fcmToken: null,
        lastActivity: null,
        online: false,
        isPro: false,
        createdAt: null,
        // Local state only. Fields are missing because they were not read,
        // not because the user lacks them: anything that would prompt for
        // or act on a missing field should wait while this is set.
        profileIncomplete: true,
      }));
      logStartupTiming('profile_reads_partial', { reload: reload ? 1 : 0 });
      reloadProfileWhenConnected(userId);
    }
  }, [appdatabase, resetUserState, reloadProfileWhenConnected]); // ✅ Uses memoized resetUserState
  useEffect(() => {
    handleUserLoginRef.current = handleUserLogin;
  }, [handleUserLogin]);
  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      try {
        console.log('Registering push token for user:', user.id);
        await registerForNotifications(user.id);
      } catch (e) {
        console.log('registerForNotifications error', e);
      }
    };

    run();
  }, [user?.id]);


  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      // A new auth state supersedes any profile reload queued for the old one.
      cancelProfileReload();

      // Enforce email verification ONLY for the email/password provider
      // (ported from adoptme-jan7, 2026-10-13). This listener fires with the
      // persisted session on every cold start and token refresh, and it used
      // to sign out EVERY emailVerified=false user, which also hit social
      // logins (Apple, and some Google accounts, report false).
      //
      // It also raced registration: SigninDrawer creates the account, then
      // sends the verification email, then signs out. Signing out under it
      // (Adopt Me measured 190 of 191 such sign-outs mid-session) stopped the
      // email or made the drawer's own signOut fail. So give the drawer a few
      // seconds, and only sign out a user who is still here: a restored
      // unverified session, or a drawer flow that failed part-way.
      const isPasswordUser = !!loggedInUser?.providerData?.some((p) => p?.providerId === 'password');
      if (loggedInUser && isPasswordUser && !loggedInUser.emailVerified) {
        const uid = loggedInUser.uid;
        setTimeout(() => {
          if (auth.currentUser?.uid !== uid) return; // the drawer already signed out
          if (auth.currentUser?.emailVerified) return; // verified meanwhile
          signOut(auth).catch(() => {});
        }, UNVERIFIED_SIGNOUT_GRACE_MS);
        return;
      }

      setTimeout(async () => {
        const _loginStartedAt = Date.now();
        try {
          // Swallows its own errors and caps its read, so this cannot hang.
          await handleUserLogin(loggedInUser);
        } finally {
          logStartupTiming('startup_profile_reads', { ms: Date.now() - _loginStartedAt });

          // Time-to-interactive: process start -> splash hide.
          logStartupTiming('startup_ready', { ms: Date.now() - _launchedAt });
          await updateLocalState('isAppReady', true);
        }
      }, 0);
    });

    return () => unsubscribe();
  }, []);



  // Launch config. Four root nodes that used to be read fresh on every cold
  // start; now served from a 6-hour MMKV cache (PLAN_2026-09.md F2). Values
  // change only when someone edits them in the Firebase console.
  useEffect(() => {
    let cancelled = false;

    const fetchAPIKeys = async () => {
      try {
        const cfg = await getConfigNodes(appdatabase, [
          'api',
          'free_translation',
          'single_offer_wall',
        ]);
        if (cancelled) return;

        if (cfg.api != null) setApi(cfg.api);
        if (cfg.free_translation != null) setFreeTranslation(cfg.free_translation);
        if (cfg.single_offer_wall != null) setSingle_offer_wall(cfg.single_offer_wall);
      } catch (error) {
        // Offline launch — screens fall back to their own defaults, and the
        // cache is deliberately not poisoned, so the next launch retries.
      }
    };

    fetchAPIKeys();
    return () => { cancelled = true; };
  }, []);

  // Fetch trading server link with 3 hour caching
  useEffect(() => {
    const fetchTradingServerLink = async () => {
      try {
        const ls = localStateRef.current;
        const lastServerFetch = ls.lastServerFetch ? new Date(ls.lastServerFetch).getTime() : 0;
        const now = Date.now();
        const timeElapsed = now - lastServerFetch;
        const EXPIRY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

        // Only fetch if expired or not cached
        if (timeElapsed > EXPIRY_LIMIT || !ls.tradingServerLink) {
          const serverRef = ref(appdatabase, 'server');
          const snapshot = await get(serverRef);

          if (snapshot.exists()) {
            const serverData = snapshot.val();
            const serverList = Object.entries(serverData).map(([id, value]) => ({ id, ...value }));
            const firstServer = serverList.length > 0 ? serverList[0] : null;
            const serverLink = firstServer?.link || null;

            if (serverLink) {
              setTradingServerLink(serverLink);
              await updateLocalStateRef.current('tradingServerLink', serverLink);
              await updateLocalStateRef.current('lastServerFetch', new Date().toISOString());
            }
          }
        } else {
          // Use cached link
          if (ls.tradingServerLink) {
            setTradingServerLink(ls.tradingServerLink);
          }
        }
      } catch (error) {
        console.error('Error fetching trading server link:', error);
        const ls = localStateRef.current;
        if (ls.tradingServerLink) {
          setTradingServerLink(ls.tradingServerLink);
        }
      }
    };

    if (appdatabase) {
      fetchTradingServerLink();
    }
  }, [appdatabase]); // ✅ Removed localState deps to prevent write→trigger→write loop

  const lastProWriteRef = useRef({ uid: null, isPro: undefined });
  const updateUserProStatus = () => {
    if (!user?.id || !appdatabase) {
      // console.error("User ID or database instance is missing!");
      return;
    }

    // Coerce to a real boolean before writing. set() THROWS synchronously on
    // undefined ("'value' must be defined") rather than returning a rejected
    // promise, and this runs inside a setTimeout — so an undefined isPro (a
    // localState that hasn't hydrated from MMKV yet) escaped the .catch() below
    // as an uncaught JS exception instead of a failed write.
    const isPro = localState?.isPro === true;

    // Skip redundant RTDB writes: previously this fired on every login and
    // every isPro change, almost always re-writing the value just fetched.
    const last = lastProWriteRef.current;
    if (last.uid === user.id && last.isPro === isPro) {
      return;
    }
    lastProWriteRef.current = { uid: user.id, isPro };

    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);

    set(userIsProRef, isPro)
      .then(() => {
      })
      .catch((error) => {
        // console.error("Error updating online status:", error);
      });
  };





  useEffect(() => {
    const t = setTimeout(() => {
      // checkInternetConnection();
      updateUserProStatus();
    }, 0);
    return () => clearTimeout(t);
  }, [user?.id, localState.isPro]);


  // Once per sign-in, after the user loads: on mount user.id is still empty,
  // so the RTDB write was skipped and no account had lastActivity
  // (functions/birthdays ranks today's birthdays by it).
  useEffect(() => {
    if (!user?.id) return;
    updateLocalStateAndDatabase('lastActivity', new Date().toISOString());
  }, [user?.id]);



  // const fetchStockData = async (refresh) => {
  //   try {
  //     setLoading(true);

  //     const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
  //     const now = Date.now();
  //     const timeElapsed = now - lastActivity;
  //     const EXPIRY_LIMIT = refresh ? 1 * 10 * 1000 : 1 * 6 * 60 * 1000; // 30 min or 6 hrs

  //     const shouldFetch =
  //       timeElapsed > EXPIRY_LIMIT ||
  //       !localState.data ||
  //       !Object.keys(localState.data).length ||
  //       !localState.imgurl;

  //     if (shouldFetch) {
  //       let data = {};
  //       let image = '';

  //       // ✅ First try to fetch `data` from Bunny CDN
  //       try {
  //         const dataRes = await fetch('https://adoptme.b-cdn.net');
  //         const dataJson = await dataRes.json();
  //         // console.log(dataJson)

  //         if (!dataJson || typeof dataJson !== 'object' || dataJson.error || !Object.keys(dataJson).length) {
  //           throw new Error('CDN returned invalid or error data');
  //         }

  //         data = dataJson;

  //         console.log('✅ Loaded data from Bunny CDN');
  //       } catch (err) {
  //         console.warn('⚠️ Failed to load from CDN, falling back to Firebase:', err.message);

  //         const xlsSnapshot = await get(ref(appdatabase, 'xlsData'));
  //         data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};
  //       }

  //       // ✅ Always fetch `image_url` from Firebase
  //       const imageSnapShot = await get(ref(appdatabase, 'image_url'));
  //       image = imageSnapShot.exists() ? imageSnapShot.val() : '';

  //       // ✅ Store in local state
  //       await updateLocalState('data', JSON.stringify(data));
  //       await updateLocalState('imgurl', JSON.stringify(image));
  //       await updateLocalState('lastActivity', new Date().toISOString());
  //     }

  //   } catch (error) {
  //     console.error("❌ Error fetching stock data:", error);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // ✅ Use ref for localState to keep fetchStockData stable across renders
  const localStateRef = useRef(localState);
  useEffect(() => { localStateRef.current = localState; }, [localState]);

  const fetchStockData = useCallback(async (refresh) => {
    let catalogRefreshed = true;
    try {
      setLoading(true);
      const ls = localStateRef.current;

      // Own key, not lastActivity. lastActivity is re-stamped on every launch
      // by the effect above, so it could never be older than a few ms -- which
      // made `timeElapsed > CACHE_TTL` unreachable and pinned every updated
      // install to whatever catalogue it had cached. A fresh install fetched
      // (no cache at all), an updated one never did, which is exactly why
      // Halloween showed on a clean emulator and not on a real update.
      //
      // Installs that predate this key have no value here, so they read as
      // epoch 0 and refetch once on next launch. That is the intended
      // migration: it is how they pick up the items they are missing.
      const fetchedAt = ls.valuesFetchedAt ? new Date(ls.valuesFetchedAt).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - fetchedAt;

      // Bunny is billed per GB served. The two catalogues are ~1.5 MB together
      // on every fetch, and they only change when the scraper runs — a few
      // times a day at most. The old 6-minute window meant a user who opened
      // the app ten times a day paid for ten downloads of identical bytes.
      //
      // So: cached for a day, and `refresh` (the pull-to-refresh / "Updated
      // just now" control) always goes to the network, because that is the
      // user explicitly asking for today's numbers.
      const CACHE_TTL = 24 * 60 * 60 * 1000;

      const hasCachedValues =
        usableCatalog(ls.data) && usableCatalog(ls.suprime);

      // `imgurl` is deliberately NOT part of this. It is a config node with a
      // default, cached separately, and MM2 may not publish one at all —
      // including it forced a full catalogue download on every single launch.
      const shouldFetch = Boolean(refresh) || !hasCachedValues || timeElapsed > CACHE_TTL;

      if (shouldFetch) {
        let image = '';
        const load = async url => unwrapFeed(await fetchCatalog(url));
        const catalogStartedAt = Date.now();
        const results = await Promise.all([
          refreshCatalog({
            load: () => load('https://mm2-api.b-cdn.net/data.json'), cached: ls.data,
            save: value => updateLocalStateRef.current('data', value), // object: stored once as JSON, kept parsed in state
            fallback: async () => {
              const snapshot = await get(ref(appdatabase, 'mm2Data'));
              return snapshot.exists() ? unwrapFeed(snapshot.val()) : null;
            },
          }),
          refreshCatalog({
            load: () => load('https://mm2api-suprime.b-cdn.net/supreme.json'), cached: ls.suprime,
            save: value => updateLocalStateRef.current('suprime', value), // object: stored once as JSON, kept parsed in state
            fallback: async () => {
              const snapshot = await get(ref(appdatabase, 'suprimeData'));
              return snapshot.exists() ? unwrapFeed(snapshot.val()) : null;
            },
          }),
        ]);
        catalogRefreshed = results.every(r => r.fresh);
        trackGrowthEvent('catalog_load_result', {
          duration_ms: Date.now() - catalogStartedAt,
          fresh_feeds: results.filter(r => r.fresh).length,
          available_feeds: results.filter(r => r.available).length,
          manual_refresh: refresh ? 1 : 0,
        });
        setCatalogStatus(results.every(r => r.fresh) ? 'ready' :
          results.some(r => r.available) ? 'cached' : 'unavailable');
        if (results.every(r => r.fresh)) {
          await updateLocalStateRef.current('valuesFetchedAt', new Date().toISOString());
        }

        // `image_url` may not exist in MM2 at all. Cached for 6 hours with the
        // other config nodes so a stock refresh (every 6 min) stops re-reading
        // a node that changes a few times a year.
        try {
          // `events` rides along with image_url on the same cached read, so the
          // seasonal-event config costs no extra round trip. Set it from the
          // Firebase console and every install picks the change up without an
          // app release — see Code/Engagement/eventConfig.js.
          const cfg = await withDeadline(() => getConfigNodes(appdatabase, ['image_url', 'events']));
          image = cfg.image_url || '';
          if (cfg.events && typeof cfg.events === 'object') {
            await updateLocalStateRef.current('events', cfg.events);
          }
        } catch (imgErr) {
          // absent or unreachable — empty string, same as before
        }

        if (image) await updateLocalStateRef.current('imgurl', JSON.stringify(image));
      }
    } catch (error) {
      catalogRefreshed = false;
      console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
    return catalogRefreshed;
  }, [appdatabase]); // ✅ Stable — only depends on appdatabase




  // console.log(user)

  // ✅ Run the function only if needed
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchStockData(); // ✅ Now runs after main thread is free
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  const reload = useCallback(() => {
    return fetchStockData(true);
  }, [fetchStockData]);

  // ── MM2 image index, for Supreme's art fallback ──
  // Keyed off localState.data rather than the fetch, because a cache hit
  // (6-minute window) skips fetchStockData entirely and the index still has to
  // exist. Supreme items carry a placeholder instead of an image path, so
  // resolveItemImage() looks them up here by name — see Helper/valueSources.js.
  useEffect(() => {
    try {
      const raw = localState?.data;
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      indexMM2Images(unwrapFeed(parsed));
    } catch (e) {
      // A malformed cache must not take the provider down; the index simply
      // stays empty and Supreme items fall back to no image.
    }
  }, [localState?.data]);

  // ── Supreme price index, for the calculator's source toggle ──
  // Same reasoning as above: keyed off the cached catalogue, not the fetch, so
  // a cache hit still populates it. Empty index → every item reads as "not
  // listed" on Supreme, which is honest rather than a silent zero.
  useEffect(() => {
    try {
      const raw = localState?.suprime;
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      indexSupremePrices(unwrapFeed(parsed));
    } catch (e) {
      // same rationale as the image index above
    }
  }, [localState?.suprime]);

  

  // ── Moderator ban/mute kill switch ──
  // One root listener for the whole session. Denied or offline → stays ON,
  // matching the documented default.
  useEffect(() => {
    if (!appdatabase) return;
    const unsub = onValue(
      ref(appdatabase, 'mod_controls_enabled'),
      (snap) => setModControlsEnabled(snap.val() !== false),
      () => { /* denied / offline → leave ON */ },
    );
    return () => { try { unsub(); } catch (e) { /* noop */ } };
    // appdatabase is a module-level constant, not a reactive value.
  }, []);

  // ── Delegated Junior-Mod grant permission ──
  // A single leaf listener, so a revoke reaches the device immediately rather
  // than at next login. Fails closed.
  useEffect(() => {
    if (!appdatabase || !user?.id) { setCanGrantJmd(false); return; }
    const unsub = onValue(
      ref(appdatabase, `jmd_granters/${user.id}`),
      (snap) => setCanGrantJmd(snap.exists() && snap.val() !== false),
      () => setCanGrantJmd(false),
    );
    return () => { try { unsub(); } catch (e) { /* noop */ } };
  }, [user?.id]);

  // ── Live role flags for the signed-in user ──
  // Two leaf listeners for the session, so a demoted moderator loses their
  // powers immediately instead of at next launch.
  useEffect(() => {
    if (!appdatabase || !user?.id) return;
    const uid = user.id;
    const unsubs = ['isModerator', 'isBabyMod'].map((flag) => onValue(
      ref(appdatabase, `users/${uid}/${flag}`),
      (snap) => {
        const v = !!(snap && snap.exists() && snap.val() === true);
        setUser((prev) => (prev && prev.id === uid && prev[flag] !== v ? { ...prev, [flag]: v } : prev));
      },
      () => { /* denied / offline → keep current value */ },
    ));
    return () => unsubs.forEach((u) => { try { u(); } catch (e) { /* noop */ } });
  }, [user?.id]);

  // ── Ban / mute enforcement, validated against SERVER time ──
  //
  // The device clock is not trusted anywhere here. Rolling it forward is the
  // standard way out of a timed ban and it defeats any Date.now() comparison.
  // `bannedUntil` is checked against a server-time probe, and the auto-clear
  // uses setTimeout (monotonic, immune to wall-clock changes). Returning to
  // the foreground re-probes, so a clock changed while backgrounded is caught.
  useEffect(() => {
    if (!currentUserEmail || !appdatabase) {
      setIsEmailBanned(false);
      setStrikeInfo(null);
      return;
    }

    const banRef = ref(appdatabase, `banned_users_by_email/${currentUserEmail.replace(/\./g, '(dot)')}`);

    let currentBan = null;
    let expiryTimer = null;
    let cancelled = false;

    const evaluate = async () => {
      if (cancelled) return;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      const banData = currentBan;
      if (!banData) { setIsEmailBanned(false); return; }

      const { bannedUntil } = banData;
      if (bannedUntil === 'permanent') { setIsEmailBanned(true); return; }
      if (typeof bannedUntil !== 'number') { setIsEmailBanned(false); return; }

      const serverNow = (await getServerTime(appdatabase, user?.id || currentUserEmail)).getTime();
      if (cancelled) return;

      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) { setIsEmailBanned(false); return; }

      setIsEmailBanned(true);
      // Cap at ~24h so a long ban never sits on a stale offset.
      expiryTimer = setTimeout(evaluate, Math.min(remaining, 24 * 60 * 60 * 1000));
    };

    const unsubscribe = onValue(banRef, (snapshot) => {
      currentBan = snapshot.val() || null;
      setStrikeInfo(currentBan);
      evaluate();
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluate();
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      appStateSub.remove();
      unsubscribe();
    };
  }, [currentUserEmail, user?.id]);

  // ── Device ban (ported from adoptme-jan7 2026-10-13) ──
  //
  // Closes "ban the email, sign up again on the same phone". Staff bans
  // write banned_devices/{fingerprint} (ChatScreen/utils.js), and every
  // account signed in on that device is held by isUserBlocked exactly like
  // an email ban. Same server-time validation as the email listener above.
  //
  // Signed-in only (Adopt Me also listens signed out): a signed-out user can
  // send nothing the gate protects, and it saves a listener on every
  // signed-out launch. A denied or failed read (rule not deployed yet,
  // offline) fails OPEN, so nobody is locked out by an error.
  useEffect(() => {
    const clear = () => { setIsDeviceBanned(false); setDeviceBanInfo(null); };
    if (!user?.id || !appdatabase) { clear(); return undefined; }

    let unsub = null;
    let appStateSub = null;
    let cancelled = false;
    let currentBan = null;
    let expiryTimer = null;

    const evaluate = async () => {
      if (cancelled) return;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      const data = currentBan;
      if (!data) { clear(); return; }

      const { bannedUntil } = data;
      if (bannedUntil === 'permanent') { setIsDeviceBanned(true); setDeviceBanInfo(data); return; }
      if (typeof bannedUntil !== 'number') { clear(); return; }

      const serverNow = (await getServerTime(appdatabase, user?.id || 'anon')).getTime();
      if (cancelled) return;

      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) { clear(); return; }

      setIsDeviceBanned(true);
      setDeviceBanInfo(data);
      expiryTimer = setTimeout(evaluate, Math.min(remaining, 24 * 60 * 60 * 1000));
    };

    getDeviceFingerprint().then((fp) => {
      if (cancelled) return;
      if (!fp) { clear(); return; }
      unsub = onValue(
        ref(appdatabase, `banned_devices/${fp}`),
        (snapshot) => {
          currentBan = snapshot.val() || null;
          evaluate();
        },
        () => { currentBan = null; clear(); },
      );
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') evaluate();
      });
    }).catch(() => clear());

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      if (appStateSub) appStateSub.remove();
      if (unsub) unsub();
    };
  }, [user?.id]);

  // ✅ Set up online status tracking using separate presence node (RTDB-only, optimized for scale)
  // ✅ Foreground-only presence (ACTIVE = online, background/inactive = offline)
  // ✅ Uses presence/{uid} instead of users/{uid}/online for better scalability
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const uid = user.id;
    const presenceRef = ref(appdatabase, `presence/${uid}`); // ✅ Separate presence node
    const connectedRef = ref(appdatabase, ".info/connected")

    let isConnected = false;
    let currentAppState = AppState.currentState; // 'active' | 'background' | 'inactive'
    let armedOnDisconnect = false;

    // (No local `user.online` any more: nothing reads it, and setting it made
    // `user` a new object — re-rendering every useGlobalState() consumer — on
    // each foreground/background switch and connection flap. Presence lives
    // in RTDB presence/{uid}.)

    const forceOffline = async () => {
      try {
        await set(presenceRef, false);
      } catch (e) {
        // log if you want: console.log("forceOffline error", e);
      }
    };

    let onDisconnectHandler = null;
    
    const armOnDisconnect = async () => {
      if (armedOnDisconnect) return;
      try {
        onDisconnectHandler = onDisconnect(presenceRef);
        await onDisconnectHandler.set(false);
        armedOnDisconnect = true;
      } catch (e) {
        // Handle error silently
      }
    };

    let running = false;
    let pending = false;
  
    const updatePresence = async () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;
  
      try {
        if (localState?.showOnlineStatus === false) {
          try { 
            if (onDisconnectHandler) {
              await onDisconnectHandler.cancel(); 
            }
          } catch {}
          armedOnDisconnect = false;
          await forceOffline();
          return;
        }
  
        if (!isConnected || currentAppState !== "active") {
          await forceOffline();
          return;
        }
  
        await armOnDisconnect();
        await set(presenceRef, true);
  
      } catch (e) {
        // console.log("updatePresence error", e);
      } finally {
        running = false;
  
        // ✅ if something changed while we were running, apply latest state once more
        if (pending) {
          pending = false;
          updatePresence();
        }
      }
    };
  
  

    // Listen to RTDB connection state
    const unsubConnected = onValue(connectedRef, (snap) => {
      isConnected = snap.val() === true;
      updatePresence();
    });

    // Listen to AppState changes
    const sub = AppState.addEventListener("change", (nextState) => {
      currentAppState = nextState;
      // immediately offline when background/inactive
      updatePresence();
    });

    // Initial sync
    updatePresence();

    return () => {
      // ✅ Cleanup: Mark user offline when component unmounts or user.id changes (logout)
      sub.remove();
      if (typeof unsubConnected === "function") unsubConnected();

      // ✅ Cancel onDisconnect handler if it exists
      if (onDisconnectHandler) {
        onDisconnectHandler.cancel().catch(() => {});
      }

      // ✅ Mark offline in RTDB (using closure to capture the old uid)
      // This ensures when user.id changes to null (logout), the previous user is marked offline
      set(presenceRef, false).catch(() => {});
    };
  }, [user?.id, appdatabase, localState?.showOnlineStatus]);



  // console.log(user)

  const contextValue = useMemo(
    () => ({
      user, auth,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      updateLocalStateAndDatabase,
      fetchStockData,
      loading,
      catalogStatus,
      freeTranslation,
      isAdmin,
      reload,
      robloxUsernameRef, api, currentUserEmail, single_offer_wall, tradingServerLink,
      isInActiveGame, // ✅ Game state for invite notifications
      setIsInActiveGame, // ✅ Set game state
      acceptedInviteRoom, // ✅ Accepted invite from toast
      setAcceptedInviteRoom, // ✅ Set accepted invite
      strikeInfo,          // raw ban payload — reason, strike count, expiry
      isUserBlocked,       // canonical gate, server-time validated: email ban OR device ban
      isEmailBanned,       // this account's own ban/mute is live
      isDeviceBanned,      // this device is under a live device ban
      deviceBanInfo,       // banned_devices row: originating email/userId, reason, expiry
      modControlsEnabled,  // moderator ban/mute kill switch
      canGrantJmd,         // delegated Junior-Mod grant permission
    }),
    [user, theme, loading, catalogStatus, api, freeTranslation, currentUserEmail, tradingServerLink, isInActiveGame, acceptedInviteRoom, isAdmin, single_offer_wall, fetchStockData, reload, updateLocalStateAndDatabase, strikeInfo, isUserBlocked, isEmailBanned, isDeviceBanned, deviceBanInfo, modControlsEnabled, canGrantJmd]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


