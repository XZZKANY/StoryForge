// Isolated ordinary Native host, or an explicitly selected debug-only external fixture.
// Neither mode mocks renderer/IPC/FS; production release gates remain unchanged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import {
  createSmokeEnvironment,
  findFreeLoopbackApiBaseUrl,
  killProcessTree,
} from '../../scripts/verify-tauri-smoke.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = process.argv.includes('--external');
const outputRoot = resolve(
  root,
  fixture ? 'output/playwright/stream-ui-native-external' : 'output/playwright/stream-ui-native',
);
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(resolve(outputRoot, 'run-'));
const directories = {
  localDataDir: resolve(output, 'local-data'),
  configDir: resolve(output, 'config'),
  webviewDataDir: resolve(output, 'webview2'),
};
const project = resolve(fixture ? directories.localDataDir : output, 'project');
const alternateProject = resolve(output, 'alternate-project');
for (const path of Object.values(directories)) await mkdir(path, { recursive: true });
for (const path of [project, alternateProject])
  await mkdir(resolve(path, '正文'), { recursive: true });
const manuscript = '# 第01章\n她把旧钥匙藏进袖口，没有敲门。\n';
await writeFile(resolve(project, fixture ? 'chapter.md' : '正文/第01章.md'), manuscript);
if (fixture)
  await writeFile(
    resolve(directories.localDataDir, 'gui-fixture.json'),
    JSON.stringify({ protocol: 'storyforge-gui-lifecycle-fixture-v1', scenario: 'token_stream' }),
  );
await writeFile(resolve(alternateProject, '正文/第01章.md'), '# 另一部作品\n另一个独立场景。\n');
const chunks = [
  '## 流式审稿建议\n\n第一批正文：先让人物的选择带动情节。\n\n' +
    '她摸到袖口里的旧钥匙，却没有敲门。动作留下的悬念，比直接解释更有力量。\n\n'.repeat(12) +
    '**第二批',
  '建议**：保留门锁被换过的细节。\n\n- 用行动替代解释\n- 留下人物选择\n\n' +
    '接下来逐段核对因果，保留人物行动和环境细节。\n\n'.repeat(12) +
    '~~~text\n她把钥匙藏进袖口',
  '，转身走进雨里。\n~~~\n\n最终建议：让下一场对话承接这个选择。',
];
let mode = 'success';
let active = null;
const requests = [];
const failures = [];
let vite, child;
let exitRequested = false;
const persist = async () =>
  writeFile(
    resolve(output, 'provider-state.json'),
    JSON.stringify(
      {
        synthetic: true,
        mode,
        active: active && {
          index: active.index,
          terminalSent: active.terminalSent,
        },
        requests,
        failures,
      },
      null,
      2,
    ),
  );
const emit = (response, delta, finish_reason = null) =>
  response.write(
    'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\n\n',
  );
const terminal = (response, finish = 'stop') => {
  emit(response, {}, finish);
  response.write(
    'data: ' +
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 30,
          total_tokens: 50,
        },
      }) +
      '\n\n',
  );
  response.end('data: [DONE]\n\n');
};
const provider = createHttpServer(async (req, res) => {
  try {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) throw new Error('Fixture request exceeds budget');
    }
    const body = JSON.parse(raw);
    const tools = body.tools?.map((item) => item.function.name) ?? [];
    requests.push({
      at: new Date().toISOString(),
      stream: body.stream === true,
      model: body.model,
      roles: body.messages?.map((item) => item.role),
      bodySha256: createHash('sha256').update(raw).digest('hex'),
    });
    if (!body.stream || !tools.length) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '隔离流式验收项目',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await persist();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const hasToolFeedback = body.messages.some((item) => item.role === 'tool');
    if (mode === 'success' && !hasToolFeedback) {
      assert.ok(tools.includes('fs_read'));
      emit(res, {
        tool_calls: [
          {
            index: 0,
            id: 'native-read',
            type: 'function',
            function: { name: 'fs_read', arguments: '{"path":' },
          },
        ],
      });
      emit(res, { tool_calls: [{ index: 0, function: { arguments: '"正文/第01章.md"}' } }] });
      terminal(res, 'tool_calls');
      await persist();
      return;
    }
    if (hasToolFeedback) {
      const feedback = body.messages.find(
        (item) => item.tool_call_id === 'native-read' && item.role === 'tool',
      );
      assert.ok(JSON.parse(feedback.content).content.includes('旧钥匙'));
    }
    assert.equal(active, null, 'Only one pending model stream');
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    active = { response: res, index: 0, terminalSent: false, release };
    emit(res, { content: '<think>不应显示的合成推理</think>' + chunks[0] });
    await persist();
    await barrier;
    if (mode === 'failure') res.destroy();
    else {
      for (let i = active.index + 1; i < chunks.length; i++) emit(res, { content: chunks[i] });
      active.terminalSent = true;
      terminal(res);
    }
    active = null;
    await persist();
  } catch (error) {
    failures.push(String(error));
    res.destroy();
    await persist();
  }
});
const control = createHttpServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/state')
      return reply(200, {
        output,
        project,
        alternateProject,
        mode,
        chunks,
        requests,
        active: active && { index: active.index, terminalSent: active.terminalSent },
        failures,
      });
    if (req.method === 'POST' && req.url.startsWith('/mode/')) {
      assert.equal(active, null);
      const value = req.url.slice('/mode/'.length);
      assert.ok(['success', 'stop', 'failure', 'navigate'].includes(value));
      mode = value;
      await persist();
      return reply(200, { mode });
    }
    if (req.method === 'POST' && req.url === '/advance') {
      assert.ok(active && active.index < chunks.length - 1);
      active.index++;
      emit(active.response, { content: chunks[active.index] });
      await persist();
      return reply(200, { index: active.index });
    }
    if (req.method === 'POST' && req.url === '/release') {
      assert.ok(active);
      active.release();
      return reply(200, { released: true });
    }
    if (req.method === 'POST' && req.url === '/shutdown') {
      exitRequested = true;
      active?.release();
      return reply(200, { shutdown: true });
    }
    reply(404, { detail: 'Unknown isolated control route' });
  } catch (error) {
    reply(409, { detail: String(error) });
  }
});
let launch;
try {
  await new Promise((ready) => provider.listen(0, '127.0.0.1', ready));
  await new Promise((ready) => control.listen(0, '127.0.0.1', ready));
  const providerBaseUrl = 'http://127.0.0.1:' + provider.address().port + '/v1';
  const controlBaseUrl = 'http://127.0.0.1:' + control.address().port;
  const apiBaseUrl = await findFreeLoopbackApiBaseUrl();
  const cdpBaseUrl = await findFreeLoopbackApiBaseUrl();
  vite = await createServer({
    root: resolve(root, 'apps/desktop/frontend'),
    configFile: resolve(root, 'apps/desktop/frontend/vite.config.ts'),
    envFile: false,
    server: { host: 'localhost', port: 3007, strictPort: true },
  });
  await vite.listen();
  if (!fixture)
    await writeFile(
      resolve(directories.configDir, 'llm-provider.json'),
      JSON.stringify({
        provider: 'custom',
        baseUrl: providerBaseUrl,
        model: 'token-stream-native-fixture',
        apiKey: 'synthetic-loopback-native-only',
      }),
    );
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|SYSTEMDRIVE|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(
        name,
      ),
    ),
  );
  const env = createSmokeEnvironment(inherited, apiBaseUrl, directories);
  delete env.STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH;
  Object.assign(env, {
    STORYFORGE_ROOT: root,
    STORYFORGE_API_KEY: 'synthetic-native-acceptance-api',
    STORYFORGE_DESKTOP_USE_API_SIDECAR: '0',
    STORYFORGE_DESKTOP_SMOKE_LIFECYCLE_ONLY: '1',
    STORYFORGE_LLM_TIMEOUT_SECONDS: '300',
    STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
    REDIS_URL: '',
    STORYFORGE_RATE_LIMIT_REDIS_URL: '',
    SENTRY_DSN: '',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      '--remote-debugging-port=' +
      new URL(cdpBaseUrl).port +
      ' --remote-debugging-address=127.0.0.1',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  });
  const executable = resolve(
    root,
    'apps/desktop/src-tauri/target/debug/' +
      (fixture ? 'storyforge-gui-fixture.exe' : 'storyforge-desktop.exe'),
  );
  child = spawn(executable, [], {
    cwd: root,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(createWriteStream(resolve(output, 'native-stdout.log')));
  child.stderr.pipe(createWriteStream(resolve(output, 'native-stderr.log')));
  launch = {
    output,
    pid: child.pid,
    executable,
    executableSha256: createHash('sha256')
      .update(await readFile(executable))
      .digest('hex'),
    providerBaseUrl,
    controlBaseUrl,
    apiBaseUrl,
    cdpBaseUrl,
    project,
    alternateProject,
    directories,
    fixture,
    isolation: 'smoke-lifecycle-only',
    startedAt: new Date().toISOString(),
  };
  await writeFile(resolve(output, 'launch.json'), JSON.stringify(launch, null, 2));
  await writeFile(resolve(outputRoot, 'current.json'), JSON.stringify(launch, null, 2));
  console.log(JSON.stringify(launch, null, 2));
  const deadline = Date.now() + 600_000;
  while (!exitRequested && child.exitCode === null && child.signalCode === null) {
    assert.ok(Date.now() < deadline, 'Isolated Native host observation timed out');
    await delay(500);
  }
  assert.ok(exitRequested, 'Native host exited before acceptance finished');
} finally {
  active?.release();
  if (child?.exitCode === null && child.signalCode === null) {
    await delay(500);
    killProcessTree(child);
  }
  await vite?.close();
  for (const server of [provider, control]) {
    server.closeAllConnections();
    await new Promise((ready) => server.close(ready));
  }
  await persist();
  await writeFile(
    resolve(output, 'host-closed.json'),
    JSON.stringify({
      pid: child?.pid ?? null,
      cleanupCompleted: true,
      closedAt: new Date().toISOString(),
    }),
  );
  console.log('Native host closed:', output);
}
