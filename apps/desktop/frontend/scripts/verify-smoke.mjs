import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { createServer } from 'vite';

/* global Request, Response */

const server = await createServer({
  configFile: 'vite.config.ts',
  envFile: false,
  define: {
    'import.meta.env.VITE_STORYFORGE_API_BASE_URL': JSON.stringify(
      'http://storyforge-smoke.invalid',
    ),
    'import.meta.env.VITE_STORYFORGE_API_KEY': JSON.stringify('smoke-fixture-key'),
  },
  server: { port: 0, strictPort: false },
});

let browser;
let smokeProjectPath;

try {
  smokeProjectPath = await mkdtemp(join(tmpdir(), 'storyforge-smoke-'));
  await server.listen();
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  });
  await context.addInitScript((projectPath) => {
    window.__STORYFORGE_MOCK_FS__ = {
      readFile: (path) => {
        throw new Error(`ENOENT: no such file or directory: ${path}`);
      },
      listDir: () => [],
      pathExists: (path) =>
        path.replaceAll('\\', '/').replace(/\/+$/, '') === projectPath.replaceAll('\\', '/'),
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      const json = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const parsedUrl = new URL(requestUrl, window.location.href);
      const requestPath = parsedUrl.pathname;
      const rejectRequest = () => {
        const message = `Unexpected browser smoke request: ${requestPath}`;
        window.__STORYFORGE_UNEXPECTED_REQUESTS__ = [
          ...(window.__STORYFORGE_UNEXPECTED_REQUESTS__ ?? []),
          message,
        ];
        console.error(message);
        throw new Error(message);
      };
      const method = (
        init.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const isApi = requestPath.startsWith('/api/') || requestPath.startsWith('/health/');
      if (isApi && parsedUrl.origin !== 'http://storyforge-smoke.invalid') rejectRequest();
      const body =
        isApi && method === 'POST'
          ? JSON.parse(init.body ?? (input instanceof Request ? await input.clone().text() : '{}'))
          : {};
      const args = body.args ?? {};
      if (
        requestPath.startsWith('/api/ide/commands/') &&
        (method !== 'POST' || args.project_root !== projectPath || args.current_file)
      )
        rejectRequest();
      if (requestPath === '/api/agent-runs/knowledge-proposals/refresh') {
        if (method !== 'POST' || body.project_root !== projectPath) rejectRequest();
        return json({ items: [], pending_count: 0 });
      }
      if (requestPath === '/api/ide/commands/book.context') {
        return json({
          command_id: 'book.context',
          status: 'accepted',
          audit_event_id: null,
          payload: {
            title: '读取作品底座',
            category: 'Manuscript',
            writes: false,
            args,
            book_context: {
              chapters: [],
              total_chapters: 0,
              total_estimated_chars: 0,
              current_relative_path: null,
              current_ordinal: null,
              skeleton: [],
              skeleton_total: 0,
              skeleton_limit: 12,
              roster: [],
              roster_declared_total: 0,
              roster_limit: 20,
              dossier_relative_path: null,
              previous_chapter: null,
              prompt_block: null,
            },
          },
        });
      }
      if (requestPath === '/api/ide/commands/observatory.scan') {
        return json({
          command_id: 'observatory.scan',
          status: 'accepted',
          audit_event_id: null,
          payload: {
            title: '重扫世界线观测镜',
            category: 'Canon',
            writes: false,
            args,
            // Synthetic projection for rendering only; backend checkers are not executed here.
            observatory: {
              version: 2,
              observations: [],
              counts: { error: 0, warning: 0, advisory: 0, total: 0 },
              checkers: [],
              entities: [],
              generated_at: '2026-09-27T00:00:00Z',
              promises: { current_chapter: 0, ledger: [] },
              proposals: {
                available: false,
                new_entities: [],
                new_invariants: {},
                pending_count: 0,
              },
            },
          },
        });
      }
      if (requestPath === '/api/agent-runs/writeback-recovery') {
        if (
          method !== 'GET' ||
          parsedUrl.searchParams.get('project_path') !== projectPath ||
          parsedUrl.searchParams.get('after_id') !== '0' ||
          parsedUrl.searchParams.get('limit') !== '20'
        )
          rejectRequest();
        return json({ items: [], next_after_id: null });
      }
      if (requestPath === '/api/assistant/sessions') {
        if (method !== 'GET' || parsedUrl.searchParams.get('project_path') !== projectPath)
          rejectRequest();
        return json([]);
      }

      if (requestPath === '/health/ready') {
        if (method !== 'GET') rejectRequest();
        return new Response(
          JSON.stringify({
            status: 'ready',
            app_version: 'smoke-fixture',
            checks: { db: 'ok', redis: 'skipped' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (isApi || parsedUrl.origin !== window.location.origin) {
        rejectRequest();
      }
      return originalFetch(input, init);
    };
  }, smokeProjectPath);

  const errors = [];
  await context.route('**/*', async (route) => {
    const requested = new URL(route.request().url());
    if (
      requested.origin === new URL(url).origin &&
      !requested.pathname.startsWith('/api/') &&
      !requested.pathname.startsWith('/health/')
    )
      return route.continue();
    errors.push(`Blocked non-fixture network request: ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
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
  const library = page.getByTestId('project-library');
  await shell.waitFor({ timeout: 5000 });
  await library.waitFor({ timeout: 5000 });
  await page
    .locator('[data-testid="shell-side-panel"]')
    .waitFor({ state: 'hidden', timeout: 5000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  const requiredText = ['StoryForge', '作品库', '打开本地作品', '新建作品'];
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

  if ((await shell.getAttribute('data-main-surface')) !== 'library') {
    throw new Error('Expected the project library on initial load');
  }
  const libraryBox = await library.boundingBox();
  if (!libraryBox || libraryBox.width <= 500 || libraryBox.height <= 400) {
    throw new Error('Expected the project library to fill the main work area');
  }
  // 当前深色画布允许 near-black；核对真实主题 token，而非要求退役欢迎页配色。
  const themeMatches = await library.evaluate((element) => {
    const channels = getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim()
      .split(/\s+/);
    return (
      channels.length === 3 &&
      getComputedStyle(element).backgroundColor === `rgb(${channels.join(', ')})`
    );
  });
  if (!themeMatches) throw new Error('Project library must use the current background token');
  for (const id of ['library-open-project', 'library-new-project']) {
    const button = page.getByTestId(id);
    if (!(await button.isVisible()) || !(await button.isEnabled())) {
      throw new Error(`Project library entry must be actionable: ${id}`);
    }
  }
  await page.getByTestId('activity-explorer').waitFor({ state: 'hidden', timeout: 5000 });

  const narrowPage = await context.newPage();
  collectErrors(narrowPage);
  try {
    await narrowPage.setViewportSize({ width: 1024, height: 768 });
    await narrowPage.goto(url, { waitUntil: 'networkidle' });
    await narrowPage.locator('[data-testid="desktop-shell"]').waitFor({ timeout: 5000 });
    await narrowPage.locator('[data-testid="project-library"]').waitFor({ timeout: 5000 });
    await narrowPage
      .locator('[data-testid="shell-side-panel"]')
      .waitFor({ state: 'hidden', timeout: 5000 });
    if (await narrowPage.locator('[data-testid="editor-panel"]').count()) {
      throw new Error('Expected no editor panel on the narrow project library');
    }
    if (await narrowPage.locator('[data-testid="assistant-panel"]').count()) {
      throw new Error('Expected no assistant panel on the narrow project library');
    }
  } finally {
    await narrowPage.close();
  }

  await page.waitForFunction(() => typeof window.__STORYFORGE_SMOKE__?.openProject === 'function');
  await page.evaluate((path) => {
    window.__STORYFORGE_SMOKE__?.openProject(path);
  }, smokeProjectPath);

  await page.getByTestId('book-overview-surface').waitFor({ timeout: 5000 });
  await page.getByTestId('assistant-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await page.getByTestId('editor-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await page.getByTestId('open-writing-workspace').click();
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
  await library.waitFor({ state: 'hidden', timeout: 5000 });
  const sidePanel = page.getByTestId('shell-side-panel');
  const explorerActivity = page.getByTestId('activity-explorer');
  if ((await explorerActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Explorer must be active while its panel is visible');
  }
  await explorerActivity.click();
  await sidePanel.waitFor({ state: 'hidden', timeout: 5000 });
  if ((await explorerActivity.getAttribute('data-active')) !== 'false') {
    throw new Error('Explorer must be inactive after collapsing');
  }
  await explorerActivity.click();
  await sidePanel.waitFor({ timeout: 5000 });
  if ((await explorerActivity.getAttribute('data-active')) !== 'true') {
    throw new Error('Explorer must be active after restoring');
  }

  await page.getByTestId('activity-book').click();
  await page.getByTestId('book-overview-surface').waitFor({ timeout: 5000 });
  await page.getByTestId('assistant-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await page.getByTestId('open-writing-workspace').click();
  // 返回作品库只是隐藏现有工作台，不丢失编辑器/会话节点或伪造空白工作区。
  await page.evaluate(() => {
    window.__SMOKE_WORKSPACE_NODES__ = ['editor-panel', 'assistant-panel'].map((id) =>
      document.querySelector(`[data-testid="${id}"]`),
    );
  });
  await page.getByTestId('titlebar-library').click();
  await library.waitFor({ timeout: 5000 });
  await page.getByTestId('assistant-panel').waitFor({ state: 'hidden', timeout: 5000 });
  await page.getByTestId('library-resume-project').click();
  await page.getByTestId('editor-panel').waitFor({ timeout: 5000 });
  await page.getByTestId('assistant-panel').waitFor({ timeout: 5000 });
  const sameNodes = await page.evaluate(() =>
    ['editor-panel', 'assistant-panel'].every(
      (id, index) =>
        document.querySelector(`[data-testid="${id}"]`) === window.__SMOKE_WORKSPACE_NODES__[index],
    ),
  );
  if (!sameNodes) throw new Error('Library round-trip must preserve workspace node identity');

  await page.waitForLoadState('networkidle');
  const unexpectedRequests = await page.evaluate(
    () => window.__STORYFORGE_UNEXPECTED_REQUESTS__ ?? [],
  );
  if (unexpectedRequests.length > 0) {
    throw new Error(`Unexpected fixture requests: ${unexpectedRequests.join(', ')}`);
  }
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
