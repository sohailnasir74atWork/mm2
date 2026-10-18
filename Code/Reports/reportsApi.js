/**
 * reportsApi.js — More ▸ Complaints & ideas: a player sends a complaint (with
 * a category) or a suggestion, with text and up to three images; admins read
 * them in More ▸ Admin. Lives in RTDB /user_reports (rules in
 * database.rules.json):
 *
 *   * a signed-in player can only CREATE, as themselves, with status 'open'
 *     and a server timestamp — and at most one a minute: the same write must
 *     stamp /user_report_last/{uid}, whose rule refuses a stamp under 60 s old;
 *   * a player can read only their own (query by userId, so "Your reports"
 *     shows whether each was looked at);
 *   * admins read everything, flip status open/done and delete.
 *
 * Images go to the public Bunny zone through the uploadImage Cloud Function
 * (kind 'report' → report-images/<uid>/<time>-<random>.<ext>); the rule only
 * accepts URLs under the sender's own folder there.
 *
 * Ported from Adopt Me (adoptme-jan7/Code/Reports/reportsApi.js) on
 * 2026-10-13. Adopt Me uploads straight to Bunny with an embedded key; MM2
 * never holds a storage key, so the picker and upload below replace its
 * Helper/modEvidenceUpload.js.
 */

import {
  ref, push, update, remove, get, query, orderByChild, equalTo, limitToLast, endAt, serverTimestamp,
} from '@react-native-firebase/database';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { safeCompressImage } from '../Helper/safeCompressImage';
import { pickImages } from '../Helper/imagePicker';
import { uploadImage, UPLOAD_KIND } from '../Helper/imageUpload';

export const REPORT_TEXT_MAX = 2000;
export const MAX_REPORT_IMAGES = 3;
// ban_appeal (2026-10-18): the ban card's "Send an appeal" opens the form with
// it picked; the rule takes any category string up to 30 characters.
export const COMPLAINT_CATEGORIES = ['false_review', 'moderation', 'ban_appeal', 'scam', 'bug', 'other'];

/**
 * Open the library and return local uris, capped so the caller never holds
 * more than MAX_REPORT_IMAGES. [] when the player cancels; THROWS when the
 * picker itself fails, so the screen can say so instead of doing nothing.
 */
export async function pickReportImages(alreadyPicked = 0) {
  const remaining = Math.max(0, MAX_REPORT_IMAGES - alreadyPicked);
  if (remaining === 0) return [];
  const res = await pickImages({
    mediaType: 'photo',
    selectionLimit: remaining,
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.9,
  });
  if (res?.didCancel) return [];
  if (res?.errorCode) throw new Error(res.errorMessage || `Photo picker failed (${res.errorCode}).`);
  return (res?.assets || []).map((a) => a?.uri).filter(Boolean).slice(0, remaining);
}

// Compress (best-effort: a failure costs bytes, not the upload), then upload.
// Throws on the first failed upload so the player can retry with the images
// still in hand. `onProgress(done, total)` fires after each one.
async function uploadReportImages(uris, onProgress) {
  const list = (Array.isArray(uris) ? uris : []).filter(Boolean).slice(0, MAX_REPORT_IMAGES);
  const urls = [];
  for (const uri of list) {
    // safeCompressImage never throws; on any failure it hands back the original.
    const out = await safeCompressImage(uri, { maxWidth: 1600, quality: 0.8, returnableOutputType: 'uri' });
    const local = out.uri || uri;
    urls.push(await uploadImage(local, UPLOAD_KIND.report));
    if (typeof onProgress === 'function') onProgress(urls.length, list.length);
  }
  return urls;
}

const appLabel = () => {
  try {
    return `${Platform.OS} ${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`.slice(0, 60);
  } catch (e) {
    return Platform.OS;
  }
};

const toList = (val) =>
  Object.entries(val || {})
    .map(([id, v]) => ({ id, ...v, images: Array.isArray(v?.images) ? v.images.filter(Boolean) : Object.values(v?.images || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

const write = (db, uid, key, report) => update(ref(db), {
  [`user_reports/${key}`]: report,
  [`user_report_last/${uid}`]: serverTimestamp(),
});

/**
 * Upload the images, then write the report and the rate-limit stamp in one
 * update. Throws { code: 'too_soon' } when the rule refuses it inside a minute
 * of the last one (the only refusal a valid form can hit).
 *
 * `review` ({ id, toUserId }) is set by "Report review": the report carries
 * reviewId + reviewedUserId so the inbox can show the review and remove it in
 * one tap. Those two fields need the 2026-10-18 rules; until they are live the
 * write is refused, so it is retried once with the ids in the text instead.
 */
export async function sendReport(db, user, { type, category, text, imageUris = [], review = null }, onProgress) {
  const uid = user?.id;
  if (!uid) throw Object.assign(new Error('sign in'), { code: 'sign_in' });
  const images = await uploadReportImages(imageUris, onProgress);
  const key = push(ref(db, 'user_reports')).key;
  const report = {
    userId: uid,
    userName: String(user.displayName || user.userName || 'Player').slice(0, 60),
    type,
    text: text.trim().slice(0, REPORT_TEXT_MAX),
    app: appLabel(),
    createdAt: serverTimestamp(),
    status: 'open',
  };
  if (type === 'complaint' && category) report.category = category;
  if (user.avatar && String(user.avatar).length <= 500) report.avatar = String(user.avatar);
  if (images.length) report.images = images;
  const reviewId = review?.id ? String(review.id).slice(0, 128) : null;
  const reviewedUserId = review?.toUserId ? String(review.toUserId).slice(0, 128) : null;
  if (reviewId) report.reviewId = reviewId;
  if (reviewedUserId) report.reviewedUserId = reviewedUserId;
  try {
    await write(db, uid, key, report);
  } catch (e) {
    // The only rule a well-formed report can trip is the one-a-minute stamp.
    const last = await get(ref(db, `user_report_last/${uid}`)).then((s) => s.val()).catch(() => null);
    if (last && Date.now() - last < 120000) throw Object.assign(new Error('too soon'), { code: 'too_soon' });
    if (!reviewId) throw e;
    const plain = { ...report };
    delete plain.reviewId;
    delete plain.reviewedUserId;
    const tag = `\n\n[review ${reviewId}${reviewedUserId ? ` · user ${reviewedUserId}` : ''}]`;
    plain.text = `${plain.text.slice(0, REPORT_TEXT_MAX - tag.length)}${tag}`;
    await write(db, uid, key, plain);
  }
  return key;
}

export async function fetchMyReports(db, uid) {
  const snap = await get(query(ref(db, 'user_reports'), orderByChild('userId'), equalTo(uid), limitToLast(20)));
  return toList(snap.val());
}

// ── Admin ────────────────────────────────────────────────────────────────

/**
 * Newest `n` reports, or the `n` before `beforeCreatedAt` for "Load older".
 * endAt is inclusive, so the boundary row comes back again; callers merge by
 * id.
 */
export async function fetchReportsPage(db, n = 40, beforeCreatedAt = null) {
  const base = [ref(db, 'user_reports'), orderByChild('createdAt')];
  const q = beforeCreatedAt == null
    ? query(...base, limitToLast(n))
    : query(...base, endAt(beforeCreatedAt), limitToLast(n + 1));
  return toList((await get(q)).val());
}

export const setReportStatus = (db, id, status) => update(ref(db, `user_reports/${id}`), { status });
export const deleteReport = (db, id) => remove(ref(db, `user_reports/${id}`));

// Feedback that older app builds still send from their News screen. Old poll
// votes share the node and are dropped, so a page can come back with fewer
// rows than asked for; `cursor` (the oldest createdAt fetched) and `end` are
// what paging goes by.
export async function fetchLegacyFeedbackPage(db, n = 40, beforeCreatedAt = null) {
  const base = [ref(db, 'news_feedback'), orderByChild('createdAt')];
  const q = beforeCreatedAt == null
    ? query(...base, limitToLast(n))
    : query(...base, endAt(beforeCreatedAt), limitToLast(n + 1));
  const raw = Object.entries((await get(q)).val() || {}).map(([id, v]) => ({ id, ...v }));
  const times = raw.map((v) => v.createdAt).filter((x) => typeof x === 'number');
  return {
    rows: raw.filter((v) => v.type !== 'poll_vote' && v.text).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    cursor: times.length ? Math.min(...times) : null,
    end: raw.length < (beforeCreatedAt == null ? n : n + 1),
  };
}

export const deleteLegacyFeedback = (db, id) => remove(ref(db, `news_feedback/${id}`));
