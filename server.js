const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Enable stealth mode
puppeteer.use(StealthPlugin());

const app = express();

app.use(cors());
app.use(express.json());

// Create browser instance (singleton pattern)
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
  }
  return browser;
}

// Close browser on exit
process.on('exit', async () => {
  if (browser) await browser.close();
});

// Search 1337x for magnet link using Puppeteer
async function search1337x(title, quality = '1080') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    const searchQuery = encodeURIComponent(`${title} ${quality}`);
    const searchUrl = `https://1337x.to/search/${searchQuery}/1/`;
    
    console.log(`[1337x] Navigating: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Wait for table to load
    await page.waitForSelector('table.table-list tbody tr', { timeout: 10000 });
    
    // Get first torrent link
    const firstTorrentLink = await page.evaluate(() => {
      const row = document.querySelector('table.table-list tbody tr');
      if (!row) return null;
      const link = row.querySelector('td.name a[href^="/torrent/"]');
      return link ? link.getAttribute('href') : null;
    });
    
    if (!firstTorrentLink) {
      throw new Error('No torrent found in search results');
    }
    
    const detailUrl = `https://1337x.to${firstTorrentLink}`;
    console.log(`[1337x] Navigating detail: ${detailUrl}`);
    
    await page.goto(detailUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Get magnet link
    const magnetLink = await page.evaluate(() => {
      const magnetLink = document.querySelector('a[href^="magnet:"]');
      return magnetLink ? magnetLink.getAttribute('href') : null;
    });
    
    if (!magnetLink) {
      throw new Error('No magnet link found on detail page');
    }
    
    console.log('[1337x] Magnet link found');
    return magnetLink;
  } catch (error) {
    console.error('[1337x] Failed:', error.message);
    throw error;
  } finally {
    await page.close();
  }
}

// Search The Pirate Bay for magnet link using Puppeteer
async function searchThePirateBay(title, quality = '1080') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    const searchQuery = encodeURIComponent(`${title} ${quality}`);
    const searchUrl = `https://thepiratebay.org/search.php?q=${searchQuery}`;
    
    console.log(`[ThePirateBay] Navigating: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Wait for search results
    await page.waitForSelector('ol#searchResult li, .list-entry, .search-item', { 
      timeout: 10000 
    });
    
    // Get first result magnet link
    const magnetLink = await page.evaluate(() => {
      // Try different selectors for TPB
      const selectors = [
        'ol#searchResult li:first-child a[href^="magnet:"]',
        '.list-entry:first-child a[href^="magnet:"]',
        '.search-item:first-child a[href^="magnet:"]',
        'a[href^="magnet:"]'
      ];
      
      for (const selector of selectors) {
        const link = document.querySelector(selector);
        if (link) return link.getAttribute('href');
      }
      return null;
    });
    
    if (!magnetLink) {
      throw new Error('No magnet link found');
    }
    
    console.log('[ThePirateBay] Magnet link found');
    return magnetLink;
  } catch (error) {
    console.error('[ThePirateBay] Failed:', error.message);
    throw error;
  } finally {
    await page.close();
  }
}

// Search YTS for magnet link using Puppeteer
async function searchYTS(title, quality = '1080') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    const searchQuery = encodeURIComponent(title);
    const searchUrl = `https://yts.mx/browse-movies/${searchQuery}/all/all/0/latest/0/all`;
    
    console.log(`[YTS] Navigating: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Wait for movie results
    await page.waitForSelector('.browse-movie-wrap, .movie-item', { 
      timeout: 10000 
    });
    
    // Click first movie
    const movieLink = await page.evaluate(() => {
      const movie = document.querySelector('.browse-movie-wrap a, .movie-item a');
      return movie ? movie.getAttribute('href') : null;
    });
    
    if (!movieLink) {
      throw new Error('No movie found');
    }
    
    const movieUrl = movieLink.startsWith('http') ? movieLink : `https://yts.mx${movieLink}`;
    console.log(`[YTS] Navigating movie: ${movieUrl}`);
    
    await page.goto(movieUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Get magnet link for specified quality
    const magnetLink = await page.evaluate((targetQuality) => {
      const qualityOptions = document.querySelectorAll('.modal-quality, .quality-size');
      for (const option of qualityOptions) {
        if (option.textContent.includes(targetQuality)) {
          const magnetBtn = option.closest('.modal-content, .download-torrent')?.querySelector('a[href^="magnet:"]');
          if (magnetBtn) return magnetBtn.getAttribute('href');
        }
      }
      // Fallback: get first magnet link
      const firstMagnet = document.querySelector('a[href^="magnet:"]');
      return firstMagnet ? firstMagnet.getAttribute('href') : null;
    }, quality);
    
    if (!magnetLink) {
      throw new Error('No magnet link found for quality');
    }
    
    console.log('[YTS] Magnet link found');
    return magnetLink;
  } catch (error) {
    console.error('[YTS] Failed:', error.message);
    throw error;
  } finally {
    await page.close();
  }
}

// Try multiple providers until one succeeds (30 second timeout each)
async function searchTorrent(title, quality = '1080') {
  const providers = [
    { name: '1337x', fn: search1337x },
    { name: 'ThePirateBay', fn: searchThePirateBay },
    { name: 'YTS', fn: searchYTS }
  ];
  
  for (const provider of providers) {
    try {
      console.log(`Trying provider: ${provider.name}`);
      
      // Create promise with 30 second timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`${provider.name} timeout`)), 30000)
      );
      
      const magnetPromise = provider.fn(title, quality);
      
      // Race between function and timeout
      const magnet = await Promise.race([magnetPromise, timeoutPromise]);
      
      console.log(`Success with ${provider.name}`);
      return magnet;
    } catch (error) {
      console.log(`${provider.name} failed: ${error.message}, trying next...`);
      continue;
    }
  }
  
  throw new Error('All torrent providers failed');
}

// Real-Debrid torrent flow (CORRECT)
async function getDebridStream(magnet, rdKey) {
  try {
    // Step 1: Add magnet to Real-Debrid
    const addRes = await axios.post(
      'https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
      new URLSearchParams({ magnet: magnet }),
      { headers: { Authorization: `Bearer ${rdKey}` } }
    );
    const torrentId = addRes.data.id;
    console.log('Torrent added, ID:', torrentId);
    
    // Step 2: Wait for torrent info (max 10 seconds)
    let infoRes;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      infoRes = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
        { headers: { Authorization: `Bearer ${rdKey}` } }
      );
      if (infoRes.data.status === 'waiting_files_selection') break;
      if (infoRes.data.status === 'downloaded') break;
    }
    
    if (!infoRes || !infoRes.data.files || infoRes.data.files.length === 0) {
      throw new Error('No files found in torrent');
    }
    
    // Step 3: Select the largest file (usually the movie)
    const files = infoRes.data.files;
    const largestFile = files.reduce((a, b) => a.bytes > b.bytes ? a : b);
    
    await axios.post(
      `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
      new URLSearchParams({ files: largestFile.id.toString() }),
      { headers: { Authorization: `Bearer ${rdKey}` } }
    );
    console.log('File selected:', largestFile.path);
    
    // Step 4: Wait for torrent to finish downloading (poll up to 60 seconds)
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusRes = await axios.get(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
        { headers: { Authorization: `Bearer ${rdKey}` } }
      );
      
      if (statusRes.data.status === 'downloaded') {
        // Get the download link from the torrent info
        const downloadLink = statusRes.data.links[0];
        if (!downloadLink) throw new Error('No download link available');
        
        // Step 5: Unrestrict the link (get direct .m3u8)
        const unrestrictRes = await axios.post(
          'https://api.real-debrid.com/rest/1.0/unrestrict/link',
          new URLSearchParams({ link: downloadLink }),
          { headers: { Authorization: `Bearer ${rdKey}` } }
        );
        
        return unrestrictRes.data.download;
      }
    }
    
    throw new Error('Torrent download timed out');
    
  } catch (error) {
    console.error('Real-Debrid error:', error.response?.data || error.message);
    throw new Error('Debrid service failed');
  }
}

// Stream endpoint
app.get('/stream', async (req, res) => {
  const { title, quality = '1080' } = req.query;
  
  if (!title) {
    return res.status(400).json({ error: 'Movie title is required' });
  }
  
  try {
    console.log(`Searching for: ${title} ${quality}`);
    
    // Step 1: Get magnet link
    const magnet = await searchTorrent(title, quality);
    console.log('Magnet found');
    
    // Step 2: Send to Real-Debrid
    const rdKey = process.env.REAL_DEBRID_API_KEY;
    if (!rdKey) {
      throw new Error('REAL_DEBRID_API_KEY not set');
    }
    
    const streamUrl = await getDebridStream(magnet, rdKey);
    console.log('Stream URL generated');
    
    res.json({ url: streamUrl });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(404).json({ error: 'Stream not available', message: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Ghost Stream API is running', version: '1.0' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
