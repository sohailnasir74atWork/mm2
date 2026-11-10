/**
 * scanReportUpload.js — Trade Scanner "Send picture" (2026-11-06, as the Blox
 * and Adopt Me apps).
 *
 * Only on the user's tap: the picked picture and a JSON of what the scan read
 * go to the uploadScanReport Cloud Function (functions/uploadScanReport.js),
 * which stores them as scan-reports/mm2/<random>.{jpg,json} on Bunny. No user
 * id goes with them, signed in or not; the server limits uploads per caller.
 * The scanner team downloads them with RunningApps/_scanner_ml/fetch_reports.py
 * to fix and retrain the scanner. No storage key ships in the app.
 */
import RNFS from 'react-native-fs';
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { safeCompressImage } from './safeCompressImage';

const URL = 'https://us-central1-mm2vlaues-ed80c.cloudfunctions.net/uploadScanReport';

/** Upload the picture and its scan info. Resolves to the report id; throws on failure. */
export const uploadScanReport = async (uri, meta) => {
  const compressed = await safeCompressImage(uri, { returnableOutputType: 'uri' }).catch(() => null);
  const local = compressed?.uri || uri;
  const image = await RNFS.readFile(String(local).replace('file://', ''), 'base64');
  const headers = { 'Content-Type': 'application/json' };
  // Signed-in users get their own upload limit (the token is checked, never stored).
  const user = getAuth().currentUser;
  if (user) {
    const token = await getIdToken(user).catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify({ image, meta }) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) throw new Error(body?.error || `upload ${res.status}`);
  return body.id;
};
