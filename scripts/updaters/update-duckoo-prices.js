// Update Duckoo prices from Mercari scraper results to scraped-prices.json
const fs = require('fs');
const path = require('path');

const duckooMercariPath = path.join(__dirname, '..', 'data', 'duckoo-mercari-prices.json');
const scrapedPricesPath = path.join(__dirname, '..', 'data', 'scraped-prices.json');

// Load the Mercari prices
const duckooMercariPrices = JSON.parse(fs.readFileSync(duckooMercariPath, 'utf8'));

// Load existing scraped prices
let scrapedPrices = {};
if (fs.existsSync(scrapedPricesPath)) {
  scrapedPrices = JSON.parse(fs.readFileSync(scrapedPricesPath, 'utf8'));
}

let updatedCount = 0;

// Update prices for each series
Object.entries(duckooMercariPrices).forEach(([seriesId, seriesData]) => {
  Object.entries(seriesData.items).forEach(([itemId, itemData]) => {
    // Create the price entry in the same format as the app expects (flat structure)
    scrapedPrices[itemId] = {
      values: [itemData.avgPrice],
      listingCount: itemData.listingCount,
      currency: 'USD',
      lastUpdated: itemData.lastUpdated
    };
    updatedCount++;
  });
});

// Save updated scraped prices
fs.writeFileSync(scrapedPricesPath, JSON.stringify(scrapedPrices, null, 2));

console.log(`✅ Updated ${updatedCount} Duckoo items in scraped-prices.json`);
console.log(`📊 Duckoo price summary:`);

// Show summary by series
Object.entries(duckooMercariPrices).forEach(([seriesId, seriesData]) => {
  const itemCount = Object.keys(seriesData.items).length;
  if (itemCount > 0) {
    console.log(`   ${seriesData.seriesName}: ${itemCount} items`);
    
    // Show a few example prices
    const items = Object.values(seriesData.items).slice(0, 3);
    items.forEach(item => {
      console.log(`      • ${item.name}: $${item.avgPrice} (${item.listingCount} listings)`);
    });
  }
});
