import { adviseTrade, verdictFor } from '../Code/TradeAdvisor/advisorCore';

const row = (name, value, demand = null) => ({ key: name.toLowerCase(), name, value, demand });
const POOL = [
  row('Gingerscope', 16000, 9), row('Harvester', 2100, 8), row('Celestial', 1950, 7),
  row('Sakura', 1600, 8), row('Sunset', 1475, 7), row('Sunrise', 1450, 6),
  row('Icepiercer', 900, 6), row('Bauble', 700, 5), row('Heat', 520, 4),
  row('Elderwood Scythe', 300, 5), row('Ocean', 240, 6), row('Batwing', 40, 7),
  row('Gemstone', 15, 2),
];

describe('verdictFor', () => {
  it('labels win / fair / loss from the player side', () => {
    expect(verdictFor(110, 100)).toBe('win');
    expect(verdictFor(100, 100)).toBe('fair');
    expect(verdictFor(96, 100)).toBe('fair');
    expect(verdictFor(90, 100)).toBe('loss');
    expect(verdictFor(5, 0)).toBe('fair');
  });
});

describe('adviseTrade', () => {
  it('returns nothing for an empty or unpriced offer', () => {
    expect(adviseTrade([], POOL)).toEqual({ total: 0, singles: [], combos: [] });
    expect(adviseTrade([row('Mystery', 0)], POOL).total).toBe(0);
  });

  it('suggests single items within 85-115% of the offer, closest first', () => {
    const r = adviseTrade([row('Sunrise', 1450, 6)], POOL);
    expect(r.total).toBe(1450);
    const names = r.singles.map((s) => s.items[0].name);
    expect(names[0]).toBe('Sunset');
    expect(names).toContain('Sakura');
    expect(names).not.toContain('Sunrise');
    expect(names).not.toContain('Harvester');
    r.singles.forEach((s) => {
      expect(s.value).toBeGreaterThanOrEqual(1450 * 0.85);
      expect(s.value).toBeLessThanOrEqual(1450 * 1.15);
    });
  });

  it('never offers back an item that is in the offer', () => {
    const r = adviseTrade([row('Sunset', 1475, 7), row('Ocean', 240, 6)], POOL);
    const all = [...r.singles, ...r.combos].flatMap((s) => s.items.map((i) => i.name));
    expect(all).not.toContain('Sunset');
    expect(all).not.toContain('Ocean');
  });

  it('builds two-item combos from real items, no item twice', () => {
    const r = adviseTrade([row('Harvester', 2100, 8)], POOL);
    expect(r.combos.length).toBeGreaterThan(0);
    const seen = new Set();
    r.combos.forEach((c) => {
      expect(c.items).toHaveLength(2);
      c.items.forEach((i) => {
        expect(i.value).toBeGreaterThanOrEqual(2100 * 0.2);
        expect(seen.has(i.key)).toBe(false);
        seen.add(i.key);
      });
      expect(c.value).toBeGreaterThanOrEqual(2100 * 0.9);
      expect(c.value).toBeLessThanOrEqual(2100 * 1.12);
    });
  });

  it('counts duplicates in the offer', () => {
    expect(adviseTrade([row('Batwing', 40), row('Batwing', 40)], POOL).total).toBe(80);
  });

  it('labels verdicts', () => {
    const r = adviseTrade([row('Sunrise', 1450, 6)], POOL);
    const sakura = r.singles.find((s) => s.items[0].name === 'Sakura');
    expect(sakura.verdict).toBe('win');
  });
});
