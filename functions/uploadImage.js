/**
 * uploadImage — every user image in the app (avatar, feed post, status,
 * group icon, group chat, private chat) goes to Bunny through here.
 *
 * Until 2026-10-11 the app PUT straight to storage.bunnycdn.com with the
 * post-gag zone's storage password compiled into the bundle, so anyone who
 * unpacked the APK/IPA could upload, overwrite or delete any file in the
 * zone. The password now lives only in Secret Manager (BUNNY_STORAGE_KEY).
 * The app sends the image; this function checks who is asking and what they
 * sent, and picks the storage path itself — a caller cannot name a path, so
 * it cannot overwrite or delete anything.
 *
 * POST JSON { kind: <KINDS key>, data: <base64> }
 * Authorization: Bearer <Firebase ID token>
 * → 200 { url } | 4xx/5xx { error }
 *
 * Checks, in order: signed-in caller (ID token, revocation checked), known
 * kind, image bytes (magic bytes — the client's content type is not trusted),
 * size cap per kind, and a per-user hourly quota held server-side at
 * upload_quota/{uid} (no client rule, so database.rules.json denies it).
 *
 * Old builds keep PUTting with the embedded password until it is rotated,
 * so this function is only half the fix. Rollout order:
 * docs/BUNNY_UPLOAD_ROLLOUT_2026-10-11.md.
 *
 * Deploy (by name — see HANDOFF.md for why never a bare --only functions):
 *   firebase functions:secrets:set BUNNY_STORAGE_KEY --project mm2vlaues-ed80c
 *   firebase deploy --only functions:uploadImage --project mm2vlaues-ed80c
 *
 * Test: node --test functions/test/uploadImage.test.js (Bunny and Auth stubbed).
 */
const functions = require('firebase-functions/v1');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUNNY_STORAGE_KEY = defineSecret('BUNNY_STORAGE_KEY');

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const KB = 1024;
const MB = 1024 * KB;

// The folders are the ones the app wrote to before, now with the uploader's
// uid in the path. Caps sit above the app's own checks (avatar 500 KB, chat
// and posts 1 MB) so a legitimate upload is never refused here; group icons
// are resized to 1024px by the picker.
const KINDS = {
  avatar: { dir: 'avatars', maxBytes: 1 * MB },
  post: { dir: 'uploads', maxBytes: 3 * MB },
  dm: { dir: 'uploads', maxBytes: 3 * MB },
  chat: { dir: 'chat', maxBytes: 3 * MB },
  status: { dir: 'statuses', maxBytes: 3 * MB },
  group: { dir: 'groups', maxBytes: 3 * MB },
};

// Per user, across all kinds. A chat message carries up to 3 images.
const MAX_PER_HOUR = 60;

// Magic bytes. No SVG or anything else a browser could run as a document.
const ascii = (b, from, to) => b.subarray(from, to).toString('ascii');
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const TYPES = [
  { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', ok: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { ext: 'gif', ok: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' },
  // Android pickers can hand back the camera's original HEIF.
  { ext: 'heic', ok: (b) => ascii(b, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(b, 8, 12)) },
];
const sniff = (bytes) => (bytes.length >= 12 ? TYPES.find((t) => t.ok(bytes)) : undefined);

const STATUS = {
  method_not_allowed: 405, unauthenticated: 401, bad_kind: 400, bad_image: 400,
  too_large: 413, rate_limited: 429, upload_failed: 502, internal: 500,
};
const fail = (res, error) => res.status(STATUS[error] || 400).json({ error });

// One counter per user, reset each hour: { h: hour index, n: uploads }.
async function takeQuota(uid) {
  const hour = Math.floor(Date.now() / 3600000);
  const { committed } = await admin.database().ref(`upload_quota/${uid}`).transaction((cur) => {
    if (!cur || cur.h !== hour) return { h: hour, n: 1 };
    if (cur.n >= MAX_PER_HOUR) return undefined; // abort
    return { h: hour, n: cur.n + 1 };
  });
  return committed;
}

// Everything that leaves the process, so the test can stub it.
const io = {
  verifyIdToken: (token) => admin.auth().verifyIdToken(token, true),
  takeQuota,
  storageKey: () => BUNNY_STORAGE_KEY.value(),
  put: (url, init) => fetch(url, init),
};

async function handleUpload(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return fail(res, 'method_not_allowed');

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(res, 'unauthenticated');
  let caller;
  try {
    caller = await io.verifyIdToken(m[1]);
  } catch (_) {
    return fail(res, 'unauthenticated');
  }

  const { kind, data } = req.body || {};
  const spec = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!spec) return fail(res, 'bad_kind');
  // base64 is 4/3 the size; refuse an oversized string before decoding it.
  if (typeof data !== 'string' || data.length === 0) return fail(res, 'bad_image');
  if (data.length > Math.ceil(spec.maxBytes / 3) * 4 + 8) return fail(res, 'too_large');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > spec.maxBytes) return fail(res, 'too_large');
  const type = sniff(bytes);
  if (!type) return fail(res, 'bad_image');

  if (!(await io.takeQuota(caller.uid))) return fail(res, 'rate_limited');

  const key = io.storageKey();
  if (!key) {
    console.error('[uploadImage] BUNNY_STORAGE_KEY is not set');
    return fail(res, 'internal');
  }
  // Firebase uids are [A-Za-z0-9]; hash anything else rather than put it in a path.
  const owner = /^[A-Za-z0-9_-]{1,128}$/.test(caller.uid)
    ? caller.uid
    : crypto.createHash('sha256').update(String(caller.uid)).digest('hex').slice(0, 32);
  const path = `${spec.dir}/${owner}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
  const put = await io.put(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${path}`, {
    method: 'PUT',
    headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!put.ok) {
    console.error('[uploadImage] Bunny PUT failed', put.status);
    return fail(res, 'upload_failed');
  }
  return res.status(200).json({ url: `${BUNNY_CDN_BASE}/${path}` });
}

exports.uploadImage = functions
  .runWith({ secrets: [BUNNY_STORAGE_KEY], memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleUpload(req, res);
    } catch (e) {
      console.error('[uploadImage]', e?.message || e);
      if (!res.headersSent) fail(res, 'internal');
    }
  });

exports._internal = { handleUpload, io, KINDS, MAX_PER_HOUR, sniff };
