/**
 * manorApi.js — Lights Out Manor server calls (2026-10-30, Phase 2).
 *
 * Crates are rolled by functions/manor (HTTPS + Firebase ID token, like
 * FantasyLeague/fantasyApi.js). Owned skins are read from
 * manor_players/{uid}, which only the functions write (firestore.rules
 * managed()). Results go straight back to the game: { crate, left } or
 * { error } — the game words every case.
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { doc, getDoc } from '@react-native-firebase/firestore';

const FUNCTIONS_URL = 'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net';
const KNOWN_ERRORS = new Set(['sign_in', 'bad_role', 'no_round', 'too_fast', 'expired', 'capped', 'generic']);

async function call(name, body) {
  const user = getAuth().currentUser;
  if (!user) return { error: 'sign_in' };
  try {
    const token = await getIdToken(user);
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json) return json;
    const code = json && json.error;
    return { error: KNOWN_ERRORS.has(code) ? code : 'generic' };
  } catch (e) {
    return { error: 'generic' };
  }
}

export const startRound = (role) => call('manorStart', { role });
export const finishRound = (roundId, win) => call('manorFinish', { roundId, win: !!win });
export const doubleCrate = (roundId) => call('manorDouble', { roundId });

/** Skins this player owns (server record), or null when it could not be read. */
export async function loadOwned(db, uid) {
  if (!db || !uid) return ['classic'];
  try {
    const snap = await getDoc(doc(db, 'manor_players', uid));
    const owned = snap.exists() ? snap.data().owned : null;
    return Array.isArray(owned) && owned.length ? owned : ['classic'];
  } catch (e) {
    return null;
  }
}
