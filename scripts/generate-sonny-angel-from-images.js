const fs = require('fs');
const path = require('path');

const SONNY_ANGEL_JSON_PATH = './data/sonny-angel.json';
const IMAGES_BASE_PATH = './assets/images/sonny-angel';

// Read existing JSON to preserve brand info
const existingData = JSON.parse(fs.readFileSync(SONNY_ANGEL_JSON_PATH, 'utf8'));

// Helper to generate nice series names from folder names
function generateSeriesName(folderId) {
  return folderId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper to generate nice item names from filenames
function generateItemName(filename) {
  const name = path.basename(filename, path.extname(filename));
  
  // Handle secret/limited suffix
  let displayName = name
    .replace(/-secret$/i, '')
    .replace(/-limited$/i, '');
  
  // Convert to nice display name
  displayName = displayName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return displayName;
}

// Helper to check if item is secret/limited
function getRarity(filename) {
  const name = path.basename(filename, path.extname(filename));
  if (/-secret$/i.test(name)) return 'Secret';
  if (/-limited$/i.test(name)) return 'Limited';
  return 'Regular';
}

// Generate color palettes for different series types
function generatePalette(folderId) {
  // Predefined palettes for common themes
  const palettes = {
    'animal': ["#ff6b6b", "#e03131", "#a61e1e"],
    'christmas': ["#dc2626", "#b91c1c", "#991b1b"],
    'halloween': ["#f97316", "#ea580c", "#c2410c"],
    'valentine': ["#f9a8d4", "#ec4899", "#db2777"],
    'marine': ["#6bb6ff", "#1e88e5", "#1565c0"],
    'flower': ["#f093fb", "#e91e63", "#c2185b"],
    'fruit': ["#ff9a9e", "#ff6b88", "#ff3d71"],
    'vegetable': ["#74c365", "#52a540", "#3d7830"],
    'sweets': ["#fdbb2d", "#f57c00", "#e65100"],
    'hippers': ["#7c3aed", "#6d28d9", "#5b21b6"],
    'summer': ["#4ecdc4", "#38a69b", "#2c7873"],
    'winter': ["#0284c7", "#0369a1", "#075985"],
    'birthday': ["#fbbf24", "#f59e0b", "#d97706"],
    'default': ["#be185d", "#9d174d", "#831843"]
  };

  for (const [key, palette] of Object.entries(palettes)) {
    if (folderId.includes(key)) {
      return palette;
    }
  }
  return palettes.default;
}

// Scan all folders and build series array
console.log('🔍 Scanning Sonny Angel image folders...\n');

const folders = fs.readdirSync(IMAGES_BASE_PATH, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)
  .sort();

const series = [];

for (const folderId of folders) {
  const folderPath = path.join(IMAGES_BASE_PATH, folderId);
  const files = fs.readdirSync(folderPath);
  const imageFiles = files.filter(f => 
    /\.(jpg|jpeg|png|webp|gif)$/i.test(f)
  );

  if (imageFiles.length === 0) {
    console.log(`⏭️  Skipping ${folderId} (no images)`);
    continue;
  }

  console.log(`📁 ${folderId} - ${imageFiles.length} images`);

  const items = imageFiles
    .sort()
    .map(file => {
      const item = {
        name: generateItemName(file),
        image: `assets/images/sonny-angel/${folderId}/${file}`
      };
      
      const rarity = getRarity(file);
      if (rarity !== 'Regular') {
        item.rarity = rarity;
      }
      
      return item;
    });

  series.push({
    id: folderId,
    name: generateSeriesName(folderId),
    palette: generatePalette(folderId),
    items: items
  });
}

// Build final JSON
const newData = {
  brand: existingData.brand,
  series: series
};

// Save to file
fs.writeFileSync(
  SONNY_ANGEL_JSON_PATH,
  JSON.stringify(newData, null, 2),
  'utf8'
);

console.log('\n' + '='.repeat(60));
console.log(`\n✨ Generated Sonny Angel JSON:`);
console.log(`   📂 Total series: ${series.length}`);
console.log(`   🎨 Total items: ${series.reduce((sum, s) => sum + s.items.length, 0)}`);
console.log(`\n💾 Saved to: ${SONNY_ANGEL_JSON_PATH}\n`);
