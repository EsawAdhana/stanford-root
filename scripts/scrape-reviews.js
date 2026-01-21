const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Show the browser so you can log in
    defaultViewport: null, // Use full window size
    args: ['--start-maximized'] // Start maximized
  });

  const page = await browser.newPage();

  // Enable request interception to see what the site is fetching
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    request.continue();
  });

  // Function to inject into a specific page/frame
  const injectIntoPage = async (targetPage) => {
    try {
        await targetPage.exposeFunction('savePageData', ({ html, text, url }) => {
            const timestamp = Date.now();
            console.log(`\n📄 CAPTURING DATA from: ${url}`);
            const htmlFilename = `scrape-dump-${timestamp}.html`;
            fs.writeFileSync(htmlFilename, html);
            console.log(`   > HTML saved to: ${htmlFilename}`);
            const textFilename = `scrape-dump-${timestamp}.txt`;
            fs.writeFileSync(textFilename, text);
            console.log(`   > Text saved to: ${textFilename}`);
            console.log('---------------------------------------------------');
        }).catch(() => {}); // Ignore if already exposed

        const frames = targetPage.frames();
        for (const frame of frames) {
            await frame.evaluate(() => {
                if (document.getElementById('scraper-btn')) return;
                const btn = document.createElement('button');
                btn.id = 'scraper-btn';
                btn.innerText = '⬇️ DUMP';
                btn.style.position = 'fixed';
                btn.style.bottom = '20px';
                btn.style.right = '20px';
                btn.style.zIndex = '2147483647';
                btn.style.padding = '10px';
                btn.style.backgroundColor = '#b1040e'; 
                btn.style.color = 'white';
                btn.style.border = '2px solid white';
                btn.style.borderRadius = '8px';
                btn.style.cursor = 'pointer';
                btn.onclick = async () => {
                    btn.innerText = '⏳';
                    const html = document.documentElement.outerHTML;
                    const text = document.body.innerText;
                    await window.savePageData({ html, text, url: window.location.href });
                    btn.innerText = '✅';
                };
                document.body.appendChild(btn);
            }).catch(() => {});
        }
    } catch (e) {}
  };

  // Watch for NEW tabs/windows
  browser.on('targetcreated', async (target) => {
      const newPage = await target.page();
      if (newPage) {
          console.log('🆕 New tab detected! Injecting button...');
          // Keep trying to inject into the new tab
          setInterval(() => injectIntoPage(newPage), 2000);
      }
  });

  // Initial injection for the first page
  setInterval(() => injectIntoPage(page), 2000);

  console.log('👉 Navigating to https://stanford.evaluationkit.com/Respondent');
  console.log('⚠️  PLEASE LOG IN MANUALLY IN THE BROWSER WINDOW');
  console.log('👉 Once logged in, navigate to a review page and click the red "DUMP PAGE DATA" button.');
  
  await page.goto('https://stanford.evaluationkit.com/Respondent', {
    waitUntil: 'networkidle2',
    timeout: 0 
  });
  
  // No initial call needed, setInterval handles it

  // Keep the script running so you can browse
  // Close the browser manually or press Ctrl+C in terminal to stop
})();
