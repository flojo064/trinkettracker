const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'assets', 'images', 'skullpanda', 'warmth-processed');
const outDir = path.resolve(__dirname, '..', 'assets', 'images', 'skullpanda', 'warmth-contained');
fs.mkdirSync(outDir, { recursive: true });

// Config: padding inside the image to define the visible 'card' area.
// Values are fractions (0-1) of width/height.
const padding = { left: 0.06, right: 0.06, top: 0.06, bottom: 0.08 };

async function processFile(file) {
  const src = path.join(srcDir, file);
  const out = path.join(outDir, file);
  try {
    const meta = await sharp(src).metadata();
    const w = meta.width;
    const h = meta.height;
    const left = Math.round(w * padding.left);
    const top = Math.round(h * padding.top);
    const right = Math.round(w * (1 - padding.right));
    const bottom = Math.round(h * (1 - padding.bottom));
    const cropW = right - left;
    const cropH = bottom - top;

    // Create an empty transparent PNG the same size, then composite the cropped area in the center
    const cropped = await sharp(src).extract({ left, top, width: cropW, height: cropH }).png().toBuffer();

    // Place the cropped image back into a transparent canvas same size as original, centered at the crop coords
    const canvas = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    await canvas.composite([{ input: cropped, left, top }]).png().toFile(out);
    console.log('Wrote', out);
  } catch (e) {
    console.error('Error', src, e.message);
  }
}

async function main() {
  const files = fs.readdirSync(srcDir).filter(f => /\.(png)$/i.test(f));
  if (!files.length) {
    console.log('No processed warmth files found in', srcDir);
    return;
  }
  for (const f of files) await processFile(f);
}

main().catch(console.error);
