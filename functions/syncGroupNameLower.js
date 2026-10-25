/**
 * syncGroupNameLower — keeps groups/{groupId}.groupNameLower equal to the
 * lowercased group name, so the All Groups search can match regardless of
 * capitals (Firestore range queries are case-sensitive). Ported from Adopt Me
 * 2026-10-25.
 *
 * New app builds write the field themselves on create and rename; this
 * trigger covers older builds and the website, which only write groupName.
 * It returns without writing when the field is already right, so its own
 * update does not loop.
 *
 * Existing groups: scripts/backfill-group-name-lower.js.
 * Deploy by name:
 *   firebase deploy --only functions:syncGroupNameLower --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

if (!admin.apps.length) {
  admin.initializeApp();
}

const OPTS = { region: 'us-central1', memory: '128MiB', timeoutSeconds: 30 };

// Same rule as the app (Code/ChatScreen/utils/groupUtils.js toGroupNameLower).
const toGroupNameLower = (data) => String(data?.groupName || data?.name || '').trim().toLowerCase();

exports.syncGroupNameLower = onDocumentWritten({ ...OPTS, document: 'groups/{groupId}' }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const data = after.data();
  const lower = toGroupNameLower(data);
  if (data.groupNameLower === lower) return;
  await after.ref.update({ groupNameLower: lower });
});

// Exposed for the backfill script and tests.
exports._internals = { toGroupNameLower };
