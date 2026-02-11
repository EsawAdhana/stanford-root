const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE_URL = 'https://bulletin.stanford.edu';
const PROGRAMS_URL = `${BASE_URL}/programs?KhCQH=Undergraduate&page=1&pq=`;
const OUTPUT_FILE = 'stanford_majors_data.json';

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function scrape() {
    console.log('Starting Scrape Phase 2 (Robust Mode)...');

    let existingData = [];
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            console.log(`Loaded ${existingData.length} existing records.`);
        } catch (e) {
            console.log('Could not parse existing data, starting fresh.');
        }
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Refresh Majors List if needed
    let majors = existingData.map(m => ({ name: m.name, link: m.link, description: m.description }));

    const TARGET_URLS = [
        'https://bulletin.stanford.edu/programs?KhCQH=Undergraduate&page=1&pq=',
        'https://bulletin.stanford.edu/programs?coterm=true&KhCQH=Graduate&page=1&pq='
    ];

    // If we have significantly fewer than the expected count (approx 151 undergrad + 50 coterm), refresh
    if (majors.length < 200) {
        console.log('Refreshing programs list (Undergraduate + Graduate Coterm)...');
        majors = []; // Start fresh list to ensure correct merging

        for (const url of TARGET_URLS) {
            console.log(`Scanning URL: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2' });

            let hasNextPage = true;
            let pageCount = 1;

            while (hasNextPage) {
                console.log(`  Scanning page ${pageCount}...`);
                try {
                    await page.waitForSelector('.program-card', { timeout: 10000 });
                } catch (e) {
                    if (await page.title() === 'Human Verification') {
                        console.error('BLOCKED BY WAF on programs list. Stopping.');
                        await browser.close();
                        return;
                    }
                    break;
                }

                const newMajors = await page.evaluate(() => {
                    const cards = Array.from(document.querySelectorAll('.program-card'));
                    return cards.map(card => ({
                        name: card.querySelector('h3')?.innerText.trim(),
                        link: card.getAttribute('href'),
                        description: card.querySelector('p')?.innerText.trim()
                    }));
                });

                if (newMajors.length === 0) break;

                // Simple deduplication
                newMajors.forEach(nm => {
                    if (!majors.some(m => m.link === nm.link)) {
                        majors.push(nm);
                    }
                });

                const nextButton = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button, a'));
                    return buttons.find(b => b.textContent.includes('Next') || b.getAttribute('aria-label') === 'Next page');
                });

                if (!nextButton) break;
                const isDisabled = await page.evaluate(el => el.disabled || el.classList.contains('disabled'), nextButton);
                if (isDisabled) break;

                const currentFirstMajor = newMajors[0].name;
                await nextButton.click();
                try {
                    await page.waitForFunction(n => document.querySelector('.program-card h3')?.innerText.trim() !== n, { timeout: 10000 }, currentFirstMajor);
                    pageCount++;
                    await sleep(2000 + Math.random() * 2000);
                } catch (e) { break; }
            }
        }
        console.log(`Total programs identified: ${majors.length}`);
    }

    // 2. Process Missing or Failed Majors
    let finalData = [...existingData];

    // Ensure all majors from list are in finalData (even if shell)
    majors.forEach(m => {
        if (!finalData.some(fd => fd.link === m.link)) {
            finalData.push({ ...m, requirements: {} });
        }
    });


    for (let i = 0; i < finalData.length; i++) {
        const major = finalData[i];

        // Skip if we already have valid data
        if (major.requirements && Object.keys(major.requirements).length > 0 && !major.error) {
            continue;
        }

        console.log(`[${i + 1}/${finalData.length}] Scraping requirements for ${major.name}...`);

        try {
            await page.goto(`${BASE_URL}${major.link}`, { waitUntil: 'networkidle2' });

            if (await page.title() === 'Human Verification') {
                console.error('BLOCKED BY WAF. Stopping to save progress.');
                break;
            }

            // 0. Detect and Click "Degree Requirements" tab if it exists and isn't active
            const tabClicked = await page.evaluate(async () => {
                const tabs = Array.from(document.querySelectorAll('.nav-link, button.nav-item'));
                const reqTab = tabs.find(t => t.innerText.trim().toLowerCase().includes('degree requirements'));
                if (reqTab && !reqTab.classList.contains('active')) {
                    reqTab.click();
                    return true;
                }
                return false;
            });

            if (tabClicked) {
                console.log('  Clicked Degree Requirements tab, waiting for load...');
                await new Promise(r => setTimeout(r, 2000)); // Wait for potential dynamic load
            }

            // Scroll to bottom to trigger any lazy loading
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    let distance = 100;
                    let timer = setInterval(() => {
                        let scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // Greedy Requirements Extraction
            const requirements = await page.evaluate(() => {
                const res = {};

                // A. Check for "Redirect" text (Sub-plans)
                const mainContent = document.querySelector('main, .main-content, #main-content')?.innerText || "";
                if (mainContent.includes('Please take a look at this program for complete degree requirements')) {
                    const link = document.querySelector('main a[href*="/programs/"], .main-content a[href*="/programs/"]')?.getAttribute('href');
                    if (link) {
                        res["_redirect"] = {
                            message: "Sub-plan: See main program requirements",
                            link: link
                        };
                        return res;
                    }
                }

                // 1. Try Accordions (Common for Engineering/Sciences)
                const accordions = document.querySelectorAll('.accordion-button, [data-bs-toggle="collapse"], .collapse-trigger');
                if (accordions.length > 0) {
                    accordions.forEach(acc => {
                        const title = acc.innerText.trim();
                        // Try to find the associated panel
                        let panel = null;
                        const controls = acc.getAttribute('aria-controls') || acc.getAttribute('data-bs-target')?.replace('#', '');
                        if (controls) panel = document.getElementById(controls);
                        if (!panel) panel = acc.nextElementSibling; // Fallback to next sibling

                        if (panel && title && title.length > 3) {
                            res[title] = {
                                fullText: panel.innerText.trim(),
                                courses: Array.from(panel.querySelectorAll('button.link, a[href*="/courses/"]')).map(b => b.innerText.trim())
                            };
                        }
                    });
                }

                // 2. Try Fallback (Humanities/Social Sciences / Math - Headers and lists)
                // We look for sections that contain requirements if accordions didn't capture enough
                const sections = Array.from(document.querySelectorAll('section, .mb-8, .p-block, .tab-pane.active, .program-section'));
                sections.forEach(sect => {
                    const header = sect.querySelector('h2, h3, h4');
                    const headerText = header ? header.innerText.trim() : "";
                    const lowerText = headerText.toLowerCase();
                    const isRequirement = lowerText.includes('requirement') ||
                        lowerText.includes('curriculum') ||
                        lowerText.includes('specialization') ||
                        lowerText.includes('core') ||
                        lowerText.includes('elective') ||
                        lowerText.includes('capstone') ||
                        lowerText.includes('wim') ||
                        lowerText.includes('honors') ||
                        lowerText.includes('foundation');

                    if (isRequirement && headerText.length > 3) {
                        if (!res[headerText]) {
                            res[headerText] = {
                                fullText: sect.innerText.trim(),
                                courses: Array.from(sect.querySelectorAll('button.link, a[href*="/courses/"]')).map(b => b.innerText.trim())
                            };
                        }
                    }
                });


                // 3. Last resort: If still empty, try to find any list that looks like requirements
                if (Object.keys(res).length === 0) {
                    const probableContainers = document.querySelectorAll('.tab-pane.active, main, #main-content');
                    probableContainers.forEach(container => {
                        const headers = container.querySelectorAll('h2, h3, h4');
                        headers.forEach(h => {
                            const hText = h.innerText.trim();
                            if (hText.length > 5 && (hText.includes('Requirement') || hText.includes('Course'))) {
                                let content = "";
                                let next = h.nextElementSibling;
                                while (next && !['H2', 'H3', 'H4'].includes(next.tagName)) {
                                    content += next.innerText + "\n";
                                    next = next.nextElementSibling;
                                }
                                res[hText] = {
                                    fullText: content.trim(),
                                    courses: Array.from(h.parentElement.querySelectorAll('button.link, a[href*="/courses/"]')).map(b => b.innerText.trim())
                                };
                            }
                        });
                    });
                }

                return res;
            });



            major.requirements = requirements;
            major.error = null;
            major.lastScraped = new Date().toISOString();

            // Save after every successful major to be safe
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));

        } catch (err) {
            console.error(`  Error: ${err.message}`);
            major.error = err.message;
            major.lastScraped = new Date().toISOString();
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));
        }

        // Variable delay (4-7 seconds to be extra safe since we hit WAF)
        await sleep(4000 + Math.random() * 3000);
    }

    console.log('Scrape complete or interrupted.');
    await browser.close();
}

scrape();
