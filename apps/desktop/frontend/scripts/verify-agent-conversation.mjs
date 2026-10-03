import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* global Headers, ReadableStream, Request, Response, TextEncoder */

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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 920 },
    serviceWorkers: 'block',
  });
  const errors = [];
  await page.route('**/*', async (route) => {
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
  const isExpectedBrowserRuntimeNoise = (text) =>
    text.includes('TauriFileSystem.') &&
    text.includes('is only available inside the Tauri desktop runtime');

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isExpectedBrowserRuntimeNoise(text)) errors.push(text);
  });
  page.on('pageerror', (error) => {
    if (!isExpectedBrowserRuntimeNoise(error.message)) errors.push(error.message);
  });

  await page.addInitScript(
    ({ projectPath, filePath, fileContent, characterFilePath, characterFileContent }) => {
      let currentFileContent = fileContent;
      window.__STORYFORGE_MOCK_FS__ = {
        readFile(path) {
          if (path === filePath) return currentFileContent;
          if (path === characterFilePath) return characterFileContent;
          throw new Error(`ENOENT: no such file or directory: ${path}`);
        },
        pathExists(path) {
          const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
          return [
            projectPath,
            filePath,
            characterFilePath,
            `${projectPath}/正文`,
            `${projectPath}/人物`,
          ].some((entry) => entry.replaceAll('\\', '/') === normalized);
        },
        writeFile(path, content) {
          if (path !== filePath) throw new Error(`Unexpected fixture write: ${path}`);
          currentFileContent = content;
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

      const originalFetch = window.fetch.bind(window);
      let latestAgentPayload = null;
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
        const requestBody =
          isApi && method === 'POST'
            ? JSON.parse(
                init.body ?? (input instanceof Request ? await input.clone().text() : '{}'),
              )
            : {};
        const args = requestBody.args ?? {};
        if (
          requestPath.startsWith('/api/ide/commands/') &&
          (method !== 'POST' ||
            args.project_root !== projectPath ||
            (args.current_file && args.current_file !== filePath))
        )
          rejectRequest();
        if (requestPath === '/api/agent-runs/knowledge-proposals/refresh') {
          if (method !== 'POST' || requestBody.project_root !== projectPath) rejectRequest();
          return json({ items: [], pending_count: 0 });
        }
        if (requestPath === '/api/ide/commands/book.context') {
          const estimatedChars = Math.floor(new TextEncoder().encode(fileContent).length / 3);
          const currentChapter = args.current_file
            ? '当前打开的是第 1 章（正文/第三章.md）'
            : '当前没有打开正文';
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
                chapters: [
                  {
                    ordinal: 1,
                    relative_path: '正文/第三章.md',
                    estimated_chars: estimatedChars,
                  },
                ],
                total_chapters: 1,
                total_estimated_chars: estimatedChars,
                current_relative_path: args.current_file ? '正文/第三章.md' : null,
                current_ordinal: args.current_file ? 1 : null,
                skeleton: [],
                skeleton_total: 0,
                skeleton_limit: 12,
                roster: [],
                roster_declared_total: 0,
                roster_limit: 20,
                dossier_relative_path: null,
                previous_chapter: null,
                prompt_block: `[作品底座 · 确定性]\n· 全书 1 章正文 · 约 ${estimatedChars} 字；平均每章 约 ${estimatedChars} 字；${currentChapter}。`,
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
                promises: { current_chapter: 1, ledger: [] },
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
        if (requestPath === '/api/assistant/sessions') {
          if (method !== 'GET' || parsedUrl.searchParams.get('project_path') !== projectPath)
            rejectRequest();
          return json([]);
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
        if (requestPath === '/api/assistant/sessions/101') {
          if (method !== 'GET' || !latestAgentPayload) rejectRequest();
          const now = new Date().toISOString();
          return new Response(
            JSON.stringify({
              id: 101,
              title: 'IDE Agent: 审一下第三章',
              task_type: 'ide_agent',
              project_path: projectPath,
              blueprint_id: null,
              book_run_id: null,
              artifact_id: null,
              messages: [
                {
                  id: 1,
                  session_id: 101,
                  role: 'user',
                  content: latestAgentPayload?.user_message ?? '审一下第三章，看看节奏是不是拖了',
                  created_at: now,
                  updated_at: now,
                },
                {
                  id: 2,
                  session_id: 101,
                  role: 'assistant',
                  content:
                    '多视角审稿完成：发现 1 个问题。未配置 LLM，本轮为启发式预扫，非模型审稿。',
                  created_at: now,
                  updated_at: now,
                },
              ],
              created_at: now,
              updated_at: now,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (/^\/api\/agent-runs\/[^/]+\/save-points$/.test(requestPath)) {
          const runId = requestPath.split('/').at(-2);
          if (method !== 'GET' || runId !== latestAgentPayload?.run_id) rejectRequest();
          return new Response(
            JSON.stringify({
              run_id: runId,
              status: 'completed',
              current_step: 'completed',
              save_points: [],
              pending: {},
              recoverability: {},
              runtime_recovery: {},
              interruption_model: {},
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (!/^\/api\/ide\/agent\/sessions\/[^/]+\/stream$/.test(requestPath)) {
          if (isApi || parsedUrl.origin !== window.location.origin) {
            rejectRequest();
          }
          return originalFetch(input, init);
        }

        if (method !== 'POST') rejectRequest();
        const payload = requestBody;
        latestAgentPayload = payload;
        const requestHeaders = new Headers(init.headers);
        window.__STORYFORGE_AGENT_REQUESTS__ = [
          ...(window.__STORYFORGE_AGENT_REQUESTS__ ?? []),
          {
            url: requestUrl,
            method: init.method,
            accept: requestHeaders.get('accept'),
            apiKey: requestHeaders.get('x-storyforge-api-key'),
          },
        ];
        window.__STORYFORGE_AGENT_MESSAGES__ = [
          ...(window.__STORYFORGE_AGENT_MESSAGES__ ?? []),
          payload,
        ];
        const streamSessionId = decodeURIComponent(requestPath.split('/').at(-2));
        const sequence = [
          {
            type: 'agent_run_started',
            session_id: streamSessionId,
            run_id: payload.run_id ?? 'mock-run',
            user_message: payload.user_message,
          },
          {
            type: 'agent_step',
            session_id: streamSessionId,
            run_id: payload.run_id ?? 'mock-run',
            index: 0,
            step: 'context-agent',
            detail: 'mock streamed context step',
            status: 'completed',
          },
          {
            type: 'tool_trace',
            session_id: streamSessionId,
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
          session_id: streamSessionId,
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
        const messages = [...sequence, response];
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            messages.forEach((message, index) => {
              setTimeout(() => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
                if (index === messages.length - 1) controller.close();
              }, index * 20);
            });
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      };
    },
    {
      projectPath: smokeProjectPath,
      filePath: draftPath,
      fileContent: draftContent,
      characterFilePath: characterPath,
      characterFileContent: characterContent,
    },
  );

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="desktop-shell"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => Boolean(window.__STORYFORGE_SMOKE__), null, { timeout: 5000 });

  await page.evaluate((projectPath) => {
    window.__STORYFORGE_SMOKE__?.openProject(projectPath);
  }, smokeProjectPath);
  await page.getByTestId('book-overview-surface').waitFor({ timeout: 5000 });
  await page.getByTestId('open-writing-workspace').click();
  await page.evaluate((filePath) => {
    window.__STORYFORGE_SMOKE__?.openFile(filePath);
  }, draftPath);
  await page.waitForFunction(
    (filePath) =>
      document.querySelector('[data-testid="editor-root"]')?.getAttribute('data-current-file') ===
      filePath,
    draftPath,
    { timeout: 5000 },
  );

  await page.locator('[data-testid="assistant-panel"]').waitFor({ timeout: 5000 });
  await page
    .getByTestId('conversation-session-switch')
    .filter({ hasText: '新的创作会话' })
    .waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '添加上下文', exact: true }).click();
  await page.getByTestId('context-summary').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="context-candidate"]').filter({ hasText: '林岚.md' }).click();
  await page
    .getByTestId('pinned-context-list')
    .filter({ hasText: '林岚.md' })
    .waitFor({ timeout: 5000 });

  const modelInHeader = await page
    .getByTestId('conversation-header')
    .filter({ hasText: 'Claude' })
    .count();
  if (modelInHeader !== 0) {
    throw new Error('Expected model/mode metadata to stay out of the conversation header');
  }

  const input = page.getByLabel('给 StoryForge 发送消息').first();
  await input.fill('审一下第三章，看看节奏是不是拖了');
  await page.getByTestId('composer-submit').click();

  await page
    .getByTestId('conversation-session-switch')
    .filter({ hasText: /审一下第三章/ })
    .waitFor({ timeout: 5000 });
  await page
    .locator('p')
    .filter({ hasText: /^审一下第三章，看看节奏是不是拖了$/ })
    .waitFor({ timeout: 5000 });
  try {
    await page.getByText(/多视角审稿完成：发现 1 个问题/).waitFor({ timeout: 5000 });
  } catch (error) {
    const panelText = await page.locator('[data-testid="assistant-panel"]').innerText();
    throw new Error(
      `Agent SSE result did not render: ${String(error)}\n${panelText}\n${errors.join('\n')}`,
      { cause: error },
    );
  }

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
  const steps = page.getByTestId('thinking-fold-toggle');
  await steps.waitFor({ timeout: 5000 });
  if ((await steps.getAttribute('aria-expanded')) !== 'false') {
    throw new Error('Completed Agent steps must initially be collapsed');
  }
  await steps.click();
  await page.getByText('选择上下文', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /选择上下文/ }).click();
  await page.getByText('mock context', { exact: true }).waitFor({ timeout: 5000 });
  const bodyText = await page.locator('[data-testid="assistant-panel"]').innerText();
  if (!bodyText.includes('选择上下文') || !bodyText.includes('mock context')) {
    throw new Error(
      `Expected event-driven Agent steps to render in the conversation:\n${bodyText}`,
    );
  }
  for (const fabricated of [
    '准备项目上下文',
    '同步当前稿件',
    '发送给 StoryForge Agent',
    '整理回复',
  ]) {
    if (bodyText.includes(fabricated)) {
      throw new Error(
        `Expected no frontend-fabricated step "${fabricated}" in the conversation:\n${bodyText}`,
      );
    }
  }
  await page.waitForFunction(() => (window.__STORYFORGE_AGENT_MESSAGES__ ?? []).length >= 1, null, {
    timeout: 5000,
  });

  const payloads = await page.evaluate(() => window.__STORYFORGE_AGENT_MESSAGES__);
  const requests = await page.evaluate(() => window.__STORYFORGE_AGENT_REQUESTS__);
  const firstRequest = requests[0];
  if (
    firstRequest?.method !== 'POST' ||
    firstRequest?.accept !== 'text/event-stream' ||
    firstRequest?.apiKey !== 'smoke-fixture-key' ||
    !String(firstRequest?.url ?? '').endsWith('/stream')
  ) {
    throw new Error(`Expected authenticated Agent SSE request: ${JSON.stringify(firstRequest)}`);
  }
  const firstArgs = payloads[0]?.args;
  if (firstArgs?.project_path !== smokeProjectPath) {
    throw new Error(
      `Expected Agent payload project_path to match project: ${JSON.stringify(firstArgs)}`,
    );
  }
  if (firstArgs?.current_file !== draftPath || firstArgs?.file_path !== draftPath) {
    throw new Error(`Expected Agent payload to carry current file: ${JSON.stringify(firstArgs)}`);
  }
  if (!String(firstArgs?.content ?? '').includes('旧设定解释在这里铺开。')) {
    throw new Error('Expected Agent payload to include current file content');
  }
  if (
    !Array.isArray(firstArgs?.context_bundle?.files) ||
    firstArgs.context_bundle.files.length < 1
  ) {
    throw new Error(
      `Expected Agent payload to include project context bundle: ${JSON.stringify(firstArgs?.context_bundle)}`,
    );
  }
  if (!payloads[0]?.run_id || payloads[0]?.user_message !== '审一下第三章，看看节奏是不是拖了') {
    throw new Error(
      `Expected Agent SSE payload with run id and user message: ${JSON.stringify(payloads[0])}`,
    );
  }
  if (firstArgs?.context_bundle?.budget?.pinned_file_count < 1) {
    throw new Error(
      `Expected context bundle budget to record pinned context: ${JSON.stringify(firstArgs?.context_bundle?.budget)}`,
    );
  }
  if (!String(firstArgs.context_bundle.files[0]?.excerpt ?? '').includes('害怕再次失去证据')) {
    throw new Error(
      `Expected context bundle to include character file excerpt: ${JSON.stringify(firstArgs.context_bundle.files)}`,
    );
  }
  if (bodyText.includes('你\n审一下第三章')) {
    throw new Error('Expected user bubble to omit user name label');
  }

  const unexpectedRequests = await page.evaluate(
    () => window.__STORYFORGE_UNEXPECTED_REQUESTS__ ?? [],
  );
  if (unexpectedRequests.length > 0) {
    throw new Error(`Unexpected fixture requests: ${unexpectedRequests.join(', ')}`);
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
