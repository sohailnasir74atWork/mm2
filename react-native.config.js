// modules/trade-ocr: on-device text reader for the Trade Scanner (2026-11-01),
// a local native module that lives in this repo instead of node_modules.
const path = require('path');

module.exports = {
    assets: ['./assets/fonts/'],
    dependencies: {
      'trade-ocr': { root: path.join(__dirname, 'modules/trade-ocr') },
    },
  };
