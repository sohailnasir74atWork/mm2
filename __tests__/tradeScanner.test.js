/**
 * MM2 Trade Scanner (Code/TradeScanner/tradeMatch.js): finding the window by
 * its YOUR OFFER / THEIR OFFER labels, reading names, Chroma tags and stack
 * counts, and ignoring the inventory list beside the window.
 */
import { buildTrade, namesForText, normalize } from '../Code/TradeScanner/tradeMatch';

const NAMES = ['Tides', 'Ginger (Gun)', 'Ghost', 'Heat', 'Chroma Heat', "Hallow's Blade", 'Hallowscythe', 'Hallowgun', 'Harvester', 'Snowflake Key 2018', 'Gingerblade', 'Chroma Gingerblade'];
const catalog = new Map(NAMES.map((n) => [normalize(n), n]));
const line = (text, x, y, w = 80, h = 20) => ({ text, x, y, w, h });

describe('namesForText', () => {
  it('reads exact, punctuated, cut-off and misread names', () => {
    expect(namesForText('Tides', catalog)).toEqual({ names: ['Tides'], exact: true });
    expect(namesForText('Hallows Blade', catalog).names).toEqual(["Hallow's Blade"]);
    expect(namesForText('Snowflake Key', catalog)).toEqual({ names: ['Snowflake Key 2018'], exact: true });
    expect(namesForText('Harvestor', catalog).names).toEqual(['Harvester']);
    expect(namesForText('Ginger', catalog)).toEqual({ names: ['Ginger (Gun)', 'Gingerblade'], exact: false });
    expect(namesForText('ACCEPT', catalog).names).toEqual([]);
  });
});

describe('buildTrade', () => {
  it('splits on the two labels, skips the inventory list, reads Chroma and stacks', () => {
    const lines = [
      line('YOUR OFFER', 976, 245, 160, 30),
      line('THEIR OFFER', 976, 466, 160, 30),
      line('Tides', 1021, 429),
      line('x23', 1100, 490, 30, 18),
      line('Hallowscythe', 1018, 650),
      line('Chroma', 1120, 620, 50, 14),
      line('Heat', 1135, 650),
      line('Chroma', 806, 689), line('Heat', 845, 719), // inventory, left of the window
      line('DECLINE', 1172, 820),
    ];
    const trade = buildTrade({ lines, width: 1920, catalog });
    expect(trade.foundWindow).toBe(true);
    expect(trade.mine.map((p) => p.name)).toEqual(['Tides']);
    expect(trade.theirs.filter((p) => p.name === 'Hallowscythe')).toHaveLength(23);
    expect(trade.theirs[trade.theirs.length - 1]).toEqual({ name: 'Chroma Heat', sure: true, alternatives: [] });
  });

  it('finds no window without both labels', () => {
    expect(buildTrade({ lines: [line('Tides', 10, 10)], width: 500, catalog })).toEqual({ mine: [], theirs: [], foundWindow: false });
  });
});

// ── 2026-11-06: downloaded scanner (slot finder + AI model) ───────────────
/* eslint-disable import/first */
import { nameSlot } from '../Code/TradeScanner/tradeMatch';
import { pickRelease, scannerState } from '../Code/TradeScanner/scannerRelease';
const matcher = require('../Code/TradeScanner/matcher');
const { build: buildPage } = require('../scripts/trade-scanner/build-html');
/* eslint-enable import/first */

// A trade window drawn the way MM2 draws it: dark gaps, grey squares, a
// rarity-coloured name bar with white letters along each filled square's bottom.
function drawWindow(tiles, W = 900, H = 500) {
  const px = new Uint8Array(W * H * 4);
  const fill = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  };
  fill(0, 0, W, H, [30, 30, 30]);
  for (const t of tiles) {
    fill(t.x, t.y, t.x + 140, t.y + 140, [57, 57, 57]);
    fill(t.x + 30, t.y + 20, t.x + 110, t.y + 120, [150, 90, 40]); // the item picture
    if (!t.bar) continue;
    fill(t.x, t.y + 140, t.x + 140, t.y + 172, t.bar);
    for (let k = 0; k < 6; k++) fill(t.x + 20 + k * 17, t.y + 148, t.x + 30 + k * 17, t.y + 164, [255, 255, 255]);
  }
  return { px, W, H };
}

describe('matcher.scan (MM2 slot finder)', () => {
  it('finds every filled tile by its name bar and skips empty ones', () => {
    const purple = [92, 0, 240];
    const pink = [235, 0, 174];
    const { px, W, H } = drawWindow([
      { x: 20, y: 20, bar: purple }, { x: 170, y: 20, bar: pink }, { x: 320, y: 20 },
      { x: 20, y: 260, bar: pink },
    ]);
    const slots = matcher.scan(px, W, H);
    expect(slots).toHaveLength(3);
    const first = slots[0];
    expect(Math.abs(first.x0 - 20)).toBeLessThanOrEqual(2);
    expect(Math.abs(first.x1 - 159)).toBeLessThanOrEqual(2);
    expect(Math.abs(first.nameTop - 160)).toBeLessThanOrEqual(2);
    expect(Math.abs(first.top - 23)).toBeLessThanOrEqual(6);
  });

  // The trade window in user reports from 2026-11-06 on: no solid name bar;
  // the name in rarity-coloured letters and a thin rarity underline above the
  // tile's black bottom outline. A small coloured patch in the item art fooled
  // the bar finder (Plasmabeam / Frostbite read off one Icepiercer).
  it('finds tiles of the current window by their thin name underline', () => {
    const W = 1400, H = 620;
    const px = new Uint8Array(W * H * 4);
    const fill = (x0, y0, x1, y1, c) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      }
    };
    fill(0, 0, W, H, [34, 34, 34]);
    const tile = (x, y, col) => {
      fill(x, y, x + 300, y + 240, [0, 0, 0]);
      fill(x + 2, y + 2, x + 298, y + 238, [57, 57, 57]);
      if (!col) return;
      fill(x + 60, y + 30, x + 240, y + 170, [120, 160, 210]); // the item picture
      fill(x + 120, y + 100, x + 160, y + 109, col); // a coloured patch in the art
      for (let k = 0; k < 7; k++) fill(x + 50 + k * 30, y + 190, x + 70 + k * 30, y + 225, col); // letters
      fill(x + 8, y + 230, x + 292, y + 234, col); // underline
    };
    const purple = [94, 22, 217], pink = [230, 30, 160];
    tile(10, 20, purple); tile(320, 20, null); tile(630, 20, null);
    tile(10, 330, pink); tile(320, 330, pink);
    const slots = matcher.scan(px, W, H);
    expect(slots).toHaveLength(3);
    const first = slots[0];
    expect(Math.abs(first.x0 - 10)).toBeLessThanOrEqual(6);
    expect(Math.abs(first.x1 - 308)).toBeLessThanOrEqual(6);
    expect(Math.abs(first.top - 22)).toBeLessThanOrEqual(4);
    expect(first.nameTop).toBeLessThan(215);
    expect(first.nameBottom).toBeGreaterThanOrEqual(234);
    expect(slots.filter((s) => s.top > 300)).toHaveLength(2);
  });

  it('finds nothing on a picture without a trade window', () => {
    const W = 300, H = 200;
    const px = new Uint8Array(W * H * 4).fill(120);
    expect(matcher.scan(px, W, H)).toEqual([]);
  });

  it('builds the downloadable scanner page with the finder inside', () => {
    const page = buildPage();
    expect(page).toContain('TradeMatcher');
    expect(page).not.toContain('/*__MATCHER__*/');
  });
});

describe('buildTrade with slots and the AI model', () => {
  const slot = (x0, nameTop, candidates) => ({ x0, x1: x0 + 140, top: nameTop - 137, nameTop, nameBottom: nameTop + 32, candidates });
  const cand = (name, score) => ({ name, d: 1 - score, score });

  it('takes the name on the bar when it is a catalogue name, the model otherwise', () => {
    const lines = [
      line('YOUR OFFER', 660, 20, 170, 26), line('THEIR OFFER', 660, 260, 170, 26),
      line('Tides', 700, 220, 60, 20),
      line('Chroma', 670, 445, 70, 18), line('Gingerblade', 690, 466, 110, 20),
      line('x3', 1060, 330, 30, 18),
      line('Hallowscythe', 20, 466, 120, 20), // inventory list, left of the window
    ];
    const slots = [
      slot(667, 215, [cand('Ghost', 0.9)]),
      slot(667, 460, [cand('Gingerblade', 0.7)]),
      slot(970, 460, [cand('Harvester', 0.93), cand('Heat', 0.03)]),
      slot(10, 460, [cand('Hallowscythe', 0.9)]),
    ];
    const trade = buildTrade({ slots, lines, width: 1280, catalog });
    expect(trade.mine).toEqual([{ name: 'Tides', sure: true, alternatives: ['Ghost'] }]);
    expect(trade.theirs.map((p) => p.name)).toEqual(['Chroma Gingerblade', 'Harvester', 'Harvester', 'Harvester']);
    expect(trade.theirs[1].sure).toBe(true);
    expect(trade.skippedInventory).toBe(1);
  });

  it('skips the inventory column that ends right next to the labels (x27 stack)', () => {
    // Crop of a real PC window (emulator test 2026-11-06): the last inventory
    // column ends ~30 px left of the THEIR OFFER label.
    const lines = [
      line('YOUR OFFER', 460, 10, 140, 22), line('THEIR OFFER', 460, 150, 140, 22),
      line('Hallowscythe', 340, 318, 85, 16), line('x27', 395, 172, 25, 16),
      line('Harvester', 470, 318, 80, 16),
    ];
    const slots = [slot(333, 312, [cand('Hallowscythe', 0.9)]), slot(462, 312, [cand('Harvester', 0.9)])];
    slots[0].x1 = 428; slots[1].x1 = 555;
    const trade = buildTrade({ slots, lines, width: 860, catalog });
    expect(trade.theirs.map((p) => p.name)).toEqual(['Harvester']);
    expect(trade.skippedInventory).toBe(1);
  });

  it('marks an unsure model guess and splits rows at the widest gap without labels', () => {
    const slots = [slot(10, 200, [cand('Heat', 0.3), cand('Ghost', 0.2)]), slot(10, 600, [cand('Tides', 0.95)])];
    const trade = buildTrade({ slots, lines: [], width: 800, catalog });
    expect(trade.mine).toEqual([{ name: 'Heat', sure: false, alternatives: ['Ghost'] }]);
    expect(trade.theirs).toEqual([{ name: 'Tides', sure: true, alternatives: [] }]);
  });

  it('uses a cut-off name to pick among the model guesses', () => {
    const pick = nameSlot({ text: 'Hallow', chroma: false, model: [cand('Harvester', 0.4), cand('Hallowscythe', 0.35)], catalog });
    expect(pick.name).toBe('Hallowscythe');
  });

  it('falls back to the text-only reading without slots', () => {
    const lines = [line('YOUR OFFER', 976, 245, 160, 30), line('THEIR OFFER', 976, 466, 160, 30), line('Tides', 1021, 429)];
    expect(buildTrade({ slots: [], lines, width: 1920, catalog }).mine.map((p) => p.name)).toEqual(['Tides']);
  });
});

describe('scanner download (releases)', () => {
  const file = (v) => ({ url: `https://x/v${v}`, sha256: `s${v}`, bytes: 1000 });
  const release = (v, minBuild = 59) => ({ version: v, minBuild, model: file(v), names: file(v), html: file(v) });
  it('picks the newest release this build may take; staff see mods first', () => {
    const manifest = { releases: { all: release(1), mods: release(2) } };
    expect(pickRelease(manifest, { tester: false, build: 59, needsModel: true }).version).toBe(1);
    expect(pickRelease(manifest, { tester: true, build: 59, needsModel: true }).version).toBe(2);
    expect(pickRelease(manifest, { tester: false, build: 58, needsModel: true })).toBeNull();
    expect(scannerState(null, release(1))).toBe('missing');
    expect(scannerState(release(1), release(2))).toBe('old');
  });
});
