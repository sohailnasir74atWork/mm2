import { calculatorVerdict, tradeStatus, STATUS_LETTER } from '../Code/Helper/tradeStatus';

const side = (count, total, unpriced = 0) => ({ count, total, unpriced });

test('0 vs 0 is no verdict, not WIN', () => {
  expect(calculatorVerdict({ give: side(0, 0), get: side(0, 0), feedLoaded: true }))
    .toEqual({ status: null, reason: 'empty' });
});

test('a list that never loaded gives no verdict, even with items in the grid', () => {
  expect(calculatorVerdict({ give: side(2, 0, 2), get: side(1, 0, 1), feedLoaded: false }))
    .toEqual({ status: null, reason: 'no_data' });
});

test('an unpriced item on either side withholds the verdict', () => {
  // Giving away a "Priceless" Nik's Scythe used to total 0 and read WIN.
  expect(calculatorVerdict({ give: side(1, 0, 1), get: side(1, 650), feedLoaded: true }).status).toBeNull();
  expect(calculatorVerdict({ give: side(2, 650, 1), get: side(1, 700), feedLoaded: true }).reason).toBe('incomplete');
});

test('a side holding only bundle-tier items (total 0) withholds the verdict', () => {
  expect(calculatorVerdict({ give: side(3, 0), get: side(1, 25), feedLoaded: true }).reason).toBe('incomplete');
});

test('priced trades keep the existing 5% rule', () => {
  expect(calculatorVerdict({ give: side(1, 100), get: side(1, 104), feedLoaded: true }).status).toBe('fair');
  expect(calculatorVerdict({ give: side(1, 100), get: side(1, 120), feedLoaded: true }).status).toBe('win');
  expect(calculatorVerdict({ give: side(1, 120), get: side(1, 100), feedLoaded: true }).status).toBe('lose');
  // An ad that only asks (nothing offered) is still judged on what it asks for.
  expect(calculatorVerdict({ give: side(0, 0), get: side(1, 50), feedLoaded: true }).status).toBe('win');
  expect(tradeStatus(100, 120)).toBe('win');
  expect(STATUS_LETTER.win).toBe('w');
});
