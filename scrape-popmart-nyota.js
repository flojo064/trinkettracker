// scrape-popmart-nyota.js
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { chromium } = require("playwright");

// ====== CONFIG / CLI ======
// Usage examples:
//   node scrape-popmart-nyota.js --url https://www.popmart.com/us/pop-now/set/303 --brand nyota
//   node scrape-popmart-nyota.js --url https://www.popmart.com/us/pop-now/set/999 --brand duckoo
// Optional: --save-dir assets/images/duckoo  --headless

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const long = `--${name}`;
  const idx = args.findIndex((a) => a === long || a.startsWith(`${long}=`));
  if (idx === -1) return fallback;
  const token = args[idx];
  if (token.includes("=")) return token.split("=").slice(1).join("=");
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
};

const defaultUrl = "https://www.popmart.com/us/pop-now/set/303"; // Nyota example
const brandFromArg = String(getArg("brand", "nyota") || "nyota").toLowerCase();

// Sanitize URL input (strip surrounding quotes or angle brackets pasted from chat/markdown)
const cleanUrlInput = (u) => {
  let s = String(u || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.startsWith("<") && s.endsWith(">")) {
    s = s.slice(1, -1);
  }
  return s;
};
const targetUrl = cleanUrlInput(getArg("url", defaultUrl) || defaultUrl);

// Validate URL early for clearer errors
try { new URL(targetUrl); } catch {
  console.error("Invalid --url provided:", targetUrl);
  process.exit(1);
}

const saveDirFromArg = getArg("save-dir", path.join(__dirname, "assets", "images", brandFromArg));
const DEBUG_DIR = path.join(__dirname, "debug");
const SHOW_BROWSER = !args.includes("--headless"); // add --headless to hide
// ==========================

fs.mkdirSync(saveDirFromArg, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "";

// filename → name fallback: decode, drop ext, split underscores/camelCase, remove junk
function nameFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    let base = decodeURIComponent(u.pathname.split("/").pop() || "");
    base = base.replace(/\.(png|jpe?g|webp|avif|gif|svg)$/i, "");
    // split common delimiters and camelCase → space
    base = base
      .replace(/[_+]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    // remove generic words
    base = base.replace(/\b(pop\s*mart|reviews?|series|figures|collection|set|image|img|slide|thumb|cover|banner)\b/gi, "").trim();
    // NEW: strip leading numbers like 17528339- or hashes
    base = base.replace(/^(?:\d{6,}|[a-f0-9]{8,})[-_ ]+/, "");
    return base;
  } catch { return ""; }
}

function downloadTo(urlStr, filepath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = u.protocol === "http:" ? http : https;
    const req = client.get(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        protocol: u.protocol,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
          Referer: targetUrl,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const nextUrl = new URL(res.headers.location, u).href;
          res.resume();
          return resolve(downloadTo(nextUrl, filepath, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
        }
        const file = fs.createWriteStream(filepath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      }
    );
    req.on("error", reject);
  });
}

(async () => {
  console.log("Starting scraper…");
  console.log("Saving to:", saveDirFromArg);

  const browser = await chromium.launch({ headless: !SHOW_BROWSER, slowMo: SHOW_BROWSER ? 80 : 0 });
  const page = await browser.newPage();

  // Light analytics blocking (avoid breaking core site assets)
  await page.route(
    /(google-analytics\.com|googletagmanager\.com|gdoubleclick\.net|facebook\.com|fbcdn\.net|tr\.snapchat\.com|ct\.pinterest\.com)/i,
    r => r.abort()
  );

  console.log("Navigating:", targetUrl);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.screenshot({ path: path.join(DEBUG_DIR, "01-domcontentloaded.png"), fullPage: true });

  // Scroll to bottom so the bottom carousel lazy-loads
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);

  // Clean series name from meta/headers; remove noisy words & punctuation (like a leading colon)
  const seriesName = await page.evaluate((brandName) => {
    const clean = (s) => (s || "")
      .replace(/\s*\|\s*POP\s*MART.*$/i, "")
      .replace(/\s*-\s*POP\s*MART.*$/i, "")
      .replace(/^[\s:;,\-–—]+/, "")               // drop leading punctuation/colons
      .replace(new RegExp(`\\b(pop\\s*mart|pop\\s*now|${brandName}|reviews?|series|figures)\\b`, "gi"), "")
      .replace(/\s+/g, " ")
      .trim();

    const og = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const h1 = document.querySelector("h1")?.textContent?.trim();
    const title = document.title?.trim();
    return clean(og) || clean(h1) || clean(title) || "series";
  }, brandFromArg);
  const seriesSlug = slug(seriesName);
  console.log("Series:", seriesName);

  // Click through the last carousel if it has a "next" button to render all slides
  for (const sel of ['[aria-label="Next"]', '.swiper-button-next', 'button[aria-label="next"]', 'button[aria-label="Next slide"]']) {
    const btn = await page.$(sel);
    if (btn) {
      console.log("Advancing carousel via:", sel);
      for (let i = 0; i < 80; i++) {
        try { await btn.click({ timeout: 400 }); await page.waitForTimeout(200); } catch { break; }
      }
      break;
    }
  }

  console.log("Collecting figure images + captions…");
  const items = await page.evaluate(() => {
    const normalize = (src) => {
      try {
        if (!src) return null;
        if (src.includes("/_next/image")) {
          const u = new URL(src, location.origin);
          const orig = u.searchParams.get("url");
          if (orig) return new URL(orig, location.origin).href;
        }
        return new URL(src, location.origin).href;
      } catch { return src; }
    };

    // Pick the last carousel-like container on the page (bottom strip)
    const containers = Array.from(
      document.querySelectorAll('.swiper, .swiper-container, .swiper-wrapper, [class*="carousel"], [class*="Carousel"], [role="list"]')
    );
    const target = containers[containers.length - 1] || document;

    // Slides/items inside that container
    const slides = Array.from(target.querySelectorAll('.swiper-slide, [role="listitem"], li, figure, .slide, .item, div'));

    // Extract a tight, name-like caption for each image
    const extractName = (root, img) => {
      const pick = (arr) => {
        const cleaned = arr
          .map(s => (s || "").replace(/\s+/g, " ").trim())
          .filter(s => s && !/^(pop\s*mart|reviews?)$/i.test(s));
        // Prefer short-ish names
        cleaned.sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length);
        return cleaned[0] || "";
      };

      // 1) image attributes first
      const fromAttrs = pick([
        img.getAttribute("alt"),
        img.getAttribute("title"),
        img.getAttribute("aria-label"),
      ]);
      if (fromAttrs) return fromAttrs;

      // 2) tight caption nodes
      const nameNode = root.querySelector('[class*="name" i]');
      const titleNode = root.querySelector('[class*="title" i]');
      const capNode = root.querySelector("figcaption, [class*='caption' i]");
      const fromNodes = pick([
        nameNode?.textContent,
        titleNode?.textContent,
        capNode?.textContent,
      ]);
      if (fromNodes) return fromNodes;

      // 3) very tight: immediate text nodes only (avoid whole container)
      const directText = Array.from(root.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent);
      const fromDirect = pick(directText);
      return fromDirect;
    };

    const pairs = [];
    for (const slide of slides) {
      const img = slide.querySelector("img");
      if (!img) continue;
      const url = normalize(img.currentSrc || img.src || img.getAttribute("data-src"));
      if (!url) continue;
      const caption = extractName(slide, img);
      // Also send back a basename for logging/fallback
      const base = (() => {
        try {
          const u = new URL(url);
          return decodeURIComponent(u.pathname.split("/").pop() || "");
        } catch { return ""; }
      })();
      pairs.push({ url, caption, basename: base });
    }

    // Dedupe by URL
    const seen = new Set();
    const unique = [];
    for (const p of pairs) {
      if (!seen.has(p.url)) { seen.add(p.url); unique.push(p); }
    }
    return unique;
  });

  // quick debug: show first few detected names + basenames
  console.log(`Found ${items.length} figures for series "${seriesName}".`);
  console.log("Sample detected:", items.slice(0, 5).map(it => ({
    caption: it.caption || "(blank)",
    basename: it.basename || "(no base)"
  })));

  await page.screenshot({ path: path.join(DEBUG_DIR, "03-after-collect.png"), fullPage: true });

  const used = new Set();
  let idx = 1;

  for (const { url, caption, basename } of items) {
    // Use caption; if blank, fall back to URL basename → slug
    const urlNameRaw = nameFromUrl(url).replace(/^\d+(?:[-_ ]+)?/, ""); // strip leading numeric tokens
    const urlName = slug(urlNameRaw);

    let figureSlug = slug(caption) || urlName;

    // safety: if anything numeric slipped through after slugging, strip it again
    figureSlug = figureSlug.replace(/^\d+(?:-+|_+)?/, "");

    if (!figureSlug) figureSlug = `figure-${idx}`; // last resort

    const ext = (path.extname(new URL(url).pathname).split("?")[0] || ".jpg").toLowerCase();
    let base = `${figureSlug}-${seriesSlug}`;
    let filename = `${base}${ext}`;
    let filepath = path.join(saveDirFromArg, filename);

    // Avoid duplicates
    let bump = 2;
    while (used.has(filename) || fs.existsSync(filepath)) {
      filename = `${base}-${bump}${ext}`;
      filepath = path.join(saveDirFromArg, filename);
      bump++;
    }
    used.add(filename);

    try {
      await downloadTo(url, filepath);
      console.log(`Saved: ${filepath}`);
      idx++;
    } catch (e) {
      console.warn("Failed:", url, e.message);
    }
  }

  await browser.close();
  console.log("Done.");
})().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
