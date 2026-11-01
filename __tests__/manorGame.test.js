/**
 * Lights Out Manor (Code/Manor/*): the bundled game is in step with its
 * source, the app and the game agree on every text key, and the bridge
 * helpers behave.
 */
import fs from 'fs';
import path from 'path';
import MANOR_HTML from '../Code/Manor/manorGameHtml';
import { MANOR_FRAMES, ALL_ITEMS, getItemsByRarity, RARITY } from '../Code/Engagement/shopItems';
import {
  MANOR_KEYS, SKIN_IDS, cleanSave, parseMessage, initScript, withInit, shouldShowInterstitial, HAPTIC_TYPES,
} from '../Code/Manor/manorBridge';

const SRC = fs.readFileSync(path.join(__dirname, '../Code/Manor/game/manor.html'), 'utf8');
// Evaluate the game's EN object itself (a regex over it also matched "jobs:" inside a sentence).
const enKeys = () => {
  const start = SRC.indexOf('const EN = {') + 'const EN = '.length;
  const end = SRC.indexOf('};', start) + 1;
  // eslint-disable-next-line no-new-func
  return Object.keys(Function(`return ${SRC.slice(start, end)}`)());
};

describe('bundled game', () => {
  it('manorGameHtml.js matches manor.html (run npm run manor:build)', () => {
    expect(MANOR_HTML).toBe(SRC);
  });
  it('makes no network requests', () => {
    expect(SRC).not.toMatch(/<link[^>]+href=|<script[^>]+src=|fetch\(|XMLHttpRequest|https?:\/\/(?!www\.w3\.org)/);
  });
  it('app keys and game keys are the same set', () => {
    expect([...MANOR_KEYS].sort()).toEqual(enKeys().sort());
  });
  it('every skin in the game is a known skin', () => {
    const ids = [...SRC.matchAll(/\{ id: "(\w+)", rarity:/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...SKIN_IDS].sort());
  });
  it('every language has every key, with the same placeholders as English', () => {
    const dir = path.join(__dirname, '../Code/Translation');
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')).manor;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).manor || {};
      for (const k of MANOR_KEYS) {
        expect([f, k, typeof m[k]]).toEqual([f, k, 'string']);
        const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
        expect([f, k, ph(m[k])]).toEqual([f, k, ph(en[k])]);
      }
    }
  });
});

describe('crates: game, server and My Cosmetics agree', () => {
  const server = require('../functions/manor/logic');
  it('the game rarities and odds are the server ones', () => {
    const gameSkins = [...SRC.matchAll(/\{ id: "(\w+)", rarity: "(\w+)"/g)].map((m) => [m[1], m[2]]);
    expect(gameSkins).toEqual(server.SKINS.map((k) => [k.id, k.rarity]));
    const gameOdds = [...SRC.matchAll(/\{ id: "(\w+)", w: (\d+), c:/g)].map((m) => [m[1], Number(m[2])]);
    expect(gameOdds).toEqual(server.ODDS);
  });
  it('every skin has its frame in the catalogue, matching the server record', () => {
    for (const k of server.SKINS) {
      const f = MANOR_FRAMES[`manor_${k.id}`];
      expect(f).toBeTruthy();
      expect([f.rarity, f.borderColors, f.borderWidth, f.glowColor, f.duration]).toEqual([k.rarity, k.borderColors, k.borderWidth, k.glowColor, -1]);
      expect(Object.values(RARITY)).toContain(f.rarity);
    }
  });
  it('Manor frames never drop from Mystery Eggs', () => {
    for (const id of Object.keys(MANOR_FRAMES)) expect(ALL_ITEMS[id]).toBeUndefined();
    for (const r of Object.values(RARITY)) expect(getItemsByRarity(r).some((i) => i.source === 'manor')).toBe(false);
  });
  it('every language names every frame', () => {
    const dir = path.join(__dirname, '../Code/Translation');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const items = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).cosmetics.items;
      for (const id of Object.keys(MANOR_FRAMES)) expect([f, id, typeof items[id]]).toEqual([f, id, 'string']);
    }
  });
});

describe('bridge helpers', () => {
  it('cleanSave keeps known skins, always owns classic, falls back to classic', () => {
    expect(cleanSave(null)).toEqual({ owned: ['classic'], equipped: 'classic', played: 0, seenRoles: [], sound: false, howSeen: false });
    expect(cleanSave({ owned: ['void', 'hack', 'void'], equipped: 'hack', played: '4.7', seenRoles: ['seeker', 'boss'], sound: true }))
      .toEqual({ owned: ['classic', 'void'], equipped: 'classic', played: 4, seenRoles: ['seeker'], sound: true, howSeen: false });
    expect(cleanSave({ owned: ['classic', 'ember'], equipped: 'ember' }).equipped).toBe('ember');
  });
  it('parseMessage', () => {
    expect(parseMessage('{"type":"save"}')).toEqual({ type: 'save' });
    expect(parseMessage('nope')).toBe(null);
    expect(parseMessage('{"x":1}')).toBe(null);
  });
  it('interstitial at most every 3 rounds, never for Pro', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => shouldShowInterstitial(n, false))).toEqual([false, false, true, false, false, true]);
    expect(shouldShowInterstitial(3, true)).toBe(false);
    expect(shouldShowInterstitial(0, false)).toBe(false);
  });
  it('initScript cannot break out of the script tag', () => {
    const s = initScript({ strings: { tag: '</script><b>' } });
    expect(s).not.toContain('</script>');
    expect(s.startsWith('window.__MANOR_INIT = ')).toBe(true);
  });
  it('withInit puts the settings before the game script', () => {
    const page = withInit(SRC, { insetsHandled: true });
    const at = page.indexOf('window.__MANOR_INIT = ');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(page.indexOf('const INIT = window.__MANOR_INIT'));
  });
  it('haptic names map to library types', () => {
    expect(HAPTIC_TYPES.success).toBe('notificationSuccess');
  });
});
