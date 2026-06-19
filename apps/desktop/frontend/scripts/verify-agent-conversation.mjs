import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 0, strictPort: false },
});

let browser;
let smokeProjectPath;

try {
  smokeProjectPath = await mkdtemp(join(tmpdir(), 'storyforge-agent-conversation-'));
  const draftDir = join(smokeProjectPath, '正文');
  const draftPath = join(draftDir, '第三章.md');
  await mkdir(draftDir, { recursive: true });
  await writeFile(draftPath, '# 第三章\n\n她推开门，风声灌进来。\n\n旧设定解释在这里铺开。', 'utf8');

  await server.listen();
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const errors = [];
  const isExpectedBrowserRuntimeNoise = (text) => (
    text.includes('TauriFileSystem.') && text.includes('is only available inside the Tauri desktop runtime')
  );

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isExpectedBrowserRuntimeNoise(text)) errors.push(text);
  });
  page.on('pageerror', (error) => {
    if (!isExpectedBrowserRuntimeNoise(error.message)) errors.push(error.message);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="desktop-shell"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => Boolean(window.__STORYFORGE_SMOKE__), null, { timeout: 5000 });

  await page.evaluate(
    ({ projectPath, filePath }) => {
      window.__STORYFORGE_SMOKE__?.openProject(projectPath);
      window.__STORYFORGE_SMOKE__?.openFile(filePath);
    },
    { projectPath: smokeProjectPath, filePath: draftPath },
  );

  await page.locator('[data-testid="assistant-panel"]').waitFor({ timeout: 5000 });
  await page.getByRole('heading', { name: '新的创作会话' }).waitFor({ timeout: 5000 });
  await page.getByText('StoryForge · Claude · 编辑模式').waitFor({ timeout: 5000 });
  await page.getByText('@ 正文').waitFor({ timeout: 5000 });

  const modelInHeader = await page.locator('header').filter({ hasText: 'Claude' }).count();
  if (modelInHeader !== 0) {
    throw new Error('Expected model/mode metadata to stay out of the conversation header');
  }

  const input = page.getByLabel('给 StoryForge 发送消息').first();
  await input.fill('审一下第三章，看看节奏是不是拖了');
  await page.getByTitle('发送').last().click();

  await page.getByRole('heading', { name: /审一下第三章/ }).waitFor({ timeout: 5000 });
  await page.locator('p').filter({ hasText: /^审一下第三章，看看节奏是不是拖了$/ }).waitFor({ timeout: 5000 });
  await page.getByText('StoryForge').first().waitFor({ timeout: 5000 });

  const userBubble = await page
    .locator('div')
    .filter({ hasText: /^审一下第三章，看看节奏是不是拖了$/ })
    .last()
    .boundingBox();
  const panelBox = await page.locator('[data-testid="assistant-panel"]').boundingBox();
  if (!userBubble || !panelBox) {
    throw new Error('Expected user message bubble and assistant panel to be visible');
  }
  if (userBubble.x + userBubble.width < panelBox.x + panelBox.width * 0.55) {
    throw new Error('Expected user message to render as a right-side bubble');
  }

  const bodyText = await page.locator('[data-testid="assistant-panel"]').innerText();
  if (!bodyText.includes('扫描项目上下文') || !bodyText.includes('调用 Agent Orchestrator')) {
    throw new Error('Expected Agent execution steps to render in the conversation');
  }
  if (bodyText.includes('你\n审一下第三章')) {
    throw new Error('Expected user bubble to omit user name label');
  }

  if (errors.length > 0) {
    throw new Error(`Console errors:\n${errors.join('\n')}`);
  }

  console.log(`Agent conversation verification passed: ${url}`);
} finally {
  if (browser) await browser.close();
  if (smokeProjectPath) await rm(smokeProjectPath, { recursive: true, force: true });
  await server.close();
}
