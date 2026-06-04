const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: err.message }));
  await page.goto('http://127.0.0.1:3000/?view=assistant', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    body: document.body ? document.body.innerText.slice(0, 2000) : null,
    html: document.documentElement.outerHTML.slice(0, 1000),
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  console.log(JSON.stringify({ data, logs }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
