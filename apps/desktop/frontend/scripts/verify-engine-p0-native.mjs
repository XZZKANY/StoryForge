// Real ordinary debug WebView + official plugin globals; owned synthetic inputs only.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  createSmokeEnvironment,
  findFreeLoopbackApiBaseUrl,
  killProcessTree,
  waitForExit,
} from '../../scripts/verify-tauri-smoke.mjs';

assert.equal(process.platform, 'win32', 'P0 Native probe currently targets Windows WebView2');
const [mode, ...extra] = process.argv.slice(2);
assert.ok(
  [
    '--cpu-only',
    '--transport-only',
    '--all',
    '--context-only',
    '--reader-only',
    '--llm-only',
    '--assistant-only',
    '--assistant-real',
    '--agent-only',
  ].includes(mode) && extra.length === 0,
  'Use --cpu-only, --transport-only, --all or --context-only / --reader-only / --llm-only / --assistant-only / --assistant-real / --agent-only',
);
const REAL_CHAPTERS = {
  '正文/第001章.md':
    '# 第一章 停电\n\n城里停电的第三天，林舟在楼道里数到第十七级台阶，才听见楼上传来敲门声。\n\n' +
    '那声音很轻，三下一停，像是怕惊动什么。他握紧手里的消防斧，贴着墙往上走。四楼的门开着一条缝，' +
    '冷风从里面灌出来，带着一股铁锈味。\n\n' +
    '门后站着的是对门的老周。老周没说话，只把一张纸塞进他手里，纸上写着：别下楼，水厂那边出事了。\n',
  '正文/第002章.md':
    '# 第二章 水厂\n\n第二天一早，林舟还是下了楼。\n\n' +
    '街上没有人。积水漫过了人行道，倒映着灰白的天，远处水厂的方向升起一道黑烟，一直没有散。' +
    '他沿着墙根走，每走几步就停下来听一听，雨后的城市安静得过分，连鸟叫都没有。\n\n' +
    '拐过超市的时候，他看见了那辆翻倒的运水车。车门被什么东西从里面撕开了，边缘卷得像纸，地上的水是红的。\n',
};
const contextOnly = mode === '--context-only';
const readerOnly = mode === '--reader-only';
const llmOnly = mode === '--llm-only';
const assistantOnly = mode === '--assistant-only';
// Paid run with the author's provider: the encrypted config is copied in, the key stays in Rust.
const assistantReal = mode === '--assistant-real';
const p2 = llmOnly || assistantOnly || assistantReal;
// P3: the agent loop on the TS engine (routing, Worker regex, Rust .storyforge writer, controls).
const agentOnly = mode === '--agent-only';
const p3 = agentOnly;
const storeMode = assistantOnly || assistantReal || agentOnly;
const p1 = contextOnly || readerOnly;
const fixtureName = agentOnly
  ? 'engine-p3-agent'
  : assistantReal
    ? 'engine-p2-assistant-real'
    : assistantOnly
      ? 'engine-p2-assistant'
      : llmOnly
        ? 'engine-p2-llm'
        : readerOnly
          ? 'engine-p1-reader'
          : contextOnly
            ? 'engine-p1-context'
            : 'engine-p0';
const transports = mode === '--transport-only' || mode === '--all';
const label = p3 ? 'P3' : p2 ? 'P2' : p1 ? 'P1' : 'P0';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = resolve(root, 'apps/desktop/frontend');
const outputRoot = resolve(
  root,
  p3
    ? 'output/ts-engine-p3/native'
    : p2
      ? 'output/ts-engine-p2/native'
      : p1
        ? 'output/ts-engine-p1/native'
        : 'output/ts-engine-p0/native',
);
await mkdir(outputRoot, { recursive: true });
// Share the existing P0 lock: two probe modes must never race separate Native hosts.
const lockRoot = resolve(root, 'output/ts-engine-p0/native');
await mkdir(lockRoot, { recursive: true });
const lockPath = resolve(lockRoot, 'active.lock');
const lock = await open(lockPath, 'wx');
const output = await mkdtemp(resolve(outputRoot, 'run-'));
await lock.writeFile(JSON.stringify({ pid: process.pid, output }));
const directories = {
  localDataDir: resolve(output, 'local-data'),
  configDir: resolve(output, 'config'),
  webviewDataDir: resolve(output, 'webview2'),
};
// Windows Known Folder APIs resolve below USERPROFILE and require existing folders;
// LOCALAPPDATA alone does not isolate plugin HTTP cookies or SQL configuration.
const knownFolders = {
  home: resolve(output, 'home'),
  local: resolve(output, 'home/AppData/Local'),
  roaming: resolve(output, 'home/AppData/Roaming'),
  temp: resolve(output, 'temp'),
};
const hostRoot = resolve(output, 'startup-stub');
const apiDir = resolve(hostRoot, 'apps/api');
const executable = resolve(hostRoot, 'bin/storyforge-desktop.exe');
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
let vite,
  child,
  browser,
  build,
  httpServer,
  foreignServer,
  llmKey,
  contextInput,
  contextBefore,
  commandCount,
  readerInput,
  readerBefore;
const evidence = {
  synthetic: true,
  rendererMocks: false,
  ipcMocks: false,
  mode,
  output,
  errors: [],
};
const associatedHashes = async (path) => {
  const entries = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      entries.push([suffix || 'database', await hash(path + suffix)]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries.push([suffix || 'database', null]);
    }
  }
  return Object.fromEntries(entries);
};
function ownedPath(base, name) {
  const target = resolve(base, name);
  const local = relative(base, target);
  assert.ok(
    local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local),
    'Fixture path escaped owned root',
  );
  return target;
}
async function contextFingerprint(base, allowLinks = false) {
  const result = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = ownedPath(base, name);
      if (entry.isSymbolicLink()) {
        assert.ok(allowLinks, 'Plain context oracle unexpectedly contains a link');
        result.push({ path: name, kind: 'link', target: await readlink(path) });
        continue; // Fingerprint the link, never walk its target.
      }
      if (entry.isDirectory()) {
        result.push({ path: name, kind: 'directory' });
        await visit(path, name);
      } else {
        assert.ok(entry.isFile(), 'Unsupported fixture entry');
        const bytes = await readFile(path);
        result.push({
          path: name,
          kind: 'file',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  }
  await visit(base, '');
  return result;
}
try {
  const processes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'storyforge-desktop.exe' OR Name = 'storyforge-gui-fixture.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  );
  assert.ifError(processes.error);
  assert.equal(processes.status, 0, processes.stderr);
  assert.equal(processes.stdout.trim(), '', 'Existing Native app: refuse to reuse or kill it');
  for (const path of [
    ...Object.values(directories),
    ...Object.values(knownFolders),
    apiDir,
    resolve(hostRoot, 'bin'),
  ]) {
    await mkdir(path, { recursive: true });
  }
  // find_project_root prefers ancestor markers over STORYFORGE_ROOT. Copy the executable
  // under these owned markers so ordinary setup cannot import the author's API/.env.
  await writeFile(resolve(hostRoot, 'package.json'), '{"private":true,"synthetic":true}\n');
  await writeFile(resolve(hostRoot, 'docker-compose.yml'), '# P0 owned root marker only\n');
  await symlink(resolve(root, 'apps/api/.venv'), resolve(apiDir, '.venv'), 'junction');
  if (contextOnly) {
    const golden = JSON.parse(
      await readFile(resolve(root, 'packages/engine/golden/p1-context.windows.json'), 'utf8'),
    );
    const ownedRoot = resolve(output, 'context-projects');
    await mkdir(ownedRoot);
    contextInput = { ownedRoot: ownedRoot.replaceAll('\\', '/'), projects: {} };
    commandCount = 0;
    for (const fixture of golden.book_context) {
      assert.match(fixture.id, /^[a-z0-9-]+$/);
      const project = ownedPath(ownedRoot, fixture.id);
      await mkdir(project); // exclusive: duplicate fixture identities must fail, not overwrite
      contextInput.projects[fixture.id] = project.replaceAll('\\', '/');
      commandCount += fixture.commands.length;
      for (const [name, encoded] of Object.entries(fixture.files)) {
        const target = ownedPath(project, name);
        const chunks = encoded.chunks.map(({ base64, repeat }) => {
          assert.ok(Number.isSafeInteger(repeat) && repeat >= 0);
          return { bytes: Buffer.from(base64, 'base64'), repeat };
        });
        const length = chunks.reduce((sum, chunk) => sum + chunk.bytes.length * chunk.repeat, 0);
        assert.ok(
          Number.isSafeInteger(length) && length <= 16 * 1024 * 1024,
          'Unexpected fixture allocation',
        );
        const bytes = Buffer.alloc(length);
        let offset = 0;
        for (const chunk of chunks) {
          const end = offset + chunk.bytes.length * chunk.repeat;
          if (end > offset) bytes.fill(chunk.bytes, offset, end);
          offset = end;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
    }
    contextBefore = await contextFingerprint(ownedRoot);
    await writeFile(resolve(output, 'context-input.json'), JSON.stringify(contextInput, null, 2));
    await writeFile(resolve(output, 'context-before.json'), JSON.stringify(contextBefore, null, 2));
    evidence.contextProgress = [];
  }
  if (readerOnly) {
    const ownedRoot = resolve(output, 'reader-projects');
    const generated = spawnSync(
      resolve(root, 'apps/api/.venv/Scripts/python.exe'),
      [
        resolve(root, 'apps/api/scripts/golden_dump.py'),
        '--suite',
        'p1-reader',
        '--output',
        resolve(root, 'packages/engine/golden/p1-reader.windows.json'),
        '--check',
        '--fixture-root',
        ownedRoot,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 180000,
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          PYTHONUTF8: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
      },
    );
    await writeFile(resolve(output, 'reader-oracle.log'), generated.stdout + generated.stderr);
    assert.ifError(generated.error);
    assert.equal(generated.status, 0, generated.stderr);
    const golden = JSON.parse(
      await readFile(resolve(root, 'packages/engine/golden/p1-reader.windows.json'), 'utf8'),
    );
    evidence.readerExpected = {
      cases: golden.fixtures
        .filter((fixture) => fixture.skip === null)
        .reduce((sum, fixture) => sum + fixture.actions.length, 0),
      skipped: golden.fixtures
        .filter((fixture) => fixture.skip !== null)
        .map((fixture) => ({
          fixture: fixture.id,
          actions: fixture.actions.length,
          reason: fixture.skip,
        })),
    };
    readerInput = { ownedRoot: ownedRoot.replaceAll('\\', '/') };
    readerBefore = await contextFingerprint(ownedRoot, true);
    await writeFile(resolve(output, 'reader-input.json'), JSON.stringify(readerInput, null, 2));
    await writeFile(resolve(output, 'reader-before.json'), JSON.stringify(readerBefore, null, 2));
  }
  const tauriConfig = JSON.parse(
    await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  );
  let httpBaseUrl, sqlFixture, sqlBefore;
  if (transports) {
    const generated = spawnSync(
      resolve(root, 'apps/api/.venv/Scripts/python.exe'),
      [resolve(root, 'apps/api/scripts/engine_p0_sql_fixture.py'), '--output', output],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.ifError(generated.error);
    assert.equal(generated.status, 0, generated.stderr);
    sqlFixture = JSON.parse(await readFile(resolve(output, 'sql-fixture.json'), 'utf8'));
    sqlBefore = {
      original: await associatedHashes(sqlFixture.original),
      readonly: await associatedHashes(sqlFixture.readonly),
    };
    const expectedText = 'data: {"text":"你好𠀀"}\n\ndata: [DONE]\n\n';
    const bytes = Buffer.from(expectedText);
    const start = bytes.indexOf(Buffer.from('你'));
    const boundaries = [0, start + 1, start + 4, start + 8, bytes.length - 5, bytes.length];
    const chunks = boundaries.slice(1).map((end, index) => bytes.subarray(boundaries[index], end));
    evidence.httpServer = { expectedText, records: [] };
    httpServer = createHttpServer((request, response) => {
      const record = { path: request.url, requestedAt: Date.now(), emissions: [], endedAt: null };
      evidence.httpServer.records.push(record);
      let timer;
      response.on('close', () => {
        clearTimeout(timer);
        record.closedAt = Date.now();
        record.writableFinished = response.writableFinished;
      });
      if (request.url === '/p0/error') {
        response.writeHead(503, { 'Content-Type': 'text/plain' });
        response.end('synthetic provider unavailable');
        record.endedAt = Date.now();
      } else if (request.url === '/p0/stream') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        let index = 0;
        const emit = () => {
          const chunk = chunks[index++];
          record.emissions.push({ emittedAt: Date.now(), bytes: Array.from(chunk) });
          response.write(chunk);
          if (index < chunks.length)
            timer = setTimeout(emit, 200); // explicit fixture schedule
          else {
            record.endedAt = Date.now();
            response.end();
          }
        };
        emit();
      } else if (['/p0/cancel-reader', '/p0/cancel-signal'].includes(request.url)) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: ready\n\n'); // remain open until the Native client cancels
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    httpBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  }
  const storeLogPath = resolve(output, 'store-log.json');
  let assistantProject, assistantBefore;
  if (assistantOnly) {
    assistantProject = ownedPath(output, 'book');
    await mkdir(resolve(assistantProject, '正文'), { recursive: true });
    await writeFile(
      resolve(assistantProject, '正文/第001章.md'),
      '第一章开头。\n\n雨夜里他推开门，钟声响了三下。\n',
    );
    await writeFile(resolve(assistantProject, '正文/第002章.md'), '第二章上文。\n');
    assistantBefore = await contextFingerprint(assistantProject);
  }
  if (assistantReal) {
    assistantProject = ownedPath(output, 'book');
    await mkdir(resolve(assistantProject, '正文'), { recursive: true });
    for (const [name, text] of Object.entries(REAL_CHAPTERS))
      await writeFile(resolve(assistantProject, name), text);
    assistantBefore = await contextFingerprint(assistantProject);
  }
  let agentProject, agentBefore;
  if (agentOnly) {
    agentProject = ownedPath(output, 'book');
    await mkdir(resolve(agentProject, '正文'), { recursive: true });
    await mkdir(resolve(agentProject, '人物'), { recursive: true });
    await writeFile(resolve(agentProject, '正文/第001章.md'), '第一章 风起\n\n雨夜里他推开门。\n');
    await writeFile(resolve(agentProject, '正文/第002章.md'), '第二章 夜行\n\n钟声响了三下。\n');
    await writeFile(resolve(agentProject, '人物/主角.md'), '# 林舟\n\n左臂有旧伤。\n');
    agentBefore = await contextFingerprint(agentProject);
    // Synthetic key generated per run: it must reach the provider, never the WebView.
    llmKey = `sk-p3-synthetic-${randomBytes(12).toString('hex')}`;
    const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
    const delta = (value, finish) =>
      event({
        choices: [{ index: 0, delta: value, ...(finish ? { finish_reason: finish } : {}) }],
      });
    const call = (index, id, name, args) =>
      delta({
        tool_calls: [
          { index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      });
    const tail =
      event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }) +
      'data: [DONE]\n\n';
    // One scripted stream per model request, in order: run A tool round, run A answer, run B slow answer.
    const script = [
      [
        call(0, 'c1', 'fs_search', { query: '钟.|雨夜', use_regex: true }),
        call(1, 'c2', 'project_plan_update', {
          chapters: [{ ordinal: 3, title: '入城', goal: '沈禾带林舟入城' }],
        }),
        delta({}, 'tool_calls'),
        tail,
      ],
      [
        delta({ content: '找到了' }),
        delta({ content: '两处，' }),
        delta({ content: '计划已记下。' }),
        delta({}, 'stop'),
        tail,
      ],
      [
        ...Array.from({ length: 25 }, (_, index) => delta({ content: `慢${index}` })),
        delta({}, 'stop'),
        tail,
      ],
    ];
    evidence.llmServer = { records: [], foreign: [] };
    httpServer = createHttpServer((request, response) => {
      const record = {
        method: request.method,
        path: request.url,
        authorization:
          request.headers.authorization === `Bearer ${llmKey}`
            ? 'real-key'
            : (request.headers.authorization ?? null),
        requestedAt: Date.now(),
        endedAt: null,
      };
      evidence.llmServer.records.push(record);
      let timer;
      response.on('close', () => {
        clearTimeout(timer);
        record.closedAt = Date.now();
        record.writableFinished = response.writableFinished;
      });
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = null;
        }
        record.stream = body?.stream === true;
        record.tools = Array.isArray(body?.tools) ? body.tools.length : 0;
        const events =
          request.method === 'POST' && request.url === '/v1/chat/completions' && record.stream
            ? script[evidence.llmServer.records.filter((item) => item.stream).length - 1]
            : null;
        if (!events) {
          response.writeHead(500, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'unscripted request' } }));
          record.endedAt = Date.now();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let index = 0;
        const emit = () => {
          response.write(events[index++]);
          if (index < events.length)
            timer = setTimeout(emit, 200); // explicit fixture schedule
          else {
            record.endedAt = Date.now();
            response.end();
          }
        };
        emit();
      });
    });
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    httpBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  }
  if (llmOnly || assistantOnly) {
    // Synthetic key generated per run: it must reach the provider, never the WebView.
    llmKey = `sk-p2-synthetic-${randomBytes(12).toString('hex')}`;
    const sse = [
      'data: {"choices":[{"delta":{"content":"合成"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"流式"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"回放"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\ndata: [DONE]\n\n',
    ];
    evidence.llmServer = { records: [], foreign: [] };
    httpServer = createHttpServer((request, response) => {
      const record = {
        method: request.method,
        path: request.url,
        authorization:
          request.headers.authorization === `Bearer ${llmKey}`
            ? 'real-key'
            : (request.headers.authorization ?? null),
        requestedAt: Date.now(),
        endedAt: null,
      };
      evidence.llmServer.records.push(record);
      let timer;
      response.on('close', () => {
        clearTimeout(timer);
        record.closedAt = Date.now();
        record.writableFinished = response.writableFinished;
      });
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        record.stream = Buffer.concat(chunks).toString('utf8').includes('"stream": true');
        const echo = request.headers.authorization ?? '';
        if (request.method === 'POST' && request.url === '/v1/chat/completions' && record.stream) {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          let index = 0;
          const emit = () => {
            response.write(sse[index++]);
            if (index < sse.length)
              timer = setTimeout(emit, 200); // explicit fixture schedule
            else {
              record.endedAt = Date.now();
              response.end();
            }
          };
          emit();
        } else if (request.method === 'POST' && request.url === '/v1/chat/completions') {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: `invalid key ${echo}` } }));
          record.endedAt = Date.now();
        } else if (request.url === '/v1/models') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'X-Echo': echo });
          response.end(JSON.stringify({ data: [{ id: 'p2-model' }], echo }));
          record.endedAt = Date.now();
        } else if (request.url === '/v1/slow') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          let index = 0;
          const emit = () => {
            response.write(`data: slow-${index++}\n\n`);
            if (index < 25) timer = setTimeout(emit, 200);
            else {
              record.endedAt = Date.now();
              response.end();
            }
          };
          emit();
        } else {
          response.writeHead(404);
          response.end();
        }
      });
    });
    foreignServer = createHttpServer((request, response) => {
      evidence.llmServer.foreign.push({ method: request.method, path: request.url });
      response.writeHead(200);
      response.end('foreign');
    });
    for (const server of [httpServer, foreignServer])
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    httpBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    evidence.llmServer.foreignUrl = `http://127.0.0.1:${foreignServer.address().port}/steal`;
  }
  const assistantScript = `import json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
VERSION = ${JSON.stringify(tauriConfig.version)}
LOG_PATH = ${JSON.stringify(storeLogPath)}
STATE = {'log': [], 'sessions': {}, 'titles': {}, 'messages': {}, 'tools': {}, 'rows': {}, 'next': 1}
LOCK = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-StoryForge-API-Key')
        self.send_header('Content-Length', '0')
        self.end_headers()
    def do_GET(self):
        if self.path in ('/health/ready', '/health/live'):
            return self.send_json(200, {'status': 'ready', 'app_version': VERSION, 'synthetic': True})
        self.store('GET')
    def do_POST(self):
        self.store('POST')
    def do_PATCH(self):
        self.store('PATCH')
    def store(self, method):
        if not self.path.startswith('/api/assistant/'):
            return self.send_json(404, {'detail': 'unknown route'})
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length).decode('utf-8')) if length else None
        parts = self.path.split('/')[3:]
        with LOCK:
            STATE['log'].append({'method': method, 'path': self.path,
                                 'key': self.headers.get('X-StoryForge-API-Key'), 'body': body})
            with open(LOG_PATH, 'w', encoding='utf-8') as handle:
                json.dump(STATE['log'], handle, ensure_ascii=False)
            new_id = STATE['next']
            if method == 'POST' and parts == ['sessions']:
                STATE['next'] += 1
                STATE['sessions'][new_id] = body.get('project_path')
                STATE['titles'][new_id] = body.get('title') or ''
                STATE['messages'][new_id] = []
                return self.send_json(201, {'id': new_id, 'title': STATE['titles'][new_id],
                                            'project_path': body.get('project_path'), 'messages': []})
            if parts[:1] == ['sessions'] and len(parts) >= 2 and parts[1].isdigit():
                session_id = int(parts[1])
                if session_id not in STATE['sessions']:
                    return self.send_json(404, {'detail': 'Assistant 会话不存在：%d。' % session_id})
                if method == 'GET' and len(parts) == 2:
                    return self.send_json(200, {'id': session_id, 'title': STATE['titles'][session_id],
                                                'project_path': STATE['sessions'][session_id],
                                                'messages': STATE['messages'][session_id]})
                if method == 'GET' and parts[2:] == ['tool-calls']:
                    return self.send_json(200, [row for row in STATE['rows'].values()
                                                if row['session_id'] == session_id])
                if method == 'POST' and parts[2:] == ['messages']:
                    STATE['next'] += 1
                    STATE['messages'][session_id].append({'id': new_id, 'role': body.get('role'),
                                                          'content': body.get('content')})
                    return self.send_json(201, {'id': new_id})
                if method == 'POST' and parts[2:] == ['tool-calls']:
                    STATE['next'] += 1
                    STATE['tools'][new_id] = body.get('input_summary') or {}
                    STATE['rows'][new_id] = {'id': new_id, 'session_id': session_id, 'tool_name': body.get('tool_name'),
                                             'status': body.get('status'), 'input_summary': STATE['tools'][new_id],
                                             'output_summary': body.get('output_summary') or {},
                                             'related_type': None, 'related_id': None}
                    return self.send_json(201, {'id': new_id, 'input_summary': STATE['tools'][new_id]})
            if method == 'PATCH' and parts[:1] == ['tool-calls'] and int(parts[1]) in STATE['tools']:
                tool_id = int(parts[1])
                if 'input_summary' in body:
                    STATE['tools'][tool_id] = body['input_summary']
                row = STATE['rows'][tool_id]
                row['input_summary'] = STATE['tools'][tool_id]
                for key in ('status', 'output_summary'):
                    if body.get(key) is not None:
                        row[key] = body[key]
                return self.send_json(200, {'id': tool_id, 'input_summary': STATE['tools'][tool_id]})
            self.send_json(404, {'detail': 'unknown assistant route'})
ThreadingHTTPServer(('127.0.0.1', int(os.environ['STORYFORGE_API_PORT'])), Handler).serve_forever()
`;
  await writeFile(
    resolve(apiDir, 'run_windows.py'),
    storeMode
      ? assistantScript
      : `import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/health/ready', '/health/live'):
            self.send_error(404)
            return
        payload = json.dumps({'status': 'ready', 'app_version': ${JSON.stringify(tauriConfig.version)}, 'synthetic': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
ThreadingHTTPServer(('127.0.0.1', int(os.environ['STORYFORGE_API_PORT'])), Handler).serve_forever()
`,
  );
  if (assistantReal)
    await copyFile(
      resolve(process.env.APPDATA, 'com.storyforge.ide', 'llm-provider.json'),
      resolve(directories.configDir, 'llm-provider.json'),
    );
  else
    await writeFile(
      resolve(directories.configDir, 'llm-provider.json'),
      JSON.stringify(
        p2 || p3
          ? {
              provider: 'openai-compatible',
              baseUrl: `${httpBaseUrl}/v1`,
              model: 'p2-model',
              apiKey: llmKey,
            }
          : {
              provider: 'custom',
              baseUrl: 'http://127.0.0.1:1',
              model: 'p0-unused',
              apiKey: 'synthetic-unused',
            },
      ),
    );
  vite = await createServer({
    root: frontend,
    configFile: false,
    envFile: false,
    cacheDir: resolve(output, 'vite-cache'),
    server: { host: 'localhost', port: 3007, strictPort: true, fs: { allow: [root] } },
    plugins: [
      {
        name: 'engine-native-entry',
        configureServer(server) {
          server.middlewares.use('/', async (req, res, next) => {
            if (req.url !== '/') return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(
              await server.transformIndexHtml(
                '/',
                `<html><body><h1>${label} Native synthetic probe</h1><script type="module" src="/scripts/fixtures/${fixtureName}.ts"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
  });
  await vite.listen(); // strictPort: never reuse the author's dev server.
  const overlay = {
    productName: `StoryForge ${label} Probe`,
    identifier: `com.storyforge.engine.${label.toLowerCase()}`,
    app: {
      security: {
        capabilities: [
          {
            identifier: `${label.toLowerCase()}-probe`,
            windows: ['main'],
            permissions: [
              'core:default',
              ...(transports
                ? [
                    { identifier: 'http:default', allow: [{ url: `${httpBaseUrl}/p0/*` }] },
                    'sql:default',
                    'sql:allow-execute',
                  ]
                : []),
            ],
          },
        ],
      },
    },
  };
  await writeFile(resolve(output, 'tauri-overlay.json'), JSON.stringify(overlay, null, 2));
  build = spawn(
    'cargo',
    [
      'build',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--bin',
      'storyforge-desktop',
      '--no-default-features',
      '--locked',
      '--offline',
    ],
    {
      cwd: resolve(root, 'apps/desktop'),
      env: { ...process.env, TAURI_CONFIG: JSON.stringify(overlay) },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const buildLog = createWriteStream(resolve(output, 'build.log'));
  build.stdout.pipe(buildLog, { end: false });
  build.stderr.pipe(buildLog, { end: false });
  assert.equal(await waitForExit(build, 'P0 ordinary debug build', 600000), 0);
  buildLog.end();
  await copyFile(
    resolve(root, 'apps/desktop/src-tauri/target/debug/storyforge-desktop.exe'),
    executable,
  );
  const apiBaseUrl = await findFreeLoopbackApiBaseUrl();
  const cdpBaseUrl = await findFreeLoopbackApiBaseUrl();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|SYSTEMDRIVE)$/i.test(name),
    ),
  );
  const env = createSmokeEnvironment(inherited, apiBaseUrl, directories);
  delete env.STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH;
  Object.assign(env, {
    HOME: knownFolders.home,
    USERPROFILE: knownFolders.home,
    APPDATA: knownFolders.roaming,
    LOCALAPPDATA: knownFolders.local,
    TEMP: knownFolders.temp,
    TMP: knownFolders.temp,
    STORYFORGE_ROOT: hostRoot,
    STORYFORGE_API_KEY: 'synthetic-p0-api',
    STORYFORGE_DESKTOP_USE_API_SIDECAR: '0',
    STORYFORGE_DESKTOP_SMOKE_LIFECYCLE_ONLY: '1',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${new URL(cdpBaseUrl).port} --remote-debugging-address=127.0.0.1`,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  });
  const nativeStartedAt = Date.now();
  child = spawn(executable, [], {
    cwd: hostRoot,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(createWriteStream(resolve(output, 'native-stdout.log')));
  child.stderr.pipe(createWriteStream(resolve(output, 'native-stderr.log')));
  child.on('error', (error) => evidence.errors.push(error.message));
  Object.assign(evidence, {
    pid: child.pid,
    executable,
    executableSha256: await hash(executable),
    apiBaseUrl,
    cdpBaseUrl,
    directories,
    knownFolders,
    overlay,
    locks: {
      cargo: await hash(resolve(root, 'apps/desktop/src-tauri/Cargo.lock')),
      pnpm: await hash(resolve(root, 'pnpm-lock.yaml')),
      frontend: await hash(resolve(frontend, 'package-lock.json')),
    },
    startup: 'ordinary debug setup + owned Python stdlib health stub; not a backend-free boot',
    sources: {
      fixture: await hash(resolve(frontend, `scripts/fixtures/${fixtureName}.ts`)),
      harness: await hash(fileURLToPath(import.meta.url)),
      sqlGenerator: await hash(resolve(root, 'apps/api/scripts/engine_p0_sql_fixture.py')),
      main: await hash(resolve(root, 'apps/desktop/src-tauri/src/main.rs')),
    },
  });
  if (contextOnly) {
    evidence.contextSources = {};
    const sourcePaths = [
      'packages/engine/golden/p1-context.windows.json',
      'packages/engine/src/index.ts',
      'packages/engine/src/readPort.ts',
      'packages/project-core/src/path.ts',
      'apps/desktop/frontend/src/lib/engine/reader.ts',
      'apps/desktop/frontend/src/lib/book-context.ts',
      'apps/desktop/src-tauri/src/fs.rs',
      'apps/desktop/src-tauri/src/fs_engine_reader.rs',
    ];
    sourcePaths.push(
      ...(await readdir(resolve(root, 'packages/engine/src/kernel')))
        .filter((name) => /\.(ts|json)$/.test(name) && !name.includes('.test'))
        .map((name) => 'packages/engine/src/kernel/' + name),
    );
    for (const name of sourcePaths) evidence.contextSources[name] = await hash(resolve(root, name));
  }
  if (readerOnly) {
    evidence.readerSources = {};
    for (const name of [
      'apps/api/scripts/golden_dump.py',
      'apps/api/scripts/golden_project_reader.py',
      'apps/api/app/common/project_tree.py',
      'packages/engine/golden/p1-reader.windows.json',
      'packages/engine/src/readPort.ts',
      'packages/engine/src/kernel/projectTree.ts',
      'packages/project-core/src/path.ts',
      'apps/desktop/frontend/src/lib/engine/reader.ts',
      'apps/desktop/src-tauri/src/fs.rs',
      'apps/desktop/src-tauri/src/fs_engine_reader.rs',
    ])
      evidence.readerSources[name] = await hash(resolve(root, name));
  }
  console.log(`${label} Native evidence:`, output);
  const deadline = Date.now() + 60000;
  while (!browser && Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Owned Native host exited before CDP');
    try {
      browser = await chromium.connectOverCDP(cdpBaseUrl);
    } catch {
      await delay(200);
    } // bounded readiness, not a transport/semantic fallback
  }
  assert.ok(browser, 'Owned WebView2 CDP endpoint did not start');
  const pages = browser.contexts().flatMap((context) => context.pages());
  assert.equal(pages.length, 1, 'Expected exactly one isolated Native page');
  const page = pages[0];
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  if (contextOnly)
    page.on('console', (message) => {
      const text = message.text();
      if (text.startsWith('ENGINE_P1_START ')) evidence.activeContextCase = text.slice(16);
      if (text.startsWith('ENGINE_P1_CASE ')) {
        try {
          evidence.contextProgress.push(JSON.parse(text.slice(15)));
        } catch {
          evidence.errors.push('Invalid Native context progress frame');
        }
      }
    });
  await page.waitForFunction(
    (key) => document.documentElement.dataset[key] === 'true',
    agentOnly
      ? 'engineP3AgentReady'
      : assistantReal
        ? 'engineP2AssistantRealReady'
        : assistantOnly
          ? 'engineP2AssistantReady'
          : llmOnly
            ? 'engineP2LlmReady'
            : readerOnly
              ? 'engineP1ReaderReady'
              : contextOnly
                ? 'engineP1Ready'
                : 'engineP0Ready',
  );
  evidence.nativeReadyMs = Date.now() - nativeStartedAt;
  let timer;
  try {
    await Promise.race([
      (async () => {
        if (transports) {
          evidence.http = await page.evaluate(
            (baseUrl) => window.__ENGINE_P0__.runHttpProbe(baseUrl),
            httpBaseUrl,
          );
          const stream = evidence.httpServer.records.find((record) => record.path === '/p0/stream');
          assert.equal(evidence.http.stream.status, 200);
          assert.equal(evidence.http.stream.text, evidence.httpServer.expectedText);
          assert.ok(evidence.http.stream.chunks.length > 1, 'HTTP buffered the complete response');
          const first = evidence.http.stream.chunks[0];
          assert.ok(
            first.visibleText.length > 0 && first.receivedAt < stream.endedAt,
            'No text was visible before the controlled stream ended',
          );
          evidence.http.firstChunkMs = first.receivedAt - evidence.http.stream.startedAt;
          assert.ok(evidence.http.firstChunkMs < 3000);
          assert.deepEqual(evidence.http.error, {
            status: 503,
            ok: false,
            text: 'synthetic provider unavailable',
          });
          const cancelDeadline = Date.now() + 5000;
          while (
            Date.now() < cancelDeadline &&
            evidence.httpServer.records
              .filter((record) => record.path.startsWith('/p0/cancel-'))
              .some((record) => !record.closedAt)
          ) {
            await delay(25);
          }
          for (const record of evidence.httpServer.records.filter((record) =>
            record.path.startsWith('/p0/cancel-'),
          )) {
            assert.ok(
              record.closedAt && !record.writableFinished,
              'Native cancellation did not close the server stream',
            );
          }
          assert.equal(
            evidence.httpServer.records.some((record) => record.path === '/outside'),
            false,
          );
          evidence.sql = await page.evaluate(
            (input) => window.__ENGINE_P0__.runSqlProbe(input),
            sqlFixture,
          );
          assert.deepEqual(evidence.sql.actual, sqlFixture.expected);
          assert.match(evidence.sql.appConfigDir, /[\\/]com\.storyforge\.engine\.p0[\\/]*$/);
          evidence.sql.appConfigEntries = await readdir(evidence.sql.appConfigDir);
          assert.deepEqual(
            evidence.sql.appConfigEntries,
            [],
            'Unexpected database under OS app-config instead of owned output',
          );
          assert.deepEqual(evidence.sql.afterWrites, sqlFixture.expected.sessions);
          assert.equal(evidence.sql.oldPath[0].file.replaceAll('\\', '/'), sqlFixture.readonly);
          assert.equal(evidence.sql.newPath[0].file.replaceAll('\\', '/'), sqlFixture.new);
          assert.deepEqual(evidence.sql.journalMode, [{ journal_mode: 'wal' }]);
          assert.deepEqual(evidence.sql.schemaVersion, [{ version: 1 }]);
          assert.deepEqual(evidence.sql.newRows, [
            { id: 1, text: '合成新库𠀀\r\n', payload: '{"nested":[true,null,1]}' },
          ]);
          await assert.rejects(readFile(sqlFixture.missing), { code: 'ENOENT' });
          evidence.sql.during = await associatedHashes(sqlFixture.readonly);
          await page.evaluate(() => window.__ENGINE_P0__.closeSqlProbe());
          evidence.sql.before = sqlBefore;
          evidence.sql.after = {
            original: await associatedHashes(sqlFixture.original),
            readonly: await associatedHashes(sqlFixture.readonly),
          };
          assert.deepEqual(
            evidence.sql.after,
            sqlBefore,
            'Read-only query changed database or associated files',
          );
          assert.equal(
            resolve(evidence.sql.appConfigDir),
            resolve(knownFolders.roaming, overlay.identifier),
            'SQL plugin config escaped the owned Windows profile',
          );
          evidence.sql.schemaBelow100Ms = evidence.sql.schemaMs < 100;
        }
        if (contextOnly) {
          evidence.context = await page.evaluate(
            (input) => window.__ENGINE_P1__.runContextProbe(input),
            contextInput,
          );
          assert.equal(evidence.context.native, true);
          assert.equal(evidence.context.rows.length, commandCount);
          const after = await contextFingerprint(contextInput.ownedRoot);
          await writeFile(resolve(output, 'context-after.json'), JSON.stringify(after, null, 2));
          assert.deepEqual(
            after,
            contextBefore,
            'Native context changed the owned file tree or bytes',
          );
          for (const [name, expected] of Object.entries(evidence.contextSources))
            assert.equal(
              await hash(resolve(root, name)),
              expected,
              `Source changed during probe: ${name}`,
            );
          evidence.context.contentUnchanged = true;
          evidence.context.traceScope =
            'four real ProjectReader calls plus final tree/content hashes; not an OS-wide write audit';
          delete evidence.contextProgress;
          delete evidence.activeContextCase;
        }
        if (readerOnly) {
          evidence.reader = await page.evaluate(
            (input) => window.__ENGINE_P1_READER__.runReaderProbe(input),
            readerInput,
          );
          assert.equal(evidence.reader.native, true);
          assert.equal(evidence.reader.rows.length, evidence.readerExpected.cases);
          assert.deepEqual(evidence.reader.skipped, evidence.readerExpected.skipped);
          const after = await contextFingerprint(readerInput.ownedRoot, true);
          await writeFile(resolve(output, 'reader-after.json'), JSON.stringify(after, null, 2));
          assert.deepEqual(after, readerBefore, 'Native reader changed the owned fixtures');
          evidence.reader.contentUnchanged = true;
          evidence.reader.traceScope =
            'real reader calls plus no-follow final tree/content hashes; not an OS-wide write audit';
          for (const [name, expected] of Object.entries(evidence.readerSources))
            assert.equal(
              await hash(resolve(root, name)),
              expected,
              `Source changed during probe: ${name}`,
            );
          assert.deepEqual(
            evidence.reader.rows
              .filter((row) => !row.matched)
              .map((row) => `${row.fixture}/${row.action}`),
            [],
            'Native reader differs from Python',
          );
        }
        if (llmOnly) {
          evidence.llm = await page.evaluate(
            (input) => window.__ENGINE_P2_LLM__.runLlmProbe(input),
            { foreignUrl: evidence.llmServer.foreignUrl },
          );
          const placeholder = evidence.llm.secrets[0];
          assert.equal(evidence.llm.native, true);
          assert.equal(evidence.llm.secrets.length, 1);
          assert.deepEqual(evidence.llm.source, {
            STORYFORGE_LLM_API_BASE_URL: `${httpBaseUrl}/v1`,
            STORYFORGE_LLM_API_KEY: placeholder,
            STORYFORGE_LLM_BASE_URL: `${httpBaseUrl}/v1`,
            STORYFORGE_LLM_MODEL: 'p2-model',
            STORYFORGE_LLM_PROVIDER: 'openai-compatible',
            STORYFORGE_LLM_TIMEOUT_SECONDS: '60.0',
          });
          assert.ok(Object.values(evidence.llm.polishSource).every((value) => value === ''));
          const records = evidence.llmServer.records;
          const stream = records.find((record) => record.stream);
          assert.ok(stream && stream.authorization === 'real-key', 'Provider never saw the key');
          assert.equal(evidence.llm.deltas.map((delta) => delta.text).join(''), '合成流式回放');
          assert.ok(
            evidence.llm.deltas.length >= 3 && evidence.llm.deltas[0].receivedAt < stream.endedAt,
            'No delta was visible before the synthetic stream ended',
          );
          evidence.llm.firstDeltaMs = evidence.llm.deltas[0].receivedAt - evidence.llm.startedAt;
          assert.equal(evidence.llm.done.content, '合成流式回放');
          assert.equal(evidence.llm.done.token_usage, 7);
          assert.match(evidence.llm.failure.message, /HTTP 401/);
          assert.match(evidence.llm.failure.message, /\[REDACTED\]/);
          assert.equal(evidence.llm.models.status, 200);
          assert.equal(evidence.llm.models.headers['x-echo'], `Bearer ${placeholder}`);
          assert.ok(evidence.llm.models.body.includes(`Bearer ${placeholder}`));
          assert.equal(evidence.llm.refusals.foreign.name, 'LlmConfigError');
          assert.equal(evidence.llm.refusals.header.name, 'LlmConfigError');
          assert.deepEqual(evidence.llmServer.foreign, [], 'Foreign origin was contacted');
          assert.equal(
            records.filter((record) => record.path === '/v1/models').length,
            1,
            'A refused request reached the provider',
          );
          assert.equal(evidence.llm.slow.first, 'data: slow-0\n\n');
          const slow = records.find((record) => record.path === '/v1/slow');
          const closeDeadline = Date.now() + 5000;
          while (Date.now() < closeDeadline && !slow.closedAt) await delay(25);
          assert.ok(slow.closedAt && !slow.writableFinished, 'close() did not abort the stream');
          const stored = await readFile(
            resolve(directories.configDir, 'llm-provider.json'),
            'utf8',
          );
          assert.equal(JSON.parse(stored).schemaVersion, 2);
          assert.ok(!stored.includes(llmKey), 'Config kept the plaintext key');
          assert.ok(
            !JSON.stringify(evidence).includes(llmKey),
            'The real key reached the WebView or evidence',
          );
        }
        if (assistantOnly) {
          evidence.assistant = await page.evaluate(
            (input) => window.__ENGINE_P2_ASSISTANT__.runAssistantProbe(input),
            { projectRoot: assistantProject },
          );
          const result = evidence.assistant;
          assert.equal(result.native, true);
          assert.equal(result.revise.after, '合成流式回放');
          assert.equal(result.revise.model, 'p2-model');
          assert.equal(
            result.revise.summary,
            `已按指令修订 ${assistantProject}\\正文\\第002章.md，修订后约 6 字。`,
          );
          assert.equal(result.continued.text, '合成流式回放');
          assert.equal(result.deltas.map((delta) => delta.text).join(''), '合成流式回放');
          assert.equal(result.cancelled?.name, 'RunInterrupted', 'Cancelling did not interrupt');
          assert.equal(result.missing?.message, 'Assistant 会话不存在：999。');
          assert.deepEqual(
            {
              status: result.health.status,
              baseUrl: result.health.baseUrl,
              model: result.health.model,
              models: result.health.models,
            },
            { status: 'ok', baseUrl: `${httpBaseUrl}/v1`, model: 'p2-model', models: ['p2-model'] },
          );
          const streams = evidence.llmServer.records.filter((record) => record.stream);
          assert.equal(streams.length, 3, 'Expected revise, continue and cancelled streams');
          assert.ok(
            streams.every((record) => record.authorization === 'real-key'),
            'Provider never saw the key',
          );
          assert.ok(
            result.deltas.length >= 3 && result.deltas[0].receivedAt < streams[1].endedAt,
            'No continuation delta was visible before its stream ended',
          );
          evidence.assistant.firstDeltaMs = result.deltas[0].receivedAt - streams[1].requestedAt;
          const closeDeadline = Date.now() + 5000;
          while (Date.now() < closeDeadline && !streams[2].closedAt) await delay(25);
          assert.ok(
            streams[2].closedAt && !streams[2].writableFinished,
            'Cancelling did not close the Native stream',
          );
          const log = JSON.parse(await readFile(storeLogPath, 'utf8'));
          evidence.storeLog = log;
          assert.ok(
            log.every((entry) => entry.key === 'synthetic-p0-api'),
            'Store auth missing',
          );
          const shape = log.map((entry) => `${entry.method} ${entry.path.replace(/\d+/g, 'N')}`);
          assert.deepEqual(shape, [
            'POST /api/assistant/sessions',
            'POST /api/assistant/sessions/N/tool-calls',
            'PATCH /api/assistant/tool-calls/N',
            'PATCH /api/assistant/tool-calls/N',
            'POST /api/assistant/sessions/N/messages',
            'GET /api/assistant/sessions/N',
            'POST /api/assistant/sessions/N/messages',
            'POST /api/assistant/sessions/N/tool-calls',
            'PATCH /api/assistant/tool-calls/N',
            'PATCH /api/assistant/tool-calls/N',
            'POST /api/assistant/sessions/N/messages',
            'POST /api/assistant/sessions',
            'POST /api/assistant/sessions/N/tool-calls',
            'PATCH /api/assistant/tool-calls/N',
            'PATCH /api/assistant/tool-calls/N',
            'GET /api/assistant/sessions/N',
          ]);
          assert.equal(log[0].body.task_type, 'desktop_revise');
          assert.equal(log[0].body.project_path, assistantProject);
          assert.equal(log[3].body.status, 'completed');
          const continueCall = log[7].body.input_summary;
          assert.equal(continueCall.previous_chapter, '正文/第001章.md');
          assert.equal(
            log[8].body.input_summary.generation_sources.writing_context.current_file,
            '正文/第002章.md',
          );
          assert.equal(log[9].body.status, 'completed');
          assert.deepEqual(
            [log[14].body.status, log[14].body.output_summary.interruption_reason],
            ['paused', 'stopped'],
          );
          assert.deepEqual(
            await contextFingerprint(assistantProject),
            assistantBefore,
            'The assistant probe wrote into the project',
          );
          assert.ok(
            !JSON.stringify(log).includes(llmKey),
            'The real key reached the session store',
          );
          assert.ok(
            !JSON.stringify(evidence).includes(llmKey),
            'The real key reached the WebView or evidence',
          );
        }
        if (agentOnly) {
          evidence.agent = await page.evaluate(
            (input) => window.__ENGINE_P3_AGENT__.runAgentProbe(input),
            { projectRoot: agentProject },
          );
          const result = evidence.agent;
          assert.equal(result.native, true);
          // Worker regex: the runaway match is cut off by the watchdog and the page keeps ticking.
          assert.deepEqual([result.runaway.failure, result.runaway.hits], ['timeout', []]);
          assert.ok(result.runawayMs >= 1000 && result.runawayMs < 5000, 'Watchdog timing');
          assert.ok(result.ticks >= 10, 'The page stopped ticking while the regex ran');
          assert.deepEqual(result.quick.hits, [0, 1]);
          // Run A: a tool round then a streamed answer, all in the WebView.
          assert.equal(result.result.type, 'agent_result');
          assert.ok(
            JSON.stringify(result.result).includes('找到了两处，计划已记下。'),
            'Answer missing',
          );
          const tools = result.frames.filter((frame) => frame.tool).map((frame) => frame.tool);
          assert.ok(
            tools.includes('fs.search') && tools.includes('project.plan_update'),
            'Tool traces missing',
          );
          const search = result.frames.find((frame) => frame.tool === 'fs.search');
          assert.equal(search.summary?.match_count, 2, 'Regex search did not find both lines');
          const streams = evidence.llmServer.records.filter((record) => record.stream);
          assert.equal(streams.length, 3, 'Expected two rounds for run A and one stream for run B');
          assert.ok(
            streams.every((record) => record.authorization === 'real-key'),
            'Provider never saw the key',
          );
          assert.ok(streams[0].tools > 0, 'The loop request carried no tools');
          const deltas = result.frames.filter((frame) => frame.type === 'agent_text_delta');
          assert.ok(
            deltas.length >= 1 && deltas[0].receivedAt < streams[1].endedAt,
            'No delta before the answer ended',
          );
          evidence.agent.firstDeltaMs = deltas[0].receivedAt - streams[1].requestedAt;
          assert.ok(
            result.events.includes('agent_run_completed'),
            'Run A events missing completion',
          );
          assert.equal(result.savePoints.status, 'completed');
          // The engine wrote only its app file, through the Rust writer; manuscripts are untouched.
          const plan = JSON.parse(
            await readFile(resolve(agentProject, '.storyforge/serial-plan.json'), 'utf8'),
          );
          assert.equal(plan.chapters[0].title, '入城');
          const after = (await contextFingerprint(agentProject)).filter(
            (entry) => !entry.path.startsWith('.storyforge'),
          );
          assert.deepEqual(after, agentBefore, 'The agent probe wrote outside .storyforge/');
          // Run B: a stop while streaming settles the run and closes the Native stream early.
          assert.equal(result.stopAck?.control_effect, 'requested');
          assert.equal(result.stoppedStatus, 'stopped');
          assert.equal(result.stopped.runtime_interruption?.status, 'stopped');
          const closeDeadline = Date.now() + 5000;
          while (Date.now() < closeDeadline && !streams[2].closedAt) await delay(25);
          assert.ok(
            streams[2].closedAt && !streams[2].writableFinished,
            'Stopping did not close the Native stream',
          );
          const log = JSON.parse(await readFile(storeLogPath, 'utf8'));
          evidence.storeLog = log;
          assert.ok(
            log.every((entry) => entry.key === 'synthetic-p0-api'),
            'Store auth missing',
          );
          assert.ok(
            !JSON.stringify(log).includes(llmKey),
            'The real key reached the session store',
          );
          assert.ok(
            !JSON.stringify(evidence).includes(llmKey),
            'The real key reached the WebView or evidence',
          );
        }
        if (assistantReal) {
          evidence.real = await page.evaluate(
            (input) => window.__ENGINE_P2_ASSISTANT_REAL__.runAssistantRealRun(input),
            { projectRoot: assistantProject, chapter: REAL_CHAPTERS['正文/第002章.md'] },
          );
          const real = evidence.real;
          assert.equal(real.native, true);
          assert.ok(
            real.provider.keyIsPlaceholder,
            'The WebView saw something other than the placeholder',
          );
          const log = JSON.parse(await readFile(storeLogPath, 'utf8'));
          evidence.storeLog = log;
          assert.ok(
            log.every((entry) => entry.key === 'synthetic-p0-api'),
            'Store auth missing',
          );
          evidence.toolCalls = log
            .filter((entry) => entry.method === 'PATCH' && entry.body?.status)
            .map((entry) => ({
              status: entry.body.status,
              error: entry.body.error_message ?? null,
              ...entry.body.output_summary,
            }));
          assert.deepEqual(
            await contextFingerprint(assistantProject),
            assistantBefore,
            'The real run wrote into the project',
          );
        }
        if (!p1 && !p2 && !p3 && mode !== '--transport-only')
          evidence.cpu = await page.evaluate(() => window.__ENGINE_P0__.runCpuProbe());
      })(),
      new Promise((_, reject) => {
        const limit = assistantReal ? 600000 : 180000;
        timer = setTimeout(
          () => reject(new Error(`Native probe exceeded ${limit / 1000} seconds`)),
          limit,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await page.screenshot({ path: resolve(output, 'native-probe.png') });
  if (evidence.cpu) assert.equal(evidence.cpu.native, true);
  if (evidence.sql)
    assert.ok(evidence.sql.schemaBelow100Ms, 'Native schema creation exceeded the P0 100ms gate');
  assert.equal(evidence.errors.length, 0, evidence.errors.join('\n'));
  evidence.status = 'passed';
  console.log(
    JSON.stringify(
      {
        status: evidence.status,
        reader: evidence.reader && {
          cases: evidence.reader.rows.length,
          skipped: evidence.reader.skipped,
          durationMs: evidence.reader.durationMs,
          longTasks: evidence.reader.longTasks.length,
          contentUnchanged: evidence.reader.contentUnchanged,
        },
        context: evidence.context && {
          cases: evidence.context.rows.length,
          durationMs: evidence.context.durationMs,
          longTasks: evidence.context.longTasks.length,
          contentUnchanged: evidence.context.contentUnchanged,
        },
        cpu: evidence.cpu?.results.map(({ id, p50Ms, p95Ms, maxMs, longTasks }) => ({
          id,
          p50Ms,
          p95Ms,
          maxMs,
          longTasks: longTasks.length,
        })),
        agent: evidence.agent && {
          firstDeltaMs: evidence.agent.firstDeltaMs,
          runawayMs: Math.round(evidence.agent.runawayMs),
          ticks: evidence.agent.ticks,
          frames: evidence.agent.frames.length,
          storeCalls: evidence.storeLog.length,
        },
        assistant: evidence.assistant && {
          firstDeltaMs: evidence.assistant.firstDeltaMs,
          deltas: evidence.assistant.deltas.length,
          storeCalls: evidence.storeLog.length,
        },
        llm: evidence.llm && {
          firstDeltaMs: evidence.llm.firstDeltaMs,
          deltas: evidence.llm.deltas.length,
          requests: evidence.llmServer.records.length,
        },
        http: evidence.http && {
          firstChunkMs: evidence.http.firstChunkMs,
          chunks: evidence.http.stream.chunks.length,
        },
        sql: evidence.sql && {
          oldLoadMs: evidence.sql.oldLoadMs,
          newLoadMs: evidence.sql.newLoadMs,
          schemaMs: evidence.sql.schemaMs,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  evidence.status = 'failed';
  evidence.errors.push(String(error));
  throw error;
} finally {
  killProcessTree(build);
  // Cleanup failures remain evidence; one failure must not prevent other owned resources closing.
  for (const cleanup of [
    () => browser?.close(),
    () => killProcessTree(child),
    () => vite?.close(),
    ...[httpServer, foreignServer].map((server) => async () => {
      if (!server) return;
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      evidence.errors.push(`Cleanup: ${error}`);
      evidence.status = 'failed';
      process.exitCode = 1;
      console.error(error);
    }
  }
  // The copied author config is ciphertext bound to this Windows user; still never keep it.
  if (assistantReal)
    for (const name of await readdir(directories.configDir).catch(() => []))
      if (name.startsWith('llm-provider')) await unlink(resolve(directories.configDir, name));
  if (p1 || p2 || p3) {
    await copyFile(fileURLToPath(import.meta.url), resolve(output, 'harness-source.mjs'));
    await copyFile(
      resolve(frontend, `scripts/fixtures/${fixtureName}.ts`),
      resolve(output, 'fixture-source.ts'),
    );
  }
  evidence.closedAt = new Date().toISOString();
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await lock.close();
  await unlink(lockPath);
}
