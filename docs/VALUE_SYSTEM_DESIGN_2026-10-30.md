# MM2 value system: how the sources work, where we go wrong, and a scam-resistant design

2026-10-30. Trigger: Moon's Supreme reports (Sunset 1,450, Flowerwood Knife unpriced, Vintage chip 3/10). Scope: the value pipeline (/Volumes/Sohail/DataFetching/MM2VALUES), the MM2 app (this repo) and the MM2 website (RunningWebsites/MM2WEB). Evidence was gathered live on 2026-10-30 from mm2values.com, supremevalues.com and mm2.cosmicvalues.gg, plus our two feeds (generatedAt 2026-10-30T02:03Z) replayed through the app's own code.

Companion files: full findings list `Ops/bugs/scans/2026-10-30-mm2-value-trade-audit.md`; variant/collision data `Ops/bugs/scans/2026-10-30-mm2-value-conflicts.md`; P1 entries in `Ops/bugs/LOG.md` (2026-10-30).

## 0. Summary

**What the two source sites get right, and we don't.**
- **Item identity.**
  - Both sites give every item, and every re-release of it, its own id: mm2values.com a numeric id (994), Supreme a key like `Gingerbread_Knife_2019`.
  - We join the two lists by name. That produced every bug in Moon's reports plus ~200 silent ones: wrong prices, hidden items, wrong years, wrong chat cards and wrong Trade Match hits.
- **Who computes the verdict.**
  - mm2values.com computes it on its server from ids and quantities.
  - Supreme computes it from server-fetched items, with a published rule.
  - We let each client compute and store totals and verdicts, and every other user reads them as truth.
- **Uncertainty.**
  - Supreme publishes value ranges, stability (including **Unsafe**), "Corrected" badges and its update time.
  - mm2values.com publishes **MASS-DUPED / PROJECTED** warnings and its update time.
  - We keep few of these and show none of them at the moment of decision.

**What a scam-resistant system needs** (detail in §6):
1. **One canonical item key** per real item and year, built once in the pipeline from both sites' own ids. Every surface (app, web, Discord, Cloud Functions) uses it, and the year is always on screen.
2. **Values per list**, exactly as each site publishes them. Bundle texts ("x3 T1 Rares") are converted with Supreme's own published ladder, plus the range, stability, status tags and the site's own update time.
3. **A verdict rule** that matches Supreme's own calculator, so users cross-checking us get the same answer. It refuses to judge incomplete trades and flags trades whose outcome depends on which list you trust.
4. **Scam warnings** where they matter:
   - the version to check in the trade window;
   - items Supreme calls Unsafe, or MM2 calls Mass-duped or Projected;
   - brand-new items;
   - deals needing more than one in-game trade (4 slots per side);
   - sets, which are two items, not one;
   - stacks of bundle-tier items;
   - "too good to be true" gaps.
5. **The server re-prices** anything other people see (trade posts, chat cards, ratings). Clients send item keys and quantities only.
6. **Publish gates** in the pipeline, so a partial or stale scrape cannot go live, as it did on 2026-10-15.

**Order of work** (§8):
1. Phase 0 is a week of small fixes, several of them P1.
2. Phase 1 builds the canonical catalogue.
3. Phase 2 does server-side pricing and verdict v2.
4. Phase 3 is monitoring.

## 1. How mm2values.com publishes values

- **Catalogue.** 994 items, each with a numeric id (`checkval.php?id=902` = Sunset). Every re-release is its own id and its own image, and the image file carries the year (`2019gbknife.png`, `Gingerbreadknife2020.png`, `Gingerbread_2025.png`). The displayed **name does not**: the Common page lists three different "Candy Corn" cards and several "Bats".
- **Card fields.** Value (a number, or text such as `3 X (T1) Uncommon` below 1), Range (overpays/underpays or "pulls", almost always N/A — 15 items have one), Demand, Rarity, Stability (10 tags from Rising to Decreasing).
- **Status tags (scam signals).** `MASS-DUPED` (duped copies flooding the economy, value likely to crash; ⚠️ on the image) and `PROJECTED` (a group is inflating the item with fake offers and alt accounts). None are set today; our feed has no field for them.
- **Freshness.** The home page shows its own stamp: "VALUES UPDATED: 10/25/2026 01:08:30pm EST". Our feed's `generatedAt` is the scrape time (10-30), five days later.
- **Trade Checker.** Built on ids, not names: each side holds at most **4 distinct items with quantities** (the in-game trade window), and the verdict is written by the server (`tSummary.php?data=id-qty|…`), so a user cannot type a value. Output: what you give and get, value of each side, the difference, then a separate **demand change** and **rarity change** score.
- **Flaw.** Values below 1 are sort codes, not numbers: `.43` = "3 X (T1) Legend", `.33` = "3 X (T1) Rare", `.13` = "3 X (T1) Common". The checker adds those codes as if they were values (ten "3 X (T1) Common" = 1.3), so bundle-tier totals there are meaningless. mm2values publishes **no official conversion** for these texts.
- **Scam guidance** names "sharking" — lying about values to gain value — as a core scam, and tells traders never to go first and to use a trusted middleman when a deal needs more than one trade window.

## 2. How supremevalues.com publishes values

- **Catalogue.** 14 categories including Sets, Evos and Untradables. Every item has a site key (`?item=Gingerbread_Knife_2019`), carried in our feed as `id` / `imageKey`, plus `origin` with event and year ("Christmas 2019 (Tier 9)"; 1,021 of 1,464 rows carry a year). Some display names carry the year ("CandyCorn (2017)", "Bats (2020)"), changelog entries tag re-releases ("Candy Corn [HALLOWS2026]").
- **Card fields.** Value, Range `[low - high]` (53 items; our feed keeps `rangeLow`/`rangeHigh`), Stability (Rising 10 … Stable 4 … Underpaid For 3, Decreasing 2, **Unsafe** 1 — "items we consider unsafe to trade for"), Demand, Rarity, Change in Value, and a **Corrected** badge when a change fixes the list rather than reflecting the market.
- **Sets** are a listing convenience: all 115 equal the exact sum of their parts. There is no "set" item in the game.
- **Official conversion below 1** (Use Guide + calculator source): 1 value ≈ 5 T1 Legendaries; a T1 item is worth 64 / 16 / 4 / 1 units of 1/320 for Legendary / Rare / Uncommon / Common:

  | text | official decimal | our feed today | ours vs official |
  |---|---|---|---|
  | x1 T1 Legendary | 0.2 | 0.2 | 100% |
  | x1 T1 Rare | 0.05 | 0.04 | 80% |
  | x1 T1 Uncommon | 0.0125 | 0.008 | 64% |
  | x1 T1 Common | 0.003125 | 0.0015 | 48% |

  341 of the 536 bundle-priced Supreme items in our feed are below the official figure (x2/x3 rows scale the same way).
- **Freshness.** "Values Last Updated - October 30th, 2026 at 4:26 AM" plus a dated changelog. Our feed matched the live page on every item checked (Sunset 650, Sunrise 800, Flowerwood 235, Flowerwood Gun 240, Soul 635, Laser 22).
- **Trade Calculator** (source read 2026-10-30):
  - Items are added by image key + category and fetched from the server with a signed token; quantities 1–9,999; same item stacks.
  - Side total = Σ decimal value × qty, bundle items included at the official decimals.
  - Verdict on the **range midpoint** of each item (or the top of the range for your own items, as a setting):
    `diff = (their − your) / your`; **win** if diff > 1% (your side > 1,000) or > 2.5% (smaller); **loss** if below the negative; **"fair, slight win/loss"** between 0.5%/0.75% and that threshold; **fair** inside ±0.5%/±0.75%.
  - Separate lines for range (worst/best case), value-weighted stability, value-weighted demand, chance of rising and recent value trend. Bundle-tier ranges count only when the bundle items add up to ≥ 1.
  - Disclaimers: value is not everything, stacks can get overpays, ask a human advisor for non-Stable items, "if a trade is too good to be true, it may be a scam".
- **Scam guidance**: use a trusted middleman whenever a deal needs more than one trade window; account-security warnings.

## 3. How mm2.cosmicvalues.gg (Supreme's trading partner) does it

- Every variant is its own item with a numeric `itemId`; trade ads store `itemId` + `metadata.origin`, never just a name. All four Gingerbread (Knife) items are pickable; Laser Vintage (8) and Godly (22) are separate; Sunset and "Sun Set" are separate.
- Weak spot: the picker shows truncated names, no year and no value — variants are told apart only by artwork, and one has no art.
- Its numbers did not match Supreme's live page (Sunset 750 vs 650, Flowerwood 260 vs 235). Not a source to copy values from.

## Measured disagreement between the two lists

Of 405 items both sites price with an observed number: 133 identical, median gap 5.9%, 75th percentile 25%, 90th percentile 73%. The largest gaps on valuable items are this week's new Halloween items (Emberbow 1,300 on MM2 vs 750 on Supreme, which corrected it on 29 Oct; MM2 last updated 25 Oct).

## 4. How our system works today

**Pipeline** (`/Volumes/Sohail/DataFetching/MM2VALUES` + `publish-all`):
- **Scraping.** Puppeteer scrapes 11 mm2values.com pages and 14 Supreme pages and publishes two feeds, `data.json` (MM2) and `supreme.json`.
- **Kept.** Supreme `id` / `imageKey` / `origin` / `rangeLow` / `rangeHigh` / `containsParts`.
- **Dropped.**
  - mm2values.com's numeric item id;
  - its MASS-DUPED / PROJECTED tags;
  - both sites' "values updated" stamps;
  - Supreme's real image path. The scraper blocks images, so 1,461 of 1,464 rows get the `N_A.webp` placeholder.
- **Bundle texts** are converted with our own ladder, 0.2 / 0.04 / 0.008 / 0.0015, not Supreme's published one (§2).
- **Run and stamp.** It runs by hand. `generatedAt` is the build time. A failed category silently keeps old rows, and no gate compares against the live file.

**App** (this repo):
- **Pool.** Joins the feeds by name (category-aware since today's working-tree fix) into a pool keyed by category + name. The first year wins.
- **Calculator.**
  - Sums observed values only and shows a count of excluded items.
  - Gives WIN/FAIR/LOSE at a ±5% band of the bigger side (`Code/Helper/tradeStatus.js`), regardless of what was excluded. 0 vs 0 counts as WIN.
  - Shows a per-slot demand mean, advisory only.
- **Posting.** Writes the client's numbers and verdict into `trades_new`, and the rules check only `userId`.
- **Chat cards, Trade Match, other players' portfolios, the journal and value alerts** each re-derive items by name, and most trust whatever was written.

**Website** (`RunningWebsites/MM2WEB`):
- **Join.** Name + category, ignoring year (39 rows on the wrong year).
- **Default list.** MM2.
- **Calculator.**
  - Refuses a verdict when prices are incomplete (good).
  - Uses a ±5% band of the bigger side.
- **Trade composer.** Has the same sign bug as the old app share card, inverted against the app (stores 'w' when the poster overpays). It posts awards and gives verdicts on partial prices.
- **Discord bot.** Picks the pricier variant on ties.

The two clients disagree in at least 12 behaviours (default list, fallback, ranking, verdict sign, partial prices, awards, demand, freshness…). Every one of them is a place a user can see two different answers for the same trade.

## 5. Gap table

| Topic | mm2values.com | supremevalues.com | Us today | Target |
|---|---|---|---|---|
| Item identity | numeric id per variant | site key per variant + origin year | name (+category in tree) | canonical key from both ids (§6.1) |
| Year shown | image only | some names, origin, changelog tags | never | always, as a chip |
| Values < 1 | text; checker sums sort codes (broken) | text + published ladder, summed | our own ladder (Rares 80%, Commons 48% of Supreme's); excluded from totals | Supreme ladder, summed, labelled ≈ |
| Ranges | 15 items | 53 items, low/high | ignored in verdicts | midpoint verdict + range line |
| Stability / status | 10 tags; MASS-DUPED, PROJECTED | 10 levels incl. Unsafe; Corrected badge | shown on some cards | warnings at decision time |
| Freshness | "VALUES UPDATED" stamp | "Last Updated" + changelog | build time (app label blank) | each site's own stamp, warn > 7 days |
| Verdict | server, from ids | client, published rule, server-fetched items | client, ±5%, stored and trusted | Supreme's rule, server-written for shared trades |
| Partial prices | n/a | items without a decimal are excluded | app: verdict anyway; web: refuses | "Incomplete", no verdict |
| Trade window limit | 4 distinct items/side | middleman warning | 4-slot grid, no warning | feasibility warning |
| Sets | n/a | = sum of parts (115/115) | pickable as one item | expand into parts |

## 6. Target design

### 6.1 Item identity: one canonical key, built once

The pipeline publishes a third feed, `catalog.json`. Every surface reads it instead of joining the two lists itself.

```js
{
  meta: {
    builtAt,
    sources: {
      mm2:     { scrapedAt, siteUpdatedAt, items },
      supreme: { scrapedAt, siteUpdatedAt, items },
    },
    version,
  },
  items: {
    "uncommon/gingerbread-knife-2019": {
      name: "Gingerbread Knife", year: 2019, event: "Christmas",
      category: "Uncommon", kind: "knife",        // knife | gun | pet | misc | set
      image: "…",
      siblings: ["uncommon/gingerbread-knife-2020", "uncommon/gingerbread-knife-2025",
                 "rare/gingerbread-knife-2022"],
      tradable: true, blockReason: null,          // award | untradable | evo | unreleased
      parts: null,                                // sets: [keys]
      legacy: ["Uncommon-TIER 5-Gingerbread Knife"],   // old pool ids / slugs, for migration
      sources: {
        mm2: {
          id: 388, image: "img/2019gbknife.png",
          value: 90, text: "90", confidence: "observed",
          range: null, demand: 3.5, rarity: 4, stability: "Stable", status: null,
        },
        supreme: {
          id: "Gingerbread_Knife_2019",
          value: 85, text: "85", confidence: "observed",
          rangeLow: 85, rangeHigh: 85, demand: 3, rarity: 4, stability: "Stable",
          change: -5, corrected: false,
        },
      },
    },
  },
}
```

**Key rules**
- **Minting.** Keys are minted once and stored in a checked-in registry (`item-registry.json`, like MM2WEB's `lib/item-routes.json`). A key is never reused or rebuilt from scratch, so saved inventories, trades and links stay valid when a site renames an item.
- **Year sources.**
  - Supreme: `origin` and the id suffix.
  - MM2: the image filename (`2019gbknife`, `Gingerbreadknife2020`, `Gingerbread_2025`) or a name suffix ("Snowman Gun 23").
  - Measured 2026-10-30: the year alone separates 44 of 46 same-name groups on Supreme and 33 of 44 on MM2. The rest need `kind` (gun vs knife: "Candy Corn" 2024 exists as both) or the MM2 numeric id, which the scraper must start capturing.
- **Pairing MM2 ↔ Supreme** happens in the pipeline only:
  1. Match on category + name family + year + kind.
  2. Values must agree within 4× whenever one side has a real price (≥ 1). This is the same guard the app adopted today. Below 1 the two lists disagree by up to 50× on the *same* item of the same year (Penguin Knife 2025: MM2 "2 X (T1) Legend" = 0.4, Supreme "x1 T1 Uncommon" = 0.008), so two bundle-tier values are never used to decide identity. That spread is also why §6.4 warns on bundle-heavy sides instead of trusting their decimals.
  3. A checked-in `crosswalk.json` holds manual pairs and manual "not the same" pairs.
  4. Anything left unpaired goes into a review list printed by the build, not guessed.
- **Duplicates.** Display-only duplicates (an item listed in two tiers with the same id, image and value, e.g. 63 MM2 trophies and Chromas) collapse into one key.
- **Migration.** Old saved items resolve as old pool id → `legacy` → key. Failing that, name + category → key when unique. Failing that, show "Pick the version" with the siblings. Never silently pick the dearest.

### 6.2 Values per list

- Publish each list's numbers as the site does: observed values as numbers; bundle texts converted with **Supreme's ladder** (x1 T1 Legendary 0.2, Rare 0.05, Uncommon 0.0125, Common 0.003125; ×2/×3/×4). Display them as the site writes them ("x3 T1 Rares", "≈0.15").
  - mm2values.com publishes no ladder. Use the same one for its "N X (T1)" texts and label the decimal "≈, our conversion".
  - Keep `text` so the UI can show the source's own words.
- Ranges: Supreme `rangeLow`/`rangeHigh`, MM2 `range` parsed the same way.
- Stability, demand, rarity, change, `corrected` (Supreme), `status` (MM2 MASS-DUPED / PROJECTED; null today).
- Unpriced items carry a reason: award, priceless, untradable, unreleased, evo, gift, not-listed. MM2 trophies published as observed at 40M-500M are flagged `tradable: false` (Supreme classes them as awards), so no list can put them in a trade.
- Freshness: each list's **own** update stamp (`siteUpdatedAt`) plus our scrape time; never only the build time.

### 6.3 Totals

For the chosen list, per side:

| Total | How it's computed |
|---|---|
| `base` | Σ value × qty over priced items. Bundle-tier items are included at ladder decimals, as Supreme's calculator does. |
| `low` / `high` | Σ rangeLow / rangeHigh × qty. Bundle-tier ranges are counted only when the bundle items add up to ≥ 1 (Supreme's rule). |
| `mid` | Σ (range midpoint, else value) × qty. This is what the verdict uses. |
| `unpriced` | The list of items with no price on this list, with their reasons. Never summed as 0. |
| `bundleShare` | Bundle-tier value ÷ base. |
| `demand` | Value-weighted mean over priced items, as Supreme does. Not a per-slot mean. |

### 6.4 Verdict

The goal is to match Supreme's published calculator exactly, so a user checking us against supremevalues.com gets the same word. Guards are added on top; they never change the number.

```text
if the chosen list is missing                                           → NO DATA (no verdict, no posting)
if an item is not tradable (award, untradable, evo, unreleased)          → BLOCKED (name the item)
if a side has unpriced items                                             → INCOMPLETE (show both totals and the unpriced items; no word)
if both sides are empty                                                  → nothing

base  = your.mid > 0 ? your.mid : their.mid
diff  = (their.mid − your.mid) / base
band  = base > 1000 ? 1%   : 2.5%
exact = base > 1000 ? 0.5% : 0.75%

diff >  band     → WIN
diff < −band     → LOSS
diff >  exact    → FAIR (slight win)
diff < −exact    → FAIR (slight loss)
otherwise        → FAIR
```

Notes:
- The fair band is tighter than our ±5%. With a 5% band, a 4.9% gap on every trade is labelled FAIR, which is a slow, repeatable lowball.
- Both clients use one shared implementation (one package or a copied file with the same tests). Today's three copies disagree on sign and on edges (exactly 5% is FAIR in the app, WIN/LOSS on the web).

**Cross-check with the other list.** Run the same rule on the other list when every item is priced there.
- If the two words point different ways (WIN vs LOSS, or FAIR vs a clear WIN/LOSS), show **"Depends on the list: Supreme says WIN, MM2 says LOSS"** and name the items that differ by more than 25% (the p75 gap).
- This defeats "list shopping": a trader quoting whichever list favours them.

**Warnings** (shown under the verdict, worst first):

| Trigger | Message |
|---|---|
| Supreme `Unsafe`, MM2 `MASS-DUPED` or `PROJECTED` | Red: "Supreme marks X unsafe to trade for" / "MM2 Values: duped copies spreading" / "MM2 Values: value being pushed by a group". |
| Too good to be true: you get > 1.5× what you give | "Too good to be true? Check every item's version in the trade window." |
| Version check: an item has siblings | "Gingerbread Knife has 4 versions. Make sure you receive the 2019 one (picture)." |
| More than 4 distinct items on a side | "Needs more than one in-game trade. Never go first; use a trusted middleman." |
| New item: first seen < 14 days ago, or from the current event | "New item, values still moving (MM2 1,300 / Supreme 750)." |
| Underpaid For / Decreasing / Fluctuating | "Usually trades below its list value." |
| Bundle share > 50% of a side | "Mostly low-tier stacks; stacks often trade below list value." |
| Stale: the list's own update > 7 days old | "Values from <site> are N days old." |
| Demand | "Their side is easier to trade on (demand 5.0 vs 3.2)" — kept advisory, but weighted by value and only over priced items. |

### 6.5 What the user sees

The picker and every card show name, a **year chip**, a **category chip** and the art. Names are never cut to 7 characters, and the Chroma prefix is its own chip. Variants are listed together with their values:

| Variant | Value |
|---|---|
| Gingerbread Knife · 2019 · Uncommon | 85 |
| Gingerbread Knife · 2020 · Uncommon | 10 |
| Gingerbread Knife · 2025 · Uncommon | ≈0.016 |
| Gingerbread Knife · 2022 · Rare | ≈0.15 |

A result card, for example:

```text
FAIR · slight win (+1.8%)                          Supreme values · updated 30 Oct 04:26
You give 1,450 (1,400–1,500)                       You get 1,476
Demand: you 4.0 · them 4.5 (value-weighted)
⚠ Depends on the list: on MM2 Values this trade is a LOSS (Emberbow: MM2 1,300 / Supreme 750)
⚠ Gingerbread Knife has 4 versions — check the 2019 picture in the trade window
```

Sets are added as their parts, with a "Sun Set" group label. Adding a set's part twice warns. A set is never posted as one item.

### 6.6 Server trust: what other people see is computed by the server

- **Trades** (`trades_new`).
  - The client writes `{ hasItems: [{key, qty}], wantsItems: [{key, qty}], valueSource, note }`.
  - An onCreate/onUpdate function prices both sides from the CDN catalogue and writes totals, the poster's verdict, `catalogVersion` and `pricedAt`.
  - Rules reject client-written `status`, totals, item values, `rating`, `isPro`, `robloxUsernameVerified`, `isFeatured` / `featuredUntil` (set by the boost function only) and any `timestamp` other than `request.time`.
  - Items are immutable after create; an edit is a new post.
  - The web composer uses the same path. This also removes the inverted-status bug.
- **Feed card.** Shows the **viewer's** side — "If you accept: you give 120, you get 100 · LOSS (−17%)" — because the person accepting is the one at risk. If current values moved more than 10% since `pricedAt`, add "values changed since posting".
- **Chat item / trade cards.** Send keys + qty. The reader's app prices them with its own catalogue and labels the list per card. RTDB rules validate the shape.
- **Ratings.**
  - **Correction (2026-10-30, Phase 0 work).** Simply denying client writes to `user_ratings_summary` would break rating on every installed build. Seven client paths write it: rating, re-rating, editing a review, staff moderation, and three RTDB→Firestore migrations. Recomputing it only from `reviews/{to}_{from}` documents would also wipe legacy ratings migrated from RTDB `averageRatings` as a bare count.
  - **Phase 2 plan.**
    1. A trigger on rating documents in `reviews` maintains server-only totals (`rating_totals/{uid}`: count, sum), seeded once from RTDB `averageRatings` after checking whether those ratings also exist as review documents (avoid double counting).
    2. New builds display and use only `rating_totals`, including the Scam Safety box.
    3. Rules deny client writes to `rating_totals`. `user_ratings_summary` stays writable for old builds but is no longer trusted.
    4. Trade cards read the live rating, not a copy.
- **Shared links.** Carry the builder's side, the list and the catalogue version (`?give=…&get=…&from=builder&list=supreme&v=…`). The viewer sees "Shared by X — X gives … / X gets …" and the verdict from both sides.
- **Discord.**
  - `/value` and `/wfl` resolve to keys. An ambiguous name replies with the versions and asks; it never picks the pricier one.
  - `/wfl` follows §6.4, so it is INCOMPLETE when something is unpriced.

### 6.7 Pipeline gates (block the upload, don't just log)

1. Capture mm2values.com's numeric id (the third `stackValue` argument) and status tags, both sites' "values updated" stamps, per-category scrape time, and Supreme's real image (`data-image`, or the HTML `src` before `onerror`).
2. A category that failed this run and kept old rows fails the build unless `--allow-stale`, which marks it stale in `meta`. Restart Chrome after "Connection closed".
3. Before upload, compare with the live file:
   - block if any category shrinks by more than 2%, or any item disappears without being on an allowlist;
   - block if an observed value moves more than 3× without a matching Supreme changelog line;
   - block if any observed → none flip happens;
   - block if any row has valueType `code`, or any non-T1 bundle text appears.
4. Catalogue checks: duplicate keys, registry conflicts, crosswalk conflicts, unpaired items above a threshold, and pairs outside 4×. This is today's conflict audit, turned into tests.
5. `all:publish` runs verify. Schedule MM2 with launchd once the gates exist.
6. Clients refuse a feed whose item count drops more than 5% against the last good one and keep the last good copy. The app persists `meta` instead of discarding it (the "Updated" label is blank today).

### 6.8 Monitoring
- **Weekly.** /bug-review runs the conflict audit: collisions, unpaired items, implausible pairs, freshness of both sites, and a sample of 20 items compared with the live pages.
- **Value alerts.** Move to catalogue keys, watch the list the user picked, and never alert on bundle-tier rank changes.
- **User reports.** The in-app Reports inbox is how this was found. Tag value reports so they surface in /bug-review.

## 7. Scam patterns and how the design stops each

| Pattern | Today | Design |
|---|---|---|
| Version swap: offer the cheap year, let them think it's the rare one | only the dearest year is pickable; no year anywhere | year chips, variant list with values, "check the version" warning (§6.1, §6.5) |
| Same name, other category (Rare vs Godly Sunset, Vintage vs Godly Laser, Chroma vs normal) | fixed in the calculator today; chat, Trade Match and alerts still name-only | canonical keys everywhere; category chip; full names |
| Set passed off as one item ("Sun Set" priced as Sunset) | sets pickable as one item | sets expand into parts (§6.5) |
| List shopping: quote whichever list favours you | one list at a time | "depends on the list" verdict (§6.4) |
| Stale-list sharking on new items (Emberbow 1,300 vs 750) | build-time stamp; app label blank | each site's own stamp, new-item and disagreement warnings |
| Hidden unpriced item (Priceless, award, gift) to fake a WIN | verdict ignores it; 0/0 = WIN | INCOMPLETE / BLOCKED (§6.4) |
| Bundle flooding: a pile of commons for a godly | bundle items excluded or mis-scaled | Supreme ladder, bundle-share warning, value-weighted demand |
| Hype or dupe traps | tags not captured | Unsafe / MASS-DUPED / PROJECTED red warnings |
| Forged trade post (fake FAIR, fake values, fake verified, fake featured or pinned) | client-written, rules check userId only | server-priced trades, locked fields (§6.6) |
| Forged chat card values | sender-written | keys only, reader re-prices |
| Rating manipulation | any user can set any rating | function-computed summary |
| Profile crash to hide reviews | unguarded `toDate()` | guard + server-set timestamps |
| Multi-trade "you go first" | no warning | 4-slot feasibility warning |
| Bad or partial feed published | happened 2026-10-15 | publish gates + client sanity (§6.7) |
| Shared-link perspective trick | no builder or list in the link | link carries builder + list, both sides shown |
| Trade Match lure (cheap Sunset matches Godly Sunset wanters) | name key | canonical key + value check on "perfect" |
| Web composer says WIN while you overpay | inverted sign | shared verdict + server-written status |

## 8. Implementation plan

**Phase 0 — small fixes, one app release + one web deploy (P1s, about a week)**
- App (this repo):
  - ship today's matching fix (`valueSources.js`, tests);
  - INCOMPLETE / NO DATA instead of a verdict, and no 0/0 WIN (`HomeScreen.jsx`, `tradeStatus.js`);
  - chat "My Items" → `poolLookup` (`ValueScreen.jsx`);
  - INVENTORY tab baseline (`HomeScreen.jsx:567-571, 626`);
  - `toDate` guard (`BottomDrawer.jsx:1336`);
  - persist `meta` so "Updated" works (`GlobelStats.js`), and refresh honours failure.
- Web: flip `computeStatus` (`lib/trades.ts`); INCOMPLETE in the composer; block awards.
- Rules (after backing up the deployed set):
  - on `trades_new` create, require `isFeatured == false`, no `featuredUntil`, and `timestamp == request.time`;
  - on update, the owner may change only `isFeatured` / `featuredUntil`, with `featuredUntil` at most 26 h ahead. Built and emulator-tested 2026-10-30: 16/16 cases.
  - The ratings change moved to Phase 2; see §6.6 for why denying client writes would break rating.
- Pipeline: fail on kept categories; per-category shrink gate; capture both sites' update stamps.

**Phase 1 — canonical catalogue (1–2 weeks; pipeline first, then clients)**
- Pipeline:
  - capture the mm2values.com id, status tags and real Supreme images;
  - year/kind extraction, registry, crosswalk, pairing with the 4× guard;
  - `catalog.json`, the Supreme ladder, all §6.7 gates.
- App + web + Discord + functions read `catalog.json`. Pool, picker, chat, Trade Match, alerts and journal are keyed by canonical key.
- Year chips and variant lists; sets expand into parts.
- Migration through `legacy`, with "Pick the version" when ambiguous.

**Phase 2 — server-side pricing and verdict v2**
- A trades function prices posts; rules lock the fields.
- Chat cards carry keys only; shared links carry builder and list.
- Verdict v2 (§6.4) in one shared module with fixtures copied from Supreme's calculator, including the cross-list check and warnings.
- The feed card shows the viewer's perspective, with "values changed since posting".
- The ratings summary function.

**Phase 3 — monitoring**
- The weekly audit in /bug-review; value alerts on keys and the user's list; a sample check against the live pages.

## 9. Decisions needed from the owner
1. **Verdict band.** Adopt Supreme's (±1% above 1,000, ±2.5% below, with "slight" bands) instead of our ±5%? Recommended: yes, so answers match supremevalues.com.
2. **Bundle items in totals.** Include them at Supreme's ladder, like Supreme, instead of excluding them? Recommended: yes, with the bundle-share warning.
3. **Feed card perspective.** Show the viewer's side ("if you accept") instead of the poster's? Recommended: yes.
4. **Default list.** The app defaults to Supreme and the web to MM2. Recommended: same default everywhere, with the cross-list check making the choice less risky.
5. **Phase 2 cost.** One Cloud Function invocation per trade post or edit, plus one catalogue read (cached in the function instance). Trade volume was not measured for this document; check the trades_new write count in the Firebase console before Phase 2 to confirm it stays inside the free invocation tier.
