import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue, remove, query, orderByValue, equalTo } from '@react-native-firebase/database';
import { getFirestore, doc, onSnapshot, getDoc } from '@react-native-firebase/firestore';
import { syncValueAlertTopics } from './Helper/valueAlerts';
import { createNewUser, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, AppState } from 'react-native';
import { getFlag } from './Helper/CountryCheck';
import { getConfigNodes } from './Helper/configCache';
import { indexMM2Images, indexSupremePrices, unwrapFeed } from './Helper/valueSources';
import { getServerTime } from './Helper/serverTime';
import { generateOnePieceUsername } from './Helper/RendomNamegen';



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
  // Canonical gate. Every send/post path should read THIS, not strikeInfo,
  // because it is validated against server time rather than the device clock.
  const [isUserBlocked, setIsUserBlocked] = useState(false);
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

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      resetUserState(); // No longer recreates resetUserState
      return;
    }
    try {
      const userId = loggedInUser.uid;
      const userRef = ref(appdatabase, `users/${userId}`);


      // 🔄 Fetch user data
      const snapshot = await get(userRef);
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

      if (snapshot.exists()) {
        // ⏳ USER EXISTS → Keep existing createdAt
        const existing = snapshot.val();
        userData = {
          ...existing,
          id: userId,
          createdAt: existing.createdAt || Date.now()   // fallback if missing
        };

        // 🛡️ Fix: If displayName is empty/falsy, regenerate one and save it
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
          createdAt: Date.now()
        };

        await set(userRef, userData);
      }

      setUser(userData);

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId)]);

    } catch (error) {
      // ⚠️ A failed profile read must NOT look like a logout.
      //
      // Firebase Auth still holds a valid session at this point — only the
      // RTDB round-trip failed. Previously this catch was empty, so `user.id`
      // stayed null, every screen rendered the signed-out UI and popped the
      // sign-in drawer. That is the "I keep getting logged out" report, and it
      // hits hardest wherever firebaseio.com is slow or throttled.
      //
      // Keep the session alive using the identity we already have from the
      // auth record. Fields we could not read stay at their defaults and get
      // filled in by the next successful read.
      console.warn('[Auth] profile read failed, keeping session:', error?.message);
      setUser((prev) => (prev?.id === loggedInUser.uid ? prev : {
        id: loggedInUser.uid,
        displayName: loggedInUser.displayName || 'Player',
        avatar: loggedInUser.photoURL || null,
        isBlock: false,
        fcmToken: null,
        lastActivity: null,
        online: false,
        isPro: false,
        createdAt: null,
      }));
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState
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
      if (loggedInUser && !loggedInUser.emailVerified) {
        await auth.signOut();
        // showErrorMessage("Email Not Verified", "Please check your inbox and verify your email.");
        return;
      }

      setTimeout(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
        }

        await updateLocalState('isAppReady', true);
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
    if (!user?.id) {
      // console.error("User ID or database instance is missing!");
      return;
    }

    // Skip redundant RTDB writes: previously this fired on every login and
    // every isPro change, almost always re-writing the value just fetched.
    const last = lastProWriteRef.current;
    if (last.uid === user.id && last.isPro === localState?.isPro) {
      return;
    }
    lastProWriteRef.current = { uid: user.id, isPro: localState?.isPro };

    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);

    set(userIsProRef, localState?.isPro)
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


  useEffect(() => {
    // console.log("🕓 Saving lastActivity:", new Date().toISOString());
    updateLocalStateAndDatabase('lastActivity', new Date().toISOString());
  }, []);



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
    try {
      setLoading(true);
      const ls = localStateRef.current;

      const lastActivity = ls.lastActivity ? new Date(ls.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;

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
        ls.data && Object.keys(ls.data).length &&
        ls.suprime && Object.keys(ls.suprime).length;

      // `imgurl` is deliberately NOT part of this. It is a config node with a
      // default, cached separately, and MM2 may not publish one at all —
      // including it forced a full catalogue download on every single launch.
      const shouldFetch = Boolean(refresh) || !hasCachedValues || timeElapsed > CACHE_TTL;

      if (shouldFetch) {
        let data = {};
        let suprime = {};
        let image = '';

        // ✅ MM2 CDN URLs
        // Both zones serve the pipeline's dist build, wrapped as { meta, data }
        // — meta carries generatedAt and the observed/modeled/none counts.
        // The filename differs per zone: MM2 publishes dist/data.json, Supreme
        // publishes dist/supreme.json. unwrap() also accepts a bare categories
        // object, so an older raw upload still works if one is restored.
        //
        // These moved twice on 2026-09-13 (mm2values.json -> mm2.json ->
        // data.json). A shipped build cannot be re-pointed, so if they move
        // again, keep the old path alive on the zone as a copy.
        const suprimeUrl = 'https://mm2api-suprime.b-cdn.net/supreme.json';
        const cdnUrl = 'https://mm2-api.b-cdn.net/data.json';

        const loadFromCdn = async (url) => {
          const res = await fetch(url, { method: 'GET', cache: 'no-store' });
          // Bunny answers a missing file with a 200-looking HTML error page on
          // some zones and a 404 on others. Check the status before parsing.
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const payload = unwrapFeed(await res.json());
          // Validate AFTER unwrapping. `{ meta, data }` has two keys, so the
          // old top-level length check passed even when `data` was empty.
          if (!payload || typeof payload !== 'object' || payload.error || !Object.keys(payload).length) {
            throw new Error('CDN returned invalid or error data');
          }
          return payload;
        };

        // Fetched independently, and that is the point. Until 2026-09-13 both
        // shared one try block while the Supreme URL 404'd, so parsing its HTML
        // body threw *after* MM2 had already succeeded — discarding good MM2
        // data and falling back to Firebase on every refresh.
        const [mm2Result, suprimeResult] = await Promise.allSettled([
          loadFromCdn(cdnUrl),
          loadFromCdn(suprimeUrl),
        ]);

        if (mm2Result.status === 'fulfilled') {
          data = mm2Result.value;
          console.log('✅ Loaded MM2 data from CDN:', cdnUrl);
        } else {
          console.warn('⚠️ MM2 CDN failed, falling back to Firebase:', mm2Result.reason?.message);
          const dbSnapshot = await get(ref(appdatabase, 'mm2Data'));
          data = dbSnapshot.exists() ? dbSnapshot.val() : {};
        }

        if (suprimeResult.status === 'fulfilled') {
          suprime = suprimeResult.value;
          console.log('✅ Loaded Supreme data from CDN:', suprimeUrl);
        } else {
          console.warn('⚠️ Supreme CDN failed, falling back to Firebase:', suprimeResult.reason?.message);
          const suprimeSnapshot = await get(ref(appdatabase, 'suprimeData'));
          suprime = suprimeSnapshot.exists() ? suprimeSnapshot.val() : {};
        }

        // `image_url` may not exist in MM2 at all. Cached for 6 hours with the
        // other config nodes so a stock refresh (every 6 min) stops re-reading
        // a node that changes a few times a year.
        try {
          const cfg = await getConfigNodes(appdatabase, ['image_url']);
          image = cfg.image_url || '';
        } catch (imgErr) {
          // absent or unreachable — empty string, same as before
        }

        // ✅ Store in local state
        await updateLocalStateRef.current('data', JSON.stringify(data));
        await updateLocalStateRef.current('suprime', JSON.stringify(suprime));
        if (image) await updateLocalStateRef.current('imgurl', JSON.stringify(image));
        await updateLocalStateRef.current('lastActivity', new Date().toISOString());
      }
    } catch (error) {
      console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
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
    fetchStockData(true);
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
      setIsUserBlocked(false);
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
      if (!banData) { setIsUserBlocked(false); return; }

      const { bannedUntil } = banData;
      if (bannedUntil === 'permanent') { setIsUserBlocked(true); return; }
      if (typeof bannedUntil !== 'number') { setIsUserBlocked(false); return; }

      const serverNow = (await getServerTime(appdatabase, user?.id || currentUserEmail)).getTime();
      if (cancelled) return;

      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) { setIsUserBlocked(false); return; }

      setIsUserBlocked(true);
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

    const setLocalOnline = (val) => {
      setUser((prev) => (prev?.id ? { ...prev, online: val } : prev));
    };

    const forceOffline = async () => {
      try {
        await set(presenceRef, false);
      } catch (e) {
        // log if you want: console.log("forceOffline error", e);
      }
      setLocalOnline(false);
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
        setLocalOnline(true);
  
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
      setLocalOnline(false);
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
      freeTranslation,
      isAdmin,
      reload,
      robloxUsernameRef, api, currentUserEmail, single_offer_wall, tradingServerLink,
      isInActiveGame, // ✅ Game state for invite notifications
      setIsInActiveGame, // ✅ Set game state
      acceptedInviteRoom, // ✅ Accepted invite from toast
      setAcceptedInviteRoom, // ✅ Set accepted invite
      strikeInfo,          // raw ban payload — reason, strike count, expiry
      isUserBlocked,       // canonical gate, server-time validated
      modControlsEnabled,  // moderator ban/mute kill switch
      canGrantJmd,         // delegated Junior-Mod grant permission
    }),
    [user, theme, loading, api, freeTranslation, currentUserEmail, tradingServerLink, isInActiveGame, acceptedInviteRoom, isAdmin, single_offer_wall, fetchStockData, reload, updateLocalStateAndDatabase, strikeInfo, isUserBlocked, modControlsEnabled, canGrantJmd]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


