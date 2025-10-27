const { chromium } = require('playwright');

async function testMercariSearch() {
  console.log('🧪 Testing Mercari search with common Sonny Angel items...\n');

  const browser = await chromium.launch({ 
    headless: false, // Show browser to see what's happening
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();

  // Test searches with common items
  const testSearches = [
    'Sonny Angel',
    'Sonny Angel Animal',
    'Sonny Angel Rabbit',
    'Sonny Angel Marine'
  ];

  for (const searchTerm of testSearches) {
    console.log(`\n🔍 Searching: "${searchTerm}"`);
    const searchUrl = `https://www.mercari.com/search/?keyword=${encodeURIComponent(searchTerm)}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Extract listings
    const listings = await page.evaluate(() => {
      const items = [];
      const listingElements = document.querySelectorAll('[data-testid*="SearchResults"] [data-testid="Cell"]');
      
      listingElements.forEach(el => {
        const titleEl = el.querySelector('p');
        const priceEl = el.querySelector('[class*="price"]');
        
        if (titleEl && priceEl) {
          const title = titleEl.textContent.trim();
          const priceText = priceEl.textContent.trim();
          items.push({ title, price: priceText });
        }
      });
      
      return items;
    });

    console.log(`   Found ${listings.length} listings`);
    if (listings.length > 0) {
      console.log(`   First 3 results:`);
      listings.slice(0, 3).forEach(item => {
        console.log(`     - ${item.title} (${item.price})`);
      });
    }
  }

  console.log('\n✅ Test complete! Keeping browser open for 10 seconds...');
  await page.waitForTimeout(10000);
  await browser.close();
}

testMercariSearch().catch(console.error);
