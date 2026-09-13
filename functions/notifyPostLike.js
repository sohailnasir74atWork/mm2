/**
 * notifyPostLike — tell a post's author when someone likes it.
 *
 * 📅 2026-09-13. The feed had no like notification at all, and its comment
 * notification (notifyPostComment) was written but left commented out of the
 * deploy manifest, so neither of the feed's two social actions reached anyone.
 *
 * ── Why this is narrower than the comment notification ───────────────────
 *
 * notifyPostComment fans out to the author, every previous commenter and every
 * liker — up to 50 people per comment. That is defensible for a comment, which
 * is a conversation others have opted into.
 *
 * A like is not a conversation. It is high-frequency, low-signal, and fanning
 * it out the same way would mean a popular post pushing dozens of "someone
 * liked a post you liked" notifications to people who did not ask. So this
 * notifies EXACTLY ONE person: the author.
 *
 * ── The cost trap in an onUpdate trigger ─────────────────────────────────
 *
 * This fires on EVERY write to a post document — including the commentCount
 * increment that notifyPostComment's own path triggers. So the very first
 * thing it does is diff the likes map and return when nothing was added. That
 * keeps the common case to one cheap invocation with no reads.
 *
 * Unlikes are ignored on purpose: `likes.{uid}` is deleted on unlike, and
 * "someone stopped liking your post" is not a notification anyone wants.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const likeKeys = (data) => {
  const likes = data && data.likes;
  return likes && typeof likes === 'object' ? Object.keys(likes) : [];
};

exports.notifyPostLike = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore.document('designPosts/{postId}')
  .onUpdate(async (change, context) => {
    const { postId } = context.params;
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    // Diff first, before any read. Most invocations of this trigger are not
    // likes at all.
    const beforeLikes = new Set(likeKeys(before));
    const added = likeKeys(after).filter((uid) => !beforeLikes.has(uid));
    if (added.length === 0) return null;

    const authorId = after.userId || before.userId;
    if (!authorId) return null;

    // A single write can only realistically add one like, but take the last in
    // case a batch lands several — naming one person is better than "3 people".
    const likerId = added[added.length - 1];
    if (likerId === authorId) return null; // liking your own post

    try {
      const [tokenSnap, prefsSnap, likerSnap] = await Promise.all([
        admin.database().ref(`/users/${authorId}/fcmToken`).once('value'),
        admin.database().ref(`/users/${authorId}/notificationSettings`).once('value'),
        admin.database().ref(`/users/${likerId}/displayName`).once('value'),
      ]);

      const fcmToken = tokenSnap.val();
      if (!fcmToken) {
        console.log(`⚠️ no fcmToken for post author ${authorId}`);
        return null;
      }

      const prefs = prefsSnap.val() || {};
      // Opt-out, consistent with postCommentNotifications. Absent means on.
      if (prefs.postLikeNotifications === false) {
        console.log(`user ${authorId} has post like notifications off`);
        return null;
      }

      const likerName = likerSnap.val() || 'Someone';
      const desc = after.desc || after.description || '';
      const shortDesc = desc.length > 50 ? `${desc.substring(0, 50)}...` : desc;

      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'New like on your post',
          body: shortDesc
            ? `${likerName} liked your post: "${shortDesc}"`
            : `${likerName} liked your post`,
        },
        data: { type: 'post_like', postId, likerId },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      console.log(`❤️ notified ${authorId} that ${likerId} liked ${postId}`);
      return null;
    } catch (err) {
      // Never rethrow: a failed notification must not retry the trigger and
      // re-send on success-after-failure.
      console.error(`notifyPostLike failed for ${postId}:`, err.message);
      return null;
    }
  });
