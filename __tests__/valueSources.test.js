import fs from 'fs';
import {
  buildItemPool, indexSupremePrices, priceOf, poolLookup, unwrapFeed, categoryKey, VALUE_SOURCE,
  sourceUpdatedAt, indexMM2Images, resolveItemImage,
} from '../Code/Helper/valueSources';

jest.mock('i18next', () => ({ t: (k) => k }));

const S = VALUE_SOURCE.SUPREME;
const obs = (name, value) => ({ name, value, valueText: String(value), valueConfidence: 'observed' });
const mod = (name, value) => ({ name, value, valueText: 'x3', valueConfidence: 'modeled' });

// Trimmed from the 2026-10-30 feeds: the three reports from that day.
const MM2 = {
  Godly: { 'TIER 4': [obs('Flowerwood Knife', 230), obs('Flowerwood Gun', 235)], 'TIER 2': [obs('Laser', 23)], 'TIER 5': [obs('Sunset', 650)] },
  Chroma: { 'TIER 3': [obs('Chroma Sunset', 5500)] },
  Rare: { 'TIER 4': [obs('Cane Knife', 525)], 'TIER 2': [mod('Sunset', 0.2)] },
  Common: { 'TIER 1': [mod('Cane Knife', 0.0045)], 'TIER 2': [mod('Penguin Knife', 0.4)] },
  Vintage: { 'TIER 2': [obs('Laser', 8), obs('America', 8)] },
  // No same-category Supreme record: must read "not listed", not borrow one.
  Uncommon: { 'TIER 2': [mod('Rainbow', 0.024)] },
  Pets: { 'TIER 5': [obs('Pumpkin', 50)], 'TIER 3': [obs('Chroma Fire Bat', 3)] },
};
const SUPREME = {
  Sets: {
    'Small Tier': [obs('Sun Set', 1450), obs('Flowerwood Set', 475)],
    'Chroma Tier': [obs('Chroma Sun Set', 14000)],
  },
  Godlies: { 'Tier 3': [obs('Flowerwood Gun', 240), obs('Flowerwood', 235)], 'Tier 4': [obs('Sunset', 650)], 'Tier 2': [obs('Laser', 22), obs('Rainbow', 400)] },
  Chromas: { 'Tier 2': [obs('Chroma Sunset', 5500)], 'Tier 1': [obs('Chroma Fire Bat', 3)] },
  Rares: { 'Tier 2': [mod('Sunset', 0.12)], 'Tier 3': [obs('Cane Knife', 525)] },
  Commons: { 'Tier 1': [mod('Cane Knife', 0.0045)], 'Tier 2': [mod('Penguin', 0.008)] },
  Vintages: { 'Tier 2': [obs('Laser', 8), obs('America', 7)] },
  Untradables: {
    Effects: [
      { name: 'Flowerwood', value: null, valueText: 'N/A', valueConfidence: 'none' },
      { name: 'Rainbow', value: null, valueText: 'N/A', valueConfidence: 'none' },
      { name: 'Pumpkin', value: null, valueText: 'N/A', valueConfidence: 'none' },
    ],
  },
};

beforeEach(() => { indexSupremePrices(SUPREME); });

const row = (pool, category, name) =>
  pool.find((r) => categoryKey(r.category) === categoryKey(category) && r.name === name);

test('a single item is never priced from a Set that shares its name key', () => {
  const pool = buildItemPool(MM2, SUPREME);
  expect(priceOf(row(pool, 'Godly', 'Sunset'), S).value).toBe(650);
  expect(priceOf(row(pool, 'Chroma', 'Chroma Sunset'), S).value).toBe(5500);
  // The set itself is still in the pool, at its own price.
  expect(priceOf(row(pool, 'Sets', 'Sun Set'), S).value).toBe(1450);
  // No category at all (old trade items): still not the set.
  expect(priceOf({ name: 'Sunset' }, S).value).toBe(650);
});

test('the same name in two categories is priced from its own category', () => {
  const pool = buildItemPool(MM2, SUPREME);
  expect(priceOf(row(pool, 'Vintage', 'Laser'), S).value).toBe(8);
  expect(priceOf(row(pool, 'Godly', 'Laser'), S).value).toBe(22);
  expect(priceOf(row(pool, 'Common', 'Cane Knife'), S).value).toBe(0.0045);
  expect(priceOf(row(pool, 'Rare', 'Cane Knife'), S).value).toBe(525);
});

test('no record in the item\'s own category reads "not listed", never another item\'s price', () => {
  const pool = buildItemPool(MM2, SUPREME);
  // Supreme lists Rainbow only as a Godly (400) and an effect.
  expect(priceOf(row(pool, 'Uncommon', 'Rainbow'), S)).toMatchObject({ value: 0, missing: true });
  // Supreme's only "Pumpkin" is an untradable effect: not a reason to call the pet untradable.
  const pumpkin = priceOf(row(pool, 'Pets', 'Pumpkin'), S);
  expect(pumpkin.missing).toBe(true);
  expect(pumpkin.reason).not.toBe('untradable');
});

test('an item each site files once, under different categories, is paired', () => {
  const pool = buildItemPool(MM2, SUPREME);
  const bat = row(pool, 'Pets', 'Chroma Fire Bat');
  expect(bat.supremeCategory).toBe('Chromas');
  expect(priceOf(bat, S)).toMatchObject({ value: 3, missing: false });
  expect(pool.filter((r) => r.name === 'Chroma Fire Bat')).toHaveLength(1);
});

test('MM2 "X Knife" finds Supreme "X" in the same category only', () => {
  const pool = buildItemPool(MM2, SUPREME);
  const knife = priceOf(row(pool, 'Godly', 'Flowerwood Knife'), S);
  expect(knife).toMatchObject({ value: 235, missing: false });
  // Without a category the fallback does not guess.
  expect(priceOf({ name: 'Flowerwood Knife' }, S).missing).toBe(true);
  // Two bundle-tier values far apart (same 2025 knife, the lists disagree) still pair.
  expect(priceOf(row(pool, 'Common', 'Penguin Knife'), S)).toMatchObject({ value: 0.008, missing: false });
  // A real price on one side rules a far-off pairing out (Godly Rainbow 400 vs 0.024).
  expect(row(pool, 'Uncommon', 'Rainbow').supremeCategory).toBeNull();
});

test('every MM2 Vintage reaches the pool, and is not listed twice', () => {
  const pool = buildItemPool(MM2, SUPREME);
  const vintages = pool.filter((r) => categoryKey(r.category) === 'VINTAGE').map((r) => r.name).sort();
  expect(vintages).toEqual(['America', 'Laser']);
  // The Supreme Flowerwood knife merged into MM2's row, not a second one.
  expect(pool.filter((r) => /^Flowerwood( Knife)?$/.test(r.name))).toHaveLength(1);
});

test('poolLookup prefers the saved item\'s own category, then falls back to the name', () => {
  const find = poolLookup(buildItemPool(MM2, SUPREME));
  expect(find({ name: 'Laser', category: 'Vintage' }).category).toBe('Vintage');
  expect(find({ name: 'Laser', type: 'Godly' }).category).toBe('Godly');
  expect(find({ name: 'Laser' }).category).toBe('Godly');
  expect(find({ name: 'Nope' })).toBeNull();
});

test('sourceUpdatedAt prefers the site\'s own stamp over our build time', () => {
  const meta = {
    generatedAt: '2026-10-30T02:03:20.852Z',
    sources: { mm2: { siteUpdatedAt: '2026-10-25T17:08:30.000Z' } },
  };
  expect(sourceUpdatedAt(meta, 'mm2').toISOString()).toBe('2026-10-25T17:08:30.000Z');
  // No site stamp for this list yet: fall back to the build time.
  expect(sourceUpdatedAt(meta, 'supreme').toISOString()).toBe('2026-10-30T02:03:20.852Z');
  expect(sourceUpdatedAt(null, 'mm2')).toBeNull();
  expect(sourceUpdatedAt({ generatedAt: 'not a date' }, 'mm2')).toBeNull();
});

// Full-catalogue check, run by hand against downloaded feeds:
//   MM2_FEED=… SUPREME_FEED=… npx jest __tests__/valueSources.test.js
const live = process.env.MM2_FEED && process.env.SUPREME_FEED;
(live ? test : test.skip)('live feeds: the 2026-10-30 reports are fixed', () => {
  const mm2 = unwrapFeed(JSON.parse(fs.readFileSync(process.env.MM2_FEED, 'utf8')));
  const sup = unwrapFeed(JSON.parse(fs.readFileSync(process.env.SUPREME_FEED, 'utf8')));
  indexSupremePrices(sup);
  const pool = buildItemPool(mm2, sup);
  expect(priceOf(row(pool, 'Godly', 'Flowerwood Knife'), S).value).toBe(235);
  expect(priceOf(row(pool, 'Godly', 'Sunset'), S).value).toBe(650);
  expect(pool.filter((r) => categoryKey(r.category) === 'VINTAGE')).toHaveLength(10);
  console.log(JSON.stringify({
    pool: pool.length,
    mm2Only: pool.filter((r) => r.inMM2).length,
    supremeOnly: pool.filter((r) => !r.inMM2).length,
    missingOnSupreme: pool.filter((r) => r.inMM2 && priceOf(r, S).missing).length,
  }));
});

test('an artless Supreme Set borrows the MM2 art of its first part that has one', () => {
  indexMM2Images({ Chroma: { 'Tier 1': [{ name: 'Chroma Evergun', image: 'img/CEvergun.png' }] } });
  indexSupremePrices({
    Sets: { 'Tier 1': [{
      name: 'Chroma Ever Set', image: '/media/N_A.webp',
      containsParts: [{ name: 'Chroma Evergreen' }, { name: 'Chroma Evergun' }],
    }] },
    Uniques: { 'Tier 1': [{ name: 'Corrupt', image: '/media/N_A.webp' }] },
  });
  expect(resolveItemImage({ name: 'Chroma Ever Set', image: '/media/N_A.webp' }))
    .toBe('https://mm2values.com/img/CEvergun.png');
  // No parts, no MM2 twin: still the empty state.
  expect(resolveItemImage({ name: 'Corrupt', image: '/media/N_A.webp' })).toBe('');
  // A stored absolute URL still wins.
  expect(resolveItemImage({ name: 'Chroma Ever Set', image: 'https://x.test/a.png' })).toBe('https://x.test/a.png');
});
