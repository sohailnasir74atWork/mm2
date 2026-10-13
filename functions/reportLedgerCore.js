/**
 * reportLedgerCore.js — who reported what, so one account cannot trigger an
 * auto-ban on its own. Pure (no React Native, no Firebase).
 *
 * 📅 2026-10-13. Both auto-bans (functions/reportAutoBan.js) used to act on a
 * bare counter: the same person reporting a chat message or a feed post twice
 * banned its author. New builds also record the reporter:
 *
 *   chat  RTDB chat_reports/{room}/{msgId}/{uid}: true, in the same
 *         multi-path write as the reportCount +1 (ReportPopUp.jsx)
 *   feed  designPosts/{post}.reportedBy: arrayUnion(uid), in the same
 *         transaction as the reportCount +1 (ReportModal.js)
 *
 * Old builds write neither, so a message or post WITHOUT a ledger is still
 * judged on its counter alone (exactly as before). Once a ledger exists it
 * must hold 2 distinct reporters. The author's own uid never counts, and on
 * its own does not even make a ledger exist.
 *
 * Server copy of Code/Helper/reportLedger.js (functions/ deploys on its own,
 * so it cannot require the app's file). MUST stay identical to it — the
 * functions test (test/reportAutoBan.test.js) runs both over the same cases.
 */

const REPORT_BAN_THRESHOLD = 2;

/**
 * Distinct reporters in a ledger, excluding the author. null = no ledger
 * (an old build reported, or nobody did): judge on the counter alone.
 * Accepts the RTDB map ({uid: true}) or the Firestore array ([uid]).
 */
const distinctReporters = (ledger, authorId) => {
  let ids;
  if (Array.isArray(ledger)) {
    ids = ledger;
  } else if (ledger && typeof ledger === 'object') {
    ids = Object.keys(ledger).filter((k) => ledger[k] === true);
  } else {
    return null;
  }
  const set = new Set(ids.filter((u) => typeof u === 'string' && u && u !== authorId));
  return set.size === 0 ? null : set.size;
};

/** True when the ledger (if any) holds enough distinct reporters. */
const ledgerAllowsBan = (ledger, authorId) => {
  const n = distinctReporters(ledger, authorId);
  return n === null || n >= REPORT_BAN_THRESHOLD;
};

/** A feed post that has been reported enough to post-ban its author. */
const postQualifies = (doc) =>
  !!doc && doc.banned === true
  && Number(doc.reportCount) >= REPORT_BAN_THRESHOLD
  && ledgerAllowsBan(doc.reportedBy, doc.userId);

/**
 * Does this write (before → after) cross into "ban the author"? True at most
 * once per post: reportedBy only grows and `banned` is never cleared.
 * A post already `banned` with no ledger was handled by the old path (the
 * reporter's app, or the function before the ledger existed), so it never
 * fires again; new builds do not start a ledger on such a post.
 */
const postReportCrossesBan = (before, after) => {
  if (!postQualifies(after) || postQualifies(before)) return false;
  if (before && before.banned === true && distinctReporters(before.reportedBy, before.userId) === null) return false;
  return true;
};

module.exports = {
  REPORT_BAN_THRESHOLD,
  distinctReporters,
  ledgerAllowsBan,
  postQualifies,
  postReportCrossesBan,
};
