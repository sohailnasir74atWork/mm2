# MM2 Birthdays — design (2026-10-13)

The same feature Adopt Me and Blox Fruit have, rebuilt for MM2's
**Firebase-only** backend (HANDOFF.md: never add Supabase). Reference
implementations, read them before building:

- Blox app UI (closest port target, same React Native stack):
  `/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit/Code/Birthdays/*`
  (BirthdaysScreen.jsx, BirthdayHomeCard.jsx, BirthdayBits.jsx, birthdayDate.js,
  EditBirthdaySheet.jsx, BirthdayVisibilityRow.jsx, birthdayApi.js,
  birthdayMock.js) and its strings under `birthdays.*` in
  `Code/Translation/*.json`.
- Server behaviour to reproduce (Supabase there, Firebase here):
  `Blox_Fruit/supabase/036_birthdays.sql`, `037_birthday_list_paged.sql`,
  `041_birthday_short_list.sql`; pushes in `Blox_Fruit/functions/notifyBirthdays.js`,
  `notifyBirthdayWishes.js`, `updateBirthday.js`.

Owner rules that carry over:
- Only MONTH and DAY ever leave the server. Never expose a year or an age.
- Players under 13 are never shown to anyone and get no wishes; they still
  see their own birthday and may claim the gift? NO — no gift for under 13
  either (Blox: `minor_private_stars` copy explains it stays private).
- Birthdays are SHOWN by default; "Hide my birthday" opts out.
- Short list: today's top 6, people you know first, "Wish everyone", "See all",
  tomorrow as one line; "Thank everyone" on your own birthday; 100 wishes a day.
- Birthday dates and DOB must never be wired into ads (owner decision).

## Cost goals ("very optimized")

- Home: one tiny RTDB read per day (`birthday_counts/{MMDD}`), cached in MMKV
  for the local day. No listeners anywhere in the feature.
- Birthdays screen: ONE HTTPS call (`birthdayTop`) per open, cached 30 min on
  the phone (MMKV, keyed by uid + local day). "See all" = the same call with a
  larger limit, paged on the phone.
- Writes go through HTTPS functions (validation, limits, push in the same call).
- No per-launch triggers (no trigger on `users/{uid}/lastActivity`).

## Data (RTDB unless noted)

| Path | Who writes | Who reads | Shape |
|---|---|---|---|
| `users_private/{uid}/dateOfBirth` | owner once (rules already: write-once regex) / server (`updateMyBirthday`) | owner, staff | `'YYYY-MM-DD'` — canonical DOB |
| `email_prefs/{uid}/dob` | existing email opt-in flow | owner | fallback DOB when `users_private` has none |
| `birthday_prefs/{uid}` | owner | owner | `{ show: boolean }` (absent = shown) |
| `birthday_index/{MMDD}/{uid}` | server only | any signed-in | `true` — only shown, 13+ players. 29 Feb = `0229` |
| `birthday_counts/{MMDD}` | server only | any signed-in | number of entries under that key |
| `birthday_server/...` | server only | nobody | `index_key/{uid}: 'MMDD'`, `edits/{uid}: ts`, `sent_day/{uid}/{YYYY-MM-DD}: n`, `bday_pushed/{year}/{uid}`, `thank_pushed/{YYYY-MM-DD}/{uid}`, `first_pushed/{year}/{uid}` |
| `birthday_wishes/{year}/{toUid}/{fromUid}` | server | `toUid` only | `{ t: template, at, n: senderName, a: senderAvatar, th?: thankedAt }` |
| `birthday_sent/{uid}/{year}/{toUid}` | server | owner | `true` |
| `birthday_wish_counts/{year}/{uid}` | server | any signed-in | number |
| `birthday_wished_by/{uid}/{fromUid}` | server | nobody (server reads for ranking) | `true` ("wished you before", any year) |
| `birthday_gifts/{uid}/{year}` | server | owner | `{ stars, at }` |

Rules: add these nodes to `database.rules.json` with exactly the access in the
table (`.write: false` for every server node). Unlisted paths are already
denied by default (no root rule).

"Birthday year" = the year of the birthday occurrence nearest to UTC today
within ±1 day (same as Blox `_birthday_near`), so New Year birthdays work.
Phone dates are clamped to UTC yesterday..tomorrow (time zones).

## Server (functions/, firebase-functions v6, admin 12, us-central1)

Index maintenance (v1 database triggers, like the rest of the codebase):
- `onWrite` of `users_private/{uid}/dateOfBirth`, `email_prefs/{uid}/dob`,
  `birthday_prefs/{uid}/show` → one shared `reindexBirthday(uid)`:
  effective DOB = users_private ?? email_prefs; entry wanted iff DOB valid,
  age ≥ 13 today, `show !== false`. Moves the uid between `birthday_index`
  keys using `birthday_server/index_key/{uid}`; keeps `birthday_counts`
  right with transactions. Idempotent.
- `scripts/birthdays/backfillIndex.js` (admin SDK, run once by the lead):
  walks `users_private` and `email_prefs` (shallow REST or paged by key) and
  calls the same reindex logic. Must be safe to re-run.
- A once-a-day job (`refreshBirthdayAges`, 03:30 UTC) re-checks only the
  players whose birthday is TODAY (`birthday_index` misses players who turn
  13 today): read DOBs of candidates for today's key from a small
  `birthday_server/pending13/{MMDD}/{uid}` list that reindex fills for
  12-year-olds. Keep it simple; correctness over cleverness.

HTTPS endpoints (`onRequest`, `Authorization: Bearer <Firebase ID token>`
verified with `admin.auth().verifyIdToken`; JSON in/out; CORS not needed).
Follow the token pattern already used in `functions/uploadImage.js` if it
fits. Errors as `{ error: 'code' }` with codes the app maps to strings:
`sign_in`, `not_today`, `already_wished`, `limit`, `cannot_wish`, `bad_date`,
`already_edited`, `age_change`, `gift_unavailable`, `generic`.

1. `birthdayTop { localDate, limit (1..200, default 6), blocked: [uids] }` →
   `{ rows: [{uid,name,avatar,month,day,wishes,wished,reason}], total,
   unwished, tomorrow }`.
   - Candidates: `birthday_index` for today's key(s) (+`0229` on a non-leap
     28 Feb), minus the caller, minus `blocked` from the body (MM2 keeps
     blocks in MMKV) and `bannedUsers/{caller}`, minus anyone who blocked the
     caller (`bannedUsers/{cand}/{caller}` exists).
   - Activity: keep only `users/{uid}/lastActivity` (ISO; also check the
     legacy `lastactivity`) within 30 days.
   - Rank: DM (`chat_meta_data/{caller}/{uid}` exists) 4, follow (Firestore
     `following` where `followerId == caller`, one query) 3, shared group
     (union of `memberIds` of the caller's `groups/{g}` docs, ids from
     `group_meta_data/{caller}` keys) 2, wished you before
     (`birthday_wished_by/{caller}/{uid}`) 1; then most recent activity.
     `reason` = strongest of `'dm' | 'follow' | 'group' | 'wished_you' | null`.
   - Only for returned rows: `users/{uid}/displayName`, `avatar`,
     `birthday_wish_counts/{year}/{uid}`, `birthday_sent/{caller}/{year}/{uid}`.
   - `tomorrow` = `birthday_counts/{tomorrowKey}` (cheap approximation).
   - Do reads in parallel; never read whole `users/{uid}` nodes.
2. `sendBirthdayWish { to, template, localDate }` → `{ wishes }`. Templates
   `hbd | party | cake | gift`. Checks: signed in, not self, `to` is in today's
   index (±1 day), recipient hasn't blocked caller, daily limit 100 per sender
   per UTC day (transaction on `birthday_server/sent_day`), not already
   wished (transaction create). One multi-path update for the wish, sent,
   count (+1 via transaction or ServerValue.increment), wished_by. If this is
   the recipient's FIRST wish this birthday (`first_pushed` claim) → FCM push
   to `users/{to}/fcmToken`: "🎂 {name} wished you a happy birthday!", data
   `{ type: 'birthday_wish', route: 'Birthdays' }`; clear invalid tokens like
   `functions/chatMaintenance.js` does.
3. `wishAllBirthdays { localDate, template='party', blocked }` →
   `{ sent, left, limited }`: same candidate/ranking pipeline, every unwished
   one up to the remaining daily limit, writes batched, first-wish pushes
   chunked (FCM `sendEach`, ≤ 500).
4. `thankBirthdayWishers {}` → `{ thanked }`: only on the caller's birthday;
   marks every unthanked wish (`th`), and pushes each wisher at most once per
   UTC day ("💖 {name} thanked you for the birthday wish!", data
   `{ type: 'birthday_thanks', route: 'Birthdays' }`).
5. `claimBirthdayGift {}` → `{ stars }`: on the caller's birthday, 13+, account
   ≥ 30 days old (`users/{uid}/createdAt` ms), once per birthday year →
   `users/{uid}/dailyStars/starBalance` and `totalStarsEarned` += 15
   (`ServerValue.increment`), record `birthday_gifts`.
6. `updateMyBirthday { year, month, day }` → `{ month, day }`: once ever
   (`birthday_server/edits`), valid date, age ≥ 4, must not change which side
   of 13 the player is on (`age_change`), writes `users_private/.../dateOfBirth`
   (admin bypasses write-once) → reindex runs via the trigger.
7. `myBirthday {}` → `{ month, day, show, canEdit, wishes: [...], wishCount,
   thankPending, giftReady, giftOpened }` (own data; `wishes` = received this
   birthday, newest first, max 100, name/avatar/template).

Scheduled: `notifyBirthdays` daily 14:00 UTC: today's index key(s) →
"🎉 Happy birthday, {name}! Open MM2 Values for your birthday stars"
(`route: 'Birthdays'`), claimed per year in `birthday_server/bday_pushed`,
`sendEach` in chunks of 500, invalid tokens cleared.

Export everything from `functions/index.js`. Do NOT deploy.

## App

- `Code/Birthdays/` ported from Blox: same screens and behaviour, with
  `birthdayApi.js` rewritten against the endpoints above + the two RTDB reads
  (`birthday_counts/{MMDD}` for Home, own `users_private` / `email_prefs` DOB
  + `birthday_prefs` for the visibility row). Keep Blox's caching rules
  (MMKV, local day, 30-min list TTL, own actions patch caches) and the __DEV__
  mock fallback.
- No DOB yet → the Home card says "Add your birthday 🎂" and the screen shows
  an add button that opens the existing `Code/AppHelper/DateOfBirthModal.js`
  and writes `users_private/{uid}/dateOfBirth` (client write-once, rules allow).
  Not a forced gate.
- Route `Birthdays` in App.js's root stack (lazy `getComponent` like the
  others); Home card in `Code/HomeTab/HomeTabScreen.jsx` near the top sections;
  "Show my birthday" row in `Code/SettingScreen/Setting.jsx` near
  `EmailUpdatesRow`.
- Notification taps with `route: 'Birthdays'` open the screen (wire into the
  existing FCM open handler).
- Gift = stars (MM2 has `dailyStars.starBalance`), like Blox: label 15 stars.
- Strings: `birthdays.*` in all 9 languages (en, pt, es, es-ES, fr, de, ru,
  ja, ar). Reuse Blox's text where the language exists (es-ES from es),
  swapping Blox/fruit wording for MM2; plurals `_one/_other` (+ ar/ru forms
  as Blox has them). Reasons: `dm`, `follow`, `group`, `wished_you`.
