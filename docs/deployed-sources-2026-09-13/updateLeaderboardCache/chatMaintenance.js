/**
 * chatMaintenance.js — public-chat hygiene and private-chat push.
 *
 * 📅 2026-09-06. These two functions had been live since mid-2025 with NO
 * source in this repo (recovered in functions/recovered/). Both carried real
 * defects; see docs/FUNCTION_AUDIT_2026-09-06.md. This file is the fixed,
 * repo-owned replacement for both.
 *
 * Deploy:
 *   firebase deploy --only functions:cleanUpNoContentMessages,functions:notifyNewMessage --project mm2vlaues-ed80c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = () => admin.database();

// ═══════════════════════════════════════════════════════════════════════
//  cleanUpNoContentMessages
// ═══════════════════════════════════════════════════════════════════════
//
// Removes genuinely empty public-chat messages.
//
// ⚠️ THE BUG THIS FIXES: the previous version deleted any message whose
// `text` was falsy. But Trader.jsx writes `text: trimmedInput || null` on
// purpose — its own send guard explicitly allows a message with no text so
// long as it carries pets or a GIF:
//
//     if (!trimmedInput && !hasFruits && !emojiUrl) { ...reject... }
//     ...
//     text: trimmedInput || null, // allow fruits-only messages
//
// So every pets-only and GIF-only message was deleted milliseconds after
// being sent, and the sender watched it vanish. Measured on live data: of the
// 800 most recent messages, 124 carried pets and ZERO had empty text — every
// text-free message had already been destroyed.
//
// A message is now empty only if it carries no text, no pets, no GIF and no
// image. `[No content]` is kept as an explicit sentinel the client can send.
//
// Trigger is onCreate, not onWrite. onWrite also fired on every DELETE, so
// the nightly retention pass woke this function once per deleted message —
// 73,988 times in a single run on 2026-09-06.
exports.cleanUpNoContentMessages = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .database
  .ref('/chat_new/{messageId}')
  .onCreate(async (snapshot, context) => {
    const { messageId } = context.params;
    const message = snapshot.val();
    if (!message) return null;

    const rawText = typeof message.text === 'string' ? message.text.trim() : '';
    // '[No content]' is the client's placeholder for text it could not
    // compose, so it is not real text. Ordering matters here: checking it
    // after a truthy-text test would let the placeholder short-circuit as
    // content and never be cleaned up.
    const text = rawText === '[No content]' ? '' : rawText;
    const hasPets = Array.isArray(message.fruits) && message.fruits.length > 0;
    const hasMedia = !!message.gif || !!message.imageUrl;

    // Anything a user can legitimately send counts as content. A placeholder
    // sitting alongside real pets still counts, because the pets are real.
    if (text || hasPets || hasMedia) return null;

    console.log(`Deleting empty message ${messageId} (no text, no pets, no media)`);
    return db().ref(`/chat_new/${messageId}`).remove();
  });

// ═══════════════════════════════════════════════════════════════════════
//  notifyNewMessage
// ═══════════════════════════════════════════════════════════════════════
//
// Push notification for a new private message, fired off the recipient's
// unread counter.
//
// ⚠️ BUG 1 THIS FIXES: the previous version silenced the notification whenever
// `/activeChats/{userId}` merely EXISTED. But the app stores WHICH chat is
// open there (utils.js: `set(activeChatRef, chatId)`), so having any one
// conversation open suppressed notifications from every other conversation.
// It now compares the open chat against the chat that received the message.
//
// ⚠️ BUG 2 THIS FIXES: a send to a dead FCM token was only logged, so stale
// tokens stayed on user records forever and every future send to them failed.
// Unregistered tokens are now cleared, and the app's own `isTokenInvalid`
// flag is set so the client re-registers.
exports.notifyNewMessage = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .database
  .ref('/chat_meta_data/{userId}/{chatPartnerId}/unreadCount')
  .onWrite(async (change, context) => {
    const { userId, chatPartnerId } = context.params;

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    // Only a genuine increase is a new message. This also filters out the
    // reset-to-zero write the reader performs when opening a chat.
    if (!afterUnread || afterUnread <= beforeUnread) return null;

    const [activeChatSnap, chatMetaSnap, fcmTokenSnap] = await Promise.all([
      db().ref(`/activeChats/${userId}`).once('value'),
      db().ref(`/chat_meta_data/${userId}/${chatPartnerId}`).once('value'),
      db().ref(`/users/${userId}/fcmToken`).once('value'),
    ]);

    if (!chatMetaSnap.exists()) return null;

    const chatData = chatMetaSnap.val();
    const { chatId, lastMessage, receiverName, timestamp, receiverId } = chatData;

    // Guards against a half-written metadata row addressing the wrong person.
    if (receiverId !== chatPartnerId) return null;

    // Silence ONLY the conversation the user is currently reading.
    if (chatId && activeChatSnap.val() === chatId) {
      console.log(`${userId} is reading this chat; no push.`);
      return null;
    }

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) return null;

    try {
      await admin.messaging().send({
        notification: {
          title: receiverName || 'New Message',
          body: lastMessage || 'You have a new message.',
        },
        data: {
          chatId: chatId || '',
          senderId: chatPartnerId,
          timestamp: timestamp ? timestamp.toString() : Date.now().toString(),
        },
        token: fcmToken,
      });
    } catch (error) {
      console.error('Push failed:', error && error.code, error && error.message);

      // A token the device no longer owns will never work again. Clearing it
      // stops every future send to this user from failing, and the app
      // re-registers on next launch when it sees isTokenInvalid.
      if (error && (error.code === 'messaging/registration-token-not-registered'
                 || error.code === 'messaging/invalid-registration-token'
                 || error.code === 'messaging/invalid-argument')) {
        try {
          await db().ref(`/users/${userId}`).update({ fcmToken: null, isTokenInvalid: true });
          console.log(`Cleared dead FCM token for ${userId}`);
        } catch (e) {
          console.warn('Could not clear token:', e.message);
        }
      }
    }

    return null;
  });
