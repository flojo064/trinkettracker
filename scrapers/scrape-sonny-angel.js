// scrape-sonny-angel.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { chromium } = require("playwright");
const sharp = require('sharp');

// Configuration
const BRAND = "sonny-angel";
const BASE_DIR = path.join(__dirname, "assets", "images", BRAND);
const DEBUG_DIR = path.join(__dirname, "debug");
const SHOW_BROWSER = !process.argv.includes("--headless");

// Ensure directories exist
fs.mkdirSync(BASE_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

// Series configuration with search terms and directories
const SERIES_CONFIG = [
  { name: "animal-1", searchTerms: ["sonny angel animal series 1", "sonny angel rabbit elephant sheep"], count: 11 },
  { name: "animal-2", searchTerms: ["sonny angel animal series 2", "sonny angel cow tiger zebra"], count: 11 },
  { name: "animal-3", searchTerms: ["sonny angel animal series 3", "sonny angel penguin seal polar bear"], count: 11 },
  { name: "animal-4", searchTerms: ["sonny angel animal series 4", "sonny angel cheetah jaguar kangaroo"], count: 11 },
  { name: "fruit-2019", searchTerms: ["sonny angel fruit series 2019", "sonny angel apple orange banana strawberry"], count: 11 },
  { name: "vegetable", searchTerms: ["sonny angel vegetable series", "sonny angel carrot tomato corn broccoli"], count: 11 },
  { name: "marine", searchTerms: ["sonny angel marine series", "sonny angel dolphin whale octopus"], count: 11 },
  { name: "flower", searchTerms: ["sonny angel flower series", "sonny angel rose sunflower tulip"], count: 11 },
  { name: "sweets", searchTerms: ["sonny angel sweets series", "sonny angel chocolate cake donut ice cream"], count: 11 },
  { name: "snack", searchTerms: ["sonny angel snack series", "sonny angel hamburger french fry hot dog"], count: 12 },
  { name: "pumpkin-patch", searchTerms: ["sonny angel pumpkin patch series", "sonny angel halloween ghost"], count: 7 },
  { name: "cat-life", searchTerms: ["sonny angel cat life series", "sonny angel cat sleeping playing"], count: 6 },
  { name: "dog-time", searchTerms: ["sonny angel dog time series", "sonny angel dog walking sleeping"], count: 6 },
  { name: "rainy-day", searchTerms: ["sonny angel i love rainy day series", "sonny angel umbrella raincoat"], count: 6 },
  { name: "hanami", searchTerms: ["sonny angel cherry blossom hanami series", "sonny angel sakura spring"], count: 6 },
  { name: "hippers", searchTerms: ["sonny angel hippers series", "sonny angel hipper original cool"], count: 6 },
  { name: "hippers-dreaming", searchTerms: ["sonny angel hippers dreaming series", "sonny angel dreaming duck unicorn"], count: 12 },
  { name: "hippers-harvest", searchTerms: ["sonny angel hippers harvest series", "sonny angel ringo ichigo"], count: 4 },
  { name: "christmas-dinner", searchTerms: ["sonny angel christmas dinner series", "sonny angel turkey ham pie"], count: 6 },
  { name: "limited", searchTerms: ["sonny angel limited edition", "sonny angel birthday gift valentine"], count: 10 }
];

// Image sources to try
const IMAGE_SOURCES = [
  {
    name: "Google Images",
    search: async (page, searchTerm) => {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&tbm=isch`);
      await page.waitForSelector('img[data-src], img[src]', { timeout: 10000 });
      
      const images = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[data-src], img[src]'));
        return imgs.slice(0, 20).map(img => ({
          src: img.getAttribute('data-src') || img.src,
          alt: img.alt || '',
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0
        })).filter(img => 
          img.src && 
          img.src.startsWith('http') && 
          (img.width > 200 || img.height > 200) &&
          !img.src.includes('logo') &&
          !img.src.includes('icon')
        );
      });
      
      return images;
    }
  },
  {
    name: "Amazon",
    search: async (page, searchTerm) => {
      await page.goto(`https://www.amazon.com/s?k=${encodeURIComponent(searchTerm)}`);
      await page.waitForSelector('img[data-image-index], img.s-image', { timeout: 10000 });
      
      const images = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[data-image-index], img.s-image'));
        return imgs.slice(0, 15).map(img => ({
          src: img.src,
          alt: img.alt || '',
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0
        })).filter(img => 
          img.src && 
          img.src.startsWith('http') && 
          (img.width > 200 || img.height > 200)
        );
      });
      
      return images;
    }
  }
];

// Download image function
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode === 200) {
        const fileStream = fs.createWriteStream(filepath);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(filepath);
        });
        fileStream.on('error', reject);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// Remove white background function
async function removeWhiteBackground(inputPath, outputPath) {
  try {
    const img = sharp(inputPath);
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const threshold = 240;
    
    // Process pixels to make white areas transparent
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const ai = i + 3;
      
      // If pixel is close to white, make it transparent
      if (r >= threshold && g >= threshold && b >= threshold) {
        data[ai] = 0;
      }
    }
    
    await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(outputPath);
    
    console.log(`✅ Background removed: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Error removing background from ${inputPath}:`, error.message);
    return null;
  }
}

// Main scraping function
async function scrapeSeries(seriesConfig) {
  console.log(`\n🔍 Starting scrape for ${seriesConfig.name} series...`);
  
  const seriesDir = path.join(BASE_DIR, seriesConfig.name);
  fs.mkdirSync(seriesDir, { recursive: true });
  
  const browser = await chromium.launch({ headless: !SHOW_BROWSER });
  const page = await browser.newPage();
  
  // Set user agent to avoid detection
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  
  const allImages = [];
  
  // Search each source
  for (const source of IMAGE_SOURCES) {
    console.log(`📡 Searching ${source.name}...`);
    
    for (const searchTerm of seriesConfig.searchTerms) {
      try {
        console.log(`  🔎 "${searchTerm}"`);
        const images = await source.search(page, searchTerm);
        allImages.push(...images);
        
        // Wait between searches to be respectful
        await page.waitForTimeout(2000);
      } catch (error) {
        console.error(`❌ Error searching ${source.name}:`, error.message);
      }
    }
  }
  
  await browser.close();
  
  // Remove duplicates and filter
  const uniqueImages = allImages.filter((img, index, arr) => 
    arr.findIndex(other => other.src === img.src) === index
  );
  
  console.log(`📊 Found ${uniqueImages.length} unique images`);
  
  // Download and process images
  let downloadCount = 0;
  const maxDownloads = Math.min(seriesConfig.count * 2, uniqueImages.length); // Download extra for selection
  
  for (let i = 0; i < maxDownloads && downloadCount < seriesConfig.count; i++) {
    const image = uniqueImages[i];
    const ext = path.extname(new URL(image.src).pathname) || '.jpg';
    const filename = `${seriesConfig.name}-${downloadCount + 1}${ext}`;
    const rawPath = path.join(seriesDir, `raw-${filename}`);
    const finalPath = path.join(seriesDir, filename.replace(ext, '.png'));
    
    try {
      console.log(`⬇️  Downloading ${filename}...`);
      await downloadImage(image.src, rawPath);
      
      // Remove background and convert to PNG
      const processedPath = await removeWhiteBackground(rawPath, finalPath);
      
      if (processedPath) {
        // Clean up raw file
        fs.unlinkSync(rawPath);
        downloadCount++;
        console.log(`✅ Processed ${downloadCount}/${seriesConfig.count}: ${filename}`);
      } else {
        // Keep raw file if processing failed
        console.log(`⚠️  Kept raw file: ${filename}`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to download ${image.src}:`, error.message);
    }
  }
  
  console.log(`✅ Completed ${seriesConfig.name}: ${downloadCount} images processed`);
}

// Main function
async function main() {
  console.log("🎭 Sonny Angel Image Scraper & Background Remover");
  console.log("==============================================");
  
  const seriesArg = process.argv.find(arg => arg.startsWith('--series='));
  const targetSeries = seriesArg ? seriesArg.split('=')[1] : null;
  
  if (targetSeries) {
    const series = SERIES_CONFIG.find(s => s.name === targetSeries);
    if (series) {
      await scrapeSeries(series);
    } else {
      console.error(`❌ Series "${targetSeries}" not found. Available series:`);
      SERIES_CONFIG.forEach(s => console.log(`  - ${s.name}`));
      process.exit(1);
    }
  } else {
    // Process all series
    for (const series of SERIES_CONFIG) {
      await scrapeSeries(series);
      // Wait between series to be respectful
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log("\n🎉 All done! Images scraped and backgrounds removed.");
  console.log(`📁 Check ${BASE_DIR} for your processed images.`);
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeSeries, removeWhiteBackground };