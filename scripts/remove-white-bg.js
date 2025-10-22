const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'assets', 'images', 'skullpanda');
const outDir = path.resolve(__dirname, '..', 'assets', 'images', 'skullpanda', 'warmth-processed');
fs.mkdirSync(outDir, { recursive: true });

function isWarmthFile(name) {
  return /-warmth\./i.test(name) || /the-warmth\./i.test(name) || /raining-day-warmth\./i.test(name) || /wandering-warmth\./i.test(name);
}

async function processFile(file) {
  const src = path.join(srcDir, file);
  const out = path.join(outDir, file.replace(/\.(jpe?g|png|webp)$/i, '.png'));
  try {
    const img = sharp(src);
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const threshold = 240;
    // data is a Buffer of RGBA pixels
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // alpha index is i+3 when channels >=4
      const ai = i + 3;
      if (r >= threshold && g >= threshold && b >= threshold) {
        data[ai] = 0; // set alpha to 0 (transparent)
      }
    }
    await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(out);
    console.log('Wrote', out);
  } catch (e) {
    console.error('Error', src, e.message);
  }
}

async function main() {
  const files = fs.readdirSync(srcDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  const targets = files.filter(isWarmthFile);
  if (!targets.length) console.log('No warmth files found');
  for (const f of targets) await processFile(f);
}

main().catch(console.error);
