import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 0, strictPort: false },
});

let browser;

try {
  await server.listen();
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#open-project-btn').waitFor({ timeout: 5000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();

  const requiredText = ['项目', '打开', 'AI 交互'];
  const missingText = requiredText.filter((text) => !bodyText.includes(text));

  if (title !== 'StoryForge IDE') {
    throw new Error(`Unexpected page title: ${title}`);
  }
  if (missingText.length > 0) {
    throw new Error(`Missing smoke text: ${missingText.join(', ')}`);
  }
  if (errors.length > 0) {
    throw new Error(`Console errors:\n${errors.join('\n')}`);
  }

  console.log(`Desktop frontend smoke passed: ${url}`);
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
}
