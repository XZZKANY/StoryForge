import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { createServer } from 'vite';

/* global Request, Response */

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.__STORYFORGE_MOCK_FS__ = {
      listDir: () => [],
      pathExists: () => true,
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      if (requestUrl.endsWith('/health/ready')) {
        return new Response(JSON.stringify({ status: 'ready', checks: { database: 'ok' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.includes('/api/assistant/sessions')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.endsWith('/api/agent-runs/roles')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.endsWith('/api/ide/commands/observatory.scan')) {
        return new Response(JSON.stringify({ payload: { observatory: {} } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  });

  const errors = [];
  const collectErrors = (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        if (text !== 'Canceled') errors.push(text);
      }
    });
    page.on('pageerror', (error) => {
      if (error.message !== 'Canceled') errors.push(error.message);
    });
  };

  const page = await context.newPage();
  collectErrors(page);

  await page.goto(url, { waitUntil: 'networkidle' });
  const shell = page.locator('[data-testid="desktop-shell"]');
  const welcome = page.locator('[data-testid="welcome-workspace"]');
  await shell.waitFor({ timeout: 5000 });
  await welcome.waitFor({ timeout: 5000 });
  await page.locator('[data-testid="explorer-empty"]').waitFor({ timeout: 5000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  const requiredText = ['StoryForge', '启动', '上手', '打开项目'];
  const missingText = requiredText.filter((text) => !bodyText.includes(text));

  if (title !== 'StoryForge IDE') {
    throw new Error(`Unexpected page title: ${title}`);
  }
  if (missingText.length > 0) {
    throw new Error(`Missing smoke text: ${missingText.join(', ')}`);
  }
  if ((await shell.getAttribute('data-layout-mode')) !== 'explorer') {
    throw new Error('Expected the explorer view on initial load');
  }
  if ((await shell.getAttribute('data-layout-focus')) !== 'balanced') {
    throw new Error('Expected the balanced layout focus on initial load');
  }
  if (await page.locator('[data-testid="editor-panel"]').count()) {
    throw new Error('Expected no editor panel before a project is opened');
  }
  if (await page.locator('[data-testid="assistant-panel"]').count()) {
    throw new Error('Expected no assistant panel before a project is opened');
  }

  const welcomeBox = await welcome.boundingBox();
  if (!welcomeBox || welcomeBox.width <= 500 || welcomeBox.height <= 400) {
    throw new Error('Expected welcome workspace to fill the main work area');
  }
  const visualTone = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="welcome-workspace"]');
    const composer = document
      .querySelector('[data-testid="welcome-composer-input"]')
      ?.closest('div');
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
    throw new Error(
      `Expected welcome workspace to avoid near-black empty screen tones: ${JSON.stringify(visualTone)}`,
    );
  }

  await page.locator('[data-testid="welcome-close"]').click();
  await page.locator('[data-testid="welcome-dismissed"]').waitFor({ timeout: 5000 });
  await welcome.waitFor({ state: 'hidden', timeout: 5000 });
  if (await page.locator('[data-testid="editor-panel"]').count()) {
    throw new Error('Closing the welcome page must not fabricate an editor without a project');
  }
  if (await page.locator('[data-testid="assistant-panel"]').count()) {
    throw new Error('Closing the welcome page must not fabricate an assistant without a project');
  }

  const sidePanel = page.locator('[data-testid="shell-side-panel"]');
  const explorerActivity = page.locator('[data-testid="activity-explorer"]');
  await sidePanel.waitFor({ timeout: 5000 });
  if ((await explorerActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Expected the explorer activity to start active');
  }
  await explorerActivity.click();
  await sidePanel.waitFor({ state: 'hidden', timeout: 5000 });
  if ((await explorerActivity.getAttribute('data-active')) !== 'false') {
    throw new Error('Expected the explorer activity to become inactive after collapsing');
  }
  await explorerActivity.click();
  await sidePanel.waitFor({ timeout: 5000 });
  if ((await explorerActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Expected the explorer activity to become active after restoring');
  }

  const narrowPage = await context.newPage();
  collectErrors(narrowPage);
  try {
    await narrowPage.setViewportSize({ width: 1040, height: 720 });
    await narrowPage.goto(url, { waitUntil: 'networkidle' });
    await narrowPage.locator('[data-testid="desktop-shell"]').waitFor({ timeout: 5000 });
    await narrowPage.locator('[data-testid="welcome-workspace"]').waitFor({ timeout: 5000 });
    await narrowPage.locator('[data-testid="explorer-empty"]').waitFor({ timeout: 5000 });
    if (await narrowPage.locator('[data-testid="editor-panel"]').count()) {
      throw new Error('Expected no editor panel on the narrow welcome workspace');
    }
    if (await narrowPage.locator('[data-testid="assistant-panel"]').count()) {
      throw new Error('Expected no assistant panel on the narrow welcome workspace');
    }
  } finally {
    await narrowPage.close();
  }

  await page.waitForFunction(() => typeof window.__STORYFORGE_SMOKE__?.openProject === 'function');
  await page.evaluate((path) => {
    window.__STORYFORGE_SMOKE__?.openProject(path);
  }, smokeProjectPath);

  await page.locator('[data-testid="file-tree-panel"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="editor-panel"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="assistant-panel"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="file-list"]')?.getAttribute('data-project-path') ===
      path,
    smokeProjectPath,
    { timeout: 5000 },
  );
  if ((await shell.getAttribute('data-layout-focus')) !== 'balanced') {
    throw new Error('Expected opening a project to enter the balanced editor/assistant layout');
  }
  if (await page.locator('[data-testid="welcome-workspace"]').count()) {
    throw new Error('Expected the welcome workspace to leave after opening a project');
  }
  if (await page.locator('[data-testid="welcome-dismissed"]').count()) {
    throw new Error('Expected the dismissed welcome placeholder to leave after opening a project');
  }

  await page.waitForLoadState('networkidle');
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
