/**
 * MM2 Trade Scanner: turn the on-device text reader's lines into "your offer"
 * / "their offer" picks (2026-11-01).
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
export function buildTrade({ lines, width, catalog }) {
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
