/**
 * MM2 Trade Scanner slot finder (2026-11-06). Plain JS, no imports: runs in
 * the hidden scanner page (scanner.html, a WebView canvas) and in Node for
 * tests and the training scripts (RunningApps/_scanner_ml/mm2).
 *
 * The MM2 trade window draws every item as a dark grey square with the
 * picture on top and a solid name bar along the bottom, coloured by rarity
 * (purple Ancient, pink Godly, red Legendary, ...), the name in white on it.
 * Empty slots have no bar. So: find the bars (wide, short, one colour
 * between white letters, darker tile gaps on both ends), then the picture
 * is the square above each bar.
 *
 * scan(px, width, height) -> [{ x0, x1, top, nameTop, nameBottom, color }]
 *   px: RGBA bytes (canvas ImageData.data). The picture box handed to the
 *   slot model is [x0, top, x1, nameTop]; the name bar [x0, nameTop, x1, nameBottom].
 */
(function (root) {
  var MIN_W = 24; // bar width in pixels at the scan size

  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function isText(r, g, b) { return r > 170 && g > 170 && b > 170; }
  // Same bar colour: video and JPEG make a bar's brightness wander a lot
  // (76,0,182 next to 97,0,247), its hue much less. Compare chromaticity,
  // and brightness within a wide ratio.
  function close(a, b) {
    var sa = a[0] + a[1] + a[2] + 1, sb = b[0] + b[1] + b[2] + 1;
    var ratio = sa / sb;
    if (ratio < 0.62 || ratio > 1.6) return false;
    return Math.abs(a[0] / sa - b[0] / sb) < 0.07 && Math.abs(a[1] / sa - b[1] / sb) < 0.07 && Math.abs(a[2] / sa - b[2] / sb) < 0.07;
  }
  // Tile and gap greys: the bar colour must differ from them.
  function isTileGrey(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn < 22 && mx < 105;
  }

  function isGap(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn < 12 && mx < 75;
  }

  // Rows of a bar: a run that starts and ends on the bar colour, mostly that
  // colour, with letters (white, and their dark tinted outlines) inside. Two
  // tile-gap greys in a row end it: that is the gap to the next tile.
  function rowRuns(px, W, y) {
    var out = [];
    var x = 0;
    var i0 = y * W * 4;
    while (x < W) {
      var i = i0 + x * 4;
      var r = px[i], g = px[i + 1], b = px[i + 2];
      // A bar starts on its colour: saturated, or a light grey (Common).
      // Dark low-saturation pixels are the window (lifted and tinted in a
      // photo of a screen), never a bar.
      var sat0 = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum(r, g, b) > 140 || isTileGrey(r, g, b) || (sat0 < 35 && lum(r, g, b) < 110)) { x++; continue; }
      var col = [r, g, b];
      var sum = [r, g, b], n = 1, odd = 0, gap = 0;
      var x1 = x;
      for (var k = x + 1; k < W; k++) {
        var j = i0 + k * 4;
        var c = [px[j], px[j + 1], px[j + 2]];
        if (close(c, col)) { x1 = k; odd = 0; gap = 0; sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n++; continue; }
        if (isGap(c[0], c[1], c[2])) { if (++gap >= 3) break; } else gap = 0;
        // Letters: light pixels are free, their outlines count.
        if (lum(c[0], c[1], c[2]) > 140) continue;
        if (++odd > Math.max(10, (k - x) * 0.2)) break;
      }
      var w = x1 - x + 1;
      var c = [sum[0] / n, sum[1] / n, sum[2] / n];
      var satC = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
      if (satC < 30 && lum(c[0], c[1], c[2]) < 110) { x++; continue; } // grew over the window grey
      if (w >= MIN_W && n >= w * 0.45) out.push({ x0: x, x1: x1, c: c });
      x = Math.max(x1 + 1, x + 1);
    }
    return out;
  }

  // Left and right of a bar are tile-gap greys (or the tile's own border).
  // Left and right of a bar are tile-gap greys (or the tile's own border):
  // dark or grey, and not the bar's colour. Relative, because a photo of a
  // screen lifts the blacks and tints the greys.
  function sidesDark(px, W, x0, y0, x1, y1, col) {
    var barSat = Math.max(col[0], col[1], col[2]) - Math.min(col[0], col[1], col[2]);
    var n = 0, ok = 0;
    var dark = function (x, y) {
      if (x < 0 || x >= W) return true;
      var i = (y * W + x) * 4;
      var r = px[i], g = px[i + 1], b = px[i + 2];
      var l = lum(r, g, b), sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (l < 45) return true;
      return l < 130 && sat < Math.max(30, barSat * 0.45) && !close([r, g, b], col);
    };
    for (var y = y0; y <= y1; y++) {
      for (var side = 0; side < 2; side++) {
        var hit = false;
        for (var d = 1; d <= 5 && !hit; d++) hit = dark(side ? x1 + d : x0 - d, y);
        n++;
        if (hit) ok++;
      }
    }
    return n > 0 && ok / n >= 0.6;
  }

  function splitColumns(px, W, x0, y0, x1, y1, col) {
    var segs = [], start = -1, low = 0;
    for (var x = x0; x <= x1 + 1; x++) {
      var bar = 0, n = 0;
      if (x <= x1) {
        for (var y = y0; y <= y1; y++) {
          var i = (y * W + x) * 4;
          n++;
          if (close([px[i], px[i + 1], px[i + 2]], col)) bar++;
        }
      }
      var isBar = n > 0 && bar / n >= 0.2;
      if (isBar) {
        if (start < 0) start = x;
        low = 0;
      } else if (start >= 0 && (++low >= 2 || x > x1)) {
        segs.push([start, x - low]);
        start = -1;
        low = 0;
      }
    }
    return segs.filter(function (sg) { return sg[1] - sg[0] + 1 >= MIN_W; });
  }

  // Letters: near-white, and in a photo of a screen (contrast lost, colour
  // cast) at least well above the bar's brightness and much less coloured.
  function whiteShare(px, W, x0, y0, x1, y1, col) {
    var barLum = lum(col[0], col[1], col[2]);
    var barSat = Math.max(col[0], col[1], col[2]) - Math.min(col[0], col[1], col[2]);
    var n = 0, w = 0;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x += 2) {
        var i = (y * W + x) * 4;
        var r = px[i], g = px[i + 1], b = px[i + 2];
        n++;
        if (isText(r, g, b)) { w++; continue; }
        var l = lum(r, g, b), sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (l > Math.max(130, barLum + 55) && sat < Math.max(45, barSat * 0.5)) w++;
      }
    }
    return n ? w / n : 0;
  }

  function scanBars(px, W, H, dbg) {
    var open = []; // bars being grown: clean rows with the same ends and colour
    var bars = [];
    for (var y = 0; y < H; y++) {
      var runs = rowRuns(px, W, y);
      for (var a = 0; a < runs.length; a++) {
        var r = runs[a];
        var hit = null;
        for (var b = 0; b < open.length; b++) {
          var o = open[b];
          if (o.lastY === y) continue;
          var tolX = Math.max(3, (o.x1 - o.x0) * 0.04);
          // Against the bar so far (its latest ends, its mean colour): the
          // faint first row of a bar must not decide the rest.
          if (Math.abs(o.x0 - r.x0) <= tolX && Math.abs(o.x1 - r.x1) <= tolX && close(o.c, r.c) && (!hit || o.rows > hit.rows)) hit = o;
        }
        if (hit) {
          hit.y1 = y; hit.lastY = y; hit.rows++;
          hit.xs0.push(r.x0); hit.xs1.push(r.x1);
          hit.x0 = r.x0; hit.x1 = r.x1;
          for (var ch = 0; ch < 3; ch++) hit.c[ch] += (r.c[ch] - hit.c[ch]) / hit.rows;
        } else {
          open.push({ x0: r.x0, x1: r.x1, y0: y, y1: y, lastY: y, rows: 1, c: r.c, xs0: [r.x0], xs1: [r.x1] });
        }
      }
      // A bar ends when no clean row has continued it for a letter height.
      var still = [];
      for (var c2 = 0; c2 < open.length; c2++) {
        var ob = open[c2];
        if (y - ob.lastY > Math.max(3, (ob.x1 - ob.x0) * 0.13)) bars.push(ob);
        else still.push(ob);
      }
      open = still;
    }
    bars = bars.concat(open);

    var med = function (arr) { var s = arr.slice().sort(function (p, q) { return p - q; }); return s[Math.floor(s.length / 2)]; };
    // Neighbouring bars a thin gap apart (small windows, blur) grow as one:
    // cut them where whole columns lose the bar colour. Letters never do,
    // the bar shows above and below them.
    var parts = [];
    for (var pb = 0; pb < bars.length; pb++) {
      var B = bars[pb];
      var bx0 = med(B.xs0), bx1 = med(B.xs1);
      if ((bx1 - bx0 + 1) / (B.y1 - B.y0 + 1) <= 6) { parts.push(B); continue; }
      var cut = splitColumns(px, W, bx0, B.y0, bx1, B.y1, B.c);
      for (var q = 0; q < cut.length; q++) {
        parts.push({ x0: cut[q][0], x1: cut[q][1], y0: B.y0, y1: B.y1, rows: B.rows, c: B.c, xs0: [cut[q][0]], xs1: [cut[q][1]] });
      }
    }
    bars = parts;
    var slots = [];
    for (var e = 0; e < bars.length; e++) {
      var bar = bars[e];
      var x0 = med(bar.xs0), x1 = med(bar.xs1);
      var w = x1 - x0 + 1, h = bar.y1 - bar.y0 + 1;
      if (w < MIN_W || h < 5 || bar.rows < Math.max(3, h * 0.3)) { if (dbg) dbg.push(['size', x0, bar.y0, x1, bar.y1, bar.rows]); continue; }
      // Rarity colours are saturated or light (Common); the window's grey
      // tabs and panels are neither.
      var sat = Math.max(bar.c[0], bar.c[1], bar.c[2]) - Math.min(bar.c[0], bar.c[1], bar.c[2]);
      if (sat < 40 && lum(bar.c[0], bar.c[1], bar.c[2]) < 110) { if (dbg) dbg.push(['grey', x0, bar.y0, x1, bar.y1]); continue; }
      var ratio = w / h;
      if (ratio < 2.8 || ratio > 7.5) { if (dbg) dbg.push(['ratio', x0, bar.y0, x1, bar.y1, bar.rows]); continue; }
      if (whiteShare(px, W, x0, bar.y0, x1, bar.y1, bar.c) < 0.02) { if (dbg) dbg.push(['white', x0, bar.y0, x1, bar.y1, bar.rows]); continue; } // a name bar has letters
      if (!sidesDark(px, W, x0, bar.y0, x1, bar.y1, bar.c)) { if (dbg) dbg.push(['sides', x0, bar.y0, x1, bar.y1, bar.rows]); continue; }
      var top = Math.round(bar.y0 - w * 0.98);
      if (top < -w * 0.1) continue;
      if (!tileAbove(px, W, H, x0, Math.max(0, top), x1, bar.y0)) { if (dbg) dbg.push(['tile', x0, bar.y0, x1, bar.y1, bar.rows]); continue; }
      slots.push({ x0: x0, x1: x1, top: Math.max(0, top), nameTop: bar.y0, nameBottom: bar.y1 + 1, color: bar.c.map(Math.round) });
    }
    if (dbg) for (var z = 0; z < slots.length; z++) dbg.push(["pre", slots[z].x0, slots[z].nameTop, slots[z].x1, slots[z].nameBottom]);
    return dedupe(slots);
  }

  // The square above a bar is a tile: mostly the tile grey, with a darker
  // gap line at its top edge or above.
  function tileAbove(px, W, H, x0, y0, x1, y1) {
    var grey = 0, n = 0;
    var sx = Math.max(1, Math.floor((x1 - x0) / 24)), sy = Math.max(1, Math.floor((y1 - y0) / 24));
    for (var y = y0; y < y1; y += sy) {
      for (var x = x0; x < x1; x += sx) {
        var i = (y * W + x) * 4;
        var r = px[i], g = px[i + 1], b = px[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 24 && lum(r, g, b) > 38 && lum(r, g, b) < 115) grey++;
        n++;
      }
    }
    return n > 0 && grey / n > 0.3;
  }

  function dedupe(slots) {
    var widthOf = function (s) { return s.x1 - s.x0; };
    // A real trade window has same-size tiles: drop boxes far from the
    // typical width first (buttons and labels that happen to look like a bar),
    // so a big one can never knock real tiles out below.
    var mw = 0;
    if (slots.length >= 3) {
      // The typical width: the one the most boxes share (within 15%), the
      // wider on a tie. Not the median: a few small false boxes would pull
      // it off the real tiles.
      var best = -1;
      for (var a = 0; a < slots.length; a++) {
        var wa = widthOf(slots[a]), votes = 0;
        for (var b = 0; b < slots.length; b++) if (Math.abs(widthOf(slots[b]) - wa) <= wa * 0.15) votes++;
        if (votes > best || (votes === best && wa > mw)) { best = votes; mw = wa; }
      }
      slots = slots.filter(function (s) { var w = widthOf(s); return w > mw * 0.7 && w < mw * 1.35; });
    }
    slots.sort(function (a, b) { return mw ? Math.abs(widthOf(a) - mw) - Math.abs(widthOf(b) - mw) : widthOf(b) - widthOf(a); });
    var keep = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], clash = false;
      for (var j = 0; j < keep.length; j++) {
        var k = keep[j];
        var ox = Math.min(s.x1, k.x1) - Math.max(s.x0, k.x0);
        var oy = Math.min(s.nameBottom, k.nameBottom) - Math.max(s.top, k.top);
        if (ox > 0 && oy > 0) { clash = true; break; }
      }
      if (!clash) keep.push(s);
    }
    keep.sort(function (a, b) { return a.nameTop - b.nameTop || a.x0 - b.x0; });
    return keep;
  }

  // ── Current trade window (seen in user reports from 2026-11-06) ───────────
  // No solid name bar any more: each item tile is a grey square (57) with a
  // black outline, the name in rarity-coloured letters at the bottom and a
  // thin rarity-coloured underline (about 1.3% of the tile width thick) just
  // above the tile's bottom outline. Empty tiles have no underline. So: find
  // thin, long, one-colour lines with a dark outline row right below; the
  // tile is the box above, up to its top outline.
  function lineRuns(px, W, y, minW) {
    var out = [];
    var i0 = y * W * 4;
    var x = 0;
    while (x < W) {
      var i = i0 + x * 4;
      var r = px[i], g = px[i + 1], b = px[i + 2];
      var sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat < 40 || lum(r, g, b) < 25) { x++; continue; }
      var col = [r, g, b], x1 = x, miss = 0;
      for (var k = x + 1; k < W; k++) {
        var j = i0 + k * 4;
        if (close([px[j], px[j + 1], px[j + 2]], col)) { x1 = k; miss = 0; continue; }
        if (++miss > 2) break;
      }
      if (x1 - x + 1 >= minW) out.push({ x0: x, x1: x1, c: col });
      x = x1 + 1;
    }
    return out;
  }

  function darkRow(px, W, x0, x1, y) {
    var n = 0, d = 0;
    for (var x = x0; x <= x1; x += 2) {
      var i = (y * W + x) * 4;
      n++;
      if (lum(px[i], px[i + 1], px[i + 2]) < 52) d++;
    }
    return n > 0 && d / n >= 0.6;
  }

  // Walk up a column from just above the name to the tile's top outline:
  // the first dark (outline) pixel pair after at least half a tile.
  function topEdge(px, W, x, yFrom, minUp, maxUp) {
    for (var y = yFrom - minUp; y > yFrom - maxUp && y > 0; y--) {
      var i = (y * W + x) * 4, i2 = ((y - 1) * W + x) * 4;
      if (lum(px[i], px[i + 1], px[i + 2]) < 38 && lum(px[i2], px[i2 + 1], px[i2 + 2]) < 50) return y + 1;
    }
    return -1;
  }

  function scanUnderlines(px, W, H, dbg) {
    var minW = Math.max(40, Math.round(W * 0.05));
    var open = [], lines = [];
    for (var y = 0; y < H; y++) {
      var runs = lineRuns(px, W, y, minW);
      for (var a = 0; a < runs.length; a++) {
        var r = runs[a], hit = null;
        for (var b = 0; b < open.length; b++) {
          var o = open[b];
          if (o.lastY !== y - 1) continue;
          var tol = Math.max(3, (o.x1 - o.x0) * 0.04);
          if (Math.abs(o.x0 - r.x0) <= tol && Math.abs(o.x1 - r.x1) <= tol && close(o.c, r.c)) { hit = o; break; }
        }
        if (hit) { hit.y1 = y; hit.lastY = y; hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1); }
        else open.push({ x0: r.x0, x1: r.x1, y0: y, y1: y, lastY: y, c: r.c });
      }
      var still = [];
      for (var c2 = 0; c2 < open.length; c2++) (open[c2].lastY < y ? lines : still).push(open[c2]);
      open = still;
    }
    lines = lines.concat(open);
    var slots = [];
    for (var e = 0; e < lines.length; e++) {
      var L = lines[e];
      var w = L.x1 - L.x0 + 1, h = L.y1 - L.y0 + 1;
      // Thin: a solid button or an old-style name bar is many times thicker.
      if (h > Math.max(4, Math.round(w * 0.045)) || w / h < 14) { if (dbg) dbg.push(['uthick', L.x0, L.y0, L.x1, L.y1]); continue; }
      // Above an underline is tile grey (the letters sit higher); above the
      // bottom edge of an old-style solid bar is more bar colour.
      var same = 0, tot = 0;
      for (var ay = L.y0 - 3; ay >= Math.max(0, L.y0 - 6); ay--) {
        for (var ax = L.x0; ax <= L.x1; ax += 3) {
          var ai = (ay * W + ax) * 4;
          tot++;
          if (close([px[ai], px[ai + 1], px[ai + 2]], L.c)) same++;
        }
      }
      if (tot && same / tot > 0.3) { if (dbg) dbg.push(['ubar', L.x0, L.y0, L.x1, L.y1]); continue; }
      // The tile's bottom outline a few rows below.
      var below = false;
      for (var dy = 1; dy <= Math.max(4, h * 2 + 2) && L.y1 + dy < H; dy++) {
        if (darkRow(px, W, L.x0, L.x1, L.y1 + dy)) { below = true; break; }
      }
      if (!below) { if (dbg) dbg.push(['ubelow', L.x0, L.y0, L.x1, L.y1]); continue; }
      // The underline runs nearly border to border: the tile's dark side
      // outline sits a few pixels past each end (lines in item art don't).
      var reach = Math.max(4, Math.round(w * 0.045));
      var outline = function (x, dir) {
        for (var d = 1; d <= reach; d++) {
          var xx = x + dir * d;
          if (xx < 0 || xx >= W) return true; // tile cut by the picture edge
          var oi = ((L.y0 - 1) * W + xx) * 4;
          if (lum(px[oi], px[oi + 1], px[oi + 2]) < 40) return true;
        }
        return false;
      };
      if (L.y0 < 1 || !outline(L.x0, -1) || !outline(L.x1, 1)) { if (dbg) dbg.push(['uends', L.x0, L.y0, L.x1, L.y1]); continue; }
      var x0 = Math.max(0, Math.round(L.x0 - w * 0.015)), x1 = Math.min(W - 1, Math.round(L.x1 + w * 0.015));
      var tw = x1 - x0 + 1;
      // The tile's top outline, walked up from four columns: item art can
      // cross one edge (its own dark outline looks like the tile's), so at
      // least two columns must agree.
      var cols = [L.x0 + 2, L.x1 - 2, Math.round(L.x0 + w * 0.12), Math.round(L.x1 - w * 0.12)];
      var tops = cols.map(function (cx) { return topEdge(px, W, cx, L.y0, Math.round(tw * 0.5), Math.round(tw * 1.1)); })
        .filter(function (t) { return t >= 0; }).sort(function (p, q) { return p - q; });
      var top = -1, bestN = 1;
      for (var ti = 0; ti < tops.length; ti++) {
        var agree = tops.filter(function (t) { return Math.abs(t - tops[ti]) <= tw * 0.04; });
        if (agree.length > bestN) { bestN = agree.length; top = agree[agree.length - 1]; }
      }
      if (top < 0) { if (dbg) dbg.push(['utop', L.x0, L.y0, L.x1, L.y1]); continue; }
      if (top < -tw * 0.1) continue;
      top = Math.max(0, top);
      var nameTop = Math.round(L.y0 - tw * 0.15);
      if (nameTop - top < tw * 0.3) { if (dbg) dbg.push(['ushort', L.x0, L.y0, L.x1, L.y1]); continue; }
      // The box above is a tile: its grey shows somewhere (art rarely covers it all).
      if (!tileAbove(px, W, H, x0, top, x1, nameTop)) { if (dbg) dbg.push(['utile', L.x0, L.y0, L.x1, L.y1]); continue; }
      slots.push({ x0: x0, x1: x1, top: top, nameTop: nameTop, nameBottom: L.y1 + 1, color: L.c.map(Math.round), ui: 2 });
    }
    return slots;
  }

  function scanBoth(px, W, H, dbg) {
    var lined = dedupe(scanUnderlines(px, W, H, dbg));
    var barred = scanBars(px, W, H, dbg);
    if (!lined.length) return barred;
    if (!barred.length || lined.length > barred.length) return lined;
    // Same count: the old pass on a current window finds small coloured
    // patches inside the item art, far narrower than the real tiles.
    var mid = function (ss) { var w = ss.map(function (q) { return q.x1 - q.x0; }).sort(function (p, q) { return p - q; }); return w[Math.floor(w.length / 2)]; };
    return lined.length === barred.length && mid(barred) < mid(lined) * 0.5 ? lined : barred;
  }

  var api = { scan: scanBoth, _rowRuns: rowRuns, _scanBars: scanBars, _scanUnderlines: scanUnderlines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeMatcher = api;
})(typeof window !== 'undefined' ? window : this);
