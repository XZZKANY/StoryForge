const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  const views = [
    ['assistant', 'StoryForge Assistant'],
    ['new-project', 'Blueprint 全书编排'],
    ['projects', 'Studio 创作工作台'],
    ['artifacts', 'Artifacts 制品治理'],
    ['customize', 'Customize 创作偏好'],
  ];
  const results = [];
  for (const [view, text] of views) {
    await page.goto(`http://127.0.0.1:3000/?view=${view}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 });
    const metrics = await page.evaluate(() => ({
      url: location.href,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyText: document.body.innerText.slice(0, 500),
    }));
    if (metrics.scrollWidth > metrics.width + 1) {
      throw new Error(`${view} 出现横向溢出：${metrics.scrollWidth} > ${metrics.width}`);
    }
    results.push({ view, url: metrics.url, contains: text, width: metrics.width, scrollWidth: metrics.scrollWidth });
  }
  const unexpectedErrors = errors.filter((message) => !message.includes('Failed to load resource'));
  if (unexpectedErrors.length > 0) {
    throw new Error(`浏览器 console error: ${unexpectedErrors.join('\n')}`);
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

