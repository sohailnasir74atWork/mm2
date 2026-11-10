#!/usr/bin/env node
/**
 * Pack Code/TradeScanner/scanner.html + matcher.js into the scanner page the
 * phones download (2026-11-06). Not bundled in the app: publish_scanner.py
 * --app mm2 --html calls build() and uploads the result to the CDN.
 *
 *   node scripts/trade-scanner/build-html.js > /tmp/scanner.html   (to look at it)
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../../Code/TradeScanner');

function build() {
  const html = fs.readFileSync(path.join(dir, 'scanner.html'), 'utf8');
  const matcher = fs.readFileSync(path.join(dir, 'matcher.js'), 'utf8');
  // Function replacer: the inlined code contains "$" sequences.
  return html.replace('/*__MATCHER__*/', () => matcher);
}

module.exports = { build };

if (require.main === module) process.stdout.write(build());
