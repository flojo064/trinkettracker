// Mercari Price Scraper for Duckoo
// Scrapes current Mercari listings for Duckoo figures

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

// Configuration
const SHOW_BROWSER = !process.argv.includes("--headless");
const DELAY_BETWEEN_SEARCHES = 1500; // 1.5 seconds between searches
const MIN_PRICE = 5; // Minimum reasonable price
const MAX_PRICE = 10000; // Very high max - let outlier removal handle extremes
const MIN_LISTINGS_PER_ITEM = 1; // Minimum listings needed for averaging

// Remove outliers using IQR (Interquartile Range) method
const removeOutliers = (prices) => {
  if (prices.length < 4) return prices; // Need at least 4 prices for meaningful IQR

  // Sort prices
  const sorted = [...prices].sort((a, b) => a - b);

  // Calculate Q1, Q3, and IQR
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  // Define outlier bounds
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  // Filter out outliers
  const filtered = prices.filter(price => price >= lowerBound && price <= upperBound);

  // If we filtered out too many, return all (data might be sparse)
  if (filtered.length < Math.max(2, Math.floor(prices.length * 0.4))) {
    console.log(`    ⚠️  Too many outliers removed, keeping all ${prices.length} prices`);
    return prices;
  }

  const removedCount = prices.length - filtered.length;
  if (removedCount > 0) {
    console.log(`    🔧 Removed ${removedCount} outlier(s) using IQR method`);
  }

  return filtered;
};

// Load Duckoo brand data
const loadDuckooData = () => {
  const duckooPath = path.join(__dirname, "data", "duckoo.json");
  const data = fs.readFileSync(duckooPath, "utf8");
  return JSON.parse(data);
};

// Save Mercari price data
const saveMercariPrices = (prices) => {
  const outputPath = path.join(__dirname, "data", "duckoo-mercari-prices.json");
  fs.writeFileSync(outputPath, JSON.stringify(prices, null, 2));
  console.log(`✅ Saved Mercari prices to ${outputPath}`);
};

// Search Mercari for a specific item
const searchMercari = async (page, searchTerm) => {
  try {
    // Search for both active and sold listings, sorted by newest
    const mercariUrl = `https://www.mercari.com/search/?keyword=${encodeURIComponent(searchTerm)}&sort=created_time`;

    console.log(`🔍 Searching Mercari: "${searchTerm}"`);
    await page.goto(mercariUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for results to load with more flexible selectors
    try {
      await page.waitForSelector('[data-testid="SearchResults"], .search-result, [class*="SearchResult"]', { timeout: 20000 });
    } catch (err) {
      console.log(`    ⚠️  Timeout waiting for search results - page might be slow`);
      // Continue anyway, might still get results
    }

    // Give page time to fully render
    await page.waitForTimeout(2000);

    // Debug: Check what's on the page
    const debugInfo = await page.evaluate(() => {
      const itemLinks = document.querySelectorAll('a[href*="/item/"]');
      return {
        totalLinks: itemLinks.length,
        sampleLink: itemLinks[0] ? itemLinks[0].outerHTML.substring(0, 200) : 'none',
        bodyText: document.body.textContent.substring(0, 500)
      };
    });
    console.log(`    📊 Debug: Found ${debugInfo.totalLinks} item links on page`);

    // Extract listings - try multiple selector strategies
    const listings = await page.evaluate(({ minPrice, maxPrice }) => {
      const items = [];
      
      // Try to find all item links first
      const itemLinks = document.querySelectorAll('a[href*="/item/"]');
      
      for (const linkElement of itemLinks) {
        try {
          const url = linkElement.href;
          
          // Get the containing element (parent or grandparent)
          let container = linkElement.closest('[data-testid*="item"]') || 
                         linkElement.closest('div[class*="Item"]') ||
                         linkElement.parentElement;
          
          if (!container) container = linkElement;
          
          // Get all text content from the container
          const fullText = container.textContent || '';
          
          // Extract price - look for $XX or $XX.XX format
          const priceMatch = fullText.match(/\$\s*([0-9,]+(?:\.[0-9]{2})?)/);
          if (!priceMatch) continue;
          
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (isNaN(price) || price < minPrice || price > maxPrice) continue;
          
          // Try to find title - look in various places
          let title = '';
          
          // Try aria-label first
          if (linkElement.getAttribute('aria-label')) {
            title = linkElement.getAttribute('aria-label');
          }
          // Try data-title or title attribute
          else if (linkElement.getAttribute('data-title')) {
            title = linkElement.getAttribute('data-title');
          }
          else if (linkElement.getAttribute('title')) {
            title = linkElement.getAttribute('title');
          }
          // Try to find text in specific elements
          else {
            const titleEl = container.querySelector('[data-testid*="ItemName"], [class*="itemName"], [class*="ItemName"], h3, h4');
            if (titleEl) {
              title = titleEl.textContent.trim();
            } else {
              // Fall back to getting text before the price
              const textBeforePrice = fullText.split('$')[0].trim();
              title = textBeforePrice.split('\n').filter(line => line.length > 5)[0] || textBeforePrice;
            }
          }
          
          // Clean up title - remove price and other noise
          title = title.replace(/\$\s*[0-9,]+(?:\.[0-9]{2})?/g, '')
                       .replace(/\n/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
          
          if (!title || title.length < 3) continue;
          
          // Check if sold - look for sold indicators
          const textLower = fullText.toLowerCase();
          const isSold = textLower.includes('sold') && !textLower.includes('not sold');
          
          // Include both active and sold listings
          items.push({ 
            title, 
            price, 
            url,
            status: isSold ? 'sold' : 'active'
          });
        } catch (err) {
          // Skip this item if there's an error
          console.error('Error parsing item:', err);
          continue;
        }
      }

      return items;
    }, { minPrice: MIN_PRICE, maxPrice: MAX_PRICE });

    console.log(`    📦 Parsed ${listings.length} listings from page`);
    if (listings.length > 0 && listings.length <= 3) {
      listings.forEach((item, i) => {
        console.log(`       ${i + 1}. "${item.title}" - $${item.price}`);
      });
    }

    return listings;
  } catch (error) {
    console.error(`❌ Error searching Mercari for "${searchTerm}":`, error.message);
    return [];
  }
};

// Generate search term with brand + series + item name
const generateSearchTerm = (seriesName, itemName) => {
  const cleanSeries = seriesName.replace(/\(.*?\)/g, '').trim();
  const cleanItem = itemName.replace(/\(.*?\)/g, '').trim();
  // Search: "Duckoo" + series name + item name
  return `Duckoo ${cleanSeries} ${cleanItem}`;
};

// Remove articles and common words for better matching
const normalizeForMatching = (text) => {
  return text.toLowerCase()
    .replace(/\b(the|a|an|duckoo)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Filter out bundle/lot listings and unrelated items
const filterRelevantItems = (listings, itemName, seriesName) => {
  return listings.filter(listing => {
    const title = listing.title.toLowerCase();
    const itemNameLower = itemName.toLowerCase();
    const seriesNameLower = seriesName.toLowerCase();

    // Must contain "duckoo"
    if (!title.includes('duckoo')) return false;

    // Expanded bundle detection
    if (title.includes(' lot ') || 
        title.includes('lot of') ||
        title.includes('set of') ||
        title.includes('bulk') ||
        title.includes('collection') ||
        title.match(/\d+\s*(pcs|pieces|pc|pack)/i) ||  // "3 pcs", "2 pack"
        title.includes('bundle')) {
      return false;
    }

    // Exclude obvious fakes/replicas
    if (title.includes('not authentic') || 
        title.includes('not original') ||
        title.includes('fake') ||
        title.includes('replica') ||
        title.includes('dupe')) {
      return false;
    }

    // Exclude wrong product types (we want blind box figures only)
    if (title.includes('plush') ||
        title.includes('keychain') ||
        title.includes('strap') ||
        title.includes('magnet') ||
        title.includes('sticker') ||
        title.includes('pin') ||
        title.includes('card') ||
        title.includes('poster') ||
        title.includes('shirt') ||
        title.includes('hoodie')) {
      return false;
    }

    // For named series, verify series name appears
    const seriesWords = seriesNameLower.split(/\s+/).filter(w => w.length > 3);
    if (seriesWords.length > 0) {
      const hasSeriesName = seriesWords.some(word => title.includes(word));
      
      // If we have a specific series name and it's not in the title, reject
      if (!hasSeriesName) {
        return false;
      }
    }

    // STRICT item name matching - ALL words from item name must be in title
    const normalizedItem = normalizeForMatching(itemNameLower);
    const normalizedTitle = normalizeForMatching(title);
    
    const itemWords = normalizedItem.split(/\s+/).filter(w => w.length > 2);
    if (itemWords.length === 0) {
      return false; // No valid item words, reject
    }
    
    // ALL item words must appear in the title (100% match required)
    const allWordsPresent = itemWords.every(word => normalizedTitle.includes(word));
    
    return allWordsPresent;
  });
};

// Scrape prices for all Duckoo items
const scrapeMercariPrices = async () => {
  console.log("🚀 Starting Mercari price scraping for Duckoo...\n");

  const browser = await chromium.launch({
    headless: !SHOW_BROWSER,
    slowMo: 100
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  const duckooData = loadDuckooData();
  const mercariPrices = {};

  let totalItems = 0;
  let itemsWithPrices = 0;

  for (const series of duckooData.series || []) {
    console.log(`\n📂 Processing series: ${series.name}`);

    const seriesId = series.id || series.name.toLowerCase().replace(/\s+/g, '-');
    mercariPrices[seriesId] = {
      seriesName: series.name,
      items: {}
    };

    for (const item of series.items || []) {
      totalItems++;
      console.log(`  🎯 Item: ${item.name}`);

      let allRelevantItems = [];
      
      // Strategy 1: Full search with series (add "secret" if item is marked as secret)
      const isSecret = item.rarity && item.rarity.toLowerCase() === 'secret';
      const secretSuffix = isSecret ? ' Secret' : '';
      const fullSearch = generateSearchTerm(series.name, item.name) + secretSuffix;
      console.log(`    🔍 Search 1: "${fullSearch}"`);
      const fullListings = await searchMercari(page, fullSearch);
      const fullRelevant = filterRelevantItems(fullListings, item.name, series.name);
      console.log(`       Found ${fullListings.length} total, ${fullRelevant.length} relevant`);
      allRelevantItems.push(...fullRelevant);
      await page.waitForTimeout(DELAY_BETWEEN_SEARCHES);
      
      // Strategy 2: If not enough, try just brand + item name (+ secret if applicable)
      if (allRelevantItems.length < 5) {
        const simpleSearch = `Duckoo ${item.name}${secretSuffix}`;
        console.log(`    🔍 Search 2: "${simpleSearch}"`);
        const simpleListings = await searchMercari(page, simpleSearch);
        const simpleRelevant = filterRelevantItems(simpleListings, item.name, series.name);
        console.log(`       Found ${simpleListings.length} total, ${simpleRelevant.length} relevant`);
        
        // Merge, avoiding duplicates
        for (const item of simpleRelevant) {
          if (!allRelevantItems.find(existing => existing.url === item.url)) {
            allRelevantItems.push(item);
          }
        }
        await page.waitForTimeout(DELAY_BETWEEN_SEARCHES);
      }
      
      const relevantItems = allRelevantItems;
      console.log(`    📊 Combined: ${relevantItems.length} relevant items total`);
      
      // Show what we're including (for debugging)
      if (relevantItems.length > 0) {
        console.log(`    ✅ Including:`);
        relevantItems.slice(0, 5).forEach((listing, i) => {
          console.log(`       ${i + 1}. "${listing.title}" - $${listing.price}`);
        });
        if (relevantItems.length > 5) {
          console.log(`       ... and ${relevantItems.length - 5} more`);
        }
      }

      await page.waitForTimeout(DELAY_BETWEEN_SEARCHES);

      // Remove duplicates by URL
      const uniqueListings = Array.from(
        new Map(relevantItems.map(item => [item.url, item])).values()
      );

      if (uniqueListings.length >= MIN_LISTINGS_PER_ITEM) {
        const rawPrices = uniqueListings.map(l => l.price);
        
        // Calculate median for bundle detection
        const sortedPrices = [...rawPrices].sort((a, b) => a - b);
        const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];
        
        // Filter out prices that are >3x the median (likely bundles we missed)
        const pricesWithoutBundles = rawPrices.filter(price => price <= medianPrice * 3);
        
        if (pricesWithoutBundles.length < rawPrices.length) {
          const bundlesRemoved = rawPrices.length - pricesWithoutBundles.length;
          console.log(`    🔧 Removed ${bundlesRemoved} potential bundle(s) (>3x median price)`);
        }
        
        const filteredPrices = removeOutliers(pricesWithoutBundles);

        if (filteredPrices.length >= MIN_LISTINGS_PER_ITEM) {
          const avgPrice = filteredPrices.reduce((sum, p) => sum + p, 0) / filteredPrices.length;
          const minPrice = Math.min(...filteredPrices);
          const maxPrice = Math.max(...filteredPrices);

          // Filter listings to only include non-outliers
          const filteredListings = uniqueListings.filter(l => filteredPrices.includes(l.price));

          mercariPrices[seriesId].items[item.id] = {
            name: item.name,
            avgPrice: Math.round(avgPrice * 100) / 100,
            minPrice,
            maxPrice,
            listingCount: filteredPrices.length,
            rawListingCount: rawPrices.length,
            mercariItems: filteredListings,
            lastUpdated: new Date().toISOString()
          };

          itemsWithPrices++;
          const outlierCount = rawPrices.length - filteredPrices.length;
          const outlierText = outlierCount > 0 ? ` (${outlierCount} outliers removed)` : '';
          console.log(`    💰 Final: ${filteredPrices.length} listings, $${avgPrice.toFixed(2)} avg ($${minPrice}-$${maxPrice})${outlierText}`);
        } else {
          console.log(`    ⚠️  After removing outliers, only ${filteredPrices.length} listing(s) remain - need at least ${MIN_LISTINGS_PER_ITEM}`);
        }
      } else {
        console.log(`    ⚠️  Only found ${uniqueListings.length} relevant listing(s) - need at least ${MIN_LISTINGS_PER_ITEM}`);
      }
    }
  }

  await browser.close();

  // Save results
  saveMercariPrices(mercariPrices);

  console.log(`\n🎉 Mercari price scraping complete!`);
  console.log(`📊 Stats:`);
  console.log(`   • Total items: ${totalItems}`);
  console.log(`   • Items with prices: ${itemsWithPrices}`);
  console.log(`   • Success rate: ${((itemsWithPrices / totalItems) * 100).toFixed(1)}%`);
};

// Run the scraper
if (require.main === module) {
  scrapeMercariPrices().catch(console.error);
}

module.exports = { scrapeMercariPrices };
