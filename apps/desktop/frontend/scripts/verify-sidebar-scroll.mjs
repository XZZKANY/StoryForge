// Real App layout, isolated browser context and in-memory documents; no user files or provider.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/* global Response, location */

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const project = 'D:/sidebar-scroll-fixture';
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `${project}/第${String(i + 1).padStart(3, '0')}章.md`,
      name: `第${String(i + 1).padStart(3, '0')}章.md`,
      isDir: false,
      size: 100,
      modified: 0,
      extension: 'md',
    }));
    window.__STORYFORGE_MOCK_FS__ = {
      listDir: (path) => (path === project ? files : []),
      pathExists: (path) => path === project || files.some((file) => file.path === path),
      readFile: (path) => {
        if (!files.some((file) => file.path === path)) throw new Error('Missing fixture file');
        return '# 布局回归章节\n仅供浏览器布局测试。';
      },
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : (input.url ?? input.href),
        location.href,
      );
      if (url.pathname.endsWith('/api/ide/commands/book.context')) {
        return new Response(
          JSON.stringify({
            command_id: 'book.context',
            status: 'accepted',
            payload: {
              book_context: {
                chapters: files.map((file, i) => ({
                  ordinal: i + 1,
                  relative_path: file.name,
                  estimated_chars: 8500,
                })),
                total_chapters: files.length,
                total_estimated_chars: files.length * 8500,
                skeleton: [],
                skeleton_total: 0,
                roster: [],
                roster_declared_total: 0,
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) {
        return new Response(JSON.stringify({ detail: 'Offline layout fixture' }), { status: 503 });
      }
      return originalFetch(input, init);
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Boolean(window.__STORYFORGE_SMOKE__));
  await page.evaluate(() => window.__STORYFORGE_SMOKE__.openProject('D:/sidebar-scroll-fixture'));
  await page.getByTestId('activity-manuscript').click();
  await page.getByTestId('manuscript-chapter-row').last().waitFor();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 819, height: 614 },
  ]) {
    await page.setViewportSize(viewport);
    for (const view of ['manuscript', 'explorer']) {
      if ((await page.getByTestId('shell-side-panel').getAttribute('data-side-view')) !== view) {
        await page.getByTestId(`activity-${view}`).click();
      }
      const rowId = view === 'manuscript' ? 'manuscript-chapter-row' : 'file-item';
      await page.getByTestId(rowId).last().waitFor();
      assert.equal(await page.getByTestId(rowId).count(), 60);
      assert.equal(
        await page.getByTestId('shell-status-bar').count(),
        0,
        'Status bar must not mount',
      );
      const metrics = await page
        .getByTestId(rowId)
        .last()
        .evaluate((lastRow) => {
          let scroll = lastRow.parentElement;
          while (scroll && getComputedStyle(scroll).overflowY !== 'auto')
            scroll = scroll.parentElement;
          if (!scroll) throw new Error('Missing list scrollport');
          scroll.scrollTop = scroll.scrollHeight;
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height };
          };
          const row = lastRow.getBoundingClientRect();
          // Check both vertical edges, inset horizontally to avoid the panel's rounded corners.
          const hit = (y) =>
            lastRow.contains(document.elementFromPoint(row.left + row.width / 2, y));
          return {
            panel: rect(document.querySelector('[data-testid="shell-side-panel"]')),
            scroll: rect(scroll),
            lastRow: rect(lastRow),
            scrollTop: scroll.scrollTop,
            unobscured: hit(row.top + 1) && hit(row.bottom - 1),
          };
        });
      assert.ok(
        Math.abs(metrics.panel.bottom - viewport.height) <= 1,
        'Sidebar must fill freed bottom space',
      );
      assert.ok(metrics.scroll.bottom <= viewport.height + 1, 'Scrollport exceeds viewport');
      assert.ok(metrics.scrollTop > 0, 'Long list must actually scroll');
      assert.ok(metrics.lastRow.top >= metrics.scroll.top, 'Last document top is clipped');
      assert.ok(
        metrics.lastRow.bottom <= metrics.scroll.bottom + 1,
        'Last document bottom is clipped',
      );
      assert.ok(metrics.unobscured, 'Last document is covered by another element');
      console.log(`${view} ${viewport.width}x${viewport.height}: ${JSON.stringify(metrics)}`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
