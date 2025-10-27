// Update Smiski prices in scraped-prices.json from Mercari scraper data

const fs = require('fs');
const path = require('path');

// Load the scraped Mercari data
const mercariDataPath = path.join(__dirname, '..', 'data', 'smiski-mercari-prices.json');
const mercariData = JSON.parse(fs.readFileSync(mercariDataPath, 'utf8'));

// Load existing scraped prices (or create new)
const scrapedPricesPath = path.join(__dirname, '..', 'data', 'scraped-prices.json');
let scrapedPrices = {};
if (fs.existsSync(scrapedPricesPath)) {
  scrapedPrices = JSON.parse(fs.readFileSync(scrapedPricesPath, 'utf8'));
}

let updateCount = 0;

// Process each series
for (const seriesId in mercariData) {
  const series = mercariData[seriesId];
  
  // Process each item in the series
  for (const itemId in series.items) {
    const item = series.items[itemId];
    
    // Update scraped prices with format expected by the app
    scrapedPrices[itemId] = {
      values: [item.avgPrice],
      listingCount: item.listingCount,
      currency: 'USD',
      lastUpdated: item.lastUpdated
    };
    
    updateCount++;
    console.log(`✓ ${item.name}: $${item.avgPrice} (${item.listingCount} listings)`);
  }
}

// Save updated scraped prices
fs.writeFileSync(scrapedPricesPath, JSON.stringify(scrapedPrices, null, 2));

console.log(`\n✅ Updated ${updateCount} Smiski items in scraped-prices.json`);
console.log(`📄 File saved to: ${scrapedPricesPath}`);
