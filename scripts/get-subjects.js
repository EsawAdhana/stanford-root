const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  
  // Go to page
  await page.goto('https://navigator.stanford.edu/classes', { waitUntil: 'networkidle0' });

  // Evaluate page to find subject/department list
  // Usually in a sidebar or dropdown.
  // We can look for checkboxes or text that looks like subject codes (CS, AA, etc)
  
  // Or check if the Next.js data (self.__next_f) contains the list of facets!
  
  const content = await page.content();
  console.log(content); // Output is too large, let's process it in browser context
  
  // Try to find the facets in the Redux store or Next.js data
  // Inspecting the previous HTML dump, I didn't see a huge list.
  
  await browser.close();
})();
