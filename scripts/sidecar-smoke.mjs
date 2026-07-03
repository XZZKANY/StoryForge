/**
 * sidecar-smoke:交付形态(单进程 sidecar + sqlite 文件库)的自动化冒烟门禁。
 *
 * daily 档(默认):以源码方式起 run_windows.py,验证与发布同构的启动路径。
 * packaged 档(--packaged):先构建 PyInstaller 冻结 exe(--skip-build 可复用现有产物),
 * 对冻结产物跑同一套 smoke——路径桥断裂 / hidden import / uvloop 一类故障只在冻结态暴露。
 *
 * 流程:临时 sqlite → 起服 → 轮询 /health/ready(记录冷启动耗时)→ 无 LLM 的
 * assistant 会话 REST 往返 → Agent WS 一轮(未知消息类型换取确定性 error 帧)→ 杀进程树。
 */

/* global AbortSignal, WebSocket -- Node 22 内置全局,eslint env 未收录 */
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

async function websocketRoundTrip(port) {
  const url = `ws://127.0.0.1:${port}/api/ide/agent/sessions/smoke-${process.pid}?api_key=${API_KEY}`;
  return await new Promise((resolveWs, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WS 往返超时(10s)'));
    }, 10_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'smoke_probe' }));
    });
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      socket.close();
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.type === 'error' && typeof frame.detail === 'string') {
          resolveWs(frame);
        } else {
          reject(new Error(`WS 回帧形状异常:${String(event.data)}`));
        }
      } catch (error) {
        reject(new Error(`WS 回帧非 JSON:${error.message}`));
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WS 连接失败'));
    });
  });
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

    await Promise.race([websocketRoundTrip(port), exitedEarly]);
    log('Agent WS 一轮通过(握手 + 收发 JSON 帧)');

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
