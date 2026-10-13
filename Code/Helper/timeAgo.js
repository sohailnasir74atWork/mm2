// timeAgo.js — "just now / 5 min ago / 3 hours ago …" in the app language.
//
// Four screens used to build these strings by hand in English (StatusFeed,
// the calculator header, the profile drawer, Settings). They all call this
// now; the plural forms live under `time.*` in Code/Translation/*.json, so
// Russian and Arabic get their proper count forms.
//
//   timeAgo(ms, t)             → "5 min ago"      (long form)
//   timeAgo(ms, t, 'short')    → "5m"             (compact, for tight rows)
import i18n from 'i18next';

export function timeAgo(input, t = i18n.t.bind(i18n), style = 'long') {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(ms)) return '';
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60000);
  const p = style === 'short' ? 'time.short_' : 'time.';
  if (mins < 1) return t('time.just_now');
  if (mins < 60) return t(`${p}minutes_ago`, { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t(`${p}hours_ago`, { count: hours });
  const days = Math.floor(hours / 24);
  if (style === 'short' || days < 30) return t(`${p}days_ago`, { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('time.months_ago', { count: months });
  return t('time.years_ago', { count: Math.floor(days / 365) });
}

export default timeAgo;
