/**
 * configCache.js — MMKV cache for the small, rarely-changing RTDB config nodes
 * the app reads at launch.
 *
 * 📅 2026-09-05 (PLAN_2026-09.md F2). `api`, `free_translation`,
 * `single_offer_wall` and `image_url` were read fresh on every cold start.
 * The production profile counted ~102 reads per 10 minutes for each of them —
 * one per launch, four blocking round-trips before the first screen paints.
 * `server` already cached for 3 hours and is the pattern copied here.
 *
 * These values change when someone edits them in the Firebase console, which
 * is a handful of times a year. A 6-hour TTL is generous.
 */

import { ref, get } from '@react-native-firebase/database';

let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'config-cache' });
} catch (e) {
  console.warn('[configCache] MMKV not available:', e.message);
  store = { getString: () => undefined, set: () => {}, delete: () => {} };
}

const TTL = 6 * 60 * 60 * 1000; // 6 hours

const read = (node) => {
  try {
    const raw = store.getString(`cfg_${node}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) return undefined;
    return parsed.v;
  } catch {
    return undefined;
  }
};

const write = (node, value) => {
  try {
    store.set(`cfg_${node}`, JSON.stringify({ v: value, t: Date.now() }));
  } catch {
    // cache is optional
  }
};

/**
 * Fetch several root config nodes at once, serving whatever is still fresh
 * from MMKV and reading only the rest from RTDB.
 *
 * A node that exists but holds `null`/`false` is a legitimate value and is
 * cached as such — hence the `undefined` sentinel rather than a falsy check,
 * which would have made `single_offer_wall: false` re-read every launch.
 *
 * @param {object} db     RTDB instance
 * @param {string[]} nodes root-level node names
 * @returns {Promise<Object>} { [node]: value } — value is null when absent
 */
export const getConfigNodes = async (db, nodes) => {
  const out = {};
  const missing = [];

  for (const node of nodes) {
    const cached = read(node);
    if (cached !== undefined) out[node] = cached;
    else missing.push(node);
  }

  if (missing.length === 0 || !db) return out;

  const snaps = await Promise.all(
    missing.map((node) => get(ref(db, node)).catch(() => null)),
  );

  missing.forEach((node, i) => {
    const snap = snaps[i];
    // A failed read (snap === null) must NOT be cached — otherwise one
    // offline launch pins a missing config for six hours.
    if (!snap) { out[node] = null; return; }
    const value = snap.exists() ? snap.val() : null;
    out[node] = value;
    write(node, value);
  });

  return out;
};

/** Drop every cached config node. For a pull-to-refresh or a debug menu. */
export const clearConfigCache = (nodes = []) => {
  try {
    nodes.forEach((n) => store.delete(`cfg_${n}`));
  } catch {
    // ignore
  }
};
