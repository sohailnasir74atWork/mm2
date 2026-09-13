/**
 * cleanUpNoContentMessages — RECOVERED DEPLOYED SOURCE, 2026-09-06.
 *
 * This function is LIVE in production and had no source anywhere in this
 * repo. Recovered verbatim from the deployed archive at
 *   gs://gcf-sources-312806709908-us-central1/cleanUpNoContentMessages-<uuid>/version-1/
 * so a future deploy can rebuild it instead of it being unrecoverable.
 *
 * ⚠️ NOT exported from functions/index.js. Deploying this codebase does not
 * touch the live function. Wire it up only when you intend to redeploy it,
 * and read docs/FUNCTION_AUDIT_2026-09-06.md first — both recovered
 * functions have open defects.
 *
 * Deployed unchanged apart from this header.
 */

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
