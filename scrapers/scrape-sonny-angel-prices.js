const { chromium } = require('playwright');
const fs = require('fs');

const BRAND_JSON_PATH = './data/sonny-angel.json';
const OUTPUT_PATH = './data/sonny-angel-mercari-prices.json';

// Price filtering constants
const MIN_PRICE = 5;
const MAX_PRICE = 10000;

/**
 * Load Sonny Angel data from JSON
 */
function loadBrandData() {
  const data = JSON.parse(fs.readFileSync(BRAND_JSON_PATH, 'utf8'));
  return data;
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

    // For numbered series, be flexible with series matching
    const seriesMatch = seriesName.match(/\d+/);
    if (seriesMatch) {
      const seriesNum = seriesMatch[0];
      // Only check if it's a numeric series like "Series 1", "2023", etc.
      if (seriesName.match(/series\s*\d+|^\d{4}$/i)) {
        if (!title.includes(seriesNum) && !normalizedTitle.includes(normalizedSeries)) {
          return false;
        }
      }
    }

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
 * Generate search term with secret handling
 */
function generateSearchTerm(itemName, seriesName, rarity) {
  let searchTerm = `Sonny Angel ${seriesName} ${itemName}`;
  
  // Add "Secret" keyword for secret rarity items
  if (rarity === 'Secret' && !searchTerm.toLowerCase().includes('secret')) {
    searchTerm += ' Secret';
  }
  
  return searchTerm;
}

/**
 * Search Mercari for an item
 */
async function searchMercari(page, itemName, seriesName, rarity) {
  const searchTerm = generateSearchTerm(itemName, seriesName, rarity);
  console.log(`   Searching: "${searchTerm}"`);

  try {
    await page.goto('https://www.mercari.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    
    // Wait for search bar with longer timeout
    await page.waitForSelector('input[data-testid="SearchBar_Input"]', { timeout: 30000 });
    
    await page.fill('input[data-testid="SearchBar_Input"]', searchTerm);
    await page.press('input[data-testid="SearchBar_Input"]', 'Enter');
    
    await page.waitForTimeout(5000);

    // Extract listings
    const listings = await page.evaluate(() => {
      const items = [];
      const listingElements = document.querySelectorAll('[data-testid*="SearchResults"] [data-testid="Cell"]');
      
      listingElements.forEach(el => {
        const titleEl = el.querySelector('p');
        const priceEl = el.querySelector('[class*="price"]');
        const statusEl = el.querySelector('[class*="status"], [data-testid*="status"]');
        
        if (titleEl && priceEl) {
          const title = titleEl.textContent.trim();
          const priceText = priceEl.textContent.trim();
          const status = statusEl ? statusEl.textContent.trim().toLowerCase() : '';
          
          const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
          
          if (price && !status.includes('sold')) {
            items.push({ title, price });
          }
        }
      });
      
      return items;
    });

    console.log(`   Found ${listings.length} active listings`);

    // If we have very few results, try a simpler search (brand + item only)
    if (listings.length < 5) {
      console.log(`   ⚠️  Too few results, trying simpler search...`);
      const simpleSearchTerm = `Sonny Angel ${itemName}` + (rarity === 'Secret' ? ' Secret' : '');
      
      await page.fill('input[data-testid="SearchBar_Input"]', simpleSearchTerm);
      await page.press('input[data-testid="SearchBar_Input"]', 'Enter');
      await page.waitForTimeout(3000);

      const moreListings = await page.evaluate(() => {
        const items = [];
        const listingElements = document.querySelectorAll('[data-testid*="SearchResults"] [data-testid="Cell"]');
        
        listingElements.forEach(el => {
          const titleEl = el.querySelector('p');
          const priceEl = el.querySelector('[class*="price"]');
          const statusEl = el.querySelector('[class*="status"], [data-testid*="status"]');
          
          if (titleEl && priceEl) {
            const title = titleEl.textContent.trim();
            const priceText = priceEl.textContent.trim();
            const status = statusEl ? statusEl.textContent.trim().toLowerCase() : '';
            
            const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
            
            if (price && !status.includes('sold')) {
              items.push({ title, price });
            }
          }
        });
        
        return items;
      });

      console.log(`   Found ${moreListings.length} listings with simpler search`);
      listings.push(...moreListings);
    }

    return listings;
  } catch (error) {
    console.error(`   ❌ Error searching for ${itemName}:`, error.message);
    return [];
  }
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
 * Main scraping function
 */
async function scrapeSonnyAngelPrices() {
  console.log('🎭 Starting Sonny Angel price scraper...\n');

  const brandData = loadBrandData();
  const results = {
    brand: 'sonny-angel',
    scrapedAt: new Date().toISOString(),
    series: []
  };

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

  let totalItems = 0;
  let successfulItems = 0;

  for (const series of brandData.series) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 ${series.name} (${series.items.length} items)`);
    console.log('='.repeat(60));

    const seriesResult = {
      seriesId: series.id,
      seriesName: series.name,
      items: []
    };

    for (const item of series.items) {
      totalItems++;
      console.log(`\n[${totalItems}] ${item.name}${item.rarity ? ` (${item.rarity})` : ''}`);

      try {
        const priceData = await getPriceForItem(page, item, series.name);

        if (priceData) {
          seriesResult.items.push({
            name: item.name,
            rarity: item.rarity || 'Regular',
            ...priceData
          });
          successfulItems++;
        } else {
          seriesResult.items.push({
            name: item.name,
            rarity: item.rarity || 'Regular',
            averagePrice: null,
            listingCount: 0,
            priceRange: null
          });
        }

        // Rate limiting
        await page.waitForTimeout(2000);
      } catch (error) {
        console.error(`   ❌ Fatal error: ${error.message}`);
        seriesResult.items.push({
          name: item.name,
          rarity: item.rarity || 'Regular',
          averagePrice: null,
          listingCount: 0,
          priceRange: null
        });
      }
    }

    results.series.push(seriesResult);
  }

  await browser.close();

  // Save results
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('✨ Scraping Complete!');
  console.log('='.repeat(60));
  console.log(`Total items: ${totalItems}`);
  console.log(`Successful: ${successfulItems} (${((successfulItems/totalItems)*100).toFixed(1)}%)`);
  console.log(`Failed: ${totalItems - successfulItems}`);
  console.log(`\n💾 Results saved to: ${OUTPUT_PATH}\n`);
}

// Run the scraper
scrapeSonnyAngelPrices().catch(console.error);
