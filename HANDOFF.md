# MM2 Values — handoff

Last updated **2026-09-13**. Firebase project `mm2vlaues-ed80c`.
**Firebase only. Do not add Supabase** — that is a standing decision, and it is
why every port from Adopt Me needs rewriting rather than copying.

Detail lives in `PLAN_2026-09.md` (§1–9) and
`docs/FUNCTION_AUDIT_2026-09-06.md`. This file is the short version.

---

## 0a. 2026-09-23 — Admin Dashboard brought level with Adopt Me

The ask: staff must be able to remove anyone's review/rating, and the console
should match Adopt Me's. Adopt Me keeps its audit log in Supabase; here it is
Firestore, per the standing Firebase-only rule. **Nothing below is deployed.**

### What an admin gets now

| Tab | What it does |
|---|---|
| Restrictions | Paged (40 per page, keyset on `bannedAt`) so it reaches every restricted user. Mutes visible with a MUTED chip and their own filter. |
| Users | Search by display name, **exact email** (new `email` index on `users`), or user ID. Live BANNED / MUTED / ACTIVE chip per row, checked once and cached. |
| Mod Log | **By moderator** leaderboard (actions and distinct users touched, 7/30/90 days) and a **Recent actions** feed filterable by type and moderator. Tap an entry to open the user. |
| Chats (admin) | Pick two users by name/email/ID. Paged 100 per page with "Load older". Renders images, galleries, quoted replies, attachments. Delete the whole conversation for both sides. |
| User Chats (admin) | Find a user, list every private conversation (paged on `timestamp`), tap to read it. |
| Statuses | Newest first, paged. Admins and moderators can delete; logged. |
| Access | Grant JMD-granting power by name/email/ID instead of a pasted uid. |

**User sheet:** facts strip (member since, rating + review count, Roblox),
**Reviews received** with a trash icon (admins remove any; moderators remove
any except reviews written by staff), **Moderation record** (what is in force
now, tallies, full timeline with reason / who / role / source), then actions.
Every ban, strike, mute and unban goes through a **reason prompt** with
one-tap common reasons.

### Review removal — how it works

`AdminDashboard.deleteReview`: one Firestore transaction deletes
`reviews/{id}` and adjusts `user_ratings_summary/{uid}` (count − 1, average
recomputed, last review resets to 0/0). The two can never disagree. A
`review_delete` row is appended to the audit log with the reviewer, rating
and text, so the user's record shows who removed what and why.

### The audit log — `Code/Helper/modLog.js`

Firestore `mod_actions`, append-only by convention (the stage-1 catch-all
rules cannot enforce it; the intended stage-2 rule is written in
`firestore.rules`). Every writer in `ChatScreen/utils.js` — ban, strike,
mute, unban — now appends a row, fire-and-forget: a log failure never fails a
ban. Rows carry denormalised names, so timelines cost no profile reads.
Per-user tallies use `getCountFromServer`; the leaderboard reads at most the
latest 500 rows of the window. No listeners anywhere.

**History starts when this build ships.** Earlier actions were never recorded
anywhere and cannot be backfilled.

### Bugs fixed on the way

- **Report auto-ban alerted the reporter.** `ReportModal.js` passed `userId`
  into the `isAdmin` slot. The reporting user saw "User Banned" and the record
  saved `userId: null`. Same bug in `PostCard.js`'s Ban User menu.
- **A mute silently released a permanent ban.** Mute and ban share one record
  written with `set()`. `muteUser` now refuses to shorten a longer live
  sanction and says why.
- **Strike history could never show more than one row** — it read the single
  live record. Now the live record and the history are separate, labelled
  things.
- Junior mods' mute cap, the moderator kill switch and staff-only sanctioning
  are all funnelled through one `requestAction` gate.

### Deploy checklist (in order)

```
firebase deploy --only firestore:indexes --project mm2vlaues-ed80c   # 5 new mod_actions indexes
firebase deploy --only database --project mm2vlaues-ed80c            # users.email + chat_meta_data timestamp indexes
```

Until the indexes build, the Mod Log and a profile's history show
"Could not load history" with Firestore's index link in the message — that is
the index, not a bug. Email search and User Chats work without their RTDB
indexes but scan server-side and log a warning until the rules deploy.

Call-site signatures are additive: every existing `banUserwithEmail`,
`setUserStrike`, `muteUser`, `unbanUserWithEmail` caller keeps working. New
trailing params: `source`, and for unban `bannerInfo, reason, source`.

---

## 0. 2026-09-13 — what changed, and what it means for you

Four commits on this branch since 1.3.7: `ce480c0`, `1466b2d`, `efe386d`,
`34e630e`. **27 Cloud Functions are now live** (was 15). Android **1.4.2 (34)**.

### Supreme is now the default value source

The app used to be MM2-only. It now carries both catalogues, and **Supreme is
what a new install sees**. The toggle is the user's and persists.

Know what that costs before judging a bug report: **Supreme does not price
leaderboard awards, and that is where the top of the game lives.** All 25 of
MM2's most valuable items — Gold Minty, Gold LogChopper, Nik's Scythe — are
unpriced there. They render by reason ("Award only", "Priceless") with MM2's
figure as a labelled reference, never as 0. If someone reports "my 500M item
shows no value", that is this, working correctly.

`Code/Helper/valueSources.js` is the single place that knows how the two feeds
differ — images, name matching, value confidence, the merged pool, the toggle.
Read its header before touching any values code.

### Things that were silently broken and are now fixed

Each of these looked fine and did nothing:

| | was |
|---|---|
| CDN fetch | both URLs 404'd; one shared try block meant a Supreme failure also discarded good MM2 data, falling back to Firebase every refresh |
| `valueAlertsPoll` | polled a renamed URL **96×/day**, failed at step one every time. Value alerts were dead for months |
| `notifyPostComment` | fully written, export commented out — a comment on your post notified nobody |
| `localState.suprime` | written to MMKV, never read back on cold start |
| "Updated just now" | seeded from `new Date()` at mount, so it said that permanently |
| `imgurl` in the fetch guard | an empty config node forced a full catalogue download **on every launch** |
| moderator "delete last messages" | only ever scanned English chat |
| native ad call-to-action | unclickable — see §9 |

### Cost changes

- Values cache **6 minutes → 24 hours**; manual refresh always goes live.
- `valueAlertsPoll` **every 15 min → hourly**. It is cache-busted, so each poll
  pulled the full file from origin: ~27 MB/day to observe a change that happens
  twice a week.
- The `imgurl` guard above was likely a real share of the Bunny bill.

### Ten language chat rooms

`chat_new` is English and keeps its name — it holds every message ever sent.
Nine new nodes, each with rules + `.indexOn`, retention, and its own moderation
trigger. **All three are required**: a channel missing any one of them grows
unbounded, unindexed, or unmoderated.

`Code/ChatScreen/chatChannels.js` and `functions/chatChannels.js` must stay in
step with each other **and** with `database.rules.json`. Change one, change all
three.

### Backward compatibility — the rule everything follows

Everything added is **additive and null-tolerant**:

- absent `valueSource` on a trade → MM2 (all there was)
- absent `valueConfidence` → summable (the old behaviour). **Reverse this and
  every one of the 8,799 existing trades silently totals zero.**
- saved trades' absolute image URLs pass through untouched
- old raw CDN payloads still unwrap

11 dedicated tests cover this. 131 assertions across 10 suites in total; the
scratch harnesses are not in the repo, but `valueSources.js` is pure and easy
to re-test.

---

## 0b. Open cost findings — decisions for you, not bugs

**`cleanupOldPrivateChats` is written but deliberately not deployed.**
`private_messages` holds **~72,500 chat keys** and has never been cleaned. The
function was rewritten on 2026-09-02 because the previous version timed out
nightly and deleted nothing. It stays off because deleting private
conversations was never asked for — `functions/index.js` says so explicitly.
Enabling it is a product decision. It is the largest single storage item.

**`users` is ~85,400 records** and only grows.

**Node.js 20 is decommissioned 2026-10-30.** Every deploy now warns. After that
date nothing can be redeployed, including a fix to a live bug. This is the
closest hard deadline in the project.

---

## 1. Where things stand

**Server side is live. Client side is built but not shipped.**

| | State |
|---|---|
| Firestore rules | live — anonymous writes blocked |
| RTDB rules | live — user enumeration blocked, role flags write-protected |
| Firestore indexes | live — 14, including trade search and polls |
| Cloud Functions | live — **27** (15 before 2026-09-13) |
| RTDB chat rules | live — **10 language channels**, each indexed |
| 15-day retention | live nightly, **all 10 chat channels** |
| Feed notifications | live — comments **and** likes, both new on 2026-09-13 |
| Android build | **built, not uploaded to Play** |
| Git | **committed to a branch, not pushed to `main`** |

Data after retention (measured 2026-09-06): 17,374 chat messages, 8,799 trades,
607 feed posts, 0 polls. RTDB key counts on 2026-09-13: `users` ~85,400,
`private_messages` ~72,500, `chat_meta_data` ~27,500, `chat_new` ~13,900.

### The build

`android/app/build/outputs/bundle/release/app-release.aab`
versionName **1.4.4**, versionCode **36**, built 2026-09-21 for internal
testing, signed with `android/app/solanalab.keystore`. iOS is **3.8 (39)**.

Earlier builds are kept beside it (`.v35`, and previously `.v26`, `.v27`,
`.v29`, `.v30`, `.PREV-2026-07-29`) rather than overwritten. Delete them once
1.4.4 is live.

This entry read "1.4.2 (34)" until 2026-09-21, but the bundle on disk was
already **1.4.3 (35)** — built 2026-09-16 and never recorded here. That is why
36 was used rather than 35: a second bundle at 35 would have been rejected by
Play as a duplicate versionCode if 35 had ever been uploaded. Read the AAB, do
not trust this line:

    python3 -c "import zipfile;d=zipfile.ZipFile('app-release.aab').read('base/manifest/AndroidManifest.xml');i=d.find(b'versionCode');print(d[i:i+20])"

**1.3.6, 1.3.7 and 1.3.8 were built and never uploaded.** Do not treat an
unuploaded bundle as shipped — users are still on whatever is live on Play.

### The branch

`feat/cost-security-roles-trade-search-2026-09`, **seven commits**, nothing
uncommitted. Created off `main` rather than committing straight to it.

```bash
git checkout main && git merge feat/cost-security-roles-trade-search-2026-09
```

---

## 2. Do this next, in order

1. **Upload 1.4.2 to Play.** Until it ships, users see none of it: not Supreme
   values, not the language chat rooms, not the event hub, and not the native
   ad fix. Three server halves are already live and waiting — rules, functions
   and retention — so the gap between server and client is now wide.
2. **Merge the branch.**
3. **Sign in once with a founder email and grant yourself `admin`.** Nobody
   holds any role, so every roster is empty and the dashboard is unreachable
   for everyone but the three bootstrap emails. See §4.
4. **Bump the Cloud Functions runtime before 30 October.** See §5.

---

## 3. What was wrong, and is now fixed

Worth reading before you touch anything, because several of these were live
for over a year.

| Problem | Was |
|---|---|
| Firestore world-writable until 2029 | anyone with the project id could delete every trade, review and post |
| RTDB `/users` world-readable and writable | 81,431 records with emails and push tokens; any client could set `admin: true` on itself |
| `cleanUpNoContentMessages` | deleted every pets-only and GIF-only chat message milliseconds after sending |
| `notifyNewMessage` | one open chat silenced push from **every** other conversation |
| Trade search | queried two fields nothing had ever written; never worked, for anyone |
| Saving a featured trade | silently failed — wrote a pointer to a document id that does not exist |
| `profileCache` | 16 database reads per profile, 79% of all traffic |
| `/presence` | 70,730 ghost rows against ~160 real users |
| Helper role | had a badge and grant buttons but no roster, so Helpers were invisible |
| `PollCard.jsx` | complete, and imported by nothing |

---

## 4. Roles — read this before granting any

Five roles, all complete end to end: **Moderator, Junior Mod, Trusted, CMSR,
Helper.** Plus **Admin**, which is deliberately different — no public badge,
no grant button, because granting it *is* the bootstrap.

**Nobody holds any role right now.** All four roster nodes (`mods`, `trusted`,
`cmsr`, `helper`) are live and empty. They fill on the first grant.

### The bootstrap, and why it exists

The rules require an existing admin to grant a role. No account has
`users/{uid}/admin`, and none of the three founder emails had ever signed into
this project. Without a bootstrap the admin UI would render and every grant
would be denied.

So the rules trust the same three verified emails `Code/GlobelStats.js`
hardcodes. To get started:

1. Sign in with `sohailnasir74business@gmail.com`, `thesolanalabs@gmail.com`
   or `sohailnasir74@gmail.com`, on a **verified** account.
2. Open the dashboard from the trophy icon in the tab header.
3. Find yourself under **Users** and set `admin`.

From then on the flag is what matters and the emails are only a fallback.

### Who can do what

| | Admin | Moderator | Junior Mod |
|---|---|---|---|
| Ban / unban | ✅ | ✅¹ | ✅¹ |
| Strikes | ✅ | ✅¹ | — |
| Mute | ✅ | ✅¹ | ✅¹ max 2h |
| Make / remove Mod | ✅ | — | — |
| Make / remove Junior Mod | ✅² | — | — |
| Trusted / CMSR / Helper | ✅ | ✅ | — |
| Polls | ✅ | ✅ | — |
| Chats and Access tabs | ✅ | — | — |

¹ withdrawn by the kill switch · ² or anyone in `jmd_granters`

> The checks in the app decide what to **show**. Enforcement is
> `database.rules.json`. Never treat a UI gate as a security boundary.

---

## 5. Open items

**Before 30 October — hard deadline.** Every function runs Node.js 20, which
stops accepting deploys on 2026-10-30. After that nothing can be redeployed,
including a fix to a live bug. Bump `functions/package.json` engines and
redeploy well before then.

**Firestore rules are stage 1** — public read, authenticated write. Two
consequences: any signed-in user can write any document, so poll tallies are
not tamper-proof; and per-collection ownership rules are drafted at the bottom
of `firestore.rules` but need testing against the real client first. Two
collections make a naive "owner only" rule wrong: `user_ratings_summary` and
`notifications` are written *about* a user *by* someone else.

**Achievement badges (P12–P15) are not built.** The last piece of the Adopt Me
port. `BadgesScreen` exists but only awards from XP level, and nothing writes
`topBadge`.

**`trades_new` has no cap beyond retention.** 15 days is the only limit.

**Signing passwords are in plaintext** in `android/app/build.gradle`.
Pre-existing. Left alone because changing it risks breaking your build, but it
should move to `gradle.properties` outside version control.

---

## 5b. Traps added 2026-09-13

**A function can exist, be correct, and still be doing nothing.** Three
separate features were dead this way: `notifyPostComment` (export commented
out), `valueAlertsPoll` (polling a renamed URL), and `cleanupOldPrivateChats`
(never exported). `functions/index.js` is the deploy manifest — if it is not
exported there, it is not running, whatever the file says.

**`firebase-value-alerts/` has its own `node_modules`** and ships with none.
A deploy from that directory fails with "Couldn't find firebase-functions
package" until you `npm install` inside `firebase-value-alerts/functions`.

**Never point the value URLs back at `mm2values.json` or `data.json` on the
supreme zone.** The CDN filenames moved twice on 2026-09-13. Current:

```
MM2      https://mm2-api.b-cdn.net/data.json
Supreme  https://mm2api-suprime.b-cdn.net/supreme.json
```

Both are `{ meta, data }`. `unwrapFeed()` accepts either shape, so a rollback
to a raw upload still works — but the old *names* 404.

**Supreme's `image` field is not an image.** It is a lazy-load placeholder
(`/media/N_A.webp`) on 1,399 of 1,402 items. The real asset id is `imageKey`,
and supremevalues.com is behind Imperva — every image request returns a
212-byte challenge page under HTTP 200, so it fails silently rather than
erroring. Art comes from the MM2 catalogue by name; 248 pool rows still have
none and need a Bunny mirror.

**A native ad's call-to-action must be a leaf `<Text>`, never a `<View>`
wrapping one.** A ReactViewGroup takes part in React Native's touch
interception, so the gesture is consumed before Android reaches the click
listener GMA set — the button looks pressable and does nothing while tapping
the ad body still works. `pointerEvents="box-only"` makes it worse. Same fix
applied to Blox Fruit; Adopt Me already had it right.

**MM2 codes are a dead mechanic.** Zero active codes for all of 2025 and 2026;
the expired list is 2015–2017 era. Sites claiming codes "expire within hours"
are SEO farms with a reason to imply a drop is imminent. `/codes` in RTDB is
null and nothing has ever written `localState.codes`. Do not build a code
system on that evidence — it was investigated and rejected on 2026-09-13.

---

## 6. Traps — each of these cost real time

**Never run `firebase deploy --only functions`.** It aborts, because
`valueAlertsPoll` deploys from `firebase-value-alerts/`, a separate directory,
so the CLI offers to delete it. Deploy by explicit name:

```bash
node -e "console.log(Object.keys(require('./functions')).map(n=>'functions:'+n).join(','))"
firebase deploy --only "<that list>" --project mm2vlaues-ed80c
```

**Never run a codebase-wide `functions:delete`** for the same reason.

**Diff the repo rules against live before deploying.** `database.rules.json`
had drifted *ahead* of production and carried a `.validate` on private
messages that was never live. Deploying it would have gated every private
message on fragile string matching.

```bash
firebase database:get /.settings/rules --project mm2vlaues-ed80c
```

**`users/.read` must stay split.** `auth != null` on the collection blocks the
81k-record dump, but `users/$userId/.read` has to stay `true`, because
`RunningWebsites/MM2WEB` reads a single profile before sign-in. Closing the
whole subtree breaks the website and every old build.

**The Firestore indexes REST endpoint ignores the collection group in the
path** and returns every index in the database. The real collection is in each
index's resource `name`. Reading it the obvious way produces a file that tries
to create ~190 wrong indexes.

**Don't create test documents in production to verify an index.** Query an
empty collection instead — an accepted query with zero results proves the
index works. A test poll briefly appeared in the live feed this way.

**Polls belong in the feed's list data, never `ListHeaderComponent`.** That
header is `stickyHeaderIndices={[0]}`, so a poll placed there pins itself over
the feed permanently.

---

## 7. Tools

```bash
npm run fetch:functions                      # audit deployed vs repo, any project
node scripts/fetch-live-functions.js --project fruiteblocks
node scripts/backfill-trade-search-index.js --dry-run
cd android && ./gradlew bundleRelease --no-daemon   # ~4-11 min
```

`fetch-live-functions.js` downloads what is **actually deployed** and reports
`matches` / `DRIFTED` / `NOT IN REPO`. All 15 currently match. Two of them had
no source in this repo at all until 2026-09-06; recovered originals are in
`functions/recovered/`, and the fixed versions they were replaced with are in
`functions/chatMaintenance.js`.

Worth running against Blox Fruit and Adopt Me — both deploy some functions
from outside their repos.

---

## 8. Map

```
PLAN_2026-09.md                     the full record, §1-9
docs/FUNCTION_AUDIT_2026-09-06.md   every live function, analysed
docs/rules-backup-2026-09-06/       rules before and after, for rollback
functions/index.js                  the deploy manifest — this is the truth
functions/chatMaintenance.js        the two fixed long-live functions
functions/retention.js              15-day retention, one constant at the top
functions/recovered/                deployed source, verbatim, not exported
Code/AppHelper/AdminDashboard.js    the console
Code/Trades/tradeSearchIndex.js     search tokens — mirrored in the backfill
                                    script; change one, change both
```
