import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve(process.argv[2] ?? '../../../output/playwright/token-stream');
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: 'vite.config.ts',
  envFile: false,
  define: {
    'import.meta.env.VITE_STORYFORGE_API_BASE_URL': JSON.stringify('http://stream-fixture.invalid'),
    'import.meta.env.VITE_STORYFORGE_API_KEY': JSON.stringify('fixture-only'),
  },
  server: { port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true });
  for (const [theme, width] of [
    ['dark', 420],
    ['light', 320],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      errors.push('Non-fixture network');
      return route.abort();
    });
    await page.goto(origin + '/tests/fixtures/token-stream.html');
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.getByTestId('stream-phase').filter({ hasText: '等待正文输出' }).waitFor();
    const current = page.getByTestId('assistant-message').last();
    const node = await current.elementHandle();
    await page.screenshot({ path: resolve(output, theme + '-waiting.png') });
    await page.getByRole('button', { name: '下一批', exact: true }).click();
    await current.getByText('审稿建议', { exact: true }).waitFor();
    const scroller = page.getByTestId('message-list-scroll');
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.getByRole('button', { name: '下一批', exact: true }).click();
    await page.getByTestId('message-list-new-content').waitFor();
    assert.equal(await scroller.evaluate((element) => element.scrollTop), 0);
    await page.getByRole('button', { name: '下一批', exact: true }).click();
    await page.getByTestId('message-list-new-content').click();
    await page.getByRole('button', { name: '工具进度', exact: true }).click();
    await page.getByText('已读取样例章节', { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, theme + '-tools.png') });
    await page.getByRole('button', { name: '下一批', exact: true }).click();
    await page.getByRole('textbox').focus();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByRole('textbox').evaluate((element) => document.activeElement === element),
      true,
    );
    assert.equal(await current.evaluate((element, previous) => element === previous, node), true);
    assert.equal(
      await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      true,
    );
    await page.screenshot({ path: resolve(output, theme + '-streaming.png') });
    await page
      .getByRole('button', { name: theme === 'dark' ? '完成' : '中断', exact: true })
      .click();
    await page
      .getByTestId('fixture-state')
      .filter({ hasText: theme === 'dark' ? 'completed' : 'interrupted' })
      .waitFor();
    assert.equal(await current.evaluate((element, previous) => element === previous, node), true);
    assert.match(await page.getByTestId('fixture-state').innerText(), /POST 1/);
    assert.equal(await page.getByTestId('assistant-message').count(), 5);
    if (theme === 'dark') assert.equal(await page.getByTestId('stream-phase').count(), 0);
    else await page.getByText('回复未完成', { exact: false }).waitFor();
    await page.screenshot({ path: resolve(output, theme + '-final.png') });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      'PASS',
      theme,
      width,
      'stream/SSE/stable node/scroll/focus/overflow/terminal/one POST',
    );
  }
} finally {
  await browser?.close();
  await server.close();
}
