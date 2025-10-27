// Mercari Price Scraper for Nyota
// Scrapes current Mercari listings for Nyota figures

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

// Load Nyota brand data
const loadNyotaData = () => {
  const nyotaPath = path.join(__dirname, "data", "nyota.json");
  const data = fs.readFileSync(nyotaPath, "utf8");
  return JSON.parse(data);
};

// Save Mercari price data
const saveMercariPrices = (prices) => {
  const outputPath = path.join(__dirname, "data", "nyota-mercari-prices.json");
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
  // Clean up names (remove parentheses content)
  const cleanSeries = seriesName.replace(/\(.*?\)/g, '').replace(/series|collection/gi, '').trim();
  const cleanItem = itemName.replace(/\(.*?\)/g, '').trim();
  // Search: "Nyota" + series name + item name
  return `Nyota ${cleanSeries} ${cleanItem}`;
};

// Filter out bundle/lot listings and unrelated items
const filterRelevantItems = (listings, itemName, seriesName) => {
  return listings.filter(listing => {
    const title = listing.title.toLowerCase();
    const itemNameLower = itemName.toLowerCase();
    const seriesNameLower = seriesName.toLowerCase();

    // Must contain "nyota" (or "ny0ta" typo variant)
    const hasNyota = title.includes('nyota') || title.includes('ny0ta');
    if (!hasNyota) return false;

    // CRITICAL: Exclude any listing with "/" that suggests multiple items
    // Example: "A Brief Escape/Unknown Road/Home" is 3 items
    if (title.includes('/')) {
      // Exception: Sometimes "/" is used in legitimate single item names
      // But if there are 2+ slashes or "confirmed" appears, it's definitely a bundle
      const slashCount = (title.match(/\//g) || []).length;
      if (slashCount >= 2 || title.includes('confirmed') || title.includes('pick') || title.includes('choose')) {
        return false;
      }
    }

    // STRICTLY Exclude bundles, lots, sets, multiple items
    if (title.includes('bundle') ||
        title.includes(' lot ') ||
        title.includes('lot of') ||
        title.includes('set of') ||
        title.includes('full set') ||
        title.includes('complete set') ||
        title.includes('both') ||
        title.includes(' x2') ||
        title.includes(' x3') ||
        title.includes(' x4') ||
        title.includes(' pair') ||
        title.includes('multiple') ||
        title.includes(' + ') ||  // Often indicates bundles "item1 + item2"
        title.includes(' and ') && title.match(/\band\b/g).length >= 2 ||  // "item1 and item2 and item3"
        /\d+\s*(pcs|pieces|items|figures|set)/i.test(title) ||
        /\d+\s*x\s*\d+/.test(title)) {  // patterns like "2x3"
      return false;
    }

    // Exclude choice/select listings (user picks one from multiple)
    if ((title.includes('confirmed') || title.includes('pick') || title.includes('choose') || 
         title.includes('select') || title.includes('choice')) &&
        (title.includes('/') || title.includes(' or '))) {
      return false;
    }

    // No price limit - let outlier removal handle extreme prices later

    // Check if the SPECIFIC item name appears in title (not just series name)
    // This is critical - we want the exact item we're searching for
    const itemWords = itemNameLower.split(/\s+/).filter(w => w.length > 2);
    if (itemWords.length === 0) return false; // Need at least one word to match
    
    // ALL significant words from the item name should appear in the title
    // This prevents "Unknown Road" from matching "Home" listings
    const hasAllKeywords = itemWords.every(word => title.includes(word));
    
    return hasAllKeywords;
  });
};

// Scrape prices for all Nyota items
const scrapeMercariPrices = async () => {
  console.log("🚀 Starting Mercari price scraping for Nyota...\n");

  const browser = await chromium.launch({
    headless: !SHOW_BROWSER,
    slowMo: 100
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  const nyotaData = loadNyotaData();
  const mercariPrices = {};

  let totalItems = 0;
  let itemsWithPrices = 0;

  for (const series of nyotaData.series || []) {
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
      
      // Strategy 1: Try specific search with series name first
      const specificSearchTerm = generateSearchTerm(series.name, item.name);
      console.log(`    🔍 Search 1 (specific): "${specificSearchTerm}"`);
      const specificListings = await searchMercari(page, specificSearchTerm);
      const specificRelevant = filterRelevantItems(specificListings, item.name, series.name);
      console.log(`       Found ${specificListings.length} total, ${specificRelevant.length} relevant`);
      
      allRelevantItems.push(...specificRelevant);
      await page.waitForTimeout(DELAY_BETWEEN_SEARCHES);
      
      // Strategy 2: If we didn't find enough, try broader search (just brand + item)
      if (allRelevantItems.length < 3) {
        const broadSearchTerm = `Nyota ${item.name}`;
        console.log(`    🔍 Search 2 (broader): "${broadSearchTerm}"`);
        const broadListings = await searchMercari(page, broadSearchTerm);
        const broadRelevant = filterRelevantItems(broadListings, item.name, series.name);
        console.log(`       Found ${broadListings.length} total, ${broadRelevant.length} relevant`);
        
        // Add any new items we didn't already find (merge by URL)
        for (const item of broadRelevant) {
          if (!allRelevantItems.find(existing => existing.url === item.url)) {
            allRelevantItems.push(item);
          }
        }
        await page.waitForTimeout(DELAY_BETWEEN_SEARCHES);
      }

      const relevantItems = allRelevantItems;
      console.log(`    🔎 Combined total: ${relevantItems.length} relevant items`);
      
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
        const filteredPrices = removeOutliers(rawPrices);

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
