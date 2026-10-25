/**
 * Cloud Function: delete dead groups — no messages for INACTIVE_DAYS.
 *
 * LIVE since 2026-10-25 (owner request: inactive 15 days → deleted, warning
 * on the group list from day 7). This permanently deletes user data across
 * six paths; a copy of each group doc goes to Firestore groups_deleted first.
 *
 * Every group it keeps gets groups/{id}.lastActivityAt brought up to date, and
 * notifyGroupMessage bumps that field on each message (at most hourly).
 * GroupsScreen counts down from it: "deleted in N days" from day 7.
 *
 * ── The trap this function exists to avoid ────────────────────────────────
 *
 * The obvious implementation is a Firestore range query:
 *
 *     where('lastMessageTimestamp', '<', cutoff)      // DO NOT DO THIS
 *
 * `groups/{id}.lastMessageTimestamp` is set to null by createGroup and is
 * NEVER UPDATED AGAIN. sendGroupMessage writes the timestamp to RTDB
 * (group_meta_data/{member}/{groupId}/lastMessageTimestamp) and does not touch
 * the Firestore field at all — grep it: there is no writer. So that query
 * classifies EVERY group as dead, including the busiest ones, and deletes the
 * entire feature.
 *
 * The real signal is RTDB. group_messages/{groupId}/messages/{messageId} uses
 * messageId = Date.now(), so the largest key IS the last-activity time and
 * orderByKey().limitToLast(1) reads it in one shallow query.
 *
 * ── What counts as dead ──────────────────────────────────────────────────
 *
 *   activity = newest of: last message, lastActivityAt, createdAt
 *   activity older than INACTIVE_DAYS                -> dead
 *   no messages, created recently                    -> SPARED
 *
 * That last line is deliberate. A group created an hour ago has no messages
 * yet; treating "no messages" alone as dead would delete every new group
 * before anyone could speak in it.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * Follows cleanupOldPrivateChats: resumable cursor at
 * /cleanup_state/deadGroups, bounded concurrency, and a time budget that
 * leaves room to save the cursor. The previous generation of that function
 * iterated sequentially, timed out at 540s every night for weeks and deleted
 * nothing — a cleanup job that silently does nothing is the failure mode to
 * design against.
 *
 * Deploy:
 * firebase deploy --only functions:cleanupDeadGroups --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Set true to log what would be deleted without deleting or writing. */
const DRY_RUN = false;

const INACTIVE_DAYS = 15;
const INACTIVE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
const MAX_DELETE_PER_RUN = 200;
const PAGE_SIZE = 200;           // Firestore docs per page
const GROUP_CONCURRENCY = 15;    // groups inspected in parallel
const TIME_BUDGET_MS = 480 * 1000;
const CURSOR_PATH = '/cleanup_state/deadGroups';
const MAX_LOGGED_SAMPLES = 40;

/** Runs fn over items with at most `limit` in flight. */
const mapWithConcurrency = async (items, limit, fn) => {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
};

/** createdAt may be a Firestore Timestamp, a number, or absent. */
const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value._seconds != null) return value._seconds * 1000;
  return 0;
};

/**
 * Newest message time for a group, from RTDB. 0 when the group has never had
 * a message. Keys are Date.now() strings, so the last key by key-order is the
 * newest — no need to read any message body.
 */
const lastMessageAt = async (rtdb, groupId) => {
  const snap = await rtdb
    .ref(`group_messages/${groupId}/messages`)
    .orderByKey()
    .limitToLast(1)
    .once('value');

  if (!snap.exists()) return 0;
  let newest = 0;
  snap.forEach((child) => {
    const asNumber = Number(child.key);
    if (Number.isFinite(asNumber)) newest = Math.max(newest, asNumber);
    // A non-numeric key means a message written by something that did not use
    // Date.now(). Fall back to the body's own timestamp rather than treating
    // the group as silent.
    else {
      const ts = child.val() && child.val().timestamp;
      if (Number.isFinite(Number(ts))) newest = Math.max(newest, Number(ts));
    }
    return false;
  });
  return newest;
};

/** Every member id we can find, from Firestore and RTDB both. */
const collectMemberIds = async (rtdb, groupId, data) => {
  const ids = new Set();

  for (const id of data.memberIds || []) {
    if (id && typeof id === 'string') ids.add(id);
  }
  for (const id of Object.keys(data.members || {})) {
    if (id) ids.add(id);
  }

  // RTDB mirror, in case the Firestore arrays drifted. deleteGroup() in
  // Code/ChatScreen/utils/groupUtils.js does the same union, and its comment
  // is the reason: miss one member's group_meta_data and that user sees a
  // phantom group forever, with no way to open or leave it.
  try {
    const snap = await rtdb.ref(`groups/${groupId}`).once('value');
    const val = snap.val();
    if (val) {
      const fromRtdb = Array.isArray(val.memberIds)
        ? val.memberIds
        : Object.keys(val.memberIds || val.members || {});
      for (const id of fromRtdb) if (id && typeof id === 'string') ids.add(id);
    }
  } catch (err) {
    console.warn(`[deadGroups] could not read groups/${groupId}: ${err.message}`);
  }

  return [...ids];
};

/** Deletes all six paths a group occupies. Admin SDK bypasses security rules. */
const deleteGroupEverywhere = async (db, rtdb, groupId, memberIds, data, activityAt) => {
  await db.collection('groups_deleted').doc(groupId).set({
    group: data,
    reason: `inactive_${INACTIVE_DAYS}_days`,
    lastActivityAt: activityAt || null,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // One atomic multi-path update for everything in RTDB.
  const updates = {
    [`groups/${groupId}`]: null,
    [`group_messages/${groupId}`]: null,
  };
  for (const memberId of memberIds) {
    updates[`group_meta_data/${memberId}/${groupId}`] = null;
  }
  await rtdb.ref().update(updates);

  await db.collection('groups').doc(groupId).delete();

  for (const name of ['group_invitations', 'group_join_requests']) {
    const snap = await db.collection(name).where('groupId', '==', groupId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
};

exports.cleanupDeadGroups = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 04:30')
  .timeZone('UTC')
  .onRun(async () => {
    const startedAt = Date.now();
    const db = admin.firestore();
    const rtdb = admin.database();
    const cutoff = startedAt - INACTIVE_MS;

    const cursorRef = rtdb.ref(CURSOR_PATH);
    const cursorSnap = await cursorRef.once('value');
    let cursor = (cursorSnap.val() && cursorSnap.val().lastGroupId) || null;

    let scanned = 0;
    let dead = 0;
    let deleted = 0;
    let spared = 0;
    const samples = [];
    let wrapped = false;

    console.log(
      `[deadGroups] ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — cutoff ${new Date(cutoff).toISOString()}` +
      `, resuming after ${cursor || '(start)'}`,
    );

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      let q = db.collection('groups').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);

      const page = await q.get();
      if (page.empty) {
        // End of the collection: wrap so the next run starts from the top.
        cursor = null;
        wrapped = true;
        break;
      }

      const docs = page.docs;
      cursor = docs[docs.length - 1].id;
      scanned += docs.length;

      const verdicts = await mapWithConcurrency(docs, GROUP_CONCURRENCY, async (doc) => {
        const data = doc.data() || {};
        const lastAt = await lastMessageAt(rtdb, doc.id);
        const createdAt = toMillis(data.createdAt);
        const stored = Number(data.lastActivityAt) || 0;
        const activityAt = Math.max(lastAt, createdAt, stored);

        // No date at all: can't tell its age, leave it.
        if (!activityAt) return { doc, data, keep: true };
        if (activityAt > cutoff) {
          // Keep the app's countdown source current (never moves backwards).
          if (!DRY_RUN && activityAt - stored > 60 * 1000) {
            await doc.ref.update({ lastActivityAt: activityAt })
              .catch((err) => console.warn(`[deadGroups] lastActivityAt ${doc.id}: ${err.message}`));
          }
          return { doc, data, keep: true };
        }

        return { doc, data, keep: false, lastAt, createdAt, activityAt };
      });

      for (const v of verdicts) {
        if (v.keep) { spared += 1; continue; }
        dead += 1;

        if (samples.length < MAX_LOGGED_SAMPLES) {
          const when = v.lastAt
            ? `last message ${new Date(v.lastAt).toISOString()}`
            : `never spoken in, created ${v.createdAt ? new Date(v.createdAt).toISOString() : 'unknown'}`;
          samples.push(
            `  ${v.doc.id}  "${v.data.name || v.data.groupName || '(unnamed)'}"  ` +
            `members=${v.data.memberCount != null ? v.data.memberCount : (v.data.memberIds || []).length}  ${when}`,
          );
        }

        if (!DRY_RUN && deleted < MAX_DELETE_PER_RUN) {
          try {
            const memberIds = await collectMemberIds(rtdb, v.doc.id, v.data);
            await deleteGroupEverywhere(db, rtdb, v.doc.id, memberIds, v.data, v.activityAt);
            deleted += 1;
          } catch (err) {
            console.error(`[deadGroups] failed to delete ${v.doc.id}: ${err.message}`);
          }
        }
      }

      if (docs.length < PAGE_SIZE) { cursor = null; wrapped = true; break; }
    }

    await cursorRef.set({ lastGroupId: cursor, updatedAt: Date.now() });

    console.log(
      `[deadGroups] scanned ${scanned}, dead ${dead}, spared ${spared}, ` +
      `${DRY_RUN ? 'deleted 0 (dry run)' : `deleted ${deleted}`}` +
      `, ${wrapped ? 'reached the end, next run restarts' : `stopping at ${cursor}`}` +
      `, ${Date.now() - startedAt} ms`,
    );
    if (samples.length) {
      console.log(`[deadGroups] ${DRY_RUN ? 'would delete' : 'deleted'} (first ${samples.length}):\n${samples.join('\n')}`);
    }

    return null;
  });
