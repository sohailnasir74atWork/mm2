/**
 * manorBridge.js — the pure parts of the Lights Out Manor ↔ app bridge
 * (2026-10-30). No React, no native modules, so __tests__/manorGame.test.js
 * can cover them.
 *
 * The game (Code/Manor/game/manor.html) carries its own English text; the app
 * sends the user's language as `strings` (Code/Translation/*.json → "manor").
 * Placeholders are single-brace {name}: i18next only touches {{double}}, so
 * they reach the game unchanged and the game fills them in.
 */

// Every text key the game reads. Kept in step with EN in manor.html (the
// test checks both directions).
export const MANOR_KEYS = [
  'eyebrow', 'logo1', 'logo2', 'tag', 'play_random', 'skin_label', 'sound_on', 'sound_off', 'controls', 'easy', 'reveal', 'ready',
  'role_seeker', 'role_shadow', 'role_runner', 'short_seeker', 'short_shadow', 'short_runner',
  'mission_seeker', 'mission_shadow', 'mission_runner',
  'tip_seeker_1', 'tip_seeker_2', 'tip_shadow_1', 'tip_shadow_2', 'tip_runner_1', 'tip_runner_2',
  'obj_seeker', 'obj_runner', 'obj_runner_done', 'obj_shadow', 'accuse', 'accuse_name', 'eye', 'watcher',
  'toast_candle', 'toast_whisper', 'toast_token', 'toast_tokens_all', 'toast_task', 'toast_tasks_all', 'toast_seen',
  'room_ballroom', 'room_library', 'room_study', 'room_kitchen', 'room_hall', 'room_gallery',
  'win_title', 'lose_caught', 'lose_time',
  'res_seeker_win', 'res_seeker_wrong', 'res_seeker_time', 'res_runner_win', 'res_runner_caught', 'res_runner_time',
  'res_shadow_win', 'res_shadow_caught', 'res_shadow_time',
  'rar_common', 'rar_uncommon', 'rar_rare', 'rar_legendary', 'rar_exclusive', 'is_new',
  'crate_signin', 'signin_btn', 'signed_in', 'crate_capped', 'crate_too_fast', 'crate_error', 'crate_left', 'crate_frame',
  'how_title', 'how_step', 'how_next', 'how_go', 'how_skip', 'how_1_t', 'how_1_b', 'how_2_t', 'how_2_b', 'how_3_t', 'how_3_b', 'how_4_t', 'how_4_b',
  'practice', 'follow_arrow',
  'equip', 'equipped', 'menu', 'again', 'double', 'odds', 'paused', 'resume', 'quit',
  'skin_classic', 'skin_moth', 'skin_mint', 'skin_frost', 'skin_coral', 'skin_neon', 'skin_ember', 'skin_void',
];

export const SKIN_IDS = ['classic', 'moth', 'mint', 'frost', 'coral', 'neon', 'ember', 'void'];

// An interstitial may show before every Nth new round (owner plan 2026-10-30:
// at most one every 3 rounds; never during play, never a banner in the game).
export const ROUNDS_PER_INTERSTITIAL = 3;
export const shouldShowInterstitial = (roundsFinished, isPro) =>
  !isPro && roundsFinished > 0 && roundsFinished % ROUNDS_PER_INTERSTITIAL === 0;

/** The saved progress, cleaned (it comes back from MMKV and from the game). */
export function cleanSave(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const owned = Array.isArray(s.owned) ? [...new Set(s.owned.filter((id) => SKIN_IDS.includes(id)))] : [];
  if (!owned.includes('classic')) owned.unshift('classic');
  const roles = ['seeker', 'shadow', 'runner'];
  return {
    owned,
    equipped: owned.includes(s.equipped) ? s.equipped : 'classic',
    played: Math.max(0, Math.min(1e6, Math.floor(Number(s.played) || 0))),
    seenRoles: Array.isArray(s.seenRoles) ? s.seenRoles.filter((r) => roles.includes(r)) : [],
    sound: s.sound === true,
    howSeen: s.howSeen === true,
  };
}

/** Parse one message from the game; null when it is not ours. */
export function parseMessage(data) {
  let msg;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return null;
  }
  return msg && typeof msg === 'object' && typeof msg.type === 'string' ? msg : null;
}

// Game haptic names → react-native-haptic-feedback types.
export const HAPTIC_TYPES = {
  light: 'impactLight',
  medium: 'impactMedium',
  success: 'notificationSuccess',
  warning: 'notificationWarning',
  error: 'notificationError',
};

/** The window.__MANOR_INIT assignment ('<' escaped, so no string can close the tag). */
export const initScript = (init) => `window.__MANOR_INIT = ${JSON.stringify(init).replace(/</g, '\\u003c')}; true;`;

/**
 * The game page with its settings written in ahead of the game script.
 * Not injectedJavaScriptBeforeContentLoaded: on Android that ran AFTER the
 * page's inline script (seen 2026-10-30, react-native-webview 16.0.0), so the
 * game started with no language, no saved skins and the wrong insets.
 */
export const withInit = (html, init) => html.replace('<head>', `<head><script>${initScript(init)}</script>`);
