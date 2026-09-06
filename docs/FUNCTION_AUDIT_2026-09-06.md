# MM2 Cloud Functions — full audit of what is actually deployed

> **STATUS 2026-09-06, end of day: both defects below are FIXED and LIVE.**
> The fixed source is `functions/chatMaintenance.js`, now owned by this repo
> and exported from `functions/index.js`. All 14 live functions were
> redeployed from this codebase and every one now reports
> `matches functions/index.js`. The original recovered source is kept
> unchanged in `functions/recovered/` for reference.
>
> `cleanUpNoContentMessages` also moved from `onWrite` to `onCreate`, verified
> live: its trigger is now `providers/google.firebase.database/eventTypes/ref.create`.

2026-09-06. Every live function's **deployed source** was pulled from
`gs://gcf-sources-312806709908-us-central1/` (v1) and
`gs://gcf-v2-sources-312806709908-us-central1/` (v2), not read from the repo.
Extracted copies are in `docs/deployed-sources-2026-09-06/`.

14 functions are live. 9 were deployed today from this repo and are known-good.
The 5 that predate today are audited below.

## Invocations, last 30 days

| Function | Invocations | Share |
|---|---:|---:|
| `notifyNewMessage` | 337,435 | 74% |
| `cleanUpNoContentMessages` | 115,864 | 25% |
| `valueAlertsPoll` | 2,880 | <1% |
| `updateLeaderboardCache` | 60 | <1% |
| **Total** | **456,243** | |

Against a 2M/month free tier, so **$0**. Volume is not the problem here.
Correctness is.

---

## 🔴 `cleanUpNoContentMessages` — deleting legitimate user messages

**Live since 2025-07-02. 115,864 invocations in 30 days. Had no source in the repo.**

The whole function:

```js
const messageText = messageData.text?.trim();
if (!messageText || messageText === "[No content]") {
  return db.ref(`/chat_new/${messageId}`).remove();
}
```

It deletes any public-chat message whose `text` is empty. But the app writes
exactly that, on purpose — `Code/ChatScreen/GroupChat/Trader.jsx:609`:

```js
text: trimmedInput || null, // allow fruits-only messages
```

and its own guard three lines earlier explicitly permits it:

```js
if (!trimmedInput && !hasFruits && !emojiUrl) { ...reject... }
```

So a message carrying **only pets**, or **only a GIF**, is written with
`text: null`, the trigger fires within milliseconds, and the message is
deleted. The user watches their own message disappear.

**Confirmed against live data.** Of the 800 most recent public-chat messages:

| | count |
|---|---:|
| messages with no text at all | **0** |
| messages carrying pets | 124 |
| pets **and** no text | **0** |
| GIF **and** no text | **0** |

124 pet messages survive — every one of them because the sender also happened
to type something. Not one text-free message exists anywhere in the recent
history, which is not plausible for a trading chat and is exactly the
signature of this function.

**Second problem, much smaller:** the trigger is `onWrite` on
`chat_new/{messageId}`, so it also fires on every *delete*. Yesterday's
retention pass deleted 73,988 messages and woke this function 73,988 times.
Each nightly run will now cost roughly one invocation per deleted message.

**Fixed.** Pets, GIFs and images all count as content now. The decision table
was tested across nine cases before deploying:

| message | outcome |
|---|---|
| text only | kept |
| **pets only** | **kept** (was deleted) |
| **GIF only** | **kept** (was deleted) |
| image only | kept |
| `[No content]` + pets | kept |
| `[No content]` alone | deleted |
| whitespace only | deleted |
| nothing at all | deleted |
| empty pets array | deleted |

The ordering matters and caught a bug in the first version of the fix: testing
truthy text before the placeholder let `[No content]` short-circuit as real
content and never be cleaned up. It is normalised to empty first.

Original intended shape:

```js
const hasContent =
  (messageData.text || '').trim() ||
  (Array.isArray(messageData.fruits) && messageData.fruits.length) ||
  messageData.gif ||
  messageData.imageUrl;
if (!hasContent || messageData.text === '[No content]') { ...remove... }
```

and narrow the trigger to `onCreate` so deletes stop waking it.

---

## 🟠 `notifyNewMessage` — one open chat silences every other chat

**Live since 2025-06-06. 337,435 invocations in 30 days. Had no source in the repo.**

```js
const activeUserSnap = await admin.database().ref(`/activeChats/${userId}`).once("value");
if (activeUserSnap.exists()) {
  return null;   // "user is active, no notification"
}
```

It only asks *whether* the node exists. But the app stores **which** chat the
user has open — `Code/ChatScreen/utils.js:350`, `set(activeChatRef, chatId)`.
Live values confirm it:

```
/activeChats/1103WxMzsxdw7f… -> "1103WxMzsxdw7fHiCqwBSVijs333_6PwNxjVAolaFMRpVCVeGETsToNy1"
```

So while a user has **any** private chat open, they receive **no push
notification from any other conversation**. Messages from everyone else land
silently. There were 15 active entries at the time of writing.

It is also one-way fragile: the entry is cleared by `onDisconnect`, but a hard
app kill can leave it behind, and until that user opens another chat they get
no private-chat notifications at all.

**Fixed.** It compares, rather than just checking existence:

```js
const chatId = chatData.chatId;                    // already read below
if (activeUserSnap.val() === chatId) return null;  // only silence THIS chat
```

**Also fixed:** invalid-token cleanup. A send to an unregistered or invalid
token now clears `users/{uid}/fcmToken` and sets the `isTokenInvalid` flag the
app already reads, so the client re-registers instead of the dead token
failing forever.

The original gap was: `notifyPostComment.js` in this repo
removes an FCM token on `messaging/registration-token-not-registered`; this
function only logs. Dead tokens stay on user records forever and every send to
them fails. The app even maintains a `users/{uid}/isTokenInvalid` flag that
nothing server-side sets.

**Not a defect for MM2:** the Adopt Me equivalent checks a per-chat `muted`
flag. MM2 has mute for *group* chats only (`group_meta_data/.../muted`), and
nothing writes a mute flag for private chats, so there is nothing here to
check.

---

## ✅ `updateLeaderboardCache` / `updateLeaderboardCacheManual`

Deployed source is byte-identical to `functions/updateLeaderboardCache.js`
apart from a trailing newline. Both entry points ship from one archive. 60
invocations in 30 days, matching the 12-hour schedule. No action.

`updateLeaderboardCacheManual` is an HTTPS trigger with 0 recorded
invocations. It is a manual escape hatch; harmless, but it is an open HTTP
endpoint that rebuilds the cache on demand.

## ✅ `valueAlertsPoll`

v2, scheduled every 15 minutes, 2,880 invocations in 30 days. Deployed source
is identical to `firebase-value-alerts/functions/index.js`. No action.

Worth knowing: it is deployed from `firebase-value-alerts/`, a **separate
Firebase project directory** with its own `firebase.json`. It is not part of
the main `functions/` codebase and will not be touched by deploys from the
repo root.

---

## Source recovery

`notifyNewMessage` and `cleanUpNoContentMessages` are no longer unrecoverable.
Both are now in `functions/recovered/`, verbatim apart from a header, taken
from the deployed archives.

They are **not** exported from `functions/index.js`, so deploying this repo
still does not touch them. Wire them up only when you intend to redeploy —
and fix the two defects above first, because redeploying them as-is just
reinstalls the bugs.

## Runtime deadline

Every v1 function here runs Node.js 20, which stops accepting deploys on
**2026-10-30**. After that date none of these can be redeployed without a
runtime bump. That includes any fix to the two defects above.

---

## Reproducing this audit: `scripts/fetch-live-functions.js`

The audit above is now a script, so this never has to be done by hand again.

```bash
npm run fetch:functions
# or, for any other project in the account:
node scripts/fetch-live-functions.js --project fruiteblocks
node scripts/fetch-live-functions.js --project adoptme-7b50c --out /tmp/audit
```

It lists every live function, downloads the archive that is **actually
deployed** from its GCS source bucket, extracts it, and compares each one
against the repo. Output:

```
function                       gen  updated     status
--------------------------------------------------------------------------
cleanUpNoContentMessages       1    2025-07-02  matches functions/recovered/… (repo adds a header)
cleanupOldPosts                1    2026-09-06  matches functions/index.js
notifyNewMessage               1    2025-06-06  matches functions/recovered/… (repo adds a header)
valueAlertsPoll                2    2026-07-20  matches firebase-value-alerts/functions/index.js
…
14 live functions.
✅ every live function matches a source file in this repo.
```

Three statuses matter:

- **`NOT IN REPO`** — running code nobody can review or rebuild. This is what
  `notifyNewMessage` and `cleanUpNoContentMessages` were until today.
- **`DRIFTED from <file>`** — what is running is not what the repo says.
- **`matches <file>`** — clean.

Details worth knowing:

- It handles both generations. 1st gen sources live under
  `gcf-sources-<projectNumber>-<region>/<fn>-<uuid>/version-N/`, 2nd gen under
  `gcf-v2-sources-<projectNumber>-<region>/<fn>/`. The uuid cannot be derived,
  so prefixes are listed rather than guessed, and `version-N` directories are
  sorted **numerically** so `version-10` beats `version-9`.
- It compares the deployed entry point against *every* candidate `.js` in the
  repo rather than assuming a filename, because this project deploys in two
  styles: a shared codebase where the archive's `index.js` is
  `functions/index.js`, and the older one-folder-per-function style where the
  archive's `index.js` is that single function.
- A repo file that is the deployed source **plus an added header** counts as a
  match, not drift. Otherwise the two recovered files would report as drifted
  forever.

Verified end to end: with a one-line change injected into
`functions/updateLeaderboardCache.js` the script correctly reported
`DRIFTED`, and reported clean again once reverted.
