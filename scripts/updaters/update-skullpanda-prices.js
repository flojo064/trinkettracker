// Update SkullPanda prices from Mercari scraper results to scraped-prices.json
const fs = require('fs');
const path = require('path');

const skullpandaMercariPath = path.join(__dirname, '..', 'data', 'skullpanda-mercari-prices.json');
const scrapedPricesPath = path.join(__dirname, '..', 'data', 'scraped-prices.json');

// Load the Mercari prices
const skullpandaMercariPrices = JSON.parse(fs.readFileSync(skullpandaMercariPath, 'utf8'));

// Load existing scraped prices
let scrapedPrices = {};
if (fs.existsSync(scrapedPricesPath)) {
  scrapedPrices = JSON.parse(fs.readFileSync(scrapedPricesPath, 'utf8'));
}

let updatedCount = 0;

// Update prices for each series
Object.entries(skullpandaMercariPrices).forEach(([seriesId, seriesData]) => {
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

console.log(`✅ Updated ${updatedCount} SkullPanda items in scraped-prices.json`);
console.log(`📊 SkullPanda price summary:`);

// Show summary by series
Object.entries(skullpandaMercariPrices).forEach(([seriesId, seriesData]) => {
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
