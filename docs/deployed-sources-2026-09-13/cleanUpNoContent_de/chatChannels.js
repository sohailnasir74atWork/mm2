/**
 * chatChannels.js — the public chat nodes, server side.
 *
 * 📅 2026-09-13. The main chat became one room per language. Each is its own
 * RTDB node, and every one of them needs the same three things the original
 * `chat_new` already had, or it becomes a liability:
 *
 *   1. `.indexOn: ["timestamp", "senderId"]` in database.rules.json.
 *      Without it `orderByChild('timestamp')` still answers, but RTDB sorts
 *      the WHOLE node in memory on every retention page.
 *   2. Inclusion in the nightly retention sweep. `chat_new` reached 91,284
 *      rows before retention existed; an unswept channel repeats that.
 *   3. The moderation and notification triggers, or a channel silently has
 *      no moderation and sends no push.
 *
 * This list is the single source of truth for 2 and 3. It MUST stay in step
 * with CHANNELS in Code/ChatScreen/GroupChat/Trader.jsx and with the rules —
 * change one, change all three.
 *
 * `chat_new` is English and keeps its name on purpose: it holds every message
 * ever sent, and the retention job, the rules and the deployed triggers all
 * already point at it.
 */

const CHAT_CHANNEL_PATHS = [
  'chat_new',   // en
  'chat_es',
  'chat_pt',
  'chat_fr',
  'chat_de',
  'chat_ru',
  'chat_ar',
  'chat_id',
  'chat_vi',
  'chat_fil',
];

module.exports = { CHAT_CHANNEL_PATHS };
