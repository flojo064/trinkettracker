const BRAND_INDEX_URL = "./data/brands.json";
const STORAGE_KEY = "tt-trinket-checklist";
const PREFERENCES_KEY = "tt-trinket-preferences";

const appRoot = document.querySelector("#app");
const headerEl = document.querySelector(".tt-header");
const headerSubtitle = document.querySelector(".tt-header__subtitle span");
const headerProgress = document.querySelector(".tt-header__progress");

const state = {
  brands: [],
  view: "loading",
  currentBrand: null,
  brandMeta: null,
  items: [],
  seriesIndex: [],
  seriesFilter: "all",
  search: "",
  sort: "default",
  // Landing (brands list) controls
  landingSearch: "",
  landingSort: "az",
  showLimited: false,
  hideSecrets: false,
  checklist: {},
  preferences: {},
  error: null
};

let progressRefs = null;
const brandDataCache = new Map();
const brandItemCache = new Map();

const createElement = (tag, className, content) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined && content !== null) {
    if (typeof content === "string") {
      el.innerHTML = content;
    } else if (Array.isArray(content)) {
      content.forEach((child) => {
        if (child) el.appendChild(child);
      });
    } else if (content instanceof Node) {
      el.appendChild(content);
    }
  }
  return el;
};

const slugify = (value) => {
  if (!value) return "";
  return value
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const getSeriesToken = (seriesName) => {
  if (!seriesName) return "";
  const lowered = seriesName.toLowerCase();
  const numberMatch = lowered.match(/series\s*(\d+)/i);
  if (numberMatch && numberMatch[1]) return numberMatch[1];
  const withoutSeries = seriesName.replace(/series/gi, "").trim();
  return slugify(withoutSeries) || slugify(seriesName);
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const rgbToHex = ([r, g, b]) =>
  `#${[r, g, b]
    .map((component) => {
      const hex = component.toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join("")}`;

const rgbToHsl = ([r, g, b]) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
};

const hslToRgb = ([h, s, l]) => {
  let r;
  let g;
  let b;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

const adjustLightness = (rgb, amount) => {
  const hsl = rgbToHsl(rgb);
  hsl[2] = clamp(hsl[2] + amount);
  return hslToRgb(hsl);
};

const analyzeImageColors = (img) => {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return null;

  const sampleSize = 80;
  const canvas = document.createElement("canvas");
  const scale = Math.min(sampleSize / width, sampleSize / height, 1);
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const samplePoints = [
    [0, 0],
    [canvas.width - 1, 0],
    [0, canvas.height - 1],
    [canvas.width - 1, canvas.height - 1],
    [Math.floor(canvas.width / 2), 0],
    [Math.floor(canvas.width / 2), canvas.height - 1],
    [0, Math.floor(canvas.height / 2)],
    [canvas.width - 1, Math.floor(canvas.height / 2)]
  ];

  const edgeColors = [];
  const total = [0, 0, 0];
  let opaquePixels = 0;
  samplePoints.forEach(([x, y]) => {
    const idx = (y * canvas.width + x) * 4;
    const alpha = data[idx + 3];
    if (alpha > 230) {
      edgeColors.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  });

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 10) {
      total[0] += data[i];
      total[1] += data[i + 1];
      total[2] += data[i + 2];
      opaquePixels += 1;
    }
  }

  if (!opaquePixels) return null;
  const average = total.map((sum) => Math.round(sum / opaquePixels));

  let background = null;
  if (edgeColors.length) {
    background = edgeColors.reduce(
      (acc, [r, g, b]) => {
        acc[0] += r;
        acc[1] += g;
        acc[2] += b;
        return acc;
      },
      [0, 0, 0]
    ).map((sum) => Math.round(sum / edgeColors.length));
  }

  const totalPixels = data.length / 4;
  const coverage = opaquePixels / totalPixels;

  return { background, average, coverage };
};

const seriesMediaWrappers = new Map();
const seriesAccentTotals = new Map();

const resetSeriesAccentState = () => {
  seriesMediaWrappers.clear();
  seriesAccentTotals.clear();
};

const applyAccentToWrapper = (wrapper, accent, fallbackPalette) => {
  if (!wrapper || !accent) return;
  wrapper.style.setProperty("--accent-primary", accent.primary);
  wrapper.style.setProperty("--accent-secondary", accent.secondary);
  if (fallbackPalette?.length >= 3) {
    wrapper.style.setProperty("--accent-tertiary", fallbackPalette[2]);
  }
};

// Static series palettes for Space Molly (cycled per series index)
const SPACE_MOLLY_SERIES_PALETTES = [
  ["#a66a6a", "#6e4a4a", "#1f2937"], // muted red
  ["#7a9b7a", "#4e6b4e", "#0f2d24"], // muted green
  ["#708aa6", "#435a6f", "#0b1220"], // muted blue
  ["#8d7fa6", "#5e4f78", "#1e1b4b"], // muted purple
  ["#b08a57", "#7a5d36", "#1f2937"], // muted amber
  ["#6b9a95", "#446c68", "#0a2f2e"], // muted teal
  ["#b57a8d", "#7a5060", "#3b0d1f"], // muted mauve
  ["#b5774e", "#7a4f31", "#2c1a0f"], // muted orange
];

const getSpaceMollyPaletteForSeries = (seriesId) => {
  const idx = state.seriesIndex.findIndex((s) => s.id === seriesId);
  const safeIndex = idx >= 0 ? idx : 0;
  const palette = SPACE_MOLLY_SERIES_PALETTES[safeIndex % SPACE_MOLLY_SERIES_PALETTES.length];
  return palette;
};

const registerMediaWrapper = (seriesId, wrapper, palette) => {
  if (!seriesId) return;
  if (!seriesMediaWrappers.has(seriesId)) {
    seriesMediaWrappers.set(seriesId, new Map());
  }
  seriesMediaWrappers.get(seriesId).set(wrapper, palette);
  const accent = seriesAccentTotals.get(seriesId)?.accent;
  if (accent) {
    applyAccentToWrapper(wrapper, accent, palette);
  }
};

const updateSeriesAccent = (seriesId, color) => {
  if (!seriesId || !color) return;
  let entry = seriesAccentTotals.get(seriesId);
  if (!entry) {
    entry = { total: [0, 0, 0], count: 0, accent: null };
    seriesAccentTotals.set(seriesId, entry);
  }
  entry.total = entry.total.map((sum, idx) => sum + color[idx]);
  entry.count += 1;
  const average = entry.total.map((sum) => Math.round(sum / entry.count));
  entry.accent = {
    primary: rgbToHex(adjustLightness(average, 0.1)),
    secondary: rgbToHex(adjustLightness(average, -0.2))
  };
  const wrappers = seriesMediaWrappers.get(seriesId);
  if (wrappers) {
    wrappers.forEach((storedPalette, wrapper) => applyAccentToWrapper(wrapper, entry.accent, storedPalette));
  }
};

const applyAccentFromImage = (img, seriesId) => {
  // For Space Molly, use static per-series palettes (no image analysis)
  if (state.currentBrand === "space-molly") return;
  const analysis = analyzeImageColors(img);
  if (!analysis) return;
  const { background, average, coverage } = analysis;
  let selected = average;
  if (state.currentBrand === "smiski" && background && coverage > 0.35) {
    selected = background;
  }
  updateSeriesAccent(seriesId, selected);
};

// Fun: party popper burst anchored to an element
const launchPartyPopper = (anchorEl) => {
  if (!anchorEl) return;
  const burst = document.createElement("span");
  burst.className = "tt-popper";
  const emojis = ["🎉", "✨", "🎊", "🌟", "💫", "⭐"]; 
  const pieces = 14;
  for (let i = 0; i < pieces; i += 1) {
    const piece = document.createElement("span");
    piece.className = "tt-popper__piece";
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const angle = Math.random() * Math.PI; // 0..180deg upward fan
    const distance = 24 + Math.random() * 36; // px
    const dx = Math.cos(angle) * distance * (Math.random() < 0.5 ? -1 : 1);
    const dy = -Math.abs(Math.sin(angle) * distance) - 6;
    const rot = (Math.random() * 180 - 90).toFixed(1) + "deg";
    piece.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    piece.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    piece.style.setProperty("--rot", rot);
    piece.style.animationDelay = `${(Math.random() * 0.08).toFixed(2)}s`;
    piece.style.animationDuration = `${(0.6 + Math.random() * 0.4).toFixed(2)}s`;
    burst.appendChild(piece);
  }
  anchorEl.appendChild(burst);
  // Clean up after animation
  window.setTimeout(() => burst.remove(), 1200);
};

// Launch popper on header progress track at current percent
const launchHeaderProgressPopper = () => {
  if (!progressRefs || !progressRefs.fill) return;
  const track = progressRefs.fill.parentElement;
  if (!track) return;
  const percentStr = progressRefs.fill.style.width || "0%";
  const percent = Math.max(0, Math.min(100, parseFloat(percentStr) || 0));
  const anchor = document.createElement("span");
  anchor.className = "tt-popper";
  anchor.style.left = `${percent}%`;
  anchor.style.top = "50%";
  track.appendChild(anchor);
  launchPartyPopper(anchor);
};
const resolveImageSources = (item) => {
  const ordered = [];
  const brandId = state.currentBrand;
  if (brandId === "smiski") {
    const figureSlug = slugify(item.name);
    const seriesToken = getSeriesToken(item.seriesName || "");
    const baseDir = "./assets/images/smiski";
    if (figureSlug && seriesToken) {
      ordered.push(`${baseDir}/${figureSlug}-${seriesToken}.png`);
    }
    if (figureSlug) {
      ordered.push(`${baseDir}/${figureSlug}.png`);
    }
  }

  if (item.image) ordered.push(item.image);

  return Array.from(new Set(ordered)).filter(Boolean);
};

const applyImageSources = (img, sources, { onSuccess, onFail } = {}) => {
  const queue = sources.filter(Boolean);
  if (!queue.length) {
    if (typeof onFail === "function") onFail();
    return;
  }
  let index = 0;
  const onError = () => {
    index += 1;
    if (index >= queue.length) {
      img.removeEventListener("error", onError);
      if (typeof onFail === "function") onFail();
      return;
    }
    img.src = queue[index];
  };
  img.addEventListener("error", onError);
  img.addEventListener(
    "load",
    () => {
      img.removeEventListener("error", onError);
      if (typeof onSuccess === "function") onSuccess(img, queue[index]);
    },
    { once: true }
  );
  img.src = queue[index];
};

const fetchJSON = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return response.json();
};

const loadChecklist = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.entries(parsed).reduce((acc, [key, value]) => {
      if (value === true) {
        acc[key] = true;
      } else if (value && typeof value === "object") {
        acc[key] = Boolean(value.owned);
      }
      return acc;
    }, {});
  } catch (error) {
    console.warn("Unable to read checklist state", error);
    return {};
  }
};

const persistChecklist = () => {
  if (typeof window === "undefined") return;
  try {
    const compact = Object.fromEntries(
      Object.entries(state.checklist).filter(([, owned]) => owned)
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch (error) {
    console.warn("Unable to persist checklist", error);
  }
};

state.checklist = loadChecklist();

const loadPreferences = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    console.warn("Unable to read preferences", error);
    return {};
  }
};

const persistPreferences = () => {
  if (typeof window === "undefined") return;
  try {
    const compact = Object.fromEntries(
      Object.entries(state.preferences).map(([brandId, prefs]) => {
        const clean = Object.fromEntries(
          Object.entries(prefs || {}).filter(([, value]) => value)
        );
        return [brandId, clean];
      }).filter(([, prefs]) => Object.keys(prefs).length)
    );
    if (Object.keys(compact).length) {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(compact));
    } else {
      window.localStorage.removeItem(PREFERENCES_KEY);
    }
  } catch (error) {
    console.warn("Unable to persist preferences", error);
  }
};

const updateBrandPreference = (brandId, key, value) => {
  if (!brandId) return;
  if (!state.preferences[brandId]) state.preferences[brandId] = {};
  if (value) {
    state.preferences[brandId][key] = value;
  } else {
    delete state.preferences[brandId][key];
    if (!Object.keys(state.preferences[brandId]).length) delete state.preferences[brandId];
  }
  persistPreferences();
};

state.preferences = loadPreferences();

const updateChecklist = (itemId, owned) => {
  if (owned) {
    state.checklist[itemId] = true;
  } else {
    delete state.checklist[itemId];
  }
  persistChecklist();
  syncCardState(itemId);
  updateProgress();
  if (state.currentBrand) {
    brandItemCache.delete(state.currentBrand);
  }
};

const hydrateBrandData = (brandMeta, seriesList = []) => {
  const items = [];
  const seriesIndex = [];
  seriesList.forEach((series) => {
    if (!series?.items?.length) return;
    seriesIndex.push({ id: series.id, name: series.name });
    series.items.forEach((item) => {
      items.push({
        ...item,
        seriesId: series.id,
        seriesName: series.name
      });
    });
  });
  return { items, seriesIndex };
};

const buildBrandTile = (brand) => {
  const tile = createElement("a", "tt-brand-card");
  tile.href = `#/brand/${brand.id}`;
  tile.style.setProperty("--brand-accent", brand.accent || "#6366f1");
  tile.style.setProperty("--brand-accent-soft", brand.accentSecondary || "#4338ca");

  const previewUrl = brand.featuredImage || `./assets/brand-previews/${brand.id}.png`;
  const preview = document.createElement("span");
  preview.className = "tt-brand-card__preview";
  preview.style.backgroundImage = `url("${previewUrl}")`;
  tile.appendChild(preview);

  const progressBar = createElement("span", "tt-brand-card__progressFill");
  const progress = createElement("div", "tt-brand-card__progress", [
    createElement("div", "tt-brand-card__progressBar", [progressBar]),
    createElement("span", "tt-brand-card__progressLabel", "0 / 0")
  ]);

  const textChildren = [createElement("h2", "tt-brand-card__title", brand.name)];
  if (brand.tagline) {
    textChildren.push(createElement("p", "tt-brand-card__tagline", brand.tagline));
  }
  const textBlock = createElement("div", "tt-brand-card__text", textChildren);

  const content = createElement("div", "tt-brand-card__content", [
    textBlock,
    progress
  ]);

  tile.appendChild(content);
  updateBrandTileProgress(brand, tile);
  return tile;
};

const getBrandItemIds = async (brand) => {
  if (brandItemCache.has(brand.id)) return brandItemCache.get(brand.id);
  const payload = await ensureBrandData(brand);
  const ids = [];
  (payload.series || []).forEach((series) => {
    (series.items || []).forEach((item) => ids.push(item.id));
  });
  brandItemCache.set(brand.id, ids);
  return ids;
};

const applyBrandTileProgress = (tile, total, owned) => {
  const label = tile.querySelector(".tt-brand-card__progressLabel");
  const fill = tile.querySelector(".tt-brand-card__progressFill");
  if (!label || !fill) return;
  label.textContent = `${owned} / ${total}`;
  const percent = total ? Math.round((owned / total) * 100) : 0;
  fill.style.width = `${percent}%`;
};

const updateBrandTileProgress = async (brand, tile) => {
  applyBrandTileProgress(tile, 0, 0);
  try {
    const ids = await getBrandItemIds(brand);
    const total = ids.length;
    const owned = ids.reduce((sum, id) => sum + (state.checklist[id] ? 1 : 0), 0);
    applyBrandTileProgress(tile, total, owned);
  } catch (error) {
    console.warn("Unable to compute brand progress", error);
  }
};

const buildControls = () => {
  const container = createElement("section", "tt-controls");

  const searchWrapper = createElement("label", "tt-search");
  searchWrapper.innerHTML = `
    <span class="tt-search__label">Search</span>
    <input type="search" placeholder="Search figures or tags" />
  `;
  const searchInput = searchWrapper.querySelector("input");
  searchInput.value = state.search;
  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderGrid();
  });

  const sortWrapper = createElement("label", "tt-select");
  sortWrapper.innerHTML = `
    <span class="tt-select__label">Sort</span>
    <select>
      <option value="default">Default</option>
      <option value="secrets-only">Secrets Only</option>
      <option value="az">A - Z</option>
      <option value="za">Z - A</option>
    </select>
  `;
  const sortSelect = sortWrapper.querySelector("select");
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGrid();
  });

  const seriesWrapper = createElement("label", "tt-select");
  const seriesSelect = document.createElement("select");
  seriesSelect.innerHTML = `<option value="all">All Series</option>`;
  state.seriesIndex.forEach((series) => {
    const option = document.createElement("option");
    option.value = series.id;
    option.textContent = series.name;
    seriesSelect.appendChild(option);
  });
  seriesSelect.value = state.seriesFilter;
  seriesSelect.addEventListener("change", (event) => {
    state.seriesFilter = event.target.value;
    renderGrid();
  });
  seriesWrapper.append(
    createElement("span", "tt-select__label", "Series"),
    seriesSelect
  );

  const controls = [searchWrapper, sortWrapper, seriesWrapper];

  if (state.currentBrand === "space-molly") {
    const limitedWrapper = createElement("label", "tt-filterToggle tt-filterToggle--limited");
    const limitedInput = document.createElement("input");
    limitedInput.type = "checkbox";
    limitedInput.checked = state.showLimited;
    limitedInput.addEventListener("change", (event) => {
      state.showLimited = event.target.checked;
      updateBrandPreference(state.currentBrand, "showLimited", state.showLimited);
      renderGrid();
    });
    limitedWrapper.append(
      limitedInput,
      createElement("span", "tt-filterToggle__text", "Show Limited Editions")
    );
    controls.push(limitedWrapper);
  }

  if (state.currentBrand === "space-molly" || state.currentBrand === "smiski") {
    const secretWrapper = createElement("label", "tt-filterToggle tt-filterToggle--secret");
    const secretInput = document.createElement("input");
    secretInput.type = "checkbox";
    secretInput.checked = state.hideSecrets;
    secretInput.addEventListener("change", (event) => {
      state.hideSecrets = event.target.checked;
      updateBrandPreference(state.currentBrand, "hideSecrets", state.hideSecrets);
      renderGrid();
    });
    secretWrapper.append(
      secretInput,
      createElement("span", "tt-filterToggle__text", "Hide Secret Figures")
    );
    controls.push(secretWrapper);
  }

  container.append(...controls);
  return container;
};

const filterAndSortItems = () => {
  let items = [...state.items];

  if (state.currentBrand === "space-molly" && !state.showLimited) {
    items = items.filter((item) => item.seriesId !== "space-molly-limited-editions");
  }

  if (state.hideSecrets && (state.currentBrand === "space-molly" || state.currentBrand === "smiski")) {
    items = items.filter((item) => !(item.rarity && item.rarity.toLowerCase() === "secret"));
  }

  if (state.seriesFilter !== "all") {
    items = items.filter((item) => item.seriesId === state.seriesFilter);
  }

  if (state.search) {
    const query = state.search;
    items = items.filter((item) => {
      const text = [item.name, item.seriesName, ...(item.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(query);
    });
  }

  const compare = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

  switch (state.sort) {
    case "secrets-only":
      return items
        .filter((item) => item.rarity && item.rarity.toLowerCase() === "secret")
        .sort((a, b) => compare(a.name, b.name));
    case "az":
      return items.sort((a, b) => compare(a.name, b.name));
    case "za":
      return items.sort((a, b) => compare(b.name, a.name));
    default:
      return items;
  }
};

const buildCard = (item) => {
  const card = createElement("article", "tt-card");
  card.dataset.itemId = item.id;
  const palette = state.currentBrand === "space-molly"
    ? getSpaceMollyPaletteForSeries(item.seriesId)
    : (Array.isArray(item.palette) && item.palette.length >= 3
        ? item.palette
        : ["#4f46e5", "#312e81", "#1f2937"]);

  const mediaWrapper = createElement("div", "tt-card__mediaStack");
  mediaWrapper.style.setProperty("--accent-primary", palette[0]);
  mediaWrapper.style.setProperty("--accent-secondary", palette[1]);
  mediaWrapper.style.setProperty("--accent-tertiary", palette[2]);
  registerMediaWrapper(item.seriesId, mediaWrapper, palette);

  const sources = resolveImageSources(item);
  if (sources.length) {
    const figure = createElement("figure", "tt-card__media");
    const img = document.createElement("img");
    img.alt = item.name;
    img.loading = "lazy";
    figure.appendChild(img);
    let loaded = false;
    applyImageSources(img, sources, {
      onSuccess: (imageEl) => {
        loaded = true;
        applyAccentFromImage(imageEl, item.seriesId);
      },
      onFail: () => {
        if (!loaded) {
          figure.remove();
          mediaWrapper.appendChild(
            createElement("span", "tt-card__fallback", item.name.charAt(0).toUpperCase())
          );
        }
      }
    });
    mediaWrapper.appendChild(figure);
  } else {
    mediaWrapper.appendChild(createElement("span", "tt-card__fallback", item.name.charAt(0).toUpperCase()));
  }

  const header = createElement("header", "tt-card__header");
  header.appendChild(createElement("h3", "tt-card__title", item.name));
  if (item.rarity && item.rarity.toLowerCase() === "secret") {
    header.appendChild(createElement("span", "tt-card__badge", "Secret"));
  }

  const meta = createElement("p", "tt-card__meta", item.seriesName || "");

  const checklist = createElement("label", "tt-toggle");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(state.checklist[item.id]);
  // Checkbox wrapper (kept for layout, but effects trigger on header progress)
  const checkWrap = createElement("span", "tt-check");
  checkWrap.appendChild(input);
  input.addEventListener("change", () => {
    updateChecklist(item.id, input.checked);
    if (input.checked) {
      launchHeaderProgressPopper();
    }
  });
  checklist.append(checkWrap, createElement("span", "tt-toggle__text", "I have it"));

  card.append(mediaWrapper, header, meta, checklist);
  syncCardState(item.id, card);
  return card;
};

const syncCardState = (itemId, card) => {
  const target = card || appRoot.querySelector(`.tt-card[data-item-id="${itemId}"]`);
  if (!target) return;
  target.classList.toggle("is-owned", Boolean(state.checklist[itemId]));
};

const buildProgress = (extraClass = "") => {
  const className = ["tt-progress", extraClass].filter(Boolean).join(" ").trim();
  const section = createElement("section", className);
  const ratio = createElement("span", "tt-progress__ratio", "Owned 0 / 0");
  const percent = createElement("span", "tt-progress__percent", "0% logged");
  const row = createElement("div", "tt-progress__row", [ratio, percent]);
  const track = createElement("div", "tt-progress__track");
  const fill = createElement("div", "tt-progress__fill");
  track.appendChild(fill);
  section.append(row, track);
  progressRefs = { ratio, percent, fill };
  return section;
};

const mountHeaderProgress = () => {
  if (!headerProgress) return;
  headerProgress.innerHTML = "";
  const progress = buildProgress("tt-progress--header");
  headerProgress.appendChild(progress);
  headerEl?.classList.add("tt-header--hasProgress");
};

const clearHeaderProgress = () => {
  if (headerProgress) {
    headerProgress.innerHTML = "";
  }
  headerEl?.classList.remove("tt-header--hasProgress");
  progressRefs = null;
};

const updateProgress = () => {
  if (!progressRefs) return;
  let items = [...state.items];
  if (state.currentBrand === "space-molly" && !state.showLimited) {
    items = items.filter((item) => item.seriesId !== "space-molly-limited-editions");
  }
  if (state.hideSecrets && (state.currentBrand === "space-molly" || state.currentBrand === "smiski")) {
    items = items.filter((item) => !(item.rarity && item.rarity.toLowerCase() === "secret"));
  }
  if (state.seriesFilter !== "all") {
    items = items.filter((item) => item.seriesId === state.seriesFilter);
  }
  if (state.search) {
    const query = state.search;
    items = items.filter((item) => {
      const text = [item.name, item.seriesName, ...(item.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(query);
    });
  }
  const total = items.length;
  const owned = items.reduce((sum, item) => sum + (state.checklist[item.id] ? 1 : 0), 0);
  const percent = total ? Math.round((owned / total) * 100) : 0;
  progressRefs.ratio.textContent = `Owned ${owned} / ${total}`;
  progressRefs.percent.textContent = `${percent}% logged`;
  progressRefs.fill.style.width = `${percent}%`;
};

const renderGrid = () => {
  const grid = appRoot.querySelector(".tt-grid");
  if (!grid) return;
  if (state.currentBrand === "smiski") {
    seriesMediaWrappers.clear();
  }
  grid.innerHTML = "";
  const items = filterAndSortItems();
  updateProgress();
  if (!items.length) {
    grid.appendChild(createElement("p", "tt-grid__empty", "No figures match your filters yet."));
    return;
  }
  items.forEach((item) => grid.appendChild(buildCard(item)));
};

const renderLandingView = () => {
  state.view = "landing";
  clearHeaderProgress();
  resetSeriesAccentState();
  appRoot.innerHTML = "";
  if (appRoot) appRoot.removeAttribute("data-brand");
  headerEl?.classList.add("tt-header--landing");
  if (headerSubtitle) headerSubtitle.textContent = "Blind Box Checklists";

  const wrapper = createElement("section", "tt-landing");
  wrapper.append(
    createElement("h1", "tt-landing__title", "Pick a trinket to start tracking"),
    createElement("p", "tt-landing__description", "No logins. No ads. No friction. Your device remembers what you own." )
  );

  // Landing controls: Search + Sort (A–Z / Z–A)
  const controls = createElement("section", "tt-controls");
  // Search
  const searchWrapper = createElement("label", "tt-search");
  searchWrapper.innerHTML = `
    <span class="tt-search__label">Search</span>
    <input type="search" placeholder="Search brands" />
  `;
  const landingSearchInput = searchWrapper.querySelector("input");
  landingSearchInput.value = state.landingSearch;
  landingSearchInput.addEventListener("input", (event) => {
    state.landingSearch = event.target.value.trim().toLowerCase();
    renderLandingView();
  });
  // Sort
  const sortWrapper = createElement("label", "tt-select");
  sortWrapper.innerHTML = `
    <span class="tt-select__label">Sort</span>
    <select>
      <option value="az">A - Z</option>
      <option value="za">Z - A</option>
    </select>
  `;
  const landingSortSelect = sortWrapper.querySelector("select");
  landingSortSelect.value = state.landingSort;
  landingSortSelect.addEventListener("change", (event) => {
    state.landingSort = event.target.value;
    renderLandingView();
  });
  controls.append(searchWrapper, sortWrapper);
  wrapper.appendChild(controls);

  const grid = createElement("div", "tt-landing__grid");
  const brands = getFilteredSortedBrands(state.brands, state.landingSearch, state.landingSort);
  brands.forEach((brand) => {
    const tile = buildBrandTile(brand);
    grid.appendChild(tile);
  });

  wrapper.appendChild(grid);
  appRoot.appendChild(wrapper);
};

const renderBrandView = () => {
  if (!state.brandMeta) {
    renderLandingView();
    return;
  }
  headerEl?.classList.remove("tt-header--landing");
  if (headerSubtitle) headerSubtitle.textContent = state.brandMeta.name;

  appRoot.innerHTML = "";
  resetSeriesAccentState();
  mountHeaderProgress();

  const summary = createElement("section", "tt-brand-summary", [
    createElement("h1", "", state.brandMeta.name),
    createElement("p", "", state.brandMeta.description || "")
  ]);

  const controls = buildControls();
  const grid = createElement("section", "tt-grid");

  appRoot.append(summary, controls, grid);
  renderGrid();
};

const renderErrorView = (message) => {
  clearHeaderProgress();
  resetSeriesAccentState();
  if (appRoot) appRoot.removeAttribute("data-brand");
  headerEl?.classList.add("tt-header--landing");
  if (headerSubtitle) headerSubtitle.textContent = "Blind Box Checklists";
  appRoot.innerHTML = "";
  appRoot.append(
    createElement(
      "section",
      "tt-error",
      `<h2>Checklist offline</h2><p>${message}</p><p><a href="#/" class="tt-error__link">Back to all brands</a></p>`
    )
  );
};

const renderLoadingView = (message = "Loading...") => {
  clearHeaderProgress();
  resetSeriesAccentState();
  if (appRoot) appRoot.removeAttribute("data-brand");
  headerEl?.classList.add("tt-header--landing");
  if (headerSubtitle) headerSubtitle.textContent = "Blind Box Checklists";
  appRoot.innerHTML = "";
  appRoot.append(
    createElement(
      "section",
      "tt-loading",
      `<span class="tt-loading__spinner" aria-hidden="true"></span><p>${message}</p>`
    )
  );
};

const renderRoot = () => {
  if (state.error) {
    renderErrorView(state.error);
    return;
  }
  if (state.view === "loading") {
    renderLoadingView();
    return;
  }
  if (state.view === "brand") {
    renderBrandView();
  } else {
    renderLandingView();
  }
};

const parseRoute = () => {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash || hash === "/") return { view: "landing" };
  const [segment, brandId] = hash.split("/").filter(Boolean);
  if (segment === "brand" && brandId) return { view: "brand", brandId };
  return { view: "landing" };
};

const ensureBrandData = async (entry) => {
  const cached = brandDataCache.get(entry.id);
  if (cached && typeof cached === "object" && cached.series) return cached;
  const payload = await fetchJSON(entry.data);
  brandDataCache.set(entry.id, payload);
  return payload;
};

// Helper: filter by search and sort brands by name
const getFilteredSortedBrands = (brands, search = "", mode = "az") => {
  let list = Array.isArray(brands) ? [...brands] : [];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((b) => {
      const hay = [b.name, b.tagline].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  const compare = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  switch (mode) {
    case "za":
      return list.sort((a, b) => compare(b, a));
    case "az":
    default:
      return list.sort((a, b) => compare(a, b));
  }
};

// Helper: sort brands by name according to selected mode
const getSortedBrands = (brands, mode = "default") => {
  const list = [...brands];
  const compare = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  switch (mode) {
    case "az":
      return list.sort((a, b) => compare(a, b));
    case "za":
      return list.sort((a, b) => compare(b, a));
    default:
      return list; // original order
  }
};

const setBrandFromPayload = (entry, payload) => {
  const brandMeta = { ...(payload.brand || {}), id: entry.id };
  brandMeta.name = brandMeta.name || entry.name;
  brandMeta.description =
    brandMeta.description ||
    "Track minis you own, log wishlists, and keep everything synced to this device with no account needed.";

  const { items, seriesIndex } = hydrateBrandData(brandMeta, payload.series || []);

  state.brandMeta = brandMeta;
  state.items = items;
  state.seriesIndex = seriesIndex;
  state.currentBrand = entry.id;
  if (appRoot) appRoot.setAttribute("data-brand", entry.id);
  state.view = "brand";
  state.seriesFilter = "all";
  state.search = "";
  state.sort = "default";
  const prefs = state.preferences[entry.id] || {};
  state.showLimited = entry.id === "space-molly" ? Boolean(prefs.showLimited) : false;
  state.hideSecrets = Boolean(prefs.hideSecrets);
  state.error = null;
  renderRoot();
};

const handleRouteChange = async () => {
  if (!state.brands.length) return;
  const route = parseRoute();

  if (route.view === "brand" && route.brandId) {
    const entry = state.brands.find((brand) => brand.id === route.brandId);
    if (!entry) {
      state.error = "That brand hasn't been added yet.";
      renderRoot();
      return;
    }
    if (state.currentBrand === entry.id && state.view === "brand") {
      renderRoot();
      return;
    }
    try {
      state.view = "loading";
      renderRoot();
      const payload = await ensureBrandData(entry);
      setBrandFromPayload(entry, payload);
    } catch (error) {
      console.error(error);
      state.error = `We couldn't fetch ${entry.name} right now. Please try again shortly.`;
      renderRoot();
    }
    return;
  }

  state.currentBrand = null;
  state.brandMeta = null;
  state.items = [];
  state.seriesIndex = [];
  state.view = "landing";
  state.error = null;
  renderRoot();
};

const init = async () => {
  try {
    renderLoadingView("Loading brands...");
    const brands = await fetchJSON(BRAND_INDEX_URL);
    state.brands = brands;
    state.view = "landing";
    state.error = null;
    renderRoot();
    window.addEventListener("hashchange", handleRouteChange);
    await handleRouteChange();
  } catch (error) {
    console.error(error);
    state.error = error.message;
    renderRoot();
  }
};

init();














