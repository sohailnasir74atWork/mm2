/**
 * MM2 Trade Scanner: turn what the scan saw into "your offer" / "their
 * offer" picks.
 *
 * 2026-11-06: with the downloaded scanner, slots come from the slot finder
 * (matcher.js, every tile with a rarity name bar) and each slot's picture is
 * named by the AI model (tileModel.js). The name printed on the bar, read by
 * the text reader, decides when it is exactly a catalogue name; otherwise the
 * model does (helped by a partly read name). Without slots (no downloaded
 * scanner, or the finder saw none) the text-only reading below is used, as
 * from 2026-11-01.
 *
 * The MM2 trade window prints every item's name on its tile, with a "Chroma"
 * tag above chroma items and "x2" style counts on stacks. "YOUR OFFER" sits
 * above your row and "THEIR OFFER" above theirs, so the two labels both find
 * the window and split the sides. Names in the inventory list on the left of
 * the PC window are ignored: they sit left of the labels.
 */

export const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Catalogue names a piece of tile text can mean, best first, and whether the
 * read is exact. catalog: Map normalized name -> display name.
 */
export function namesForText(text, catalog) {
  const q = normalize(text);
  if (q.length < 3) return { names: [], exact: false };
  if (catalog.has(q)) return { names: [catalog.get(q)], exact: true };
  // Long names cut off by the tile edge.
  if (q.length >= 5) {
    const prefix = [...catalog.keys()].filter((k) => k.startsWith(q)).sort((a, b) => a.length - b.length);
    if (prefix.length) return { names: prefix.slice(0, 5).map((k) => catalog.get(k)), exact: prefix.length === 1 };
  }
  // One or two misread letters.
  const scored = [];
  for (const [k, n] of catalog) {
    const d = editDistance(q, k);
    if (d <= Math.max(1, Math.floor(q.length / 6))) scored.push([d, n]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return { names: scored.slice(0, 5).map((s) => s[1]), exact: scored.length === 1 };
}

const cy = (l) => l.y + l.h / 2;
const cx = (l) => l.x + l.w / 2;

/**
 * lines: [{ text, x, y, w, h }] in image pixels. width: image width.
 * catalog: Map normalized name -> display name.
 * Returns { mine: [pick], theirs: [pick], foundWindow } where
 * pick = { name, sure, alternatives: [name] }; a stack "x3" gives 3 picks.
 */
export function buildTrade({ slots, lines = [], width, catalog }) {
  if (slots?.length) {
    const fromSlots = buildFromSlots({ slots, lines, catalog });
    if (fromSlots.mine.length + fromSlots.theirs.length) return fromSlots;
  }
  return buildFromText({ lines, width, catalog });
}

function buildFromText({ lines, width, catalog }) {
  const your = lines.find((l) => /your\s*offer/i.test(l.text));
  const their = lines.find((l) => /their\s*offer/i.test(l.text));
  if (!your || !their || cy(their) <= cy(your)) return { mine: [], theirs: [], foundWindow: false };

  const rowH = cy(their) - cy(your);
  const left = Math.min(your.x, their.x) - width * 0.03;
  const rows = [
    { list: [], top: your.y + your.h, bottom: their.y },
    { list: [], top: their.y + their.h, bottom: their.y + rowH * 1.02 },
  ];
  const inRow = (l, r) => cy(l) > r.top && cy(l) < r.bottom && cx(l) > left;

  for (const [ri, r] of rows.entries()) {
    const here = lines.filter((l) => l !== your && l !== their && inRow(l, r));
    const tags = here.filter((l) => /^chroma$/i.test(l.text.trim()));
    const counts = here.filter((l) => /^\s*[x×]?\s*\d{1,3}\s*[x×]?\s*$/i.test(l.text) && /[x×]/i.test(l.text));
    const names = here.filter((l) => !tags.includes(l) && !counts.includes(l));
    names.sort((a, b) => cx(a) - cx(b));
    for (const l of names) {
      // A tag or count belongs to the tile whose name sits below it.
      const near = (o) => Math.abs(cx(o) - cx(l)) < Math.max(l.w, l.h * 6) * 0.75 && cy(o) < cy(l) + l.h && cy(o) > cy(l) - l.h * 9;
      const chroma = tags.some(near);
      const countLine = counts.find(near);
      const count = countLine ? Math.min(99, parseInt(countLine.text.replace(/\D/g, ''), 10) || 1) : 1;
      let found = namesForText(chroma ? `Chroma ${l.text}` : l.text, catalog);
      if (chroma && !found.names.length) found = namesForText(l.text, catalog);
      if (!found.names.length) continue;
      const pick = { name: found.names[0], sure: found.exact, alternatives: found.names.slice(1, 5) };
      for (let k = 0; k < count; k++) rows[ri].list.push({ ...pick });
    }
  }
  return { mine: rows[0].list, theirs: rows[1].list, foundWindow: true };
}

// ── Slots (finder + model) ────────────────────────────────────────────────

const inside = (l, x0, y0, x1, y1) => cx(l) >= x0 && cx(l) <= x1 && cy(l) >= y0 && cy(l) <= y1;
// A model pick this sure is shown without a "?" (as the Blox app, 0.5).
const SURE = 0.5;

/** The item name and tags the text reader saw on one slot. */
function slotText(s, lines) {
  const w = s.x1 - s.x0;
  const h = s.nameTop - s.top;
  const bar = lines.filter((l) => inside(l, s.x0 - 4, s.nameTop - 4, s.x1 + 4, s.nameBottom + 4));
  const name = bar.sort((a, b) => a.x - b.x).map((l) => l.text).join(' ').trim();
  const art = lines.filter((l) => !bar.includes(l) && inside(l, s.x0 - 4, s.top, s.x1 + 4, s.nameTop));
  const chroma = art.some((l) => /^\s*chroma\s*$/i.test(l.text) && cy(l) > s.top + h * 0.55);
  const countLine = art.find((l) => /^\s*[x×]\s*\d{1,3}\s*$/i.test(l.text) && cx(l) > s.x0 + w * 0.5 && cy(l) < s.top + h * 0.4);
  const count = countLine ? Math.min(99, parseInt(countLine.text.replace(/\D/g, ''), 10) || 1) : 1;
  return { name, chroma, count };
}

/**
 * One pick for a slot: { name, sure, alternatives } or null (nothing known).
 * model: [{ name, score }] best first, or null (no model on this phone).
 */
export function nameSlot({ text, chroma, model, catalog }) {
  const chromaOf = (n) => {
    if (!chroma || /^chroma /i.test(n)) return n;
    return catalog.get(normalize(`Chroma ${n}`)) || n;
  };
  const read = text ? namesForText(chroma ? `Chroma ${text}` : text, catalog) : { names: [], exact: false };
  const plain = chroma && text && !read.names.length ? namesForText(text, catalog) : read;
  const fromText = (plain.names.length ? plain : read);
  const modelNames = (model || []).map((c) => c.name);
  const alts = (first) => [...new Set([...modelNames, ...fromText.names.map(chromaOf)])].filter((n) => n !== first).slice(0, 4);

  // The bar says exactly one catalogue name: that is the item.
  if (fromText.exact && fromText.names.length === 1) {
    const name = chromaOf(fromText.names[0]);
    return { name, sure: true, alternatives: alts(name) };
  }
  if (model?.length) {
    // A partly read name narrows the model's list.
    const agree = fromText.names.length ? model.find((c) => fromText.names.map(chromaOf).includes(c.name) || fromText.names.includes(c.name)) : null;
    const best = agree || model[0];
    const name = chromaOf(best.name);
    return { name, sure: best.score >= SURE && (!!agree || !fromText.names.length || best.score >= 0.8), alternatives: alts(name) };
  }
  if (fromText.names.length) {
    const name = chromaOf(fromText.names[0]);
    return { name, sure: false, alternatives: alts(name) };
  }
  return null;
}

/**
 * Sides: YOUR OFFER / THEIR OFFER when the text reader saw them (slots left
 * of the labels are the inventory list, skipped); otherwise the rows are
 * split at the widest gap between them (your offer above).
 */
function sideOf(slots, lines) {
  const your = lines.find((l) => /your\s*offer/i.test(l.text));
  const their = lines.find((l) => /their\s*offer/i.test(l.text));
  if (your && their && cy(their) > cy(your)) {
    // Trade tiles start under the labels; the inventory list ends just left
    // of them (its last column can reach within a few pixels of the labels,
    // emulator test 2026-11-06), so compare where each tile starts and ends.
    const left = Math.min(your.x, their.x);
    const tol = (their.h || 20) * 1.5;
    return slots.map((s) => {
      if (s.x0 < left - tol || (s.x0 + s.x1) / 2 < left || s.nameTop < your.y) return 'inventory';
      return s.nameTop < their.y ? 'mine' : 'theirs';
    });
  }
  const rows = [...new Set(slots.map((s) => Math.round(s.nameTop)))].sort((a, b) => a - b);
  if (rows.length < 2) return slots.map(() => 'mine');
  let cut = rows[1], gap = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] - rows[i - 1] > gap) { gap = rows[i] - rows[i - 1]; cut = rows[i]; }
  }
  return slots.map((s) => (Math.round(s.nameTop) >= cut ? 'theirs' : 'mine'));
}

function buildFromSlots({ slots: found, lines, catalog }) {
  // Reading order: rows top to bottom (same row = name bars level within
  // half a bar), left to right in a row.
  const slots = [...found].sort((a, b) => {
    const tol = (a.nameBottom - a.nameTop) / 2;
    return Math.abs(a.nameTop - b.nameTop) > tol ? a.nameTop - b.nameTop : a.x0 - b.x0;
  });
  const sides = sideOf(slots, lines);
  const out = { mine: [], theirs: [], foundWindow: true, skippedInventory: 0 };
  slots.forEach((s, i) => {
    if (sides[i] === 'inventory') { out.skippedInventory++; return; }
    const t = slotText(s, lines);
    const model = s.candidates ? s.candidates.map((c) => ({ name: c.name, score: c.score ?? 1 - c.d })) : null;
    const pick = nameSlot({ text: t.name, chroma: t.chroma, model, catalog });
    if (!pick) return;
    for (let k = 0; k < t.count; k++) out[sides[i]].push({ ...pick });
  });
  return out;
}
