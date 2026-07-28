# MM2 Value-Change Push Alerts — Firebase Cloud Function

Everything runs inside the MM2 Firebase project. No Supabase, no other
services. Your daily upload to Bunny stays exactly the same.

```
Every 15 min: function fetches mm2-api.b-cdn.net/mm2values.json
  → compares with last snapshot (saved in your Realtime Database)
  → changed items: logged to /value_alerts/changes + FCM push to
    topic val_mm2_<item> — only users with that item in My Stuff get it
```

## Deploy (one time)

Requires the **Blaze** plan on the MM2 Firebase project (Functions need it;
this usage stays inside the free tier, so it costs $0 in practice).

```bash
cd /Volumes/Sohail/AI_Projects/mm2values/firebase-value-alerts/functions
npm install
cd ..
npx firebase-tools login
npx firebase-tools deploy --only functions:valueAlertsPoll --project YOUR_MM2_PROJECT_ID
```

`YOUR_MM2_PROJECT_ID` = Firebase Console → Project settings → Project ID.

## What happens after deploy

- First run (within 15 min): silent — saves the snapshot.
  Check: Firebase Console → Functions → valueAlertsPoll → Logs →
  "first run: snapshot saved (N items), no alerts".
- Every later run: only actually-changed values produce pushes.
  Re-uploading an identical file = nothing. Fixing one item = one alert.

## Test end-to-end

1. In the MM2 app (dev build has the code): sign in → My Stuff → add an item.
2. Change that item's value in your file, upload to Bunny as usual.
3. Within 15 min the push arrives: "Harvester value increased! 📈 100 → 120 (+20)".

## Notes

- The app side is already wired: `Code/Helper/valueAlerts.js` +
  `MyStuffScreen.jsx` subscribe users to `val_mm2_<slug>` topics for their
  owned + wishlist items. The slug function there and in `index.js` must
  stay identical — it's the naming contract.
- Watches ONLY `mm2values.json` (primary source). Watching the Supreme file
  too would double-alert shared items — one-line change if you ever want it.
- If alerts seem slower than ~15-30 min after upload: your Bunny pull zone
  may have "Ignore Query Strings" ON (it defeats the cache-buster). Either
  turn it off or purge the file after upload.
