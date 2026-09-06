#!/usr/bin/env node
/**
 * backfill-trade-search-index.js
 *
 * Adds `hasItemNames` / `wantsItemNames` to trade documents that predate the
 * 2026-09-06 fix. Trade search queries those fields with `array-contains`;
 * nothing had ever written them, so search matched nothing at all.
 *
 * New trades get the fields at creation (Code/Homescreen/HomeScreen.jsx).
 * This backfills the existing ones.
 *
 * Safe to re-run: documents that already have both fields are skipped, and
 * nothing but those two fields is ever written.
 *
 * Usage:
 *   node scripts/backfill-trade-search-index.js --dry-run     # count only
 *   node scripts/backfill-trade-search-index.js               # write
 *   node scripts/backfill-trade-search-index.js --limit 500   # try a slice
 *
 * Needs serviceAccount.json in the repo root, or GOOGLE_APPLICATION_CREDENTIALS.
 */

const admin = require('firebase-admin');
const path = require('path');

// ── the SAME tokeniser the app uses, inlined ──────────────────────────
// Code/Trades/tradeSearchIndex.js is an ES module inside the RN bundle and
// cannot be required from plain Node. If you change the rules there, change
// them here too — a mismatch means backfilled trades are searchable by
// different terms than new ones, which is very hard to notice.
const MAX_TOKENS = 30;

const normalizeSearchTerm = (value) =>
  String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const buildSearchTokens = (items) => {
  if (!Array.isArray(items)) return [];
  const tokens = new Set();
  for (const item of items) {
    const full = normalizeSearchTerm(item && (item.name || item.Name));
    if (!full) continue;
    tokens.add(full);
    for (const word of full.split(/[^a-z0-9]+/)) {
      if (word.length >= 2) tokens.add(word);
    }
    if (tokens.size >= MAX_TOKENS) break;
  }
  return Array.from(tokens).slice(0, MAX_TOKENS);
};

// ── args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;

const PAGE = 400;          // documents read per page
const BATCH = 400;         // writes per commit; Firestore's hard cap is 500

function init() {
  if (admin.apps.length) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return;
  }
  const keyPath = path.resolve(__dirname, '..', 'serviceAccount.json');
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
}

async function main() {
  init();
  const db = admin.firestore();

  console.log(DRY_RUN ? '🔍 DRY RUN — nothing will be written' : '✍️  writing search tokens');

  let cursor = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let empty = 0;

  for (;;) {
    // Ordered by __name__ so paging is stable even while trades are created.
    let q = db.collection('trades_new').orderBy('__name__').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    let batch = db.batch();
    let pending = 0;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();

      // Already done. Re-running must not rewrite every document, or the
      // second run costs as much as the first.
      if (Array.isArray(data.hasItemNames) && Array.isArray(data.wantsItemNames)) {
        skipped++;
        continue;
      }

      const hasItemNames = buildSearchTokens(data.hasItems);
      const wantsItemNames = buildSearchTokens(data.wantsItems);

      // A trade with no named items on either side is unsearchable whatever we
      // write. Still stamp empty arrays, so a re-run skips it next time.
      if (hasItemNames.length === 0 && wantsItemNames.length === 0) empty++;

      if (!DRY_RUN) {
        batch.update(doc.ref, { hasItemNames, wantsItemNames });
        pending++;
        if (pending >= BATCH) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
      updated++;

      if (scanned >= LIMIT) break;
    }

    if (!DRY_RUN && pending > 0) await batch.commit();

    cursor = snap.docs[snap.docs.length - 1];
    console.log(`  scanned ${scanned}  updated ${updated}  skipped ${skipped}`);

    if (snap.size < PAGE || scanned >= LIMIT) break;
  }

  console.log('\n── done ──');
  console.log(`  scanned : ${scanned}`);
  console.log(`  updated : ${updated}${DRY_RUN ? ' (would have)' : ''}`);
  console.log(`  skipped : ${skipped} (already had both fields)`);
  console.log(`  no items: ${empty} (stamped empty so a re-run skips them)`);
  if (DRY_RUN) console.log('\nRe-run without --dry-run to write.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ backfill failed:', err);
  process.exit(1);
});
