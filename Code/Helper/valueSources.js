/**
 * valueSources.js — the one place that knows how the two value feeds differ.
 *
 * 📅 2026-09-13. The app carries two catalogues of MM2 item values:
 *
 *   MM2      https://mm2-api.b-cdn.net/data.json       1,079 items, 11 categories
 *   Supreme  https://mm2api-suprime.b-cdn.net/supreme.json  1,402 items, 14 categories
 *
 * Both are the value pipeline's `dist` build, wrapped as `{ meta, data }`.
 * They are scraped from different sites and they disagree: of the 356 items
 * where both publish a real observed price, 70% differ, median 12.5%. That
 * disagreement is the product feature — it is not drift to be reconciled.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `https://mm2values.com/${item.image}` was hardcoded in nine files. That is
 * fine while there is one feed. It breaks immediately on the second, because
 * a Supreme item's `image` field is NOT an image path — see below.
 *
 * ── The Supreme image problem ─────────────────────────────────────────────
 *
 * supremevalues.com lazy-loads its item art, so the scraper captures the
 * placeholder that is in `src` at parse time, not the real asset. 1,399 of
 * 1,402 Supreme items therefore carry `image: "/media/N_A.webp"`. Prefixing
 * that the MM2 way yields `https://mm2values.com//media/N_A.webp`, which 404s.
 *
 * The real asset id is `imageKey` (e.g. `mm2godlies/Icebeam`), and the real
 * asset lives at `https://supremevalues.com/media/{imageKey}.webp`. We do NOT
 * link that: supremevalues.com is behind Imperva/Incapsula and answers every
 * image request with a ~212-byte HTML challenge page under HTTP 200. It would
 * not error, it would just render blank. Puppeteer with real Chrome clears the
 * challenge — that is how the scraper works — so mirroring those assets to
 * Bunny is a scraper-side job, not something the client can do.
 *
 * Until that mirror exists, art comes from the MM2 catalogue by name. 787 of
 * the 1,219 unique Supreme names match an MM2 item, and all 787 of those MM2
 * items have a real image — so roughly two thirds of Supreme renders for free.
 * The remainder resolve to '' and the caller falls back to its empty state.
 *
 * ── What is NOT solved here ───────────────────────────────────────────────
 *
 * 103 Sets could be composed from `containsParts` (92 have every part in the
 * MM2 catalogue). 164 Untradables are valueless and should not reach the
 * calculator at all. 165 items need genuinely new art. All three are follow-up
 * work; this file only does the free two-thirds.
 */

// ── Sources ────────────────────────────────────────────────────────────────

export const VALUE_SOURCE = {
  MM2: 'mm2',
  SUPREME: 'supreme',
};

// Supreme is the app's primary catalogue as of 2026-09-13. The toggle is the
// user's to change and their choice persists; this is only the starting point.
//
// Know what this costs: Supreme declines to price leaderboard awards, and that
// is where the top of the game lives — all 25 of MM2's most valuable items are
// unpriced on Supreme. They render by reason ("Award only") with MM2's figure
// as a labelled reference, never as 0. See unpricedReason() below.
export const DEFAULT_VALUE_SOURCE = VALUE_SOURCE.SUPREME;

// ── Feed shape ─────────────────────────────────────────────────────────────

const MM2_IMAGE_BASE = 'https://mm2values.com';

/**
 * Every Supreme image path is rooted at `/media/` — both the `N_A.webp`
 * placeholder (1,399 items) and the 3 real paths the scraper caught after the
 * art had lazy-loaded, e.g. `/media/mm2ancients/Niks_Scythe.webp`. None of them
 * may be prefixed with the MM2 host: `mm2values.com//media/...` is a 404, and
 * the real asset is on supremevalues.com, which we cannot link (see header).
 * So the whole prefix routes to the name lookup, placeholder or not.
 */
const SUPREME_MEDIA_PREFIX = '/media/';

/**
 * Both feeds publish `{ meta, data }`; older raw uploads published the
 * categories at the top level. Accept either, so a rollback on the CDN does
 * not need an app release. No MM2 or Supreme category is named `meta` or
 * `data`, so the wrapper signature cannot collide with real content.
 */
export const unwrapFeed = (raw) =>
  raw && typeof raw === 'object' && raw.meta && raw.data && typeof raw.data === 'object'
    ? raw.data
    : raw;

/**
 * The `meta` block the dist build carries: generatedAt, source, and the
 * observed/modeled/none counts. Null for an older raw upload that has none.
 *
 * generatedAt is when the SCRAPER last ran — not when the app last fetched.
 * The difference is the whole point. Supreme's own staff put their cadence at
 * "twice every 5 days", yet players believe it is every 2-3 weeks, because no
 * tool has ever shown them the real figure. Showing the fetch time instead
 * (which is what "Updated just now" used to mean) actively feeds that.
 */
export const feedMeta = (raw) =>
  raw && typeof raw === 'object' && raw.meta && typeof raw.meta === 'object'
    ? raw.meta
    : null;

/** Newest generatedAt across the feeds, as a Date, or null if none carry one. */
export const newestGeneratedAt = (...raws) => {
  let newest = null;
  for (const raw of raws) {
    const at = feedMeta(raw)?.generatedAt;
    if (!at) continue;
    const d = new Date(at);
    if (!Number.isNaN(d.getTime()) && (!newest || d > newest)) newest = d;
  }
  return newest;
};

const isSupremeAsset = (image) => !image || image.startsWith(SUPREME_MEDIA_PREFIX);

// ── Name normalization ─────────────────────────────────────────────────────
//
// The two sites name the same item differently. Stripping case and
// punctuation already reconciles most of it ("Niks Scythe" / "Nik's Scythe"
// both reduce to "niksscythe"). What is left needs care, because a WRONG
// merge shows a wrong price, which is worse than showing nothing.
//
// Every rule below was tested for collisions against both full catalogues.
// Three obvious-looking rules were rejected for exactly that reason:
//
//   drop a trailing plural "s"     +14 matches, 42 collisions
//                                  ("Bat"/"Bats", "Web"/"Webs" are different items)
//   drop "(Knife)" / "(Gun)"       +20 matches, 242 collisions
//                                  ("Tree (gun)" vs "Tree (knife)")
//   drop a bare weapon suffix      +68 matches, 181 collisions
//                                  ("Gold Swirly Axe" vs "Gold Swirly Gun")
//
// So only collision-free rewrites are applied globally, and everything else
// goes in the explicit table below.

const baseKey = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Verified collision-free against all 2,481 items in both catalogues.
const applyNameRules = (name) =>
  String(name || '')
    // Supreme abbreviates the Chroma prefix: "C. Elderwood Blade".
    .replace(/^c\.\s*/i, 'Chroma ')
    // Supreme abbreviates Vampire's: "Gold Vamp's Edge".
    // The \b keeps this off "Vampires", which MM2 already spells out.
    .replace(/vamp'?s\b/i, 'Vampires');

// Hand-checked one-to-one pairs the rules cannot reach. Each was verified to
// be unambiguous: the Supreme target is not claimed by two different MM2
// names, and it is not listed twice with conflicting values.
//
// Deliberately NOT here, and they must stay out:
//   "Silver Swirly Axe" and "Silver Swirly Gun" both resemble Supreme's single
//     "Silver Swirly" — two items, one target, so neither can be mapped.
//   "Ribbon Knife" / "Rainbow (Knife)" — different items that merely look alike.
//   "Chroma Constellation" / "Gold Constellation" — different finishes.
//   Anything whose year differs ("Santa (2017)" / "Santa (2018)",
//     "Brains 2019" / "Brains (2022)") — separate collectibles.
const NAME_ALIASES = new Map([
  ['Silver Hallows', 'Silver Hallow'],
  ['Bronze Hallows', 'Bronze Hallow'],
  ['Gold Hallows', 'Gold Hallow'],
  ['Red Hallows', 'Red Hallow'],
  ['Mystery Keys', 'Mystery Key'],
  ['Gold Travelers Axe', "Gold Traveler's"],
  ['Red Travelers Axe', "Red Traveler's"],
  ['Silver Travelers Axe', "Silver Traveler's"],
  ['Bronze Travelers Axe', "Bronze Traveler's"],
  ['Moonlight Gun', 'Moonlight'],
  ['Balloons Gun', 'Balloons'],
  ['Curse Knife', 'Cursed (Knife)'],
].map(([from, to]) => [baseKey(applyNameRules(from)), baseKey(applyNameRules(to))]));

/**
 * One key for one item, whichever catalogue named it. Used for both indexes
 * and every lookup, so the two sides always agree.
 */
const normalizeName = (name) => {
  const key = baseKey(applyNameRules(name));
  return NAME_ALIASES.get(key) || key;
};

export const __testing = { normalizeName, applyNameRules, NAME_ALIASES };

// ── Category spelling ──────────────────────────────────────────────────────
//
// MM2 names categories in the singular ("Godly"), Supreme in the plural
// ("Godlies"), and the 115 items only Supreme lists keep the plural, so an
// exact match against the category chips silently drops them. Compare
// through this key instead. Don't rewrite `category` in the pool to fix it:
// it is part of each item's `id`, which saved inventories match on.
const CATEGORY_ALIASES = {
  ANCIENTS: 'ANCIENT', UNIQUES: 'UNIQUE', CHROMAS: 'CHROMA', GODLIES: 'GODLY',
  VINTAGES: 'VINTAGE', LEGENDS: 'LEGEND', LEGENDARY: 'LEGEND', LEGENDARIES: 'LEGEND',
  RARES: 'RARE', UNCOMMONS: 'UNCOMMON', COMMONS: 'COMMON', PET: 'PETS',
};

/** Upper-case MM2 category for any spelling either catalogue uses. */
export const categoryKey = (raw) => {
  const u = String(raw || '').trim().toUpperCase();
  return CATEGORY_ALIASES[u] || u;
};

// ── MM2 image index, for the Supreme fallback ──────────────────────────────
//
// Module-level rather than passed through props: the nine call sites that
// resolve an image are spread across trades, chat, the feed and the share
// sheet, and most have no access to the raw MM2 catalogue. GlobalStats owns
// the fetch, so it owns filling this in.

let mm2ImageIndex = new Map();

/** Called once per MM2 fetch, with the UNWRAPPED `{category: {tier: [...]}}`. */
export const indexMM2Images = (mm2Data) => {
  const next = new Map();
  if (mm2Data && typeof mm2Data === 'object') {
    for (const tiers of Object.values(mm2Data)) {
      if (!tiers || typeof tiers !== 'object') continue;
      for (const items of Object.values(tiers)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || !item.name || !item.image) continue;
          const key = normalizeName(item.name);
          // First writer wins. 131 MM2 names appear in more than one tier
          // (158 surplus rows over 921 unique names); the earlier tier is the
          // canonical one.
          if (!next.has(key)) next.set(key, item.image);
        }
      }
    }
  }
  mm2ImageIndex = next;
  return next.size;
};

export const getMM2ImageIndexSize = () => mm2ImageIndex.size;

// ── The resolver ───────────────────────────────────────────────────────────

/**
 * Absolute URL → returned untouched. This matters: every trade ever created
 * stored a fully-qualified `mm2values.com` URL on each item (see mapTradeItem
 * in HomeScreen), so 8,799 existing trades depend on that passthrough.
 *
 * Relative MM2 path → prefixed with the MM2 host, as before.
 *
 * Supreme `/media/...` path or missing → looked up in the MM2 catalogue by name,
 * and '' when there is no match. Callers already handle '' — that is what a
 * missing image has always produced.
 */
export const resolveItemImage = (item) => {
  if (!item) return '';

  const raw = item.Image || item.image || item.imageUrl || '';

  if (/^https?:\/\//.test(raw)) return raw;
  if (!isSupremeAsset(raw)) return `${MM2_IMAGE_BASE}/${raw}`;

  const matched = mm2ImageIndex.get(normalizeName(item.name || item.Name));
  return matched ? `${MM2_IMAGE_BASE}/${matched}` : '';
};

// ── Value confidence ───────────────────────────────────────────────────────
//
// Every item carries `valueConfidence`, and it is the field to branch on:
//
//   observed  a real price the source site published. Safe to sum.
//   modeled   the site prices this item only in bundles ("x3 T1 Legendaries").
//             The scraper converts that with a reverse-engineered BASE table,
//             so the number RANKS correctly but is not currency.
//   none      no usable price at all.
//
//                    observed   modeled   none
//   MM2                   605       467      7
//   Supreme               533       515    354
//
// Summing modeled values asserts an exchange rate nothing supports — 200
// Commons at 0.0015 is not "1.5 T1 Legendaries". In practice the error is
// small (every modeled value is <= 0.8, against observed values reaching
// 500,000,000), so excluding them barely moves a real total. The reason to
// separate them is honesty about what the number means, and so that a trade
// made entirely of cheap items reads as "12 bundle-tier items" rather than a
// misleading "0".
//
// The two scales also overlap: MM2's `Plaid Gun` is genuinely observed at
// 0.02, inside the modeled band. So branch on the field, never on magnitude.

export const VALUE_CONFIDENCE = {
  OBSERVED: 'observed',
  MODELED: 'modeled',
  NONE: 'none',
};

/**
 * Items that predate `valueConfidence` — every saved trade item, and any
 * cached feed from before 2026-09 — have no such field. Those count as
 * summable, which is exactly what the app did before this existed. Failing
 * toward the old behaviour matters: the alternative silently zeroes the total
 * of every trade ever created.
 */
export const isSummable = (item) => {
  if (!item) return false;
  const confidence = item.valueConfidence;
  if (!confidence) return true;
  return confidence === VALUE_CONFIDENCE.OBSERVED;
};

// ── Supreme price index, for the calculator's source toggle ────────────────
//
// The picker pool is the MM2 catalogue, so a grid item always carries MM2
// values. Switching the source must NOT rewrite those — it has to stay
// reversible — so nothing is mutated. priceOf() derives the active price on
// demand and the item keeps its MM2 baseline forever.
//
// Switching is lossy in both directions, and that is the data, not a bug:
// of 509 MM2 items with a real price, 356 (70%) are also priced on Supreme;
// 54 are absent from Supreme entirely, 54 are unpriced there, and 45 are
// bundle-tier. The UI has to say so rather than showing a silent zero.

let supremePriceIndex = new Map();

/**
 * 125 Supreme keys are claimed by more than one record, because the site
 * lists a weapon and a same-named cosmetic effect: "Bats" is both a Rares
 * knife and an Untradables effect, and so are Blizzard, Bloom, Celestial and
 * ~120 others. Same text, different things — only the category separates them.
 *
 * This is a trading calculator, so the tradable record wins, and a priced one
 * beats an unpriced one. Without an explicit rule the winner is whichever the
 * JSON happened to list first; that currently gives the right answer only
 * because `Untradables` is the last key in the feed.
 */
const supremeRecordRank = (record) => {
  if (!record) return -1;
  if (record.category === 'Untradables') return 0;
  if (record.valueConfidence === VALUE_CONFIDENCE.OBSERVED) return 3;
  if (record.valueConfidence === VALUE_CONFIDENCE.MODELED) return 2;
  return 1;
};

/** Called once per Supreme fetch, with the UNWRAPPED categories object. */
export const indexSupremePrices = (supremeData) => {
  const next = new Map();
  if (supremeData && typeof supremeData === 'object') {
    for (const [category, tiers] of Object.entries(supremeData)) {
      if (!tiers || typeof tiers !== 'object') continue;
      for (const [tier, items] of Object.entries(tiers)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || !item.name) continue;
          const key = normalizeName(item.name);
          // Category and tier are not on the item itself, but they are what
          // says WHY something has no price — an award is not an untradable.
          const record = { ...item, category, tier };
          const held = next.get(key);
          if (!held || supremeRecordRank(record) > supremeRecordRank(held)) {
            next.set(key, record);
          }
        }
      }
    }
  }
  supremePriceIndex = next;
  return next.size;
};

export const getSupremePriceIndexSize = () => supremePriceIndex.size;

// ── Why an item has no price ───────────────────────────────────────────────
//
// 354 Supreme items carry no value, and "0" is wrong for almost all of them.
// The reasons are genuinely different, and they run in opposite directions:
//
//   227  Untradables   Effects, Radios, Emotes, Powers. No market exists —
//                      no demand rating either. 5 are not even released.
//   100  Awards        Leaderboard prizes: 1st/2nd/3rd Place and Top 100.
//                      Awarded, never sold. MM2 quotes 40M-500M for these.
//    16  Evos          Progression stages, not traded separately.
//     4  Gifts/promos  "Gift From Nikilis", "Nerf x Roblox Promo".
//                      slouse's Clown is demand 11, rarity 11.
//     1  Nik's Scythe  Explicitly "Priceless". ~7 known owners.
//     6  Pets/Commons  Two Commons are demand 0, rarity 0 — the default
//                      knife and gun. These really are worth nothing.
//
// So the same empty `value` covers both the default starter knife and a
// 500,000,000 leaderboard award. Rendering either as 0 is a lie; rendering
// them identically is a worse one. Every one of MM2's 25 most valuable items
// is unpriced on Supreme, all of them leaderboard awards.

export const UNPRICED_REASON = {
  UNTRADABLE: 'untradable',
  UNRELEASED: 'unreleased',
  AWARD: 'award',
  GIFT: 'gift',
  EVOLUTION: 'evolution',
  PRICELESS: 'priceless',
  WORTHLESS: 'worthless',
  UNKNOWN: 'unknown',
};

const UNPRICED_LABEL = {
  [UNPRICED_REASON.UNTRADABLE]: 'Untradable',
  [UNPRICED_REASON.UNRELEASED]: 'Unreleased',
  [UNPRICED_REASON.AWARD]: 'Award only',
  [UNPRICED_REASON.GIFT]: 'Gift only',
  [UNPRICED_REASON.EVOLUTION]: 'Evolution',
  [UNPRICED_REASON.PRICELESS]: 'Priceless',
  [UNPRICED_REASON.WORTHLESS]: 'No value',
  [UNPRICED_REASON.UNKNOWN]: 'Not priced',
};

/** Classify an unpriced Supreme record. Returns a UNPRICED_REASON. */
export const unpricedReason = (record) => {
  if (!record) return UNPRICED_REASON.UNKNOWN;

  const category = String(record.category || '');
  const tier = String(record.tier || '');
  const demand = Number(record.demand);
  const rarity = Number(record.rarity);

  if (String(record.rarity) === 'Coming Soon!') return UNPRICED_REASON.UNRELEASED;
  if (category === 'Untradables') return UNPRICED_REASON.UNTRADABLE;
  if (category === 'Evos') return UNPRICED_REASON.EVOLUTION;
  if (/Place Awards|Top \d+ Awards/i.test(tier)) return UNPRICED_REASON.AWARD;
  if (/priceless/i.test(record.valueText || '')) return UNPRICED_REASON.PRICELESS;
  if (/gift|promo/i.test(record.origin || '')) return UNPRICED_REASON.GIFT;
  // Demand AND rarity both explicitly zero is the starter gear.
  if (demand === 0 && rarity === 0) return UNPRICED_REASON.WORTHLESS;
  // Wanted enough to be tracked, never sold.
  if (demand >= 10 || rarity >= 10) return UNPRICED_REASON.PRICELESS;
  return UNPRICED_REASON.UNKNOWN;
};

export const unpricedLabelFor = (reason) => UNPRICED_LABEL[reason] || UNPRICED_LABEL[UNPRICED_REASON.UNKNOWN];

/**
 * The active price for an item, without touching the item.
 *
 * `missing` distinguishes "Supreme has no record of this item" from "Supreme
 * lists it with no price" — different messages to a trader, both rendered
 * from `valueText` where the source provides one.
 */
export const priceOf = (item, source = DEFAULT_VALUE_SOURCE) => {
  if (!item) return { value: 0, valueConfidence: VALUE_CONFIDENCE.NONE, valueText: '', missing: false };

  // Explicit rather than "anything that is not Supreme": the default moved to
  // Supreme on 2026-09-13, so treating an omitted source as MM2 would quietly
  // contradict it.
  if (source === VALUE_SOURCE.MM2) {
    // A pooled row that exists only on Supreme carries no MM2 baseline.
    // Saying so beats reporting a 0 that looks like a real price.
    if (item.inMM2 === false) {
      return {
        value: 0, valueConfidence: VALUE_CONFIDENCE.NONE, valueText: '',
        missing: true, reason: UNPRICED_REASON.UNKNOWN,
      };
    }
    return {
      value: Number(item.Value ?? item.selectedValue ?? item.value) || 0,
      valueConfidence: item.valueConfidence,
      valueText: item.valueText || '',
      missing: false,
    };
  }

  const match = supremePriceIndex.get(normalizeName(item.name || item.Name));
  if (!match) {
    return {
      value: 0, valueConfidence: VALUE_CONFIDENCE.NONE, valueText: '',
      missing: true, reason: UNPRICED_REASON.UNKNOWN,
    };
  }

  const priced = {
    value: Number(match.value) || 0,
    valueConfidence: match.valueConfidence,
    valueText: match.valueText || '',
    missing: false,
  };

  if (priced.valueConfidence === VALUE_CONFIDENCE.NONE) {
    priced.reason = unpricedReason(match);
    // What MM2 asks for the same item, when Supreme declines to price it.
    // Every one of MM2's 25 most valuable items is an unpriced Supreme award,
    // so without this the top of the game reads as worthless. Kept separate
    // from `value` on purpose: it is another site's number, it never enters a
    // Supreme total, and the UI has to label it as MM2's.
    const mm2Value = Number(item.Value ?? item.value);
    if (Number.isFinite(mm2Value) && mm2Value > 0) priced.referenceValue = mm2Value;
  }

  return priced;
};

/**
 * Totals for one side of the calculator.
 *
 * `total` sums only what can honestly be summed. `modeled` and `unpriced` are
 * counts, so the UI can say what the total leaves out instead of pretending
 * those items are worth nothing.
 *
 * Accepts the calculator's fixed-length grid arrays, which contain nulls.
 */
export const summarizeItems = (items, source = DEFAULT_VALUE_SOURCE) => {
  let total = 0;
  let counted = 0;
  let modeled = 0;
  let unpriced = 0;
  let missing = 0;

  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item) continue;
      const priced = priceOf(item, source);
      if (isSummable(priced)) {
        total += priced.value;
        counted += 1;
      } else if (priced.valueConfidence === VALUE_CONFIDENCE.MODELED) {
        modeled += 1;
      } else {
        unpriced += 1;
        if (priced.missing) missing += 1;
      }
    }
  }

  return { total, counted, modeled, unpriced, missing };
};

/**
 * What to render on an item tile.
 *
 * For a modeled or unpriced item the source's own words beat the derived
 * decimal: "x3 T1 Legendaries" and "Priceless" are both more honest and more
 * useful to a trader than "0.024" or "0".
 */
export const displayValueText = (item, source = DEFAULT_VALUE_SOURCE) => {
  if (!item) return '';
  const priced = priceOf(item, source);
  if (isSummable(priced)) return '';
  if (priced.missing) return 'Not listed';
  // A modeled item still has the source's own words ("x3 T1 Legendaries").
  if (priced.valueConfidence === VALUE_CONFIDENCE.MODELED) return priced.valueText || '';
  // An unpriced one gets the REASON, which is the useful part. "Award only"
  // tells a trader far more than "N/A", and far more truthfully than "0".
  if (priced.reason) return unpricedLabelFor(priced.reason);
  return priced.valueText || '';
};

// ── The item pool ──────────────────────────────────────────────────────────
//
// One list, built from both catalogues, deduped by the shared name key.
//
// A Supreme-first app cannot pick from the MM2 catalogue alone: 134 names are
// MM2-only, and they are not obscure — Gold Vampires Edge (500M), Gold Swirly
// Axe and Gun (100M each) among them. Nor can it pick from Supreme alone, for
// the mirror-image reason: 261 tradable names exist only there.
//
// So: MM2 first, because it owns the artwork and the baseline values, then
// every Supreme-only TRADABLE name appended. Supreme's 227 Untradables are
// excluded — they cannot be traded, so they have no business in a calculator.
//
// This replaces `[...parse(data), ...parse(suprime)]`, which was not a merge:
// it produced 2,481 rows with 953 duplicate names and 1,399 broken images.
// That concatenation was gated off behind a flag until this existed; the flag
// is gone now that the pool is the real thing.

const numericValue = (raw) => {
  const cleaned = String(raw ?? '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const poolEntry = (item, category, tier, inMM2) => ({
  Name: item.name,
  name: item.name,
  image: item.image || '',
  imageKey: item.imageKey || '',
  Category: String(category || '').trim(),
  category: String(category || '').trim(),
  Tier: String(tier || '').trim(),
  tier: String(tier || '').trim(),
  type: String(category || '').trim(),
  id: `${category}-${tier}-${item.name}`,
  demand: item.demand && item.demand !== 'N/A' ? Number(item.demand) : null,
  rarity: item.rarity || null,
  // MM2 baseline. Meaningless on a Supreme-only row, which `inMM2` marks so
  // priceOf can say "not listed" rather than quietly reporting 0.
  Value: inMM2 ? numericValue(item.value) : 0,
  valueConfidence: inMM2 ? (item.valueConfidence || null) : null,
  valueText: inMM2 ? (item.valueText || '') : '',
  inMM2,
  // Supreme-only, and the reason the event screen needs no new pipeline:
  // `origin` tags 92% of items with the event that produced them
  // ("Halloween 2025 (Tier 24)"), and change/changePct already carry the
  // movement since the site's last update for 460 of them. MM2 publishes
  // neither, so these stay null on an MM2-only row.
  origin: item.origin || null,
  change: item.change ?? null,
  changePct: item.changePct || null,
  stability: item.stability || null,
  range: item.range || null,
});

const eachItem = (data, fn) => {
  if (!data || typeof data !== 'object') return;
  for (const [category, tiers] of Object.entries(data)) {
    if (!tiers || typeof tiers !== 'object') continue;
    for (const [tier, items] of Object.entries(tiers)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item && item.name) fn(item, category, tier);
      }
    }
  }
};

export const buildItemPool = (mm2Data, supremeData) => {
  const pool = new Map();

  eachItem(mm2Data, (item, category, tier) => {
    const key = normalizeName(item.name);
    // First tier wins, matching both indexes. 131 MM2 names span >1 tier.
    if (!pool.has(key)) pool.set(key, poolEntry(item, category, tier, true));
  });

  eachItem(supremeData, (item, category, tier) => {
    const key = normalizeName(item.name);
    const held = pool.get(key);

    if (held) {
      // Already held by MM2, which owns the artwork and the baseline value.
      // But origin / change / stability are Supreme-only fields, and 787 items
      // are in BOTH catalogues — without this they would keep MM2's row and
      // silently lose their event tag, so the event screen would miss most of
      // what it is supposed to list.
      if (held.origin == null) held.origin = item.origin || null;
      if (held.change == null) held.change = item.change ?? null;
      if (held.changePct == null) held.changePct = item.changePct || null;
      if (held.stability == null) held.stability = item.stability || null;
      return;
    }

    // Untradables cannot be traded, so they have no business in a calculator —
    // but only skip them when they are not already held by a tradable MM2 row.
    if (category === 'Untradables') return;
    pool.set(key, poolEntry(item, category, tier, false));
  });

  return [...pool.values()];
};

/**
 * Which catalogue priced a list of items sent into a chat.
 *
 * Messages sent before 2026-09 carry no `valueSource` on their items, and MM2
 * is the honest answer for those — it was the only catalogue that existed.
 */
export const sourceLabelForItems = (items) => {
  const found = Array.isArray(items)
    ? items.find((i) => i && i.valueSource)
    : null;
  return found && found.valueSource === VALUE_SOURCE.SUPREME ? 'Supreme' : 'MM2';
};
