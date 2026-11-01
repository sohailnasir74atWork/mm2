/**
 * ManorScreen.jsx — Lights Out Manor, an original mini game (2026-10-30).
 *
 * The game is an HTML5 canvas page (Code/Manor/game/manor.html, packed into
 * manorGameHtml.js by `npm run manor:build`) running in react-native-webview.
 * It ships inside the app: no download, no remote code. This screen is the
 * frame around it:
 *   - writes the language strings, owned skins and settings into the page
 *     (window.__MANOR_INIT, see withInit);
 *   - crates (Phase 2): every round gets a server ticket (manorStart); a win
 *     asks the server to roll the crate (manorFinish), the video double asks
 *     manorDouble. Owned skins come from manor_players/{uid}; each new skin
 *     also lands in My Cosmetics as a frame (server side). Guests play, but
 *     crates need sign-in;
 *   - saves preferences the game reports (MMKV id 'manor': equipped skin,
 *     rounds played, roles seen, sound) — never ownership;
 *   - haptics, Android Back; the app going to the background pauses the
 *     round and silences the music and sounds (__manor.sleep);
 *   - ads only at natural breaks: an interstitial before at most every 3rd
 *     new round, a rewarded ad only when the player taps "open a 2nd crate".
 *     No banner on this screen (2026-07 accidental-clicks enforcement came
 *     from a banner inside a fast-tap game).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StatusBar, StyleSheet, AppState, BackHandler, I18nManager, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { showErrorMessage } from '../Helper/MessageHelper';
import InterstitialAdManager from '../Ads/IntAd';
import RewardedAdManager from '../Ads/RewardedAdManager';
import SignInDrawer from '../Firebase/SigninDrawer';
import { MyDarkTheme, MyLightTheme } from '../AppHelper/AppHelperFunction';
import MANOR_HTML from './manorGameHtml';
import {
  MANOR_KEYS, HAPTIC_TYPES, cleanSave, parseMessage, withInit, shouldShowInterstitial,
} from './manorBridge';
import { startRound, finishRound, doubleCrate, loadOwned } from './manorApi';

const BG = '#0a0d16';
const SAVE_KEY = 'progress';
const OWNED_WAIT_MS = 2500;

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'manor' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };
}
const readJSON = (key, fallback) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};
const writeJSON = (key, v) => { try { storage.set(key, JSON.stringify(v)); } catch (e) { /* next write retries */ } };
// The last server list per account, so the game opens at once next time.
const ownedKey = (uid) => `owned:${uid}`;

const ManorScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { user, firestoreDB, theme } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const web = useRef(null);
  const roundsRef = useRef(0);
  const ticketRef = useRef(null);
  const uid = user?.id || null;
  const selectedTheme = theme === 'dark' ? MyDarkTheme : MyLightTheme;
  const [owned, setOwned] = useState(() => (uid ? readJSON(ownedKey(uid), null) : ['classic']));
  const [signinVis, setSigninVis] = useState(false);

  const call = useCallback((js) => web.current?.injectJavaScript(`try{${js}}catch(e){}; true;`), []);
  const send = useCallback((fn, arg, extra) => call(`window.__manor && window.__manor.${fn}(${JSON.stringify(arg ?? null)}${extra ? `, ${JSON.stringify(extra)}` : ''})`), [call]);

  // Owned skins from the server; the cached list (if any) opens the game at once.
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    const timer = setTimeout(() => { if (alive) setOwned((o) => o || ['classic']); }, OWNED_WAIT_MS);
    loadOwned(firestoreDB, uid).then((list) => {
      if (!alive || !list) return;
      writeJSON(ownedKey(uid), list);
      setOwned(list);
      send('setAccount', { signedIn: true, owned: list });
    });
    return () => { alive = false; clearTimeout(timer); };
  }, [uid, firestoreDB, send]);

  // Built once, when the owned list is known: settings go into the page ahead
  // of the game script (see withInit for why not injectedJavaScriptBeforeContentLoaded).
  const html = useMemo(() => {
    if (!owned) return null;
    const strings = {};
    for (const k of MANOR_KEYS) {
      const v = t(`manor.${k}`, { defaultValue: '' });
      if (v) strings[k] = v;
    }
    const prefs = cleanSave(readJSON(SAVE_KEY, {}));
    // insetsHandled: this View pads the system bars, so the page must not pad them again.
    return withInit(MANOR_HTML, {
      lang: i18n.language, rtl: I18nManager.isRTL, insetsHandled: true, debug: __DEV__, strings,
      ...prefs, owned, equipped: owned.includes(prefs.equipped) ? prefs.equipped : 'classic', signedIn: !!uid,
    });
    // Only the first known list builds the page; later lists go in through setAccount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!owned]);

  useEffect(() => {
    RewardedAdManager.prepare?.();
    // Background: pause the round and silence music + sounds; back: sound resumes.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') call('window.__manor && (window.__manor.pause(), window.__manor.sleep(true))');
      else call('window.__manor && window.__manor.sleep(false)');
    });
    return () => sub.remove();
  }, [call]);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (signinVis) return false;
      call('window.__manor && window.__manor.back()');
      return true; // the game posts 'exit' when Back is pressed on its menu
    });
    return () => sub.remove();
  }, [call, signinVis]));

  const onMessage = useCallback(async (e) => {
    const msg = parseMessage(e.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'save':
        writeJSON(SAVE_KEY, cleanSave(msg));
        break;
      case 'haptic':
        if (HAPTIC_TYPES[msg.kind]) triggerHapticFeedback(HAPTIC_TYPES[msg.kind]);
        break;
      case 'round_start': {
        ticketRef.current = null;
        if (!uid) break;
        const r = await startRound(String(msg.role || ''));
        if (r.roundId) { ticketRef.current = r.roundId; send('ticket', r.roundId); }
        break;
      }
      case 'round_end': {
        roundsRef.current += 1;
        trackGrowthEvent('manor_round', { role: String(msg.role || ''), win: msg.win ? 1 : 0, secs: Number(msg.secs) || 0 });
        if (!uid) break;
        const roundId = ticketRef.current;
        ticketRef.current = null;
        if (!roundId) { if (msg.win) send('crate', { error: 'generic' }); break; }
        const r = await finishRound(roundId, !!msg.win);
        if (msg.win) {
          send('crate', r);
          if (r.crate && r.crate.isNew) setOwned((o) => { const next = [...new Set([...(o || []), r.crate.skin])]; writeJSON(ownedKey(uid), next); return next; });
          if (r.crate) trackGrowthEvent('manor_crate', { rarity: r.crate.rarity, isNew: r.crate.isNew ? 1 : 0 });
        }
        break;
      }
      case 'request_next': {
        const go = () => call('window.__manor && window.__manor.proceed()');
        if (shouldShowInterstitial(roundsRef.current, localState?.isPro)) InterstitialAdManager.showAd(go, go, 'manor_round');
        else go();
        break;
      }
      case 'rewarded_request': {
        let ok = false;
        if (localState?.isPro) ok = true;
        else {
          const r = await RewardedAdManager.showForResult();
          ok = r === 'earned';
          if (r === 'unavailable') showErrorMessage(t('manor_app.ad_title'), t('manor_app.ad_unavailable'));
        }
        call(`window.__manor && window.__manor.rewarded(${ok ? 'true' : 'false'})`);
        if (!ok || !uid) break;
        trackGrowthEvent('manor_double_crate', {});
        const r = await doubleCrate(String(msg.roundId || ''));
        send('crate', r, { double: true });
        if (r.crate && r.crate.isNew) setOwned((o) => { const next = [...new Set([...(o || []), r.crate.skin])]; writeJSON(ownedKey(uid), next); return next; });
        break;
      }
      case 'signin':
        setSigninVis(true);
        break;
      case 'exit':
        navigation.goBack();
        break;
      default:
        break;
    }
  }, [call, send, uid, localState?.isPro, navigation, t, triggerHapticFeedback]);

  return (
    <View style={[styles.flex1, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {html ? (
        <WebView
          ref={web}
          style={styles.web}
          source={{ html }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          textZoom={100}
          // The game has no links; anything that tries to navigate away stays put.
          onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
          androidLayerType="hardware"
          webviewDebuggingEnabled={__DEV__}
          accessibilityLabel={t('manor_app.title')}
        />
      ) : (
        <ActivityIndicator style={styles.flex1} color="#ffb547" />
      )}
      {/* Crates need an account. When this closes signed in, the effect above
          re-reads the owned list and tells the game (setAccount). */}
      <SignInDrawer visible={signinVis} onClose={() => setSigninVis(false)} selectedTheme={selectedTheme} screen="Manor" message={t('manor.crate_signin')} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
});

export default ManorScreen;
