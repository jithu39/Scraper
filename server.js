// Load environment variables
try { require('dotenv').config(); } catch (e) { /* optional */ }

const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_FILE = 'uoh_alumni_data.csv';
const JSON_FILE = 'data/results.json';

// Global state
let globalBrowser = null;
let globalScrapedData = [];
let isScraping = false;
let shouldStopScraping = false;
let pendingDataToSave = []; // Batch data to save incrementally

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories
const dataDir = 'data';
const screenshotsDir = 'screenshots';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, 'name,degree,company,gradYear,location\n');

// Graceful shutdown
async function handleShutdown() {
  console.log('\n\nSTOPPING SCRIPT (Ctrl+C detected)...');
  if (globalScrapedData.length > 0) {
    console.log(`Saving ${globalScrapedData.length} profiles to CSV...`);
    saveToCSV(globalScrapedData);
  } else {
    console.log('No data collected.');
  }
  if (globalBrowser) {
    console.log('Closing browser...');
    await globalBrowser.close();
  }
  console.log('Goodbye!');
  process.exit(0);
}
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// API Routes
app.get('/api/results', (req, res) => {
  try {
    const file = CSV_FILE;
    if (!fs.existsSync(file)) return res.json({ results: [] });
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');
    
    if (lines.length < 2) return res.json({ results: [] });
    
    // Parse CSV manually (header is first line)
    const headers = lines[0].split(',').map(h => h.trim());
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Simple CSV parsing (handle quoted values)
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.replace(/^"|"$/g, ''));
      
      if (values.length === headers.length) {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = values[idx] || '';
        });
        if (obj.name && obj.name !== 'Unknown') {
          results.push(obj);
        }
      }
    }
    
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read CSV' });
  }
});

app.post('/api/scrape', async (req, res) => {
  if (isScraping) return res.status(400).json({ message: 'Scraping in progress.' });

  const email = req.body?.LOGIN_EMAIL || process.env.LOGIN_EMAIL;
  const password = req.body?.LOGIN_PASSWORD || process.env.LOGIN_PASSWORD;

  try {
    console.log('--- Starting Scrape ---');
    isScraping = true;
    shouldStopScraping = false;
    globalScrapedData = [];
    pendingDataToSave = [];
    
    // Clear CSV file and reinitialize with header
    fs.writeFileSync(CSV_FILE, 'name,degree,company,gradYear,location\n');
    console.log('CSV file cleared.');

    const data = await scrapeAlumniData(email, password);

    // Final deduplication before saving
    const seenKeys = new Set();
    const dedupedData = [];
    for (const item of data) {
      const key = `${item.name}|${item.degree}|${item.gradYear}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        dedupedData.push(item);
      }
    }

    // Save only to CSV
    if (dedupedData.length > 0) saveToCSV(dedupedData);

    const countMsg = dedupedData.length === data.length 
      ? `Scraped ${dedupedData.length} alumni profiles.` 
      : `Scraped ${data.length} profiles, saved ${dedupedData.length} after removing ${data.length - dedupedData.length} duplicates.`;

    res.json({ success: true, count: dedupedData.length, output: countMsg });
  } catch (error) {
    console.error('Fatal Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    isScraping = false;
  }
});

app.post('/api/stop', (req, res) => {
  console.log('Stop requested by user...');
  shouldStopScraping = true;
  res.json({ success: true, message: 'Stop signal sent.' });
});

// Core scraper
async function scrapeAlumniData(email, password) {
  const globalUniqueSet = new Set();
  let page = null;

  try {
    console.log('Launching browser...');
    
    // Find Chrome executable
    const chromePaths = [
      process.env.CHROME_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
    let chromePath = null;
    for (const p of chromePaths) {
      if (p && fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    }
    if (!chromePath) {
      throw new Error('No Chrome/Chromium found. Set CHROME_PATH env var.');
    }
    console.log('Using Chrome at:', chromePath);

    globalBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      defaultViewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
    });

    page = await globalBrowser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36');

    const membersUrl = process.env.UOH_ALUMNI_URL || 'https://alumni.uohyd.ac.in/members';

    // Login if credentials provided
    if (email && password) {
      await loginToPortal(page, membersUrl, email, password);
    } else {
      await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    }

    // Get category selectors
    const categorySelector = '[ng-click*="select_in_level"]';
    try {
      await page.waitForSelector(categorySelector, { timeout: 10000 });
    } catch (e) {
      console.log('No categories found. Attempting direct scrape...');
      const directData = await extractAlumniFromPage(page, 'Default', null);
      directData.forEach(p => {
        const uniqueKey = `${p.name}_${p.degree}`;
        if (!globalUniqueSet.has(uniqueKey)) {
          globalUniqueSet.add(uniqueKey);
          globalScrapedData.push(p);
          pendingDataToSave.push(p); // Add to pending for incremental save
        }
      });
      saveIncrementalData(); // Save immediately
      return globalScrapedData;
    }

    const initialCount = (await page.$$(categorySelector)).length;
    console.log(`Found ${initialCount} categories. Starting extraction...`);

    // Main loop through categories (years)
    for (let i = 0; i < initialCount; i++) {
      // Check if user requested stop
      if (shouldStopScraping) {
        console.log('Scraping stopped by user.');
        break;
      }

      try {
        // Check page health
        if (page.isClosed()) throw new Error('Page closed');

        // Re-query elements to avoid stale references
        await ensureCategoryListLoaded(page, categorySelector);
        const freshCategories = await page.$$(categorySelector);
        if (!freshCategories[i]) {
          console.warn(`Category ${i} not found.`);
          continue;
        }

        // Extract category name (year)
        let catName = await page.evaluate(el => el.textContent.trim(), freshCategories[i]);
        catName = catName.replace(/MemberMembers/gi, '').replace(/\d+\s*Members?/i, '').replace(/\s+/g, ' ').trim();
        const yearMatch = catName.match(/\b(19|20)\d{2}\b/);
        const yearFromCategory = yearMatch ? yearMatch[0] : null;

        console.log(`\n[${i + 1}/${initialCount}] Processing: ${catName}`);

        // Click category
        await page.evaluate(el => el.click(), freshCategories[i]);
        await sleep(3000);

        // Check for subcategories (degrees)
        const subCatSelector = '[ng-click*="count_obj2.key"]';
        let hasDegrees = false;
        try {
          await page.waitForSelector(subCatSelector, { timeout: 3000 });
          hasDegrees = true;
        } catch (e) {
          // Retry once
          const retryCategories = await page.$$(categorySelector);
          if (retryCategories[i]) {
            await page.evaluate(el => el.click(), retryCategories[i]);
            await sleep(4000);
            try {
              await page.waitForSelector(subCatSelector, { timeout: 3000 });
              hasDegrees = true;
            } catch (err) {}
          }
        }

        if (!hasDegrees) {
          // Case 1: Direct list (no degree folders)
          await autoScroll(page);
          const directProfiles = await extractAlumniFromPage(page, catName, yearFromCategory);
          let added = 0;
          directProfiles.forEach(p => {
            const uniqueKey = `${p.name}_${p.degree}`;
            if (!globalUniqueSet.has(uniqueKey)) {
              globalUniqueSet.add(uniqueKey);
              globalScrapedData.push(p);
              pendingDataToSave.push(p); // Add to pending for incremental save
              added++;
            }
          });
          console.log(`   > Captured ${added} profiles directly.`);
          saveIncrementalData(); // Save immediately
        } else {
          // Case 2: Folders (degrees)
          const subCatsCount = (await page.$$(subCatSelector)).length;
          console.log(`   > Found ${subCatsCount} degree folders.`);

          for (let j = 0; j < subCatsCount; j++) {
            try {
              await page.waitForSelector(subCatSelector, { timeout: 10000 });
              const freshSubCats = await page.$$(subCatSelector);
              if (!freshSubCats[j]) continue;

              let degreeName = await page.evaluate(el => el.innerText.trim().split('\n')[0], freshSubCats[j]);
              if (!degreeName || !isNaN(parseInt(degreeName))) degreeName = `Degree ${degreeName}`;

              await page.evaluate(el => el.click(), freshSubCats[j]);
              await sleep(3000);
              await autoScroll(page);

              const newProfiles = await extractAlumniFromPage(page, degreeName, yearFromCategory);
              let added = 0;
              newProfiles.forEach(p => {
                const uniqueKey = `${p.name}_${p.degree}`;
                if (!globalUniqueSet.has(uniqueKey)) {
                  globalUniqueSet.add(uniqueKey);
                  globalScrapedData.push(p);
                  pendingDataToSave.push(p); // Add to pending for incremental save
                  added++;
                }
              });
              console.log(`     > [${j + 1}/${subCatsCount}] ${degreeName}: Added ${added} profiles.`);
              saveIncrementalData(); // Save immediately after each degree

              // Go back
              await page.goBack();
              await waitForNetworkIdle(page, 1500);
            } catch (err) {
              console.error(`Error on degree ${j}: ${err.message}`);
            }
          }
        }

        // Reset to main page
        await page.goto(membersUrl, { waitUntil: 'networkidle2' });
      } catch (err) {
        console.error(`Error on category ${i}: ${err.message}`);
        const fatalErrors = ['Detached Frame', 'Target closed', 'Session closed', 'Page closed'];
        if (fatalErrors.some(msg => err.message.includes(msg))) {
          console.log('!!! Dead page detected. Recovering...');
          try {
            if (page) await page.close().catch(() => {});
            page = await globalBrowser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36');
            if (email && password) {
              await loginToPortal(page, membersUrl, email, password);
            } else {
              await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 90000 });
            }
            console.log('Recovery complete.');
          } catch (recoveryErr) {
            console.error('FATAL: Could not recover.', recoveryErr);
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('Fatal Scraper Error:', error);
  } finally {
    if (globalBrowser) await globalBrowser.close();
  }

  return globalScrapedData;
}

// Helper functions
async function ensureCategoryListLoaded(page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
  } catch (e) {
    const membersUrl = process.env.UOH_ALUMNI_URL || 'https://alumni.uohyd.ac.in/members';
    await page.goto(membersUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector(selector, { timeout: 20000 });
  }
}

async function loginToPortal(page, membersUrl, email, password) {
  console.log('Logging in...');
  await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 90000 });
  try {
    // Email
    await page.waitForSelector('#email', { visible: true, timeout: 30000 });
    await page.type('#email', email, { delay: 100 });
    const emailBtn = await page.$('#emailBtn');
    if (emailBtn) await page.evaluate(el => el.click(), emailBtn);

    // Password
    await page.waitForSelector('#passwordLogin', { visible: true, timeout: 30000 });
    await sleep(2000);
    await page.type('#passwordLogin', password, { delay: 100 });

    // Submit
    const loginBtn = await page.$('button.ladda-button-primary') || await page.$('button[type="submit"]');
    if (loginBtn) {
      await Promise.all([
        page.evaluate(el => el.click(), loginBtn),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {})
      ]);
      console.log('Login successful.');
    } else {
      throw new Error('Login button not found');
    }
  } catch (e) {
    console.error('Login failed:', e.message);
    await page.screenshot({ path: 'screenshots/login_error.png' });
    throw e;
  }
}

async function extractAlumniFromPage(page, degree, explicitYear = null) {
  const primarySelector = '.maximize-width.border-box.padding-12';
  const fallbackSelector = '.member-card, div[ng-repeat*="member"]';

  let cards = await page.$$(primarySelector);
  if (cards.length === 0) cards = await page.$$(fallbackSelector);

  const pageResults = [];
  const seenOnPage = new Set();

  const IGNORE_NAMES = ['Settings', 'Menu', 'Filter', 'Sort', 'Logout', 'Unknown', 'Telugu', 'Computer Science'];

  for (const card of cards) {
    try {
      const data = await page.evaluate((el, deg, defaultYear) => {
        const text = el.innerText || '';
        if (text.length < 3) return null;

        // Name
        let name = 'Unknown';
        const nameEl = el.querySelector('a.link-detail, h3, h4');
        if (nameEl) name = nameEl.innerText.trim();
        else name = text.split('\n')[0].trim();

        // Degree
        let detectedDegree = '';
        const degreeKeywords = [
          'Ph.D', 'Doctor', 'M.Tech', 'Master of Technology', 'MCA', 'Master of Computer Applications',
          'M.Sc', 'Master of Science', 'M.A', 'Master of Arts', 'Integrated', '5-year', 'Systems Biology',
          'Bachelor', 'B.Tech', 'MBA', 'Hospital', 'Health Care'
        ];

        const lines = text.split('\n');
        for (let line of lines) {
          if (degreeKeywords.some(kw => line.includes(kw) || line.toLowerCase().includes(kw.toLowerCase()))) {
            detectedDegree = line.trim();
            break;
          }
        }
        const finalDegree = detectedDegree.length > 2 ? detectedDegree : deg;

        // Location
        let loc = '';
        const locEl = el.querySelector('.location, .designation, .overflow-ellipsis');
        if (locEl) loc = locEl.innerText.trim();
        else {
          const filteredLines = lines.filter(l => l !== name && !l.includes('Connect') && l.length > 2 && l !== detectedDegree);
          if (filteredLines.length > 0) loc = filteredLines[0];
        }

        // Year
        let year = 'Unknown';
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = yearMatch[0];
        else if (defaultYear) year = defaultYear;

        return { name, degree: finalDegree, company: loc, gradYear: year, location: loc };
      }, card, degree, explicitYear);

      if (data && !IGNORE_NAMES.includes(data.name) && !data.name.includes('Member') && data.name !== degree && data.name.length > 2) {
        if (!seenOnPage.has(data.name)) {
          seenOnPage.add(data.name);
          pageResults.push(data);
        }
      }
    } catch (e) {}
  }

  return pageResults;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 150;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight || totalHeight > 30000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function saveToCSV(data) {
  try {
    const rows = data.map(r => [
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.degree || '').replace(/"/g, '""')}"`,
      `"${(r.company || '').replace(/"/g, '""')}"`,
      `"${(r.gradYear || '').replace(/"/g, '""')}"`,
      `"${(r.location || '').replace(/"/g, '""')}"`
    ].join(','));
    
    // Check if file exists and has content (to avoid duplicate headers)
    const fileExists = fs.existsSync(CSV_FILE);
    const fileContent = fileExists ? fs.readFileSync(CSV_FILE, 'utf8').trim() : '';
    
    if (!fileExists || fileContent === '' || fileContent === 'name,degree,company,gradYear,location') {
      // File is empty or doesn't exist, write with header
      fs.writeFileSync(CSV_FILE, 'name,degree,company,gradYear,location\n' + rows.join('\n') + '\n');
    } else {
      // File has data, append without header
      fs.appendFileSync(CSV_FILE, rows.join('\n') + '\n');
    }
    console.log(`Appended ${data.length} rows to CSV.`);
  } catch (e) {
    console.error('Failed to save CSV:', e.message);
  }
}

// Save data incrementally as it's scraped (called frequently)
function saveIncrementalData() {
  if (pendingDataToSave.length > 0) {
    const batch = pendingDataToSave.splice(0, pendingDataToSave.length); // Take all pending
    saveToCSV(batch);
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForNetworkIdle(page, ms = 1000) {
  try {
    await page.waitForNetworkIdle({ timeout: 5000 });
  } catch (e) {
    await sleep(ms);
  }
}

// Start server
app.listen(PORT, () => console.log(`\nServer running at http://localhost:${PORT}`));
