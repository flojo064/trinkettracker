const fs = require('fs');
const path = require('path');

const SONNY_ANGEL_JSON_PATH = './data/sonny-angel.json';
const IMAGES_BASE_PATH = './assets/images/sonny-angel';

/**
 * Scans the Sonny Angel image folders and updates the JSON with actual image files
 */
async function mapSonnyAngelImages() {
  console.log('🔍 Scanning Sonny Angel image folders...\n');

  // Read the current JSON
  const jsonData = JSON.parse(fs.readFileSync(SONNY_ANGEL_JSON_PATH, 'utf8'));
  
  let totalUpdated = 0;
  let totalMissing = 0;
  let foundImages = new Map();

  // Scan each series folder
  for (const series of jsonData.series) {
    const seriesPath = path.join(IMAGES_BASE_PATH, series.id);
    
    console.log(`\n📁 ${series.name} (${series.id})`);
    
    // Check if folder exists
    if (!fs.existsSync(seriesPath)) {
      console.log(`   ⚠️  Folder not found: ${seriesPath}`);
      continue;
    }

    // Get all image files in the folder
    const files = fs.readdirSync(seriesPath);
    const imageFiles = files.filter(f => 
      /\.(jpg|jpeg|png|webp|gif)$/i.test(f)
    );

    console.log(`   Found ${imageFiles.length} image(s)`);

    // Create a map of existing images
    const imageMap = new Map();
    imageFiles.forEach(file => {
      const baseName = path.basename(file, path.extname(file));
      imageMap.set(baseName, file);
    });

    // Update each item in the series
    for (const item of series.items) {
      const currentImage = item.image;
      const expectedFileName = path.basename(currentImage, path.extname(currentImage));
      
      // Try to find a matching image
      let foundFile = null;
      
      // First, check exact match
      if (imageMap.has(expectedFileName)) {
        foundFile = imageMap.get(expectedFileName);
      } else {
        // Try normalized match (lowercase, remove special chars)
        const normalizedExpected = expectedFileName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        for (const [baseName, file] of imageMap.entries()) {
          const normalizedBase = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normalizedBase === normalizedExpected) {
            foundFile = file;
            break;
          }
        }
      }

      if (foundFile) {
        const newImagePath = `assets/images/sonny-angel/${series.id}/${foundFile}`;
        item.image = newImagePath;
        console.log(`   ✅ ${item.name}: ${foundFile}`);
        totalUpdated++;
        
        // Track found images
        if (!foundImages.has(series.id)) {
          foundImages.set(series.id, []);
        }
        foundImages.get(series.id).push(foundFile);
      } else {
        console.log(`   ❌ ${item.name}: NOT FOUND (expected: ${expectedFileName}.*)`);
        totalMissing++;
      }
    }

    // Report any unmatched images in the folder
    const matchedFiles = foundImages.get(series.id) || [];
    const unmatchedFiles = imageFiles.filter(f => !matchedFiles.includes(f));
    
    if (unmatchedFiles.length > 0) {
      console.log(`\n   ⚠️  Unmatched images in folder:`);
      unmatchedFiles.forEach(f => console.log(`      - ${f}`));
    }
  }

  // Save updated JSON
  fs.writeFileSync(
    SONNY_ANGEL_JSON_PATH,
    JSON.stringify(jsonData, null, 2),
    'utf8'
  );

  console.log('\n' + '='.repeat(60));
  console.log(`\n✨ Summary:`);
  console.log(`   ✅ Updated: ${totalUpdated} images`);
  console.log(`   ❌ Missing: ${totalMissing} images`);
  console.log(`\n💾 JSON file updated: ${SONNY_ANGEL_JSON_PATH}\n`);
}

// Run the mapping
mapSonnyAngelImages().catch(console.error);
