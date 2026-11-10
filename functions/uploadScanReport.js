/**
 * uploadScanReport — Trade Scanner "Send picture" (2026-11-06).
 *
 * POST JSON { image: <base64 JPEG/PNG/WebP/HEIC>, meta: <object> }
 * Authorization: Bearer <Firebase ID token>   (optional)
 * → 200 { id } | 4xx/5xx { error }
 *
 * The app (Code/Helper/scanReportUpload.js) sends this only when the user
 * taps Send picture on a scan. Stored on Bunny (zone post-gag) as
 * scan-reports/mm2/<id>.jpg (or the image's own type) + <id>.json, the same
 * folder layout as the Adopt Me app's reports. Nothing about the user is
 * stored: no uid, no IP; the path is a random id. The privacy policy
 * promises these are deleted after 12 months.
 *
 * Abuse limits: image bytes checked (magic bytes), 4 MB image, 64 KB meta,
 * and an hourly quota per caller held in RTDB scan_report_quota/<key>
 * (no client rule, so database.rules.json denies it): signed-in callers by
 * uid, everyone else by a salted hash of the IP, plus one global cap.
 *
 * Deploy (by name — see HANDOFF.md for why never a bare --only functions):
 *   firebase deploy --only functions:uploadScanReport --project mm2vlaues-ed80c
 * Test: node --test functions/test/uploadScanReport.test.js
 */
const functions = require('firebase-functions/v1');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { _internal: { sniff } } = require('./uploadImage');

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUNNY_STORAGE_KEY = defineSecret('BUNNY_STORAGE_KEY');
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const DIR = 'scan-reports/mm2';

const MB = 1024 * 1024;
const MAX_IMAGE = 4 * MB;
const MAX_META = 64 * 1024;
const PER_CALLER_PER_HOUR = 10;
const ALL_PER_HOUR = 500;

const STATUS = {
  method_not_allowed: 405, bad_image: 400, bad_meta: 400, too_large: 413,
  rate_limited: 429, upload_failed: 502, internal: 500,
};
const fail = (res, error) => res.status(STATUS[error] || 400).json({ error });

async function takeQuota(key, max) {
  const hour = Math.floor(Date.now() / 3600000);
  const { committed } = await admin.database().ref(`scan_report_quota/${key}`).transaction((cur) => {
    if (!cur || cur.h !== hour) return { h: hour, n: 1 };
    if (cur.n >= max) return undefined; // abort
    return { h: hour, n: cur.n + 1 };
  });
  return committed;
}

const io = {
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  takeQuota,
  storageKey: () => BUNNY_STORAGE_KEY.value(),
  put: (url, init) => fetch(url, init),
  id: () => crypto.randomUUID(),
};

// Who the quota counts against. Never stored with the report.
async function callerKey(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const t = await io.verifyIdToken(m[1]);
      return `u_${crypto.createHash('sha256').update(String(t.uid)).digest('hex').slice(0, 32)}`;
    } catch (_) {
      // A bad token counts as signed out.
    }
  }
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  return `ip_${crypto.createHash('sha256').update(`scan-report:${ip}`).digest('hex').slice(0, 32)}`;
}

async function handleReport(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return fail(res, 'method_not_allowed');

  const { image, meta } = req.body || {};
  if (typeof image !== 'string' || !image.length) return fail(res, 'bad_image');
  if (image.length > Math.ceil(MAX_IMAGE / 3) * 4 + 8) return fail(res, 'too_large');
  const bytes = Buffer.from(image, 'base64');
  if (bytes.length > MAX_IMAGE) return fail(res, 'too_large');
  const type = sniff(bytes);
  if (!type || type.ext === 'gif') return fail(res, 'bad_image');
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return fail(res, 'bad_meta');
  const json = Buffer.from(JSON.stringify(meta));
  if (json.length > MAX_META) return fail(res, 'too_large');

  if (!(await io.takeQuota(await callerKey(req), PER_CALLER_PER_HOUR))) return fail(res, 'rate_limited');
  if (!(await io.takeQuota('_all', ALL_PER_HOUR))) return fail(res, 'rate_limited');

  const key = io.storageKey();
  if (!key) {
    console.error('[uploadScanReport] BUNNY_STORAGE_KEY is not set');
    return fail(res, 'internal');
  }
  const id = io.id();
  for (const [name, body] of [[`${id}.${type.ext}`, bytes], [`${id}.json`, json]]) {
    const put = await io.put(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${DIR}/${name}`, {
      method: 'PUT',
      headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
      body,
    });
    if (!put.ok) {
      console.error('[uploadScanReport] Bunny PUT failed', put.status);
      return fail(res, 'upload_failed');
    }
  }
  return res.status(200).json({ id });
}

exports.uploadScanReport = functions
  .runWith({ secrets: [BUNNY_STORAGE_KEY], memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleReport(req, res);
    } catch (e) {
      console.error('[uploadScanReport]', e?.message || e);
      if (!res.headersSent) fail(res, 'internal');
    }
  });

exports._internal = { handleReport, io, PER_CALLER_PER_HOUR };
