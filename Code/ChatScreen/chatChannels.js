/**
 * chatChannels.js — the public chat rooms, client side.
 *
 * 📅 2026-09-13. The main chat is one RTDB node per language. English keeps
 * `chat_new`: that node holds every message ever sent, and the retention job,
 * the moderation trigger and the existing rules all already point at it.
 *
 * The list matches the languages the app itself ships (Code/Translation/*.json)
 * — a room nobody can read the UI in is a dead room.
 *
 * Mirrored server-side in functions/chatChannels.js and in the rules. Adding a
 * language here alone is NOT enough; a new node also needs its `.indexOn` in
 * database.rules.json, a slot in the retention sweep, and a moderation
 * trigger. Change one, change all three.
 */

export const CHANNELS = [
  { id: 'en', label: 'English', flag: '🇺🇸', path: 'chat_new' },
  { id: 'es', label: 'Español', flag: '🇪🇸', path: 'chat_es' },
  { id: 'pt', label: 'Português', flag: '🇧🇷', path: 'chat_pt' },
  { id: 'fr', label: 'Français', flag: '🇫🇷', path: 'chat_fr' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪', path: 'chat_de' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', path: 'chat_ru' },
  { id: 'ar', label: 'العربية', flag: '🇸🇦', path: 'chat_ar' },
  { id: 'id', label: 'Indonesia', flag: '🇮🇩', path: 'chat_id' },
  { id: 'vi', label: 'Tiếng Việt', flag: '🇻🇳', path: 'chat_vi' },
  { id: 'fil', label: 'Filipino', flag: '🇵🇭', path: 'chat_fil' },
];

export const CHAT_CHANNEL_PATHS = CHANNELS.map((c) => c.path);

export const DEFAULT_CHANNEL = CHANNELS[0];

/** The node a message id belongs to, defaulting to English for older ids. */
export const channelPathById = (id) =>
  (CHANNELS.find((c) => c.id === id) || DEFAULT_CHANNEL).path;
