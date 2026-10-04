import {matchesItemName} from '../Code/Helper/itemSearch';

test('Russian aliases find common pets, eggs, fruits and MM2 items', () => {
  for (const [name, query] of [
    ['Frost Dragon', 'ледяной дракон'], ['Safari Egg', 'яйцо'],
    ['Cat', 'кошка'], ['Ice', 'лед'], ['Ice', 'лёд'],
    ['Dough', 'тесто'], ['Chroma Luger', 'люгер'], ['Icewing', 'айсвинг'],
  ]) expect(matchesItemName(name, query)).toBe(true);
});

test('English search, whitespace and existing Adopt Me acronyms still work', () => {
  expect(matchesItemName('Frost Dragon', ' FROST ')).toBe(true);
  expect(matchesItemName('Lavender Dragon', 'ld', true)).toBe(true);
  expect(matchesItemName('Frost Dragon', '')).toBe(true);
  expect(matchesItemName(null, 'dragon')).toBe(false);
});

test('aliases do not match incidental substrings or unrelated items', () => {
  expect(matchesItemName('Caterpillar', 'кошка')).toBe(false);
  expect(matchesItemName('Dog', 'кошка')).toBe(false);
  expect(matchesItemName('Frost Dragon', 'теневой дракон')).toBe(false);
});

test('spacing and punctuation differences between catalogues still match', () => {
  // MM2 spells the ancient "Log Chopper"; Supreme and players write "Logchopper".
  expect(matchesItemName('Log Chopper', 'logchopper')).toBe(true);
  expect(matchesItemName('Ice Wing', 'icewing')).toBe(true);
  expect(matchesItemName("Nik's Scythe", 'niks scythe')).toBe(true);
  expect(matchesItemName('Gold LogChopper', 'log chopper')).toBe(true);
  expect(matchesItemName('Log Chopper', 'logchoppers')).toBe(false);
});
