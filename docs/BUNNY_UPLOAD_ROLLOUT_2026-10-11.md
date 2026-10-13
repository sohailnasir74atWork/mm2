# Bunny upload key — server-side uploads and rotation (2026-10-11)

## Problem

The post-gag storage zone's full read/write password was compiled into the
app (in git since `84fba65`, 2026-03-20). Anyone who unpacks the APK/IPA can
upload, overwrite or delete any file in post-gag — every app's avatars, posts
and chat images, all served from `pull-gag.b-cdn.net`.

## Status

- 2026-10-11: secret `BUNNY_STORAGE_KEY` v1 set (the current post-gag password) and
  `uploadImage` deployed (us-central1, Node 20, 1st gen). Live checks: no token or a
  forged token → 401, GET → 405, OPTIONS → 204. Signed-in uploads not yet tried from a device.
- Rollout steps 1–2 below are done. Next: step 3 (device test), then the app release.
- Nothing committed.

## What changed in this repo

- `functions/uploadImage.js` — new v1 HTTPS function. Requires a Firebase ID
  token (revocation checked), takes `{ kind, data }`, checks the image by its
  magic bytes (jpg/png/webp/gif/heic), caps size (avatar 1 MB, others 3 MB),
  allows 60 uploads per user per hour (`upload_quota/{uid}`, server-only),
  picks the path itself (`<dir>/<uid>/<time>-<random>.<ext>`), PUTs to post-gag
  with the `BUNNY_STORAGE_KEY` secret, and returns the pull-gag URL.
- `functions/index.js` — exports `uploadImage`.
- `functions/test/uploadImage.test.js` — `node --test functions/test/uploadImage.test.js`.
- `Code/Helper/imageUpload.js` — `uploadImage(uri, kind)` for the app.
- The seven uploaders now use it, and their embedded keys are gone:
  `Code/SettingScreen/Setting.jsx` (avatar), `Code/Design/StatusFeed.js` (status),
  `Code/Design/componenets/UploadModal.js` (post),
  `Code/ChatScreen/GroupChat/CreateGroupModal.jsx` and `GroupsScreen.jsx`
  (group icon; pickers now resize to 1024px), `GroupMessageInput.jsx` (chat),
  `Code/ChatScreen/PrivateChat/PrivateMessageInput.jsx` (dm).

## Rollout order

1. **Store the secret** (the CLI prompts; nothing is echoed):
   `firebase functions:secrets:set BUNNY_STORAGE_KEY --project mm2vlaues-ed80c`
   Use the *current* post-gag password for now.
2. **Deploy the function by name** (never a bare `--only functions`, see HANDOFF):
   `firebase deploy --only functions:uploadImage --project mm2vlaues-ed80c`
   Do this before 2026-10-30, when Node 20 stops accepting deploys, or after the runtime bump.
3. **Smoke-test** it on a dev build: avatar, post, status, group icon, group
   chat and DM image. Each returns a `pull-gag.b-cdn.net/<dir>/<uid>/…` URL.
4. **Release the app update** (Android and iOS).
5. **Wait until most users have updated.** Old builds keep PUTting with the
   embedded password, and lose image uploads the moment it is rotated.
6. **Rotate only when the other users of post-gag are off the key too.** It is
   one zone with one password: Blox Fruit, Adopt Me, Fisch, Steal an Egg,
   adoptme-web and blox-web all use the same one (list below). Rotating for
   MM2 alone breaks their uploads.
7. **Rotate** the post-gag password in the Bunny dashboard (Storage → post-gag →
   FTP & API Access → reset password). Put the new one **only** in Secret Manager:
   `firebase functions:secrets:set BUNNY_STORAGE_KEY --project mm2vlaues-ed80c`, then redeploy
   `uploadImage` so it picks up the new version. Do the same for every other
   holder that stays server-side: Blox `fruiteblocks` secret `BUNNY_STORAGE_KEY`
   (modEvidenceUpload), adoptme-jan7 `functions/cleanupGroups.js` and
   `cleanupOldPosts.js` (hardcoded today — move to a secret), MM2WEB
   `.env.local` and its GitHub Actions secret `BUNNY_STORAGE_ACCESS_KEY`
   (nightly `sync-images.yml` writes to post-gag).
8. After rotation: confirm an old build's upload gets 401 and a new build's works.

## Every embedded post-gag key found (file:line, zone)

All the same password (matched by fingerprint, value not printed).

**Apps (shipped in the bundle):**

| Repo | Files (under `Code/`) |
| --- | --- |
| mm2values | removed by this change (was Setting.jsx:76, StatusFeed.js:104, UploadModal.js:36, CreateGroupModal.jsx:31, GroupsScreen.jsx:38, GroupMessageInput.jsx:18, PrivateMessageInput.jsx:26) |
| Blox_Fruit | AppHelper/AdminDashboard.js:113, ChatScreen/GroupChat/CreateGroupModal.jsx:31, GroupMessageInput.jsx:15, GroupsScreen.jsx:37, ChatScreen/PrivateChat/PrivateMessageInput.jsx:24, Design/StatusFeed.js:173, Design/componenets/UploadModal.js:49, Helper/reportImageUpload.js:22, SettingScreen/Setting.jsx:103, ValuesScreen/ScammerDatabaseScreen.js:75 |
| adoptme-jan7 | AppHelper/AdminDashboard.js:94, ChatScreen/GroupChat/CreateGroupModal.jsx:31, GroupMessageInput.jsx:19, GroupsScreen.jsx:40, ChatScreen/PrivateChat/PrivateMessageInput.jsx:38, Design/StatusFeed.js:183, Design/componenets/UploadModal.js:47, Helper/modEvidenceUpload.js:50, SettingScreen/Setting.jsx:96, ValuesScreen/ScammerDatabaseScreen.js:69 |
| FischValues | ChatScreen/GroupChat/CreateGroupModal.jsx:36, GroupMessageInput.jsx:21, GroupsScreen.jsx:44, ChatScreen/PrivateChat/PrivateMessageInput.jsx:31, Design/StatusFeed.js:106, Design/componenets/UploadModal.js:39, SettingScreen/Setting.jsx:84 |
| StealAnEggValues | ChatScreen/GroupChat/CreateGroupModal.jsx:31, GroupMessageInput.jsx:17, GroupsScreen.jsx:38, ChatScreen/PrivateChat/PrivateMessageInput.jsx:25, Design/StatusFeed.js:97, Design/componenets/UploadModal.js:36, SettingScreen/Setting.jsx:73 |

**Websites:**

- `blox-web/src/components/feed/CreatePostModal.tsx:17` — `'use client'`, ships to every browser.
- `adoptme-web/src/components/feed/CreatePostModal.tsx:17` — `'use client'`, ships to every browser (confirmed in a built static chunk).
- `adoptme-web/src/app/api/upload-proof/route.ts:5` — server route, but hardcoded in source and git.
- `MM2WEB/.env.local:15` — server-only env (not `NEXT_PUBLIC_`), untracked; used by `scripts/sync-images.ts` and CI.

**Server code with the key hardcoded:** `adoptme-jan7/functions/cleanupGroups.js:40`, `adoptme-jan7/functions/cleanupOldPosts.js:36`.

Also copies in `Blox_Fruit/.claude/worktrees/…`, `adoptme-jan7/.claude/worktrees/…`,
`adoptme-web/.claude/worktrees/…` and `RunningApps/_i18n_backup_blox_2026-10-10/`.

**Other zones (not client code, but plaintext on disk):** `adoptme-web/.env.local:28`
(image-adoptme), `adoptme-web/.claude/settings.local.json:39` (image-adoptme, inside a
saved permission rule), `elvebredd_bunny/.env.bunny:4` (adoptme-history).

## Not done

- Bans are not checked by `uploadImage` (any signed-in user, within quota).
- Git history still holds the key; rotation is what makes that harmless.
