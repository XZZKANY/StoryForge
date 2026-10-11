// Real ordinary debug WebView + official plugin globals; owned synthetic inputs only.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
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
  ['--cpu-only', '--transport-only', '--all'].includes(mode) && extra.length === 0,
  'Use --cpu-only, --transport-only or --all',
);
const transports = mode !== '--cpu-only';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = resolve(root, 'apps/desktop/frontend');
const outputRoot = resolve(root, 'output/ts-engine-p0/native');
await mkdir(outputRoot, { recursive: true });
const lockPath = resolve(outputRoot, 'active.lock');
const lock = await open(lockPath, 'wx');
const output = await mkdtemp(resolve(outputRoot, 'run-'));
await lock.writeFile(JSON.stringify({ pid: process.pid, output }));
const directories = {
  localDataDir: resolve(output, 'local-data'),
  configDir: resolve(output, 'config'),
  webviewDataDir: resolve(output, 'webview2'),
};
const hostRoot = resolve(output, 'startup-stub');
const apiDir = resolve(hostRoot, 'apps/api');
const executable = resolve(hostRoot, 'bin/storyforge-desktop.exe');
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
let vite, child, browser, build, httpServer;
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
  for (const path of [...Object.values(directories), apiDir, resolve(hostRoot, 'bin')]) {
    await mkdir(path, { recursive: true });
  }
  // find_project_root prefers ancestor markers over STORYFORGE_ROOT. Copy the executable
  // under these owned markers so ordinary setup cannot import the author's API/.env.
  await writeFile(resolve(hostRoot, 'package.json'), '{"private":true,"synthetic":true}\n');
  await writeFile(resolve(hostRoot, 'docker-compose.yml'), '# P0 owned root marker only\n');
  await symlink(resolve(root, 'apps/api/.venv'), resolve(apiDir, '.venv'), 'junction');
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
  await writeFile(
    resolve(apiDir, 'run_windows.py'),
    `import json, os
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
  await writeFile(
    resolve(directories.configDir, 'llm-provider.json'),
    JSON.stringify({
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:1',
      model: 'p0-unused',
      apiKey: 'synthetic-unused',
    }),
  );
  vite = await createServer({
    root: frontend,
    configFile: false,
    envFile: false,
    cacheDir: resolve(output, 'vite-cache'),
    server: { host: 'localhost', port: 3007, strictPort: true, fs: { allow: [root] } },
    plugins: [
      {
        name: 'p0-cpu-entry',
        configureServer(server) {
          server.middlewares.use('/', async (req, res, next) => {
            if (req.url !== '/') return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(
              await server.transformIndexHtml(
                '/',
                '<html><body><h1>P0 Native synthetic probe</h1><script type="module" src="/scripts/fixtures/engine-p0.ts"></script></body></html>',
              ),
            );
          });
        },
      },
    ],
  });
  await vite.listen(); // strictPort: never reuse the author's dev server.
  const overlay = {
    productName: 'StoryForge P0 Probe',
    identifier: 'com.storyforge.engine.p0',
    app: {
      security: {
        capabilities: [
          {
            identifier: 'p0-probe',
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
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|SYSTEMDRIVE|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(
        name,
      ),
    ),
  );
  const env = createSmokeEnvironment(inherited, apiBaseUrl, directories);
  delete env.STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH;
  Object.assign(env, {
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
    overlay,
    locks: {
      cargo: await hash(resolve(root, 'apps/desktop/src-tauri/Cargo.lock')),
      pnpm: await hash(resolve(root, 'pnpm-lock.yaml')),
      frontend: await hash(resolve(frontend, 'package-lock.json')),
    },
    startup: 'ordinary debug setup + owned Python stdlib health stub; not a backend-free boot',
    sources: {
      fixture: await hash(resolve(frontend, 'scripts/fixtures/engine-p0.ts')),
      harness: await hash(fileURLToPath(import.meta.url)),
      sqlGenerator: await hash(resolve(root, 'apps/api/scripts/engine_p0_sql_fixture.py')),
      main: await hash(resolve(root, 'apps/desktop/src-tauri/src/main.rs')),
    },
  });
  console.log('P0 Native evidence:', output);
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
  await page.waitForFunction(() => document.documentElement.dataset.engineP0Ready === 'true');
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
          evidence.sql.schemaBelow100Ms = evidence.sql.schemaMs < 100;
        }
        if (mode !== '--transport-only')
          evidence.cpu = await page.evaluate(() => window.__ENGINE_P0__.runCpuProbe());
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native probe exceeded 180 seconds')), 180000);
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
        cpu: evidence.cpu?.results.map(({ id, p50Ms, p95Ms, maxMs, longTasks }) => ({
          id,
          p50Ms,
          p95Ms,
          maxMs,
          longTasks: longTasks.length,
        })),
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
    async () => {
      if (!httpServer) return;
      httpServer.closeAllConnections();
      await new Promise((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
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
  evidence.closedAt = new Date().toISOString();
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await lock.close();
  await unlink(lockPath);
}
