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
