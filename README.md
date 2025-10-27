# Trinket Tracker

A web-based price tracking application for collectible blind box figures.

## Project Structure

```
trinkettracker/
├── assets/              # Frontend assets (JS, CSS, images)
│   ├── app.js          # Main application logic
│   ├── style.css       # Stylesheets
│   ├── images/         # Figure images by brand
│   └── brand-previews/ # Brand preview images
├── data/               # JSON data files
│   ├── brands.json     # Brand metadata
│   ├── *-mercari-prices.json  # Scraped price data
│   ├── scraped-prices.json  # Aggregated prices for app
│   └── *.json         # Individual brand data files
├── scrapers/          # Price scraping scripts
│   ├── scrape-duckoo-prices.js
│   ├── scrape-mercari-nyota.js
│   ├── scrape-nyota-prices.js
│   ├── scrape-oipippi-prices.js
│   ├── scrape-skullpanda-prices.js
│   ├── scrape-smiski-prices.js
│   └── scrape-space-molly-prices.js
├── scripts/           # Utility scripts
│   └── updaters/      # Price update scripts
│       ├── update-duckoo-prices.js
│       ├── update-nyota-prices.js
│       ├── update-skullpanda-prices.js
│       ├── update-smiski-prices.js
│       └── update-space-molly-prices.js
├── index.html         # Main page
├── price-guide.html   # Price guide page
└── package.json       # Dependencies

```

## Usage

### Running Scrapers

Scrapers collect market prices from Mercari and save them to `data/*-mercari-prices.json`:

```bash
# Run a scraper in headless mode
node scrapers/scrape-smiski-prices.js --headless
node scrapers/scrape-skullpanda-prices.js --headless
node scrapers/scrape-space-molly-prices.js --headless
node scrapers/scrape-duckoo-prices.js --headless
node scrapers/scrape-oipippi-prices.js --headless
```

### Updating Prices

After scraping, run the update scripts to merge prices into `scraped-prices.json`:

```bash
node scripts/updaters/update-smiski-prices.js
node scripts/updaters/update-skullpanda-prices.js
node scripts/updaters/update-space-molly-prices.js
node scripts/updaters/update-duckoo-prices.js
node scripts/updaters/update-nyota-prices.js
```

## Scraper Features

- **Strict Filtering**: All item name words must match to prevent false positives
- **Bundle Detection**: Automatically filters out multi-item bundles
- **Outlier Removal**: Uses IQR method to remove price outliers
- **Secret Handling**: Automatically adds "Secret" keyword for rare items
- **Dual Search Strategy**: Falls back to simpler searches if initial search yields few results
- **Series Validation**: Ensures numbered series match correctly

## Dependencies

- `playwright` - Web scraping and browser automation
- Node.js 14+

## Installation

```bash
npm install
```

## Supported Brands

- Smiski
- SkullPanda
- MEGA SPACE MOLLY
- Duckoo
- Nyota
- Oipippi
