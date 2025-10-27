const { chromium } = require('playwright');

async function debugMercariSelectors() {
  console.log('🔍 Debugging Mercari page structure...\n');

  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();

  const searchTerm = 'Sonny Angel Rabbit';
  console.log(`Searching for: "${searchTerm}"\n`);
  
  const searchUrl = `https://www.mercari.com/search/?keyword=${encodeURIComponent(searchTerm)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000); // Wait for content to load

  // Try to extract with different selectors
  const debugInfo = await page.evaluate(() => {
    const results = {
      selectors: {},
      firstElements: {}
    };

    // Try different potential selectors
    const selectorsToTry = [
      '[data-testid*="SearchResults"] [data-testid="Cell"]',
      '[data-testid="SearchResults"]',
      '[data-testid="Cell"]',
      'div[data-testid*="item"]',
      'a[href*="/item/"]',
      'li[data-testid]',
      '[class*="Item"]',
      '[class*="item"]'
    ];

    selectorsToTry.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      results.selectors[selector] = elements.length;
      
      if (elements.length > 0 && elements[0]) {
        // Get attributes and text of first element
        results.firstElements[selector] = {
          tagName: elements[0].tagName,
          className: elements[0].className,
          textContent: elements[0].textContent.substring(0, 100),
          innerHTML: elements[0].innerHTML.substring(0, 200)
        };
      }
    });

    // Get all data-testid values on the page
    const allTestIds = new Set();
    document.querySelectorAll('[data-testid]').forEach(el => {
      allTestIds.add(el.getAttribute('data-testid'));
    });
    results.allTestIds = Array.from(allTestIds);

    return results;
  });

  console.log('📊 Selector Results:');
  console.log('='.repeat(60));
  for (const [selector, count] of Object.entries(debugInfo.selectors)) {
    console.log(`${selector}: ${count} elements`);
  }

  console.log('\n📋 All data-testid values found:');
  console.log(debugInfo.allTestIds.join(', '));

  console.log('\n🎯 First element details:');
  for (const [selector, details] of Object.entries(debugInfo.firstElements)) {
    if (details) {
      console.log(`\n${selector}:`);
      console.log(`  Tag: ${details.tagName}`);
      console.log(`  Class: ${details.className}`);
      console.log(`  Text: ${details.textContent}`);
    }
  }

  console.log('\n✅ Browser will stay open for 30 seconds so you can inspect...');
  await page.waitForTimeout(30000);
  await browser.close();
}

debugMercariSelectors().catch(console.error);
