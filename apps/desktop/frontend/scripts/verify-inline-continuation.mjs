import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const evidence = await mkdtemp(join(tmpdir(), 'storyforge-inline-browser-'));
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
console.log('Inline continuation browser evidence: ' + evidence);
const results = [];
const errors = [];
const httpServer = createHttpServer();
const server = await createServer({
  root: cwd,
  configFile: cwd + '/vite.config.ts',
  envFile: false,
  cacheDir: evidence + '/vite-cache',
  define: {
    'import.meta.env.VITE_STORYFORGE_API_BASE_URL': JSON.stringify('http://inline-browser.invalid'),
    'import.meta.env.VITE_STORYFORGE_API_KEY': JSON.stringify('fixture-key'),
  },
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
    fs: { allow: [resolve(cwd, '../../..')] },
  },
  plugins: [
    {
      name: 'isolated-entry',
      configureServer(s) {
        s.middlewares.use('/__inline-audit', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await s.transformIndexHtml(
              '/__inline-audit',
              '<html><body><div id="root"></div><script type="module" src="/scripts/fixtures/inline-continuation.jsx"></script></body></html>',
            ),
          );
        });
      },
    },
  ],
});
// Vite treats port=0 as its default port. Let Node own an OS-assigned loopback
// listener instead, so concurrent gates cannot reuse the author's dev server.
httpServer.on('request', server.middlewares);
let browser;
try {
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const url = `http://127.0.0.1:${httpServer.address().port}/`;
  await writeFile(
    evidence + '/command.json',
    JSON.stringify({ cwd: process.cwd(), argv: process.argv, frontendRoot: cwd, url }, null, 2),
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', (route) => {
    const request = new URL(route.request().url());
    if (request.origin === new URL(url).origin) return route.continue();
    errors.push('blocked remote request: ' + request.href);
    return route.abort();
  });
  const state = () =>
    page.evaluate(() => ({
      requests: window.__INLINE_AUDIT__.requests,
      writes: window.__INLINE_AUDIT__.writes,
      signals: window.__INLINE_AUDIT__.signals,
      body: window.__INLINE_AUDIT__.body(),
    }));
  const open = async () => {
    await page.evaluate(() => window.__INLINE_AUDIT__.focus());
    await page.keyboard.press('Control+Shift+k');
    await page.getByRole('textbox', { name: '续写方向（可留空）' }).waitFor();
    await page.getByRole('textbox', { name: '续写方向（可留空）' }).click();
  };
  const send = async () => page.getByRole('textbox', { name: '续写方向（可留空）' }).press('Enter');
  const accept = page.getByRole('button', { name: '接受（Alt+Enter）' });
  const reject = page.getByRole('button', { name: '弃用（Esc）' });
  await page.goto(url + '__inline-audit');
  await page.waitForFunction(() => document.documentElement.dataset.inlineReady === 'true');
  await open();
  await send();
  await accept.waitFor();
  let s = await state();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].cursor_line, 2);
  assert.equal(s.requests[0].content, '首段。\n中段。\n尾段保持不动。');
  assert.equal(s.writes.length, 0);
  assert.equal(s.body, s.requests[0].content);
  assert(s.requests[0].context_bundle.files.some((f) => f.excerpt.includes('PIN_FINAL')));
  await page.screenshot({ path: evidence + '/middle-cursor-proposal.png' });
  results.push('real Monaco shortcut: middle cursor, suffix, pinned source, proposed-only');
  await reject.click();
  assert.equal(await page.locator('.view-zones').getAttribute('aria-hidden'), 'true');

  await page.evaluate(() => window.__INLINE_AUDIT__.holdRead());
  await open();
  await send();
  await page.waitForFunction(() => window.__INLINE_AUDIT__.readHeld);
  await page.evaluate(() => window.__INLINE_AUDIT__.saveSource());
  await page.evaluate(() => window.__INLINE_AUDIT__.releaseRead());
  await accept.waitFor();
  s = await state();
  assert.equal(s.requests.length, 2);
  assert(JSON.stringify(s.requests[1]).includes('银钥匙'));
  assert(!JSON.stringify(s.requests[1]).includes('铜钥匙'));
  results.push('save during actual pending source read: current request receives new source only');
  await reject.click();

  await page.evaluate(() => window.__INLINE_AUDIT__.holdResponse());
  await open();
  await send();
  await page.waitForFunction(() => window.__INLINE_AUDIT__.responseHeld);
  await page.getByRole('button', { name: '取消（Esc）' }).click();
  assert.equal((await state()).signals.at(-1), true);
  await page.evaluate(() => window.__INLINE_AUDIT__.releaseResponse());
  await page.waitForTimeout(100);
  assert.equal(await accept.count(), 0);
  results.push('real cancel button aborts request signal; late done has no proposal');

  await page.evaluate(() => window.__INLINE_AUDIT__.holdResponse());
  await open();
  await send();
  await page.waitForFunction(() => window.__INLINE_AUDIT__.responseHeld);
  await page.evaluate(() => window.__INLINE_AUDIT__.switchProject());
  await page.waitForFunction(() => window.__INLINE_AUDIT__.project.endsWith('/B'));
  assert.equal((await state()).signals.at(-1), true);
  await page.evaluate(() => window.__INLINE_AUDIT__.releaseResponse());
  await open();
  await send();
  await accept.waitFor();
  s = await state();
  assert.equal(s.requests.at(-1).project_root, 'D:/browser-fiction/B');
  assert.equal(s.requests.at(-1).assistant_session_id, null);
  assert.equal(s.writes.length, 0);
  assert.equal(s.body, '首段。\n中段。\n尾段保持不动。');
  await page.screenshot({ path: evidence + '/project-b-proposal.png' });
  results.push('project/model switch: old signal aborted, B first send has no A session ID');
  await page.evaluate(() => window.__INLINE_AUDIT__.unmount());
  await page.waitForFunction(() => !window.__INLINE_AUDIT__.ready);
  assert.equal(await page.locator('.monaco-editor').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '续写方向（可留空）' }).count(), 0);
  assert.deepEqual(errors, []);
  results.push(
    'unmount with a visible proposal disposes the real Monaco owner without page errors',
  );
  await writeFile(
    evidence + '/summary.json',
    JSON.stringify(
      {
        status: 'passed',
        results,
        state: s,
        errors,
        scope: 'real Chromium/Monaco + current hook; FS/HTTP fixtures, no native or real provider',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: evidence + '/failure.png' });
    await writeFile(evidence + '/failure-dom.html', await page.content());
    await writeFile(
      evidence + '/failure-state.json',
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          active: document.activeElement?.outerHTML,
          audit: window.__INLINE_AUDIT__
            ? { requests: window.__INLINE_AUDIT__.requests, ready: window.__INLINE_AUDIT__.ready }
            : null,
        })),
        null,
        2,
      ),
    );
  }
  await writeFile(
    evidence + '/failure.json',
    JSON.stringify({ error: String(error), stack: error.stack, results, errors }, null, 2),
  );
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await server.close();
    } finally {
      if (httpServer.listening) {
        await new Promise((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
          httpServer.closeAllConnections();
        });
      }
    }
  }
}
