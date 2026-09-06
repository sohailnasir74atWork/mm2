# MM2 Values — handoff

Last updated **2026-09-06**. Firebase project `mm2vlaues-ed80c`.
**Firebase only. Do not add Supabase** — that is a standing decision, and it is
why every port from Adopt Me needs rewriting rather than copying.

Detail lives in `PLAN_2026-09.md` (§1–9) and
`docs/FUNCTION_AUDIT_2026-09-06.md`. This file is the short version.

---

## 1. Where things stand

**Server side is live. Client side is built but not shipped.**

| | State |
|---|---|
| Firestore rules | live — anonymous writes blocked |
| RTDB rules | live — user enumeration blocked, role flags write-protected |
| Firestore indexes | live — 14, including trade search and polls |
| Cloud Functions | live — 15 |
| 15-day retention | live and running nightly |
| Android build | **built, not uploaded to Play** |
| Git | **committed to a branch, not pushed to `main`** |

Data after retention: 17,374 chat messages, 8,799 trades, 607 feed posts,
0 polls.

### The build

`android/app/build/outputs/bundle/release/app-release.aab`
versionName **1.3.6**, versionCode **28**, 46.8 MB, signed with
`android/app/solanalab.keystore`.

Earlier builds are kept beside it (`.v26`, `.v27`, `.PREV-2026-07-29`) rather
than overwritten. Delete them once 1.3.6 is live.

### The branch

`feat/cost-security-roles-trade-search-2026-09`, three commits, nothing
uncommitted. Created off `main` rather than committing straight to it.

```bash
git checkout main && git merge feat/cost-security-roles-trade-search-2026-09
```

---

## 2. Do this next, in order

1. **Upload 1.3.6 to Play.** Until it ships, users still see the old app: the
   trade search still looks broken to them, and none of the role, badge,
   dashboard or poll work is visible. The server half is already live and
   waiting for it.
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
