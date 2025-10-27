// Update Nyota prices in community prices format
const fs = require('fs');
const path = require('path');

// Load the scraped Mercari prices
const mercariPricesPath = path.join(__dirname, '..', 'data', 'nyota-mercari-prices.json');
const mercariPrices = JSON.parse(fs.readFileSync(mercariPricesPath, 'utf8'));

// Load existing scraped prices (if any)
let scrapedPrices = {};
const scrapedPricesPath = path.join(__dirname, '..', 'data', 'scraped-prices.json');
try {
  scrapedPrices = JSON.parse(fs.readFileSync(scrapedPricesPath, 'utf8'));
} catch (e) {
  console.log('No existing scraped-prices.json found, creating new file');
}

// Convert Mercari prices to scraped price format
let updatedCount = 0;
let totalItems = 0;

for (const [seriesId, seriesData] of Object.entries(mercariPrices)) {
  for (const [itemId, itemData] of Object.entries(seriesData.items)) {
    totalItems++;
    
    if (itemData.avgPrice && itemData.avgPrice > 0) {
      // Create scraped price entry
      scrapedPrices[itemId] = {
        values: [itemData.avgPrice],
        listingCount: itemData.listingCount || 1,
        currency: 'USD',
        lastUpdated: itemData.lastUpdated || new Date().toISOString()
      };
      updatedCount++;
      
      console.log(`✓ ${itemData.name}: $${itemData.avgPrice} (${itemData.listingCount} listings)`);
    } else {
      console.log(`✗ ${itemData.name}: No price data`);
    }
  }
}

// Save updated scraped prices
fs.writeFileSync(scrapedPricesPath, JSON.stringify(scrapedPrices, null, 2));

console.log(`\n✅ Updated ${updatedCount}/${totalItems} Nyota items in scraped-prices.json`);
console.log(`📄 File saved to: ${scrapedPricesPath}`);
