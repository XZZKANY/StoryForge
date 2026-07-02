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
let draftPath;
let characterPath;
let draftContent;
let characterContent;

try {
  smokeProjectPath = await mkdtemp(join(tmpdir(), 'storyforge-agent-conversation-'));
  const draftDir = join(smokeProjectPath, '正文');
  draftPath = join(draftDir, '第三章.md');
  characterPath = join(smokeProjectPath, '人物', '林岚.md');
  draftContent = '# 第三章\n\n她推开门，风声灌进来。\n\n旧设定解释在这里铺开。';
  characterContent = '# 林岚\n\n害怕再次失去证据。';
  await mkdir(draftDir, { recursive: true });
  await mkdir(join(smokeProjectPath, '人物'), { recursive: true });
  await writeFile(draftPath, draftContent, 'utf8');
  await writeFile(characterPath, characterContent, 'utf8');

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

  await page.addInitScript(
    ({ projectPath, filePath, fileContent, characterFilePath, characterFileContent }) => {
    window.__STORYFORGE_MOCK_FS__ = {
      readFile(path) {
        if (path === filePath) return fileContent;
        if (path === characterFilePath) return characterFileContent;
        throw new Error(`mock fs missing file: ${path}`);
      },
      listDir(path) {
        if (path !== projectPath) return [];
        return [
          {
            name: '正文',
            path: `${projectPath}\\正文`,
            isDir: true,
            size: 0,
            modified: 1,
          },
          {
            name: '第三章.md',
            path: filePath,
            isDir: false,
            size: fileContent.length,
            modified: 1,
            extension: 'md',
          },
          {
            name: '人物',
            path: `${projectPath}\\人物`,
            isDir: true,
            size: 0,
            modified: 1,
          },
          {
            name: '林岚.md',
            path: characterFilePath,
            isDir: false,
            size: characterFileContent.length,
            modified: 1,
            extension: 'md',
          },
        ];
      },
    };

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      url;
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor(url) {
        super();
        this.url = url;
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }, 0);
      }

      send(raw) {
        const payload = JSON.parse(String(raw));
        window.__STORYFORGE_AGENT_MESSAGES__ = [
          ...(window.__STORYFORGE_AGENT_MESSAGES__ ?? []),
          payload,
        ];
        const sequence = [
          {
            type: 'agent_run_started',
            session_id: 'mock-session',
            run_id: payload.run_id ?? 'mock-run',
            user_message: payload.user_message,
          },
          {
            type: 'agent_step',
            session_id: 'mock-session',
            run_id: payload.run_id ?? 'mock-run',
            index: 0,
            step: 'context-agent',
            detail: 'mock streamed context step',
            status: 'completed',
          },
          {
            type: 'tool_trace',
            session_id: 'mock-session',
            run_id: payload.run_id ?? 'mock-run',
            index: 0,
            trace: {
              tool_name: 'subagent.context',
              status: 'completed',
              input_summary: {},
              output_summary: { context_file_count: 1 },
            },
          },
        ];
        const response = {
          type: 'agent_result',
          session_id: 'mock-session',
          run_id: payload.run_id ?? 'mock-run',
          assistant_session_id: 101,
          intent: 'file.review',
          user_message: payload.user_message,
          plan: [{ step: 'context-agent', detail: 'mock context', status: 'completed' }],
          agent_result: {
            summary: '多视角审稿完成：发现 1 个问题。未配置 LLM，本轮为启发式预扫，非模型审稿。',
            requires_user_confirmation: false,
            review_report: {
              kind: 'review_report',
              mode: 'heuristic_only',
              context: { file_count: 1, kinds: ['character'] },
              agent_findings: {
                plot: { issue_count: 0 },
                character: { issue_count: 1 },
                prose: { issue_count: 0 },
              },
              issues: [
                {
                  id: 'character-1',
                  category: 'character',
                  severity: 'medium',
                  message: '人物动机需要补证据。',
                  evidence: '她推开门。',
                  suggested_action: '用动作或对白证明决定。',
                },
              ],
              suggested_actions: ['修订前核对人物小传和关系线，避免动机断裂。'],
            },
          },
          tool_trace: [],
          proposed_patch: null,
        };
        [...sequence, response].forEach((message, index) => {
          setTimeout(() => {
            this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
          }, index * 20);
        });
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close', { code: 1000 }));
      }
    }
    window.WebSocket = MockWebSocket;
  },
  {
    projectPath: smokeProjectPath,
    filePath: draftPath,
    fileContent: draftContent,
    characterFilePath: characterPath,
    characterFileContent: characterContent,
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
  await page.getByTestId('context-summary').waitFor({ timeout: 5000 });
  await page.getByTestId('context-picker-toggle').click();
  await page.locator('[data-testid="context-candidate"]').filter({ hasText: '林岚.md' }).click();
  await page.getByTestId('pinned-context-list').filter({ hasText: '林岚.md' }).waitFor({ timeout: 5000 });

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

  // 流程树必须全事件驱动：步骤只来自后端 plan/tool_trace（mock 的 step 'context-agent'
  // 映射标题「选择上下文」，流式 detail 会被 agent_result 的最终 plan detail 'mock context'
  // 替换），不再出现前端预制骨架步骤。
  await page.getByText('选择上下文').first().waitFor({ timeout: 5000 });
  await page.getByText('mock context').first().waitFor({ timeout: 5000 });
  const bodyText = await page.locator('[data-testid="assistant-panel"]').innerText();
  if (!bodyText.includes('选择上下文') || !bodyText.includes('mock context')) {
    throw new Error(`Expected event-driven Agent steps to render in the conversation:\n${bodyText}`);
  }
  for (const fabricated of ['准备项目上下文', '同步当前稿件', '发送给 StoryForge Agent', '整理回复']) {
    if (bodyText.includes(fabricated)) {
      throw new Error(`Expected no frontend-fabricated step "${fabricated}" in the conversation:\n${bodyText}`);
    }
  }
  await page.waitForFunction(() => (window.__STORYFORGE_AGENT_MESSAGES__ ?? []).length >= 1, null, { timeout: 5000 });

  const payloads = await page.evaluate(() => window.__STORYFORGE_AGENT_MESSAGES__);
  const firstArgs = payloads[0]?.args;
  if (firstArgs?.project_path !== smokeProjectPath) {
    throw new Error(`Expected Agent payload project_path to match project: ${JSON.stringify(firstArgs)}`);
  }
  if (firstArgs?.current_file !== draftPath || firstArgs?.file_path !== draftPath) {
    throw new Error(`Expected Agent payload to carry current file: ${JSON.stringify(firstArgs)}`);
  }
  if (!String(firstArgs?.content ?? '').includes('旧设定解释在这里铺开。')) {
    throw new Error('Expected Agent payload to include current file content');
  }
  if (!Array.isArray(firstArgs?.context_bundle?.files) || firstArgs.context_bundle.files.length < 1) {
    throw new Error(`Expected Agent payload to include project context bundle: ${JSON.stringify(firstArgs?.context_bundle)}`);
  }
  if (payloads[0]?.stream !== true || !payloads[0]?.run_id) {
    throw new Error(`Expected Agent websocket payload to opt into stream events: ${JSON.stringify(payloads[0])}`);
  }
  if (firstArgs?.context_bundle?.budget?.pinned_file_count < 1) {
    throw new Error(`Expected context bundle budget to record pinned context: ${JSON.stringify(firstArgs?.context_bundle?.budget)}`);
  }
  if (!String(firstArgs.context_bundle.files[0]?.excerpt ?? '').includes('害怕再次失去证据')) {
    throw new Error(`Expected context bundle to include character file excerpt: ${JSON.stringify(firstArgs.context_bundle.files)}`);
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
