/**
 * birthdays/dates.js — calendar helpers for the Birthdays feature, all UTC.
 *
 * Mirrors Blox Fruit's supabase/036_birthdays.sql helpers (_birthday_md,
 * _birthday_on, _birthday_days_from, _birthday_near, dob_age_years) so MM2
 * behaves the same on Firebase:
 *   - an index key is 'MMDD' (29 Feb = '0229');
 *   - 29 Feb birthdays are celebrated on 28 Feb in non-leap years, so 28 Feb
 *     of a non-leap year also covers '0229';
 *   - the "birthday year" is the year of the occurrence within ±1 day of UTC
 *     today (every time zone's "today"), so New Year birthdays work;
 *   - a phone's local date is trusted only within UTC yesterday..tomorrow.
 *
 * A date here is a plain { y, m, d } object (m and d 1-based). Pure: no I/O.
 */

const DAY_MS = 86400000;
const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const pad2 = (n) => String(n).padStart(2, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const isRealDate = (y, m, d) =>
  Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
  y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

/** 'YYYY-MM-DD' (1- or 2-digit month/day accepted) → { y, m, d } or null. */
const parseDate = (s) => {
  const r = typeof s === 'string' ? DOB_RE.exec(s.trim()) : null;
  if (!r) return null;
  const date = { y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
  return isRealDate(date.y, date.m, date.d) ? date : null;
};

const isoOf = ({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`;
const msOf = ({ y, m, d }) => Date.UTC(y, m - 1, d);
const fromMs = (ms) => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const addDays = (date, n) => fromMs(msOf(date) + n * DAY_MS);
const utcToday = (nowMs = Date.now()) => fromMs(nowMs);
const sameDate = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;

const keyOf = (m, d) => `${pad2(m)}${pad2(d)}`;
const parseKey = (key) => {
  const r = /^(\d{2})(\d{2})$/.exec(String(key || ''));
  if (!r) return null;
  const m = Number(r[1]);
  const d = Number(r[2]);
  // 2000 is a leap year, so '0229' is a valid key.
  return isRealDate(2000, m, d) ? { m, d } : null;
};

/** The index keys celebrated on `date`: its own, plus '0229' on 28 Feb of a non-leap year. */
const keysForDate = (date) => {
  const keys = [keyOf(date.m, date.d)];
  if (date.m === 2 && date.d === 28 && !isLeap(date.y)) keys.push('0229');
  return keys;
};

/** The date a (m, d) birthday falls on in `year` (29 Feb → 28 Feb in non-leap years). */
const birthdayOn = (year, m, d) => ({ y: year, m, d: Math.min(d, daysInMonth(year, m)) });

/** Days from `from` to the next (m, d) birthday on or after it (0 = `from` itself). */
const daysFrom = (m, d, from) => {
  let next = birthdayOn(from.y, m, d);
  if (msOf(next) < msOf(from)) next = birthdayOn(from.y + 1, m, d);
  return Math.round((msOf(next) - msOf(from)) / DAY_MS);
};

/** The (m, d) birthday date within one day of `today` (UTC), or null. Blox `_birthday_near`. */
const nearDate = (m, d, today) => {
  const from = addDays(today, -1);
  const n = daysFrom(m, d, from);
  return n <= 2 ? addDays(from, n) : null;
};

/**
 * The phone's local date if it is UTC yesterday, today or tomorrow;
 * otherwise (missing, malformed, clock set wrong) UTC today.
 */
const clampLocalDate = (localDate, nowMs = Date.now()) => {
  const today = utcToday(nowMs);
  const local = parseDate(localDate);
  if (!local) return today;
  const diff = Math.round((msOf(local) - msOf(today)) / DAY_MS);
  return Math.abs(diff) <= 1 ? local : today;
};

/** Whole years old on `today` (calendar based, like Postgres age()); null if unknown or future. */
const ageOn = (dob, today) => {
  if (!dob) return null;
  if (msOf(dob) > msOf(today)) return null;
  let age = today.y - dob.y;
  if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
};

module.exports = {
  DAY_MS,
  pad2,
  isLeap,
  isRealDate,
  parseDate,
  isoOf,
  msOf,
  addDays,
  utcToday,
  sameDate,
  keyOf,
  parseKey,
  keysForDate,
  birthdayOn,
  daysFrom,
  nearDate,
  clampLocalDate,
  ageOn,
};
