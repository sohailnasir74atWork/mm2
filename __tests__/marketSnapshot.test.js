import { buildMarketSnapshot, parsePct, formatPct } from '../Code/HomeTab/marketSnapshot';

const row = (name, change, changePct, category = 'Godlies') => ({ id: name, name, category, change, changePct });

test('no pool or no movement → null, so the card hides', () => {
  expect(buildMarketSnapshot(null)).toBeNull();
  expect(buildMarketSnapshot([])).toBeNull();
  expect(buildMarketSnapshot([row('A', 0, ''), row('B', null, null)])).toBeNull();
});

test('counts and top movers by size of move, Sets left out', () => {
  const snap = buildMarketSnapshot([
    row('Tiny', 1, '+100.0%', 'Commons'),
    row('Blizzard', 250, '+4.8%', 'Chromas'),
    row('Elf', 50, '+8.7%', 'Pets'),
    row('Gingerscope', 250, '+1.6%', 'Ancients'),
    row('Traveler', -5000, '-3.4%', 'Chromas'),
    row('Emberbow', -500, '-10.0%', 'Chromas'),
    row('Ever Set', -2000, '-2.4%', 'Sets'),
    row('NoPct', -9000, '', 'Chromas'),
    row('Flat', 0, '0%'),
  ]);
  expect(snap.changed).toBe(7);
  expect(snap.rising).toBe(4);
  expect(snap.falling).toBe(3);
  expect(snap.topRising.map((m) => m.item.name)).toEqual(['Blizzard', 'Gingerscope', 'Elf']);
  // NoPct counts as a change but cannot be shown with a percent.
  expect(snap.topFalling.map((m) => m.item.name)).toEqual(['Traveler', 'Emberbow']);
  expect(snap.topFalling[0].pct).toBe(-3.4);
});

test('percent parsing and formatting', () => {
  expect(parsePct('+4.8%')).toBe(4.8);
  expect(parsePct('-10.0%')).toBe(-10);
  expect(parsePct('')).toBeNull();
  expect(parsePct('N/A')).toBeNull();
  expect(formatPct(4.8)).toBe('+4.8%');
  expect(formatPct(-10)).toBe('−10%');
});
