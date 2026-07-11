/**
 * sidecar-smoke:交付形态(单进程 sidecar + sqlite 文件库)的自动化冒烟门禁。
 *
 * daily 档(默认):以源码方式起 run_windows.py,验证与发布同构的启动路径。
 * packaged 档(--packaged):先构建 PyInstaller 冻结 exe(--skip-build 可复用现有产物),
 * 对冻结产物跑同一套 smoke——路径桥断裂 / hidden import / uvloop 一类故障只在冻结态暴露。
 *
 * 流程:临时 sqlite → 起服 → 轮询 /health/ready(记录冷启动耗时)→ 无 LLM 的
 * assistant 会话 REST 往返 → Agent SSE 流(空消息在 provider 前确定性失败)→
 * Agent control REST 往返(未知类型 error 帧)→ 杀进程树。
 */

/* global AbortSignal -- Node 22 内置全局,eslint env 未收录 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps', 'api');
const API_KEY = process.env.STORYFORGE_API_KEY || 'local-dev-key';
const PACKAGED = process.argv.includes('--packaged');
const SKIP_BUILD = process.argv.includes('--skip-build');
const READY_TIMEOUT_MS = PACKAGED ? 120_000 : 90_000;
const COLD_START_BUDGET_MS = PACKAGED ? 90_000 : 60_000;

function log(message) {
  console.log(`[sidecar-smoke] ${message}`);
}

function fail(message) {
  console.error(`[sidecar-smoke] FAILED: ${message}`);
  process.exitCode = 1;
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function locatePackagedExe() {
  const binariesDir = resolve(root, 'apps', 'desktop', 'src-tauri', 'binaries');
  const candidates = readdirSync(binariesDir)
    .filter((name) => name.startsWith('storyforge-api') && name.endsWith('.exe'))
    .map((name) => join(binariesDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) {
    throw new Error(
      `未找到冻结 exe:${binariesDir} 下无 storyforge-api*.exe(先跑构建或去掉 --skip-build)`,
    );
  }
  return candidates[0];
}

function startServer(port, databaseUrl) {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    STORYFORGE_API_HOST: '127.0.0.1',
    STORYFORGE_API_PORT: String(port),
    STORYFORGE_DESKTOP_SKIP_SERVICES: '1',
    STORYFORGE_ENV: 'local',
    STORYFORGE_API_KEY: API_KEY,
  };

  if (PACKAGED) {
    if (!SKIP_BUILD) {
      log('构建 PyInstaller 冻结 exe(可用 --skip-build 复用现有产物)…');
      const build = spawnSync('node', ['apps/desktop/scripts/build-api-sidecar.mjs'], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (build.status !== 0) throw new Error(`sidecar 构建失败,退出码 ${build.status}`);
    }
    const exePath = locatePackagedExe();
    log(`packaged 档:${exePath}`);
    return spawn(exePath, [], { env, cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  log('daily 档:uv run python run_windows.py');
  return spawn('uv', ['run', 'python', 'run_windows.py'], {
    env,
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

async function waitReady(baseUrl) {
  const startedAt = Date.now();
  let lastError = 'no attempt';
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ready') return Date.now() - startedAt;
        lastError = `status=${body.status} checks=${JSON.stringify(body.checks)}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  throw new Error(`/health/ready 超时(${READY_TIMEOUT_MS}ms),最后一次:${lastError}`);
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function assertSchemaManagedByAlembic(serverLogs) {
  const text = serverLogs.join('').replace(ANSI_ESCAPE, '');
  if (!text.includes('sqlite_schema_ready')) {
    throw new Error('未见 sqlite_schema_ready 起服日志:bootstrap 未跑或日志未落到 stdout');
  }
  if (/managed=false|"managed":\s*false/i.test(text)) {
    throw new Error(
      'sqlite schema 未纳入 alembic 管理(managed=false):冻结 exe 可能漏打 alembic 脚本、已回退 create_all',
    );
  }
  if (!/managed=true|"managed":\s*true/i.test(text)) {
    throw new Error('起服日志未确认 managed=true(sqlite schema 纳管状态不明)');
  }
}

function assertPromptLayerBundled(serverLogs) {
  const text = serverLogs.join('').replace(ANSI_ESCAPE, '');
  if (!text.includes('prompt_layer_bundled')) {
    throw new Error(
      '未见 prompt_layer_bundled 起服日志:分层 prompt 构建器未随 exe 打包(F05 死路),bookrun.start 装配会在装机后才炸',
    );
  }
  if (/callable=false|"callable":\s*false/i.test(text)) {
    throw new Error(
      'prompt_layer_bundled 但 callable=false:build_draft_prompt_from_state 未装配可达',
    );
  }
}

async function assistantRoundTrip(baseUrl, projectPath) {
  const headers = { 'content-type': 'application/json', 'X-StoryForge-API-Key': API_KEY };
  const created = await fetch(`${baseUrl}/api/assistant/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'sidecar-smoke', task_type: 'smoke', project_path: projectPath }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!created.ok)
    throw new Error(`创建 assistant 会话失败:HTTP ${created.status} ${await created.text()}`);
  const session = await created.json();
  if (!session.id) throw new Error(`创建响应缺少 id:${JSON.stringify(session)}`);

  const listed = await fetch(
    `${baseUrl}/api/assistant/sessions?project_path=${encodeURIComponent(projectPath)}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!listed.ok) throw new Error(`会话列表失败:HTTP ${listed.status}`);
  const body = await listed.json();
  const items = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
  if (!items.some((item) => item.id === session.id)) {
    throw new Error(`会话列表未包含刚创建的会话 id=${session.id}`);
  }
  return session.id;
}

async function agentControlRoundTrip(baseUrl) {
  // 未知 control type 由后端以 200 + {type:"error"} 帧返回（不建 run、不出网）。
  const response = await fetch(`${baseUrl}/api/ide/agent/sessions/smoke-${process.pid}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-StoryForge-API-Key': API_KEY },
    body: JSON.stringify({ type: 'smoke_probe', run_id: 'smoke' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Agent 控制端点 HTTP ${response.status}`);
  }
  const frame = await response.json();
  if (frame.type === 'error' && typeof frame.detail === 'string') {
    return frame;
  }
  throw new Error(`Agent 控制回帧形状异常:${JSON.stringify(frame)}`);
}

function parseSseFrames(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n'),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data));
}

async function agentStreamRoundTrip(baseUrl) {
  const runId = `smoke-${process.pid}`;
  const response = await fetch(`${baseUrl}/api/ide/agent/sessions/${runId}/stream`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'content-type': 'application/json',
      'X-StoryForge-API-Key': API_KEY,
    },
    body: JSON.stringify({ run_id: runId, user_message: '' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Agent SSE 端点 HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/event-stream')) {
    throw new Error(`Agent SSE content-type 异常:${contentType || '<missing>'}`);
  }
  const frames = parseSseFrames(await response.text());
  const started = frames[0];
  const terminal = frames.at(-1);
  if (started?.type !== 'agent_run_started' || started.run_id !== runId) {
    throw new Error(`Agent SSE started 帧异常:${JSON.stringify(started)}`);
  }
  if (
    terminal?.type !== 'error' ||
    terminal.run_id !== runId ||
    typeof terminal.detail !== 'string'
  ) {
    throw new Error(`Agent SSE 终态帧异常:${JSON.stringify(terminal)}`);
  }
  return frames.length;
}

async function main() {
  const tier = PACKAGED ? 'packaged(冻结 exe)' : 'daily(源码 run_windows.py)';
  log(`档位:${tier}`);

  const tempDir = mkdtempSync(join(tmpdir(), 'storyforge-smoke-'));
  const dbPath = join(tempDir, 'smoke.sqlite3').replace(/\\/g, '/');
  const databaseUrl = `sqlite:///${dbPath}`;
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  log(`端口 ${port},库 ${dbPath}`);

  let child;
  const serverLogs = [];
  try {
    child = startServer(port, databaseUrl);
    child.stdout?.on('data', (chunk) => serverLogs.push(String(chunk)));
    child.stderr?.on('data', (chunk) => serverLogs.push(String(chunk)));
    const exitedEarly = new Promise((_, reject) => {
      child.once('exit', (code) => reject(new Error(`服务进程提前退出,code=${code}`)));
    });

    const readyMs = await Promise.race([waitReady(baseUrl), exitedEarly]);
    log(`/health/ready 就绪耗时 ${readyMs}ms(冷启动预算 ${COLD_START_BUDGET_MS}ms)`);
    if (readyMs > COLD_START_BUDGET_MS) {
      log(`WARN: 冷启动超出预算 ${readyMs - COLD_START_BUDGET_MS}ms,请关注启动性能回归`);
    }

    const sessionId = await Promise.race([
      assistantRoundTrip(baseUrl, tempDir.replace(/\\/g, '/')),
      exitedEarly,
    ]);
    log(`assistant 会话往返通过(session id=${sessionId},零 LLM 调用)`);

    const streamFrameCount = await Promise.race([agentStreamRoundTrip(baseUrl), exitedEarly]);
    log(`Agent SSE stream 已建立并收到 ${streamFrameCount} 帧(零 LLM/零外网)`);

    await Promise.race([agentControlRoundTrip(baseUrl), exitedEarly]);
    log('Agent control REST 往返通过(未知类型 error 帧)');

    assertSchemaManagedByAlembic(serverLogs);
    log('sqlite schema 已由 alembic 纳管(managed=true)');

    assertPromptLayerBundled(serverLogs);
    log('分层 prompt 构建器已随 exe 打包(F05 死路已收口)');

    log(`OK: ${tier} 冒烟全绿`);
  } catch (error) {
    fail(error.message);
    const tail = serverLogs.join('').split('\n').slice(-25).join('\n');
    if (tail.trim()) console.error(`[sidecar-smoke] 服务端日志尾部:\n${tail}`);
  } finally {
    killTree(child);
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      log(`WARN: 临时目录清理失败(不影响结果):${tempDir}`);
    }
  }
}

await main();
