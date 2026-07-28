const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const categories = [
  'Ancient', 'Unique', 'Chroma', 'Godly', 'Legend',
  'Rare', 'Uncommon', 'Common', 'Vintage', 'Pets', 'Misc'
];

const baseUrl = 'https://www.mm2values.com/?p=';

async function scrapeCategory(category) {
  const url = baseUrl + category.toLowerCase();
  console.log(`⏳ Fetching: ${category}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    const data = {};

    $('h1').each((_, h1) => {
      const tier = $(h1).text().trim();
      if (!tier) return;

      const items = [];
      const container = $(h1).next('div.stackable-container');
      if (!container.length) return;

      container.find('div.stackable').each((_, el) => {
        const item = $(el);
        const html = item.html();
        if (!html) return;

        // Name: inside the <b> tag
        const name = item.find('b').first().text().trim();
        if (!name) return;

        // Image: first <img> src
        const image = (item.find('img').first().attr('src') || '').trim();

        // Display value: the text shown on the website (e.g., "1,765" or "4 X (T1) Legend")
        const valueMatch = html.match(/Value:\s*(.+?)(?:<br|<hr)/i);
        const displayValue = valueMatch ? valueMatch[1].trim() : 'N/A';

        // ✅ REAL numeric value: extracted from stackValue(id, 'VALUE', 'iid') onclick
        // This is the value the website's OWN calculator uses — works for ALL items
        // Examples: '1765' for numeric items, '.44' for "4 X (T1) Legend" items
        const calcMatch = html.match(/stackValue\([^,]+,'([^']+)'/);
        let value = displayValue; // fallback to display value
        if (calcMatch) {
          const calcNum = calcMatch[1];
          // Format it nicely: if it's a whole number, use commas; if decimal, keep as-is
          const num = Number(calcNum);
          if (!isNaN(num)) {
            value = num >= 1 ? num.toLocaleString('en-US') : calcNum;
          }
        }

        // Range: extract between "Range:" and the next <br>
        const rangeMatch = html.match(/Range:\s*(.+?)(?:<br|<hr)/i);
        const range = rangeMatch ? rangeMatch[1].trim() : 'N/A';

        // Demand AND Rarity are on the SAME line:
        // "Demand: 5 - Rarity: 2<br>" or "Demand: 6.5 - Rarity: 3.5<br>"
        const demandLine = html.match(/Demand:\s*(.+?)(?:<br|<hr)/i);
        let demand = 'N/A';
        let rarity = 'N/A';

        if (demandLine) {
          const fullDemand = demandLine[1].trim();
          // Split on " - Rarity: " to separate demand and rarity
          const parts = fullDemand.split(/\s*-\s*Rarity:\s*/i);
          if (parts.length === 2) {
            demand = parts[0].trim();
            rarity = parts[1].trim();
          } else {
            demand = fullDemand;
          }
        }

        // Stability: extract between "Stability:" and <hr> or <br> or end
        const stabilityMatch = html.match(/Stability:\s*(.+?)(?:<hr|<br|<input|$)/i);
        const stability = stabilityMatch ? stabilityMatch[1].trim() : 'N/A';

        // Wiki link: <a> with href containing "wiki" or "fandom"
        const wikiLink = item.find('a[href*="wiki"], a[href*="fandom"]').attr('href') || '';

        items.push({
          name,
          image,
          value,
          range,
          demand,
          rarity,
          stability,
          wiki: wikiLink
        });
      });

      if (items.length) {
        data[tier] = items;
        console.log(`   📦 ${tier}: ${items.length} items`);
      }
    });

    const itemCount = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`✅ ${category}: ${itemCount} items total`);
    return { [category]: data, _count: itemCount };
  } catch (err) {
    console.error(`❌ Failed: ${category}`, err.message);
    return { [category]: {}, _count: 0 };
  }
}

(async () => {
  const finalJson = {};
  let totalCount = 0;

  for (const category of categories) {
    const result = await scrapeCategory(category);
    const { _count, ...data } = result;
    Object.assign(finalJson, data);
    totalCount += _count;
    await delay(3000); // wait to prevent being blocked
  }

  fs.writeFileSync('mm2values.json', JSON.stringify(finalJson, null, 2));
  console.log(`\n🎉 Done! Total items scraped: ${totalCount}`);
  console.log(`📄 Saved to mm2values.json`);

  // Quick validation: check for items with relative values
  let relativeCount = 0;
  let numericCount = 0;
  for (const [cat, tiers] of Object.entries(finalJson)) {
    for (const [tier, items] of Object.entries(tiers)) {
      for (const item of items) {
        const cleaned = String(item.value).replace(/,/g, '');
        if (isNaN(cleaned)) {
          relativeCount++;
        } else {
          numericCount++;
        }
      }
    }
  }
  console.log(`📊 Numeric values: ${numericCount} | Relative values: ${relativeCount}`);
})();
