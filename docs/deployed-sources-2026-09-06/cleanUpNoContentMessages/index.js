const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

admin.initializeApp();
const db = admin.database();

exports.cleanUpNoContentMessages = functions.database
  .ref("/chat_new/{messageId}") // Listen for new messages
  .onWrite(async (change, context) => {
    const messageId = context.params.messageId;
    const messageData = change.after.val(); // Get the new message

    if (!messageData) {
      return null; // Message was deleted, do nothing
    }

    const messageText = messageData.text?.trim();

    // 🚀 Check if the message is "[No content]" and delete it
    if (!messageText || messageText === "[No content]") {
      console.log(`🔥 Deleting message: ${messageId} (No content found)`);
      return db.ref(`/chat_new/${messageId}`).remove();
    }

    return null; // Nothing to do if the message is valid
  });
