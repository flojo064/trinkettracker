const { chromium } = require('playwright');
const fs = require('fs');

const BRAND_JSON_PATH = './data/sonny-angel.json';
const OUTPUT_PATH = './data/sonny-angel-mercari-prices.json';
const BATCH_SIZE = 50; // Process 50 items at a time

// Price filtering constants
const MIN_PRICE = 5;
const MAX_PRICE = 10000;

// Command line arguments
const args = process.argv.slice(2);
const startIndex = args[0] ? parseInt(args[0]) : 0;
const endIndex = args[1] ? parseInt(args[1]) : startIndex + BATCH_SIZE;

/**
 * Load Sonny Angel data from JSON
 */
function loadBrandData() {
  const data = JSON.parse(fs.readFileSync(BRAND_JSON_PATH, 'utf8'));
  return data;
}

/**
 * Load existing results if any
 */
function loadExistingResults() {
  if (fs.existsSync(OUTPUT_PATH)) {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  }
  return {
    brand: 'sonny-angel',
    scrapedAt: new Date().toISOString(),
    series: []
  };
}

/**
 * Normalize text for matching (remove articles, common words, special chars, lowercase)
 */
function normalizeForMatching(text) {
  return text
    .toLowerCase()
    .replace(/\b(the|a|an|series|edition|limited|secret)\b/g, '')
    .replace(/[-_]/g, ' ')  // Convert hyphens and underscores to spaces
    .replace(/[^\w\s]/g, '') // Remove all special characters
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Filter relevant items using FLEXIBLE matching for Sonny Angel
 */
function filterRelevantItems(listings, itemName, seriesName, brandName = 'sonny angel') {
  return listings.filter(listing => {
    const title = listing.title.toLowerCase();
    const normalizedTitle = normalizeForMatching(title);
    const normalizedItem = normalizeForMatching(itemName);
    const normalizedSeries = normalizeForMatching(seriesName);

    // Must contain brand name
    if (!title.includes('sonny') || !title.includes('angel')) {
      return false;
    }

    // Reject bundles/lots
    if (/(lot|set of|bulk|collection|bundle)/i.test(title)) {
      return false;
    }

    // Reject fakes
    if (/(not authentic|not original|fake|replica|dupe)/i.test(title)) {
      return false;
    }

    // Reject wrong product types
    if (/(plush|keychain|strap|magnet|sticker|pin|card|poster|shirt|hoodie|bag|case|charm)/i.test(title)) {
      return false;
    }

    // FLEXIBLE: Get significant words (length > 2) and require at least 60% match
    const itemWords = normalizedItem.split(/\s+/).filter(w => w.length > 2);
    
    // If only 1-2 words, require all words
    if (itemWords.length <= 2) {
      const allItemWordsPresent = itemWords.every(word => normalizedTitle.includes(word));
      if (!allItemWordsPresent) {
        return false;
      }
    } else {
      // For longer names, require at least 60% of words to match
      const matchedWords = itemWords.filter(word => normalizedTitle.includes(word));
      const matchPercentage = matchedWords.length / itemWords.length;
      
      if (matchPercentage < 0.6) {
        return false;
      }
    }

    // For Sonny Angel, don't enforce series matching at all
    // The item name is usually distinctive enough
    
    return true;
  });
}

/**
 * Remove outliers using IQR method
 */
function removeOutliers(prices) {
  if (prices.length < 4) return prices;

  const sorted = [...prices].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return prices.filter(p => p >= lowerBound && p <= upperBound);
}

/**
 * Generate multiple search term variations for Sonny Angel
 */
function generateSearchVariations(itemName, seriesName, rarity) {
  const variations = [];
  
  // Clean item name (remove underscores, hyphens)
  const cleanItemName = itemName.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const secretSuffix = (rarity === 'Secret' && !cleanItemName.toLowerCase().includes('secret')) ? ' Secret' : '';
  
  // Extract year if present
  const yearMatch = seriesName.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : null;
  
  // Clean series name (remove extra words but keep meaningful parts)
  let cleanSeriesName = seriesName
    .replace(/\bseries\b/i, '')
    .trim();
  
  // Variation 1: Brand + Full Series + Item + Secret
  variations.push(`Sonny Angel ${seriesName} ${cleanItemName}${secretSuffix}`);
  
  // Variation 2: Brand + Series (no year) + Item + Secret
  if (year) {
    const seriesNoYear = seriesName.replace(year, '').replace(/\s+/g, ' ').trim();
    variations.push(`Sonny Angel ${seriesNoYear} ${cleanItemName}${secretSuffix}`);
  }
  
  // Variation 3: Brand + Key Series Word + Year + Item + Secret
  const meaningfulPatterns = [
    /animal\s*\d*/i, /fruit/i, /marine/i, /flower/i, /halloween/i, 
    /christmas/i, /valentine/i, /sweets/i, /vegetable/i, /limited/i,
    /anniversary/i, /hippers/i, /gift/i, /rainy/i, /hanami/i,
    /circus/i, /dinosaur/i, /tea/i, /garden/i, /creatures/i
  ];
  
  for (const pattern of meaningfulPatterns) {
    const match = seriesName.match(pattern);
    if (match) {
      const keyword = match[0].trim();
      if (year) {
        variations.push(`Sonny Angel ${keyword} ${year} ${cleanItemName}${secretSuffix}`);
      }
      variations.push(`Sonny Angel ${keyword} ${cleanItemName}${secretSuffix}`);
      break; // Only use first matched keyword
    }
  }
  
  // Variation 4: Brand + Item + Secret (simplest)
  variations.push(`Sonny Angel ${cleanItemName}${secretSuffix}`);
  
  // Remove duplicates and return
  return [...new Set(variations)];
}

/**
 * Search Mercari for an item with multiple search variations
 */
async function searchMercari(page, itemName, seriesName, rarity) {
  const searchVariations = generateSearchVariations(itemName, seriesName, rarity);
  console.log(`   Trying ${searchVariations.length} search variations...`);
  
  const allListings = [];
  const seenTitles = new Set(); // Avoid duplicates

  // Try each search variation
  for (let i = 0; i < searchVariations.length; i++) {
    const searchTerm = searchVariations[i];
    console.log(`   [${i + 1}/${searchVariations.length}] "${searchTerm}"`);

    try {
      const searchUrl = `https://www.mercari.com/search/?keyword=${encodeURIComponent(searchTerm)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);

      // Extract listings using correct selectors
      const listings = await page.evaluate(() => {
        const items = [];
        const listingElements = document.querySelectorAll('a[href*="/item/"]');
        
        listingElements.forEach(el => {
          const titleEl = el.querySelector('[data-testid="ItemName"]') || el.querySelector('span') || el;
          const title = titleEl.textContent.trim();
          
          const priceEl = el.querySelector('[data-testid*="Price"]') || 
                         el.querySelector('[class*="price" i]') ||
                         Array.from(el.querySelectorAll('*')).find(e => /^\$[\d,]+(\.\d{2})?$/.test(e.textContent.trim()));
          
          if (title && priceEl) {
            const priceText = priceEl.textContent.trim();
            const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
            
            const isSold = el.textContent.toLowerCase().includes('sold') || 
                          el.querySelector('[class*="sold" i]') !== null;
            
            if (price && !isSold && title.length > 3) {
              items.push({ title, price });
            }
          }
        });
        
        return items;
      });

      // Add unique listings
      listings.forEach(listing => {
        if (!seenTitles.has(listing.title)) {
          seenTitles.add(listing.title);
          allListings.push(listing);
        }
      });

      console.log(`      Found ${listings.length} listings (${allListings.length} unique total)`);

      // If we have enough listings, stop searching
      if (allListings.length >= 20) {
        console.log(`   ✓ Found sufficient listings, stopping search`);
        break;
      }

    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
    }
  }

  console.log(`   Total unique listings found: ${allListings.length}`);
  return allListings;
}

/**
 * Calculate average price for an item
 */
async function getPriceForItem(page, item, seriesName) {
  const listings = await searchMercari(page, item.name, seriesName, item.rarity);
  
  if (listings.length === 0) {
    console.log(`   ❌ No listings found\n`);
    return null;
  }

  // Filter relevant items
  const relevantListings = filterRelevantItems(listings, item.name, seriesName);
  console.log(`   Relevant listings: ${relevantListings.length}`);

  if (relevantListings.length === 0) {
    console.log(`   ❌ No relevant listings after filtering\n`);
    return null;
  }

  // Extract and filter prices
  let prices = relevantListings.map(l => l.price).filter(p => p >= MIN_PRICE && p <= MAX_PRICE);
  
  if (prices.length === 0) {
    console.log(`   ❌ No valid prices in range ($${MIN_PRICE}-$${MAX_PRICE})\n`);
    return null;
  }

  console.log(`   Valid prices: ${prices.length}`);

  // Remove outliers
  const filteredPrices = removeOutliers(prices);
  console.log(`   After outlier removal: ${filteredPrices.length}`);

  if (filteredPrices.length === 0) {
    console.log(`   ❌ No prices after outlier removal\n`);
    return null;
  }

  // Additional bundle detection: reject if median is suspiciously high
  const median = filteredPrices.sort((a, b) => a - b)[Math.floor(filteredPrices.length / 2)];
  const tooHighPrices = filteredPrices.filter(p => p > median * 3);
  
  if (tooHighPrices.length > 0) {
    console.log(`   ⚠️  Removing ${tooHighPrices.length} suspiciously high prices (>3x median)`);
    prices = filteredPrices.filter(p => p <= median * 3);
  } else {
    prices = filteredPrices;
  }

  // Calculate average
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;
  const roundedAvg = Math.round(average * 100) / 100;

  console.log(`   ✅ Average: $${roundedAvg} (from ${prices.length} listings)`);
  console.log(`   Price range: $${Math.min(...prices)} - $${Math.max(...prices)}\n`);

  return {
    averagePrice: roundedAvg,
    listingCount: prices.length,
    priceRange: {
      min: Math.min(...prices),
      max: Math.max(...prices)
    }
  };
}

/**
 * Main scraping function for batch
 */
async function scrapeSonnyAngelBatch() {
  console.log('🎭 Starting Sonny Angel BATCH price scraper...\n');
  console.log(`📦 Processing items ${startIndex} to ${endIndex}\n`);

  const brandData = loadBrandData();
  const results = loadExistingResults();

  // Flatten all items with their series info
  const allItems = [];
  brandData.series.forEach(series => {
    series.items.forEach(item => {
      allItems.push({
        seriesId: series.id,
        seriesName: series.name,
        item: item
      });
    });
  });

  console.log(`Total items in dataset: ${allItems.length}`);
  console.log(`Processing items ${startIndex} to ${Math.min(endIndex, allItems.length)}\n`);

  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US'
  });
  
  // Add stealth scripts
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  
  const page = await context.newPage();

  let successfulItems = 0;
  const batchItems = allItems.slice(startIndex, endIndex);

  for (let i = 0; i < batchItems.length; i++) {
    const { seriesId, seriesName, item } = batchItems[i];
    const globalIndex = startIndex + i;
    
    console.log(`\n[${globalIndex + 1}/${allItems.length}] ${item.name} (${seriesName})${item.rarity ? ` - ${item.rarity}` : ''}`);

    try {
      const priceData = await getPriceForItem(page, item, seriesName);

      // Find or create series in results
      let seriesResult = results.series.find(s => s.seriesId === seriesId);
      if (!seriesResult) {
        seriesResult = {
          seriesId: seriesId,
          seriesName: seriesName,
          items: []
        };
        results.series.push(seriesResult);
      }

      // Check if item already exists
      const existingItemIndex = seriesResult.items.findIndex(i => i.name === item.name);
      
      const itemResult = {
        name: item.name,
        rarity: item.rarity || 'Regular',
        ...(priceData || {
          averagePrice: null,
          listingCount: 0,
          priceRange: null
        })
      };

      if (existingItemIndex >= 0) {
        seriesResult.items[existingItemIndex] = itemResult;
      } else {
        seriesResult.items.push(itemResult);
      }

      if (priceData) {
        successfulItems++;
      }

      // Save after each item
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

      // Rate limiting
      await page.waitForTimeout(2000);
    } catch (error) {
      console.error(`   ❌ Fatal error: ${error.message}`);
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log('✨ Batch Complete!');
  console.log('='.repeat(60));
  console.log(`Processed: ${batchItems.length} items`);
  console.log(`Successful: ${successfulItems} (${((successfulItems/batchItems.length)*100).toFixed(1)}%)`);
  console.log(`\n💾 Results saved to: ${OUTPUT_PATH}`);
  console.log(`\n📌 Next batch: node scrapers/scrape-sonny-angel-batch.js ${endIndex} ${endIndex + BATCH_SIZE}\n`);
}

// Run the scraper
scrapeSonnyAngelBatch().catch(console.error);
