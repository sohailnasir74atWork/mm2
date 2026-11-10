import { buildSearchTokens, tradeMatchesLocally } from '../Code/Trades/tradeSearchIndex';

test('full names and whole words are still indexed first', () => {
  const tokens = buildSearchTokens([{ name: 'Flowerwood Knife' }, { name: 'Chroma Luger' }]);
  expect(tokens.slice(0, 6)).toEqual([
    'flowerwood knife', 'flowerwood', 'knife', 'chroma luger', 'chroma', 'luger',
  ]);
});

test('word prefixes of 3+ letters are indexed, so "kni" and "chro" match new trades', () => {
  const tokens = buildSearchTokens([{ name: 'Flowerwood Knife' }, { name: 'Chroma Luger' }]);
  for (const prefix of ['kni', 'knif', 'chr', 'chro', 'chrom', 'flo', 'lug']) {
    expect(tokens).toContain(prefix);
  }
  // Two letters would match nearly everything, and are not stored.
  expect(tokens).not.toContain('kn');
  expect(tokens).not.toContain('ch');
  // No duplicates.
  expect(new Set(tokens).size).toBe(tokens.length);
});

test('prefixes never push a whole word out of the index', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ name: `Elderwoodblade${i} Superlongword${i}` }));
  const tokens = buildSearchTokens(items);
  // The first 30 are exactly what was stored before prefixes existed:
  // full name, word, word — for the first 10 items.
  const expected = items.slice(0, 10).flatMap((it) => {
    const full = it.name.toLowerCase();
    return [full, ...full.split(' ')];
  });
  expect(tokens.slice(0, 30)).toEqual(expected);
  expect(tokens.length).toBeLessThanOrEqual(30 + 120);
});

test('loaded trades match a partial word from the start of a word', () => {
  const trade = { hasItems: [{ name: 'Chroma Elderwood Blade' }], wantsItems: [{ name: 'Knife' }] };
  const both = { searchInHas: true, searchInWants: true };
  expect(tradeMatchesLocally(trade, 'kni', both)).toBe(true);
  expect(tradeMatchesLocally(trade, 'chro', both)).toBe(true);
  expect(tradeMatchesLocally(trade, 'elder', both)).toBe(true);
  expect(tradeMatchesLocally(trade, 'kni', { searchInHas: true, searchInWants: false })).toBe(false);
  expect(tradeMatchesLocally(trade, 'gun', both)).toBe(false);
});
