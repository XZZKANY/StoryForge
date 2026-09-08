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
  await page
    .locator('[data-testid="shell-side-panel"]')
    .waitFor({ state: 'hidden', timeout: 5000 });

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
  const bookActivity = page.locator('[data-testid="activity-book"]');
  if ((await explorerActivity.getAttribute('data-active')) !== 'false') {
    throw new Error('An empty explorer must not appear active while its panel is absent');
  }
  await bookActivity.click();
  await sidePanel.waitFor({ timeout: 5000 });
  if ((await bookActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Expected the book guidance panel to become active');
  }
  await bookActivity.click();
  await sidePanel.waitFor({ state: 'hidden', timeout: 5000 });
  if ((await bookActivity.getAttribute('data-active')) !== 'false') {
    throw new Error('Expected the book activity to become inactive after collapsing');
  }
  await bookActivity.click();
  await sidePanel.waitFor({ timeout: 5000 });
  if ((await bookActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Expected the book activity to become active after restoring');
  }
  await explorerActivity.click();
  await sidePanel.waitFor({ state: 'hidden', timeout: 5000 });

  const narrowPage = await context.newPage();
  collectErrors(narrowPage);
  try {
    await narrowPage.setViewportSize({ width: 1024, height: 768 });
    await narrowPage.goto(url, { waitUntil: 'networkidle' });
    await narrowPage.locator('[data-testid="desktop-shell"]').waitFor({ timeout: 5000 });
    await narrowPage.locator('[data-testid="welcome-workspace"]').waitFor({ timeout: 5000 });
    await narrowPage
      .locator('[data-testid="shell-side-panel"]')
      .waitFor({ state: 'hidden', timeout: 5000 });
    if (await narrowPage.locator('[data-testid="editor-panel"]').count()) {
      throw new Error('Expected no editor panel on the narrow welcome workspace');
    }
    if (await narrowPage.locator('[data-testid="assistant-panel"]').count()) {
      throw new Error('Expected no assistant panel on the narrow welcome workspace');
    }

    // At browser widths below the native Tauri minimum, the titlebar keeps the search icon and
    // window controls inside the viewport instead of letting its fixed desktop slots clip them.
    await narrowPage.setViewportSize({ width: 500, height: 600 });
    await narrowPage.waitForFunction(
      () => {
        const header = document.querySelector('[data-testid="shell-titlebar"]');
        const children = header ? Array.from(header.children) : [];
        const search = children[1];
        const controls = children[2]?.getBoundingClientRect();
        const viewport = window.innerWidth;
        return (
          viewport === 500 &&
          (search ? getComputedStyle(search).display : 'none') !== 'none' &&
          (search?.getBoundingClientRect().width ?? 0) > 0 &&
          (controls?.right ?? Number.POSITIVE_INFINITY) <= viewport + 1 &&
          document.documentElement.scrollWidth <= viewport + 1 &&
          document.body.scrollWidth <= viewport + 1
        );
      },
      { timeout: 5000 },
    );
    const narrowTitlebar = await narrowPage.evaluate(() => {
      const header = document.querySelector('[data-testid="shell-titlebar"]');
      const children = header ? Array.from(header.children) : [];
      const search = children[1]?.getBoundingClientRect();
      const controls = children[2]?.getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        searchDisplay: children[1] ? getComputedStyle(children[1]).display : 'missing',
        searchWidth: search?.width ?? 0,
        controlsRight: controls?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    if (
      narrowTitlebar.documentWidth > narrowTitlebar.viewport + 1 ||
      narrowTitlebar.bodyWidth > narrowTitlebar.viewport + 1 ||
      narrowTitlebar.searchDisplay === 'none' ||
      narrowTitlebar.searchWidth <= 0 ||
      narrowTitlebar.controlsRight > narrowTitlebar.viewport + 1
    ) {
      throw new Error(
        `Narrow titlebar controls overflow viewport: ${JSON.stringify(narrowTitlebar)}`,
      );
    }

    // Settings remains usable below the native window minimum: the desktop sidebar hides,
    // rows stack into one column, and a visible mobile close path remains available.
    await narrowPage.getByTestId('activity-settings').click();
    await narrowPage.getByRole('menuitem', { name: '设置' }).click();
    const narrowSettings = narrowPage.locator('[data-testid="settings-view"]');
    await narrowSettings.waitFor({ timeout: 5000 });
    const narrowSettingsState = await narrowPage.evaluate(() => {
      const settings = document.querySelector('[data-testid="settings-view"]');
      const mobileClose = document.querySelector('[data-testid="settings-close-mobile"]');
      const firstRow = settings?.querySelector('.sf-settings-card > div');
      const firstControl = firstRow?.querySelector('select, input, button');
      const firstLabel = firstRow?.firstElementChild;
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        settingsWidth: settings?.getBoundingClientRect().width ?? 0,
        mobileCloseVisible: mobileClose ? getComputedStyle(mobileClose).display !== 'none' : false,
        firstRowHeight: firstRow?.getBoundingClientRect().height ?? 0,
        firstLabelBottom: firstLabel?.getBoundingClientRect().bottom ?? 0,
        firstControlTop: firstControl?.getBoundingClientRect().top ?? 0,
      };
    });
    if (
      narrowSettingsState.documentWidth > narrowSettingsState.viewport + 1 ||
      narrowSettingsState.bodyWidth > narrowSettingsState.viewport + 1 ||
      narrowSettingsState.settingsWidth > narrowSettingsState.viewport + 1 ||
      !narrowSettingsState.mobileCloseVisible ||
      narrowSettingsState.firstControlTop < narrowSettingsState.firstLabelBottom
    ) {
      throw new Error(
        `Narrow settings layout is not usable: ${JSON.stringify(narrowSettingsState)}`,
      );
    }
    await narrowPage.getByTestId('settings-close-mobile').click();
    await narrowPage
      .locator('[data-testid="settings-view"]')
      .waitFor({ state: 'hidden', timeout: 5000 });
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

  // The observation panel is inserted before the status bar. Its disclosure path must move
  // focus into the new panel, then return focus to the status-bar trigger when it closes.
  const observationTrigger = page.locator('[data-testid="status-obs"]');
  await observationTrigger.click();
  await page.locator('[data-testid="obs-panel"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-obs"]')?.getAttribute('aria-expanded') ===
        'true' &&
      document.querySelector('[data-testid="status-obs"]')?.getAttribute('aria-controls') ===
        'obs-panel' &&
      document.activeElement?.getAttribute('aria-label') === '关闭观测面板',
    { timeout: 5000 },
  );
  await page.locator('[data-testid="obs-panel"] [aria-label="关闭观测面板"]').click();
  await page.locator('[data-testid="obs-panel"]').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="status-obs"]')?.getAttribute('aria-expanded') ===
        'false' && document.activeElement?.getAttribute('data-testid') === 'status-obs',
    { timeout: 5000 },
  );

  // 900px is the narrowest desktop layout we support with all three workspace columns visible.
  // The center editor must yield width before the right Agent panel gets clipped off-screen.
  await page.setViewportSize({ width: 900, height: 700 });
  // `setViewportSize` resolves before the flex layout has necessarily committed. Wait for the
  // actual post-resize geometry so this gate cannot sample the previous 1280px/1024px layout.
  await page.waitForFunction(
    () => {
      const assistant = document
        .querySelector('[data-testid="assistant-panel"]')
        ?.getBoundingClientRect();
      const viewport = window.innerWidth;
      return (
        viewport === 900 &&
        document.documentElement.scrollWidth <= viewport + 1 &&
        document.body.scrollWidth <= viewport + 1 &&
        Boolean(assistant) &&
        (assistant?.right ?? Number.POSITIVE_INFINITY) <= viewport + 1
      );
    },
    { timeout: 5000 },
  );
  const narrowWorkspace = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      center: rect('[data-testid="shell-center"]'),
      assistant: rect('[data-testid="assistant-panel"]'),
    };
  });
  const assistantRight = narrowWorkspace.assistant?.right ?? 0;
  if (
    narrowWorkspace.documentWidth > narrowWorkspace.viewport + 1 ||
    narrowWorkspace.bodyWidth > narrowWorkspace.viewport + 1 ||
    assistantRight > narrowWorkspace.viewport + 1
  ) {
    throw new Error(
      `Narrow project workspace overflows viewport: ${JSON.stringify(narrowWorkspace)}`,
    );
  }

  // Below the supported three-column minimum, a project would leave the editor unusably narrow.
  // The responsive state keeps the activity rail and editor, with both side workspaces available
  // again through their titlebar/activity controls.
  await page.setViewportSize({ width: 899, height: 700 });
  await page.waitForFunction(
    () =>
      window.innerWidth === 899 &&
      !document.querySelector('[data-testid="shell-side-panel"]') &&
      document.querySelector('[data-testid="assistant-panel"]')?.hasAttribute('hidden') &&
      (document.querySelector('[data-testid="shell-center"]')?.getBoundingClientRect().width ??
        0) >=
        window.innerWidth - 48 - 1 &&
      document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      document.body.scrollWidth <= window.innerWidth + 1,
    { timeout: 5000 },
  );
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForFunction(
    () =>
      window.innerWidth === 900 &&
      Boolean(document.querySelector('[data-testid="shell-side-panel"]')) &&
      !document.querySelector('[data-testid="assistant-panel"]')?.hasAttribute('hidden') &&
      (document.querySelector('[data-testid="assistant-panel"]')?.getBoundingClientRect().right ??
        Number.POSITIVE_INFINITY) <=
        window.innerWidth + 1,
    { timeout: 5000 },
  );
  await page.setViewportSize({ width: 600, height: 700 });
  await page.waitForFunction(
    () => {
      const center = document
        .querySelector('[data-testid="shell-center"]')
        ?.getBoundingClientRect();
      const assistant = document.querySelector('[data-testid="assistant-panel"]');
      return (
        window.innerWidth === 600 &&
        !document.querySelector('[data-testid="shell-side-panel"]') &&
        assistant?.hasAttribute('hidden') &&
        (center?.width ?? 0) >= window.innerWidth - 48 - 1 &&
        document.documentElement.scrollWidth <= window.innerWidth + 1 &&
        document.body.scrollWidth <= window.innerWidth + 1
      );
    },
    { timeout: 5000 },
  );

  // A user can explicitly reopen Agent while compact. Its flex item must shrink inside the
  // remaining viewport instead of being clipped beyond the activity rail at 320/360px.
  await page.locator('[data-testid="titlebar-toggle-right"]').click();
  await page.waitForFunction(
    () => {
      const assistant = document
        .querySelector('[data-testid="assistant-panel"]')
        ?.getBoundingClientRect();
      return (
        window.innerWidth === 600 &&
        !document.querySelector('[data-testid="assistant-panel"]')?.hasAttribute('hidden') &&
        Boolean(assistant) &&
        (assistant?.width ?? 0) > 0 &&
        (assistant?.left ?? Number.NEGATIVE_INFINITY) >= 0 &&
        (assistant?.right ?? Number.POSITIVE_INFINITY) <= window.innerWidth + 1
      );
    },
    { timeout: 5000 },
  );
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForFunction(
      (expectedWidth) => {
        const assistant = document
          .querySelector('[data-testid="assistant-panel"]')
          ?.getBoundingClientRect();
        return (
          window.innerWidth === expectedWidth &&
          !document.querySelector('[data-testid="assistant-panel"]')?.hasAttribute('hidden') &&
          Boolean(assistant) &&
          (assistant?.width ?? 0) > 0 &&
          (assistant?.left ?? Number.NEGATIVE_INFINITY) >= 0 &&
          (assistant?.right ?? Number.POSITIVE_INFINITY) <= expectedWidth + 1 &&
          document.documentElement.scrollWidth <= expectedWidth + 1 &&
          document.body.scrollWidth <= expectedWidth + 1
        );
      },
      width,
      { timeout: 5000 },
    );
    if (width === 320) {
      await page.locator('[data-testid="conversation-session-switch"]').click();
      const sessionMenu = page.locator('[data-testid="conversation-header"] [role="menu"]');
      await sessionMenu.waitFor({ timeout: 5000 });
      const sessionMenuBounds = await sessionMenu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: bounds.width };
      });
      if (sessionMenuBounds.left < -1 || sessionMenuBounds.right > width + 1) {
        throw new Error(
          `Compact session menu overflows viewport: ${JSON.stringify({ width, ...sessionMenuBounds })}`,
        );
      }
      await page.keyboard.press('Escape');
      await sessionMenu.waitFor({ state: 'hidden', timeout: 5000 });
      await page.evaluate(() => {
        window.dispatchEvent(
          new window.CustomEvent('storyforge:toast', {
            detail: { message: '窄屏通知边界 smoke', tone: 'info', durationMs: 10000 },
          }),
        );
      });
      const toastHost = page.locator('[data-testid="toast-host"]');
      await toastHost.waitFor({ timeout: 5000 });
      await page.waitForFunction(
        () => {
          const host = document
            .querySelector('[data-testid="toast-host"]')
            ?.getBoundingClientRect();
          return (
            Boolean(host) &&
            (host?.left ?? -1) >= 0 &&
            (host?.right ?? Infinity) <= window.innerWidth + 1
          );
        },
        { timeout: 5000 },
      );
      await toastHost.locator('[data-testid="toast-close"]').click();
      await toastHost.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(
    () =>
      window.innerWidth === 1280 &&
      Boolean(document.querySelector('[data-testid="shell-side-panel"]')) &&
      !document.querySelector('[data-testid="assistant-panel"]')?.hasAttribute('hidden') &&
      document.querySelector('[data-testid="desktop-shell"]')?.getAttribute('data-layout-focus') ===
        'balanced',
    { timeout: 5000 },
  );

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
