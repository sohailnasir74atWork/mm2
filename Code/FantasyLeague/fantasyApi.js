/**
 * fantasyApi.js — Fantasy League server calls and reads (2026-10-30).
 *
 * Writes go through the HTTPS functions in functions/fantasy (fetch + the
 * Firebase ID token, like Birthdays/birthdayApi.js): the server stamps every
 * value and does all the scoring, so nothing a player sends can set a score.
 * Firestore rules refuse client writes to every fantasy_* collection.
 *
 * Reads are plain Firestore document reads, made when the screen opens or
 * is pulled to refresh — no listeners:
 *   fantasy_rounds/{week}            pool, top 100, players (1 read)
 *   fantasy_rounds/{week}/entries/{uid}   your team (1 read)
 *   fantasy_seasons/{id} + players/{uid}  season table and your total (2 reads, Season tab)
 *   fantasy_guess where status == open    Guess the Value (1 query, Guess tab)
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import {
  doc, getDoc, collection, query, where, orderBy, limit, getDocs,
} from '@react-native-firebase/firestore';
import { ref, set } from '@react-native-firebase/database';

// Same base as Helper/imageUpload.js and Birthdays/birthdayApi.js.
const FUNCTIONS_URL = 'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net';

const ERROR_CODES = new Set([
  'sign_in', 'no_round', 'closed', 'bad_picks', 'already_joined', 'not_joined',
  'no_swaps', 'bad_guess', 'no_guess', 'already_guessed', 'banned', 'try_later', 'generic',
]);

export class FantasyError extends Error {
  constructor(code) {
    super(code);
    this.code = ERROR_CODES.has(code) ? code : 'generic';
  }
}

async function call(name, body) {
  const user = getAuth().currentUser;
  if (!user) throw new FantasyError('sign_in');
  let res;
  try {
    const token = await getIdToken(user);
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new FantasyError('try_later');
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  if (!res.ok) throw new FantasyError((json && json.error) || (res.status === 404 ? 'no_round' : 'generic'));
  return json || {};
}

/** picks: [{ k, dir }] × 5 → { entry } */
export const joinRound = (round, picks, captain) => call('fantasyJoin', { round, picks, captain });

/** → { entry } */
export const swapPick = (round, out, inKey, dir, extra) => call('fantasySwap', { round, out, in: inKey, dir, extra: !!extra });

/** → { guess } */
export const submitGuess = (id, guess) => call('fantasyGuess', { id, guess });

const data = (snap) => (snap && snap.exists() ? snap.data() : null);

export async function loadRound(db, roundId, uid) {
  const roundRef = doc(db, 'fantasy_rounds', roundId);
  const [round, entry] = await Promise.all([
    getDoc(roundRef).then(data),
    uid ? getDoc(doc(db, 'fantasy_rounds', roundId, 'entries', uid)).then(data) : Promise.resolve(null),
  ]);
  return { round, entry };
}

export async function loadSeason(db, seasonId, uid) {
  if (!seasonId) return { season: null, me: null };
  const [season, me] = await Promise.all([
    getDoc(doc(db, 'fantasy_seasons', seasonId)).then(data),
    uid ? getDoc(doc(db, 'fantasy_seasons', seasonId, 'players', uid)).then(data) : Promise.resolve(null),
  ]);
  return { season, me };
}

/** Open challenges plus the last few settled ones, and the caller's own guesses. */
export async function loadGuesses(db, uid) {
  const [openSnap, doneSnap] = await Promise.all([
    getDocs(query(collection(db, 'fantasy_guess'), where('status', '==', 'open'), limit(20))),
    // Only settled challenges carry resolvedAt, so ordering by it alone finds
    // them with the automatic single-field index (no composite index).
    getDocs(query(collection(db, 'fantasy_guess'), orderBy('resolvedAt', 'desc'), limit(5))).catch(() => null),
  ]);
  const open = [];
  openSnap.forEach((d) => open.push(d.data()));
  open.sort((a, b) => (a.closesAt || 0) - (b.closesAt || 0));
  const done = [];
  if (doneSnap) doneSnap.forEach((d) => { if (d.data().status === 'final') done.push(d.data()); });
  const mine = {};
  if (uid) {
    await Promise.all([...open, ...done].map(async (g) => {
      const e = data(await getDoc(doc(db, 'fantasy_guess', g.id, 'entries', uid)).catch(() => null));
      if (e) mine[g.id] = e;
    }));
  }
  return { open, done, mine };
}

/** League pushes on/off (functions/fantasy/core.js pushTo reads this). */
export const setLeagueAlerts = (rtdb, uid, on) => set(ref(rtdb, `users/${uid}/notificationSettings/fantasyAlerts`), !!on);
