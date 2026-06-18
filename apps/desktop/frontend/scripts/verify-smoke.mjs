import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 0, strictPort: false },
});

let browser;
let smokeProjectPath;

try {
  smokeProjectPath = await mkdtemp(join(tmpdir(), 'storyforge-smoke-'));
  await server.listen();
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (text !== 'Canceled') errors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    if (error.message !== 'Canceled') errors.push(error.message);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="add-project-btn"]').waitFor({ timeout: 5000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();

  const requiredText = ['项目库', '暂无项目'];
  const missingText = requiredText.filter((text) => !bodyText.includes(text));

  if (title !== 'StoryForge IDE') {
    throw new Error(`Unexpected page title: ${title}`);
  }
  if (missingText.length > 0) {
    throw new Error(`Missing smoke text: ${missingText.join(', ')}`);
  }
  await page.locator('[data-testid="add-project-btn"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="toggle-project-library"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="project-library-list"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="toggle-project-library"]').click();
  await page.locator('[data-testid="project-library-list"]').waitFor({ state: 'hidden', timeout: 5000 });
  await page.locator('[data-testid="toggle-project-library"]').click();
  await page.locator('[data-testid="project-library-list"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="dynamic-ide-layout"]').waitFor({ timeout: 5000 });

  const initialState = await page.locator('[data-testid="dynamic-ide-layout"]').getAttribute('data-layout-state');
  if (initialState !== 'conversation-full') {
    throw new Error(`Expected welcome layout without an open file, got: ${initialState}`);
  }

  await page.locator('[data-testid="welcome-workspace"]').waitFor({ timeout: 5000 });
  if (await page.locator('[data-testid="editor-panel"]').count() !== 0) {
    throw new Error('Expected editor panel to be hidden until a file is opened');
  }
  if (await page.locator('[data-testid="assistant-panel"]').count() !== 0) {
    throw new Error('Expected assistant panel to be merged into the welcome workspace until a file is opened');
  }

  const welcomeBox = await page.locator('[data-testid="welcome-workspace"]').boundingBox();
  if (!welcomeBox || welcomeBox.width <= 500 || welcomeBox.height <= 400) {
    throw new Error('Expected welcome workspace to fill the main work area');
  }
  const visualTone = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="welcome-workspace"]');
    const composer = document.querySelector('[data-testid="welcome-workspace"] textarea[aria-label="Agent 输入"]')?.closest('div');
    const rgb = (element) => {
      if (!element) return null;
      const match = getComputedStyle(element).backgroundColor.match(/\d+/g);
      return match ? match.slice(0, 3).map(Number) : null;
    };
    return {
      workspace: rgb(workspace),
      composer: rgb(composer),
    };
  });
  const tooDark = (rgb) => !rgb || rgb.every((channel) => channel <= 24);
  if (tooDark(visualTone.workspace) || tooDark(visualTone.composer)) {
    throw new Error(`Expected welcome workspace to avoid near-black empty screen tones: ${JSON.stringify(visualTone)}`);
  }

  await page.locator('[data-testid="welcome-show-workbench"]').click();
  await page.locator('[data-testid="assistant-panel"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="file-tree-panel"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="editor-panel"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="assistant-panel"] textarea[aria-label="Agent 输入"]').waitFor({ timeout: 5000 });
  if (await page.getByText('Agent 可以接管一次作者闭环').count() !== 0) {
    throw new Error('Expected split assistant panel to keep the composer home UI, not the old checklist empty state');
  }
  const expandedState = await page.locator('[data-testid="dynamic-ide-layout"]').getAttribute('data-layout-state');
  if (expandedState !== 'split') {
    throw new Error(`Expected split layout after showing workbench, got: ${expandedState}`);
  }

  const narrowPage = await browser.newPage({ viewport: { width: 1040, height: 720 } });
  try {
    await narrowPage.goto(url, { waitUntil: 'networkidle' });
    await narrowPage.locator('[data-testid="dynamic-ide-layout"]').waitFor({ timeout: 5000 });
    const narrowState = await narrowPage.locator('[data-testid="dynamic-ide-layout"]').getAttribute('data-layout-state');
    if (narrowState !== 'conversation-full') {
      throw new Error(`Expected welcome layout on narrow viewport, got: ${narrowState}`);
    }
    await narrowPage.locator('[data-testid="welcome-workspace"]').waitFor({ timeout: 5000 });
  } finally {
    await narrowPage.close();
  }

  await page.evaluate((path) => {
    window.__STORYFORGE_SMOKE__?.openProject(path);
  }, smokeProjectPath);
  await page.locator('[data-testid="project-library-list"] button[title]').first().waitFor({ timeout: 5000 });
  await page.locator('[title="展开会话"]').first().click();
  await page.locator('[data-testid="project-session-list"]').waitFor({ timeout: 5000 });
  await page.getByText('暂无会话').waitFor({ timeout: 5000 });
  await page.locator('[title="新建会话"]').first().waitFor({ timeout: 5000 });

  if (errors.length > 0) {
    throw new Error(`Console errors:\n${errors.join('\n')}`);
  }

  console.log(`Desktop frontend smoke passed: ${url}`);
} finally {
  if (browser) {
    await browser.close();
  }
  if (smokeProjectPath) {
    await rm(smokeProjectPath, { recursive: true, force: true });
  }
  await server.close();
}
