/**
 * reviewModeration.js — staff removal of a trader review: Firestore
 * reviews/{toUserId_fromUserId} is deleted and its stars come out of the rated
 * player's user_ratings_summary in the same transaction, so the two can never
 * disagree. Shared by the Admin Dashboard's review list and More ▸ Admin's
 * "Remove review" on a reported review (2026-10-18), so both keep the same
 * rule: a moderator who is not an admin cannot remove a review written by
 * staff. Callers log the removal with logModAction({ action: 'review_delete' })
 * (Helper/modLog).
 */

import { doc, getDoc, runTransaction, Timestamp } from '@react-native-firebase/firestore';

/**
 * True when the caller may remove a review written by `fromUserId`: admins
 * always; others not when the reviewer is an admin or moderator. A failed
 * profile read lets them through, as the dashboard always did.
 */
// Reviews can be deleted by admins only (owner decision, 2026-10-18).
// Moderators used to remove reviews written by regular players.
export const canDeleteReviews = ({ isAdmin } = {}) => !!isAdmin;

/** Same rule, kept async for the existing callers. */
export async function canRemoveReview(db, fromUserId, roles) {
  return canDeleteReviews(roles);
}

/**
 * Delete the review and take its rating out of the rated player's summary in
 * one transaction. A review that is already gone changes nothing.
 */
export async function deleteReviewAndSummary(fs, { id, toUserId, rating }) {
  const ratingToRemove = Number(rating) || 0;
  const reviewRef = doc(fs, 'reviews', id);
  const summaryRef = toUserId ? doc(fs, 'user_ratings_summary', toUserId) : null;
  await runTransaction(fs, async (tx) => {
    const [rSnap, sSnap] = await Promise.all([tx.get(reviewRef), summaryRef ? tx.get(summaryRef) : null]);
    if (!rSnap.exists()) return; // already gone
    if (sSnap && sSnap.exists()) {
      const s = sSnap.data() || {};
      const oldAvg = Number(s.averageRating) || 0;
      const oldCount = Number(s.count) || 0;
      if (oldCount <= 1 || ratingToRemove <= 0) {
        tx.set(summaryRef, { averageRating: oldCount <= 1 ? 0 : oldAvg, count: Math.max(0, oldCount - 1), updatedAt: Timestamp.now() }, { merge: true });
      } else {
        const newCount = oldCount - 1;
        const newAvg = Math.max(0, Math.min(5, ((oldAvg * oldCount) - ratingToRemove) / newCount));
        tx.set(summaryRef, { averageRating: parseFloat(newAvg.toFixed(2)), count: newCount, updatedAt: Timestamp.now() }, { merge: true });
      }
    }
    tx.delete(reviewRef);
  });
}

/** The review as stored now, or null when it has already been removed. */
export async function fetchReview(fs, reviewId) {
  const snap = await getDoc(doc(fs, 'reviews', reviewId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
