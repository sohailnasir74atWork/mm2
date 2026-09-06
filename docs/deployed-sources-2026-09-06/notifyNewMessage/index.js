const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

admin.initializeApp();

exports.notifyNewMessage = functions.database
  .ref("/chat_meta_data/{userId}/{chatPartnerId}/unreadCount")
  .onWrite(async (change, context) => {
    const { userId, chatPartnerId } = context.params;
    console.log(`🛠 Triggered: user=${userId}, chatWith=${chatPartnerId}`);

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    if (!afterUnread || afterUnread <= beforeUnread) {
      console.log("⚠️ No increase in unreadCount. Skipping...");
      return null;
    }

    console.log(`✅ Unread count increased to ${afterUnread}`);

    // Fetch all data in parallel to reduce latency
    const [activeUserSnap, chatMetaSnap, fcmTokenSnap] = await Promise.all([
      admin.database().ref(`/activeChats/${userId}`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}`).once("value"),
      admin.database().ref(`/users/${userId}/fcmToken`).once("value"),
    ]);

    if (activeUserSnap.exists()) {
      console.log(`🚫 User ${userId} is active. No notification sent.`);
      return null;
    }

    if (!chatMetaSnap.exists()) {
      console.log("⚠️ Chat metadata not found. Skipping...");
      return null;
    }

    const chatData = chatMetaSnap.val();
    const { chatId, lastMessage, receiverName, timestamp, receiverId } = chatData;

    if (receiverId !== chatPartnerId) {
      console.log(`⚠️ receiverId mismatch: ${receiverId} ≠ ${chatPartnerId}. Skipping...`);
      return null;
    }

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) {
      console.log(`⚠️ Missing FCM token for user: ${userId}`);
      return null;
    }

    console.log(`📡 Sending push notification to: ${fcmToken}`);

    const payload = {
      notification: {
        title: receiverName || "New Message",
        body: lastMessage || "You have a new message.",
      },
      data: {
        chatId: chatId || "",
        senderId: chatPartnerId,
        timestamp: timestamp ? timestamp.toString() : Date.now().toString(),
      },
      token: fcmToken,
    };

    try {
      await admin.messaging().send(payload);
      console.log(`✅ Notification successfully sent to ${userId}`);
    } catch (error) {
      console.error("❌ Failed to send notification:", error);
    }

    return null;
  });
