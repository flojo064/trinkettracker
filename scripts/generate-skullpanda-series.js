const fs = require('fs');
const path = require('path');

const imagesDir = path.resolve(__dirname, '..', 'assets', 'images', 'skullpanda');
const outPath = path.resolve(__dirname, '..', 'data', 'skullpanda.json');
const brandId = 'skullpanda';
const brandName = 'SkullPanda';

function readImages() {
  if (!fs.existsSync(imagesDir)) throw new Error('images dir missing: ' + imagesDir);
  return fs.readdirSync(imagesDir)
    .filter(f => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(f))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
}

function splitTokens(name) {
  return name.split(/[-_]+/).filter(Boolean);
}

function candidateSuffixes(names, maxLen = 4) {
  const counts = new Map();
  for (const n of names) {
    const base = n.replace(/\.(png|jpe?g|webp|avif|gif|svg)$/i, '');
    const parts = splitTokens(base);
    for (let l = 1; l <= Math.min(maxLen, parts.length); l++) {
      const suf = parts.slice(parts.length - l).join('-');
      counts.set(suf, (counts.get(suf) || 0) + 1);
    }
  }
  // return array of [suffix, count] sorted by count desc then length desc
  return Array.from(counts.entries()).sort((a,b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].split('-').length - a[0].split('-').length;
  });
}

function titleCase(s) {
  if (!s) return '';
  // small words to keep lowercase if not first word
  const small = new Set(['a','an','the','of','in','on','and','or','to','with','by','for','from','at']);
  return s.split(/\s+/).filter(Boolean).map((w,i) => {
    const clean = w.replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '';
    const lower = clean.toLowerCase();
    if (i>0 && small.has(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1); // keep capitalized to match project style
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ').trim();
}

function cleanCandidate(c) {
  return c.replace(/fromthe/ig, 'from the').replace(/\s+/g,' ').trim();
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g,'');
}

function build() {
  const files = readImages();
  const bases = files.map(f => f.replace(/\.(png|jpe?g|webp|avif|gif|svg)$/i, ''));
  const cand = candidateSuffixes(files, 4);
  // choose suffixes with count >= 2
  let chosen = cand.filter(([s,c]) => c >= 2).map(([s]) => s);
  // sort chosen by token length desc so longest match first
  chosen.sort((a,b) => b.split('-').length - a.split('-').length);
  // remove any chosen suffix that is a suffix of a longer chosen suffix (avoid shortening "tell-me-what-you-want" -> "me-what-you-want")
  chosen = chosen.filter(s => !chosen.some(t => t !== s && t.endsWith('-' + s)));

  const seriesMap = new Map();

  for (let i=0;i<files.length;i++) {
    const file = files[i];
    const base = bases[i];
    let matched = null;
    for (const s of chosen) {
      if (base === s || base.endsWith('-' + s)) { matched = s; break; }
    }
    let seriesName, itemPart;
    if (matched) {
      seriesName = cleanCandidate(matched.replace(/-/g,' '));
      if (base === matched) itemPart = '';
      else itemPart = base.slice(0, base.length - (matched.length + 1));
    } else {
      seriesName = 'Unknown Series';
      itemPart = base;
    }
    itemPart = itemPart.replace(/[-_]+/g,' ').trim();
    // remove trailing connector words that were part of the filename but belong to the series (eg. 'tell')
    itemPart = itemPart.replace(/\b(?:tell|the|a|an|of)\s*$/i, '').trim();
    if (!itemPart) {
      // fallback to a sensible item name when nothing remains
      itemPart = 'Unknown';
    }
    // clean concatenations like 'fromthe' -> 'from the'
    itemPart = cleanCandidate(itemPart);
    const name = titleCase(itemPart);
    const item = {
      id: `${brandId}-${slugify(titleCase(itemPart)) || 'figure-'+(i+1)}`,
      name: name,
      rarity: 'Standard',
      image: `./assets/images/skullpanda/${file}`
    };
    const seriesKey = titleCase(seriesName);
    if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, []);
    seriesMap.get(seriesKey).push(item);
  }

  const seriesArr = [];
  for (const [k, items] of seriesMap.entries()) {
    seriesArr.push({
      id: `${brandId}-${slugify(k)}`,
      name: k,
      release: '',
      description: '',
      items: items
    });
  }

  // Correct known ambiguous series: prefer full 'Tell Me What You Want' over shortened 'Me What You Want'
  for (let s of seriesArr) {
    if (s.id.includes('me-what-you-want')) {
      s.id = `${brandId}-tell-me-what-you-want`;
      s.name = 'Tell Me What You Want';
      break;
    }
  }

  // Build pretty JSON matching the style of data/smiski.json (multi-line item objects)
  const lines = [];
  lines.push('{');
  lines.push('  "brand": {');
  lines.push(`    "id": "${brandId}",`);
  lines.push(`    "name": "${brandName}"`);
  lines.push('  },');
  lines.push('  "series": [');

  for (let si = 0; si < seriesArr.length; si++) {
    const s = seriesArr[si];
    lines.push('    {');
    lines.push(`      "id": "${s.id}",`);
    lines.push(`      "name": "${s.name}",`);
    lines.push('      "release": "",');
    lines.push('      "description": "",');
    lines.push('      "items": [');

    for (let ii = 0; ii < s.items.length; ii++) {
      const it = s.items[ii];
      lines.push('        {');
      lines.push(`          "id": "${it.id}",`);
      lines.push(`          "name": "${it.name}",`);
      lines.push(`          "rarity": "${it.rarity}",`);
      // omit palette (unknown) but include image when present
      lines.push(`          "image": "${it.image}"`);
      lines.push(ii === s.items.length - 1 ? '        }' : '        },');
    }

    lines.push('      ]');
    lines.push(si === seriesArr.length - 1 ? '    }' : '    },');
  }

  lines.push('  ]');
  lines.push('}');

  const json = lines.join('\n') + '\n';
  fs.writeFileSync(outPath, json, 'utf8');
  console.log(`Wrote ${files.length} items into ${seriesArr.length} series to ${outPath}`);
}

try {
  build();
} catch (e) {
  console.error(e);
  process.exit(1);
}
