/**
 * imageUpload.js — every user image upload goes through here.
 *
 * The app no longer holds a Bunny storage key. It sends the image to the
 * uploadImage Cloud Function (functions/uploadImage.js) with the user's
 * Firebase ID token; the server checks the token, the image bytes, the size
 * and an hourly quota, chooses the storage path, uploads to the post-gag zone
 * and returns the public https://pull-gag.b-cdn.net/... URL.
 *
 * Callers pass a `kind` (UPLOAD_KIND below, must match KINDS in
 * functions/uploadImage.js); the server decides the folder from it.
 */
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import RNFS from 'react-native-fs';

const UPLOAD_IMAGE_URL =
  'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net/uploadImage';

export const UPLOAD_KIND = {
  avatar: 'avatar', // profile picture (Settings)
  post: 'post', // feed post images (UploadModal)
  status: 'status', // status feed
  group: 'group', // group icon
  chat: 'chat', // group chat images
  dm: 'dm', // private chat images
  report: 'report', // More ▸ Complaints & ideas screenshots
};

/**
 * Upload one local image. Resolves to its public CDN URL; throws an Error
 * whose `code` is the server's error ('unauthenticated', 'too_large',
 * 'bad_image', 'rate_limited', 'upload_failed', …) or 'network'.
 * @param {string} uri  file:// URI or plain path
 * @param {keyof UPLOAD_KIND} kind
 * @returns {Promise<string>}
 */
export async function uploadImage(uri, kind) {
  const fail = (code) => Object.assign(new Error(`Image upload failed: ${code}`), { code });

  const user = getAuth().currentUser;
  if (!user) throw fail('unauthenticated');
  if (!uri || typeof uri !== 'string') throw fail('bad_image');

  const data = await RNFS.readFile(uri.replace(/^file:\/\//, ''), 'base64');
  const token = await getIdToken(user);

  let res;
  try {
    res = await fetch(UPLOAD_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind, data }),
    });
  } catch (_) {
    throw fail('network');
  }
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok || typeof body?.url !== 'string') throw fail(body?.error || `http_${res.status}`);
  return body.url;
}
