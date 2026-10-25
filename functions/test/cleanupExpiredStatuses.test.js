/**
 * cleanupExpiredStatuses against the Firestore emulator, project demo-mm2, so
 * nothing can reach production. From functions/:
 *
 *   export JAVA_HOME=/opt/homebrew/opt/openjdk@24
 *   firebase emulators:exec --config ../firebase.test.json --project demo-mm2 \
 *     --only firestore 'node --test test/cleanupExpiredStatuses.test.js'
 */
const test = require('node:test');
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-mm2';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run under the Firestore emulator (see the header).');
if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const { deleteExpiredStatuses } = require('../cleanupExpiredStatuses');

const fs = admin.firestore();
const { Timestamp } = admin.firestore;
const HOUR = 3600 * 1000;

async function reset() {
  await fs.recursiveDelete(fs.collection('statuses'));
}

test('deletes expired statuses, keeps live ones and ones without expiresAt', async () => {
  await reset();
  const now = Date.now();
  await fs.doc('statuses/old').set({ text: 'a', expiresAt: Timestamp.fromMillis(now - 48 * HOUR) });
  await fs.doc('statuses/justExpired').set({ text: 'b', expiresAt: Timestamp.fromMillis(now - 1000) });
  await fs.doc('statuses/live').set({ text: 'c', expiresAt: Timestamp.fromMillis(now + 12 * HOUR) });
  await fs.doc('statuses/noExpiry').set({ text: 'd' });
  await fs.doc('statuses/old/comments/c1').set({ text: 'orphan?' });

  const res = await deleteExpiredStatuses(fs, Timestamp.fromMillis(now));
  assert.deepStrictEqual(res, { found: 2, deleted: 2 });

  const left = (await fs.collection('statuses').get()).docs.map((d) => d.id).sort();
  assert.deepStrictEqual(left, ['live', 'noExpiry']);
  assert.strictEqual((await fs.collection('statuses/old/comments').get()).size, 0, 'subcollection removed too');
});

test('caps one run at 500 and drains the rest on the next', async () => {
  await reset();
  const past = Timestamp.fromMillis(Date.now() - 48 * HOUR);
  const writer = fs.bulkWriter();
  for (let i = 0; i < 520; i++) writer.set(fs.doc(`statuses/s${i}`), { expiresAt: past });
  await writer.close();

  assert.deepStrictEqual(await deleteExpiredStatuses(fs), { found: 500, deleted: 500 });
  assert.deepStrictEqual(await deleteExpiredStatuses(fs), { found: 20, deleted: 20 });
  assert.deepStrictEqual(await deleteExpiredStatuses(fs), { found: 0, deleted: 0 });
});
