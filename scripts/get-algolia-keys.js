const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log('Navigating to Navigator...');

  // Enable request interception
  await page.setRequestInterception(true);

  let keysFound = false;

  page.on('request', request => {
    const url = request.url();
    
    // Check headers
    const headers = request.headers();
    let appId = headers['x-algolia-application-id'];
    let apiKey = headers['x-algolia-api-key'];

    // Check query params if not in headers
    if (!appId || !apiKey) {
        try {
             // Sometimes in query string
             const u = new URL(url);
             if (u.searchParams.get('x-algolia-application-id')) appId = u.searchParams.get('x-algolia-application-id');
             if (u.searchParams.get('x-algolia-api-key')) apiKey = u.searchParams.get('x-algolia-api-key');
        } catch(e) {}
    }

    // Check POST body (common for search queries)
    if ((!appId || !apiKey) && request.method() === 'POST') {
        const postData = request.postData();
        if (postData) {
            try {
                const json = JSON.parse(postData);
                // Sometimes strictly in JSON body? Rare for appId but possible
            } catch(e) {
                // query string in body?
            }
        }
    }

    if (appId && apiKey) {
        if (!keysFound) {
            console.log('KEYS_FOUND');
            // Extract index name from URL usually: .../1/indexes/INDEX_NAME/query
            const match = url.match(/\/1\/indexes\/([^\/]+)/);
            const indexName = match ? match[1] : 'UNKNOWN';
            
            console.log(JSON.stringify({ appId, apiKey, indexName, url }));
            keysFound = true;
        }
    }
    
    // Log potential matches
    if (url.includes('algolia') && !keysFound) {
       // console.log('Potential Algolia Request:', url);
    }

    request.continue();
  });

  try {
      await page.goto('https://navigator.stanford.edu/classes', { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait a bit for JS to fire requests
      await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (e) {
      console.error('Error:', e.message);
  }

  await browser.close();
})();
