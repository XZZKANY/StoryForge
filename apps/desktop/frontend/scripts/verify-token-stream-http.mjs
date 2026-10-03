import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = resolve(root, 'apps/desktop/frontend');
const outputRoot = resolve(root, 'output/playwright/token-stream-http');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(resolve(outputRoot, 'run-'));
const project = resolve(output, 'project').replaceAll('\\', '/');
const chapter = project + '/正文/第01章.md';
const manuscript = '# 第01章\n她收起旧钥匙，没有敲门。\n';
await mkdir(resolve(project, '正文'), { recursive: true });
await writeFile(chapter, manuscript);
const apiKey = 'synthetic-http-acceptance-only';
const firstText = '第一批正文：先用人物行动带动情节。';
const lastText = '\n\n最终建议：保留旧钥匙的悬念。';
const evidence = [];
const failures = [];
let mode = 'success';
let requests = [];
let release = () => {};
let terminalSent;
let detachCount = 0;
let vite, browser, child, currentPage;
const log = createWriteStream(resolve(output, 'api.log'));
const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
};
const provider = httpServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.method, 'POST');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'token-stream-fixture');
    requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (delta, finish_reason = null) =>
      res.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n');
    if (mode === 'success' && requests.length === 1) {
      emit({
        tool_calls: [
          {
            index: 0,
            id: 'read-1',
            type: 'function',
            function: { name: 'fs_read', arguments: '{"path":' },
          },
        ],
      });
      emit({ tool_calls: [{ index: 0, function: { arguments: '"正文/第01章.md"}' } }] });
      emit({}, 'tool_calls');
      res.end('data: [DONE]\n\n');
      return;
    }
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    emit({ content: '<think>合成隐藏内容</think>' + firstText });
    await barrier;
    if (mode === 'failure') {
      res.destroy();
      return;
    }
    emit({ content: lastText });
    emit({}, 'stop');
    res.write(
      'data: ' +
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }) +
        '\n\n',
    );
    terminalSent = true;
    res.end('data: [DONE]\n\n');
  } catch (error) {
    failures.push(String(error));
    res.destroy();
  }
});
let apiPort;
const proxy = httpServer((req, res) => {
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: '127.0.0.1:' + apiPort },
    },
    (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers);
      let observed = '';
      incoming.on('data', (chunk) => {
        if (res.writableEnded) return;
        res.write(chunk);
        if (mode !== 'disconnect' || !req.url.endsWith('/stream')) return;
        observed += chunk.toString();
        if (observed.includes('"agent_text_delta"') && observed.endsWith('\n\n')) {
          detachCount++;
          res.end();
          incoming.destroy(); // Real client detach; do not stop or re-POST the worker.
        }
      });
      incoming.on('end', () => res.end());
      incoming.on('error', () => {
        if (!res.writableEnded) res.destroy();
      });
    },
  );
  upstream.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  req.pipe(upstream);
});
try {
  const providerPort = await listen(provider);
  const reservation = httpServer();
  apiPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const proxyPort = await listen(proxy);
  const apiOrigin = 'http://127.0.0.1:' + proxyPort;
  vite = await createServer({
    root: frontend,
    configFile: resolve(frontend, 'vite.config.ts'),
    envFile: false,
    define: {
      'import.meta.env.VITE_STORYFORGE_API_BASE_URL': JSON.stringify(apiOrigin),
      'import.meta.env.VITE_STORYFORGE_API_KEY': JSON.stringify(apiKey),
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  // Whitelist OS essentials; never inherit provider credentials, proxy or managed config.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|SYSTEMDRIVE)$/i.test(key),
    ),
  );
  Object.assign(env, {
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    DATABASE_URL: 'sqlite+pysqlite:///' + resolve(output, 'api.sqlite3').replaceAll('\\', '/'),
    STORYFORGE_API_PORT: String(apiPort),
    STORYFORGE_ENV: 'local',
    STORYFORGE_API_KEY: apiKey,
    STORYFORGE_CORS_ORIGINS: origin,
    STORYFORGE_DESKTOP_SKIP_SERVICES: '1',
    STORYFORGE_LLM_PROVIDER: 'openai',
    STORYFORGE_LLM_MODEL: 'token-stream-fixture',
    STORYFORGE_LLM_BASE_URL: 'http://127.0.0.1:' + providerPort + '/v1',
    STORYFORGE_LLM_API_KEY: 'synthetic-provider-only',
    STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
    STORYFORGE_LLM_TIMEOUT_SECONDS: '60',
    REDIS_URL: '',
    STORYFORGE_RATE_LIMIT_REDIS_URL: '',
    SENTRY_DSN: '',
    NO_PROXY: '127.0.0.1,localhost,::1',
  });
  child = spawn(
    resolve(root, 'apps/api/.venv/Scripts/python.exe'),
    [resolve(root, 'apps/api/tests/token_stream_http_host.py')],
    { cwd: resolve(root, 'apps/api'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  const get = async (path) => {
    const response = await fetch(apiOrigin + path, {
      headers: { 'X-StoryForge-API-Key': apiKey },
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(response.ok, true, path + ' HTTP ' + response.status);
    return response.json();
  };
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('API exited: ' + child.exitCode);
    try {
      assert.equal((await get('/health/ready')).status, 'ready');
      ready = true;
      break;
    } catch {
      await sleep(200);
    }
  }
  assert.equal(ready, true, 'Isolated API must become healthy');
  browser = await chromium.launch({ headless: true });
  for (mode of ['success', 'disconnect', 'stop', 'failure']) {
    requests = [];
    terminalSent = false;
    const context = await browser.newContext({
      viewport: { width: 420, height: 820 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(20000);
    const errors = [];
    const posts = [];
    const network = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().startsWith(apiOrigin)) {
        network.push(request.method() + ' ' + new URL(request.url()).pathname);
        if (request.method() === 'POST' && request.url().endsWith('/stream')) posts.push(request);
      }
    });
    await page.route('**/*', (route) => {
      if ([origin, apiOrigin].includes(new URL(route.request().url()).origin))
        return route.continue();
      errors.push('Unexpected non-fixture browser network');
      return route.abort();
    });
    await page.addInitScript(
      ({ project, chapter, manuscript }) => {
        const normalized = (value) => value.replaceAll('\\', '/');
        window.__STORYFORGE_MOCK_FS__ = {
          readFile: (path) => {
            if (normalized(path) === chapter) return manuscript;
            throw new Error('ENOENT: isolated fixture');
          },
          listDir: (path) => {
            if (![project, project + '/正文'].includes(normalized(path))) return [];
            return [
              {
                name: '第01章.md',
                path: chapter,
                isDir: false,
                size: manuscript.length,
                modified: 0,
                extension: 'md',
              },
            ];
          },
          pathExists: (path) => [project, project + '/正文', chapter].includes(normalized(path)),
        };
      },
      { project, chapter, manuscript },
    );
    await page.goto(
      origin + '/tests/fixtures/token-stream-http.html?project=' + encodeURIComponent(project),
    );
    await page.getByRole('button', { name: '开始', exact: true }).click();
    const message = page.getByTestId('assistant-message');
    await message.getByText(firstText, { exact: true }).waitFor();
    assert.equal(terminalSent, false, 'Visible text must precede provider terminal');
    assert.equal(await message.count(), 1);
    const node = await message.elementHandle();
    const runId = await page.getByTestId('http-state').getAttribute('data-run-id');
    assert.ok(runId);
    assert.match(await page.getByTestId('http-state').innerText(), /running · busy/);
    assert.equal((await message.innerText()).includes('合成隐藏内容'), false);
    if (mode === 'success') {
      assert.equal(requests.length, 2);
      const tool = requests[1].messages.find((item) => item.role === 'tool');
      assert.equal(tool?.tool_call_id, 'read-1');
      assert.ok(tool.content.includes('旧钥匙'));
    } else assert.equal(requests.length, 1);
    if (mode === 'disconnect') {
      await page
        .getByTestId('stream-phase')
        .filter({ hasText: '连接或内容不完整，等待核对结果' })
        .waitFor();
      assert.equal(detachCount, 1);
    }
    if (mode === 'stop') {
      await page.getByRole('button', { name: '停止', exact: true }).click();
      await page.getByText('已请求停止，等待当前操作结束', { exact: true }).waitFor();
      assert.equal(terminalSent, false);
      assert.match(await page.getByTestId('http-state').innerText(), /running · busy/);
    }
    await page.getByRole('textbox').focus();
    const visibleAt = new Date().toISOString();
    await page.screenshot({ path: resolve(output, mode + '-streaming.png') });
    release();
    const expected = mode === 'stop' ? 'stopped' : mode === 'failure' ? 'failed' : 'completed';
    await page
      .getByTestId('http-state')
      .filter({ hasText: expected + ' · settled' })
      .waitFor();
    assert.equal(await message.count(), 1);
    assert.equal(await message.evaluate((element, previous) => element === previous, node), true);
    assert.equal(
      await page.getByRole('textbox').evaluate((element) => document.activeElement === element),
      true,
    );
    if (mode !== 'failure') assert.ok((await message.innerText()).includes(firstText));
    if (['success', 'disconnect'].includes(mode)) {
      assert.ok((await message.innerText()).includes(lastText.trim()));
      assert.equal(await page.getByTestId('stream-phase').count(), 0);
    } else await page.getByText('回复未完成', { exact: false }).waitFor();
    assert.equal(posts.length, 1, 'Never re-POST on detach or stop');
    const run = await get('/api/agent-runs/' + runId);
    const events = await get('/api/agent-runs/' + runId + '/events');
    assert.equal(run.public_id, runId);
    assert.equal(run.session_id, runId);
    assert.equal(run.status, expected);
    assert.ok(events.every((event) => event.run_id === run.id));
    if (mode === 'failure') {
      // A failed agent_result still owns its canonical body; only diagnostics retain previews.
      const result = events.find((event) => event.event_type === 'agent_run_failed')?.payload
        .execution_result;
      assert.equal(result?.type, 'agent_result');
      assert.equal(result?.agent_result.execution_outcome.status, 'failed');
      const summary = result.agent_result.summary;
      assert.equal(typeof summary, 'string');
      assert.ok(summary.length > 0);
      assert.equal(await page.getByTestId('assistant-markdown').innerText(), summary);
      assert.equal((await message.innerText()).includes(firstText), false);
    }
    assert.ok(
      events.some(
        (event) =>
          event.event_type ===
            (mode === 'stop' ? 'agent_run_interrupted' : 'agent_execution_settled') &&
          event.payload.runtime_state === 'settled' &&
          event.payload.run_status === expected,
      ),
    );
    if (['success', 'disconnect'].includes(mode)) {
      const completed = events.find((event) => event.event_type === 'agent_run_completed');
      assert.equal(completed?.payload.summary, firstText + lastText);
      const history = await get('/api/assistant/sessions/' + run.assistant_session_id);
      assert.deepEqual(
        history.messages.filter((item) => item.role === 'assistant').map((item) => item.content),
        [firstText + lastText],
      );
    }
    if (mode === 'success') {
      const trace = events.find(
        (event) =>
          event.event_type === 'tool_trace' && event.payload.trace?.tool_name === 'fs.read',
      )?.payload.trace;
      assert.equal(trace?.status, 'completed');
      const calls = await get(
        '/api/assistant/sessions/' + run.assistant_session_id + '/tool-calls',
      );
      assert.ok(
        calls.some(
          (call) =>
            call.id === trace.assistant_tool_call_id &&
            call.tool_name === 'fs.read' &&
            call.status === 'completed',
        ),
      );
    }
    assert.equal(JSON.stringify(events).includes('agent_text_delta'), false);
    assert.equal(JSON.stringify(events).includes('agent_text_stream_started'), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    assert.equal(
      await readFile(chapter, 'utf8'),
      manuscript,
      'Read-only flow cannot modify manuscript',
    );
    await page.screenshot({ path: resolve(output, mode + '-final.png') });
    evidence.push({
      mode,
      runId,
      expected,
      visibleAt,
      settledAt: new Date().toISOString(),
      providerRequests: requests.length,
      userPosts: posts.length,
      network,
      stableNode: true,
      focusRetained: true,
      transientDeltasNotPersisted: true,
    });
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    await context.close();
    console.log('PASS', mode, 'real provider HTTP -> API SSE -> production hooks -> DOM');
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: resolve(output, mode + '-failure.png') });
    await writeFile(
      resolve(output, 'failure.txt'),
      String(error) +
        '\n' +
        (await currentPage.locator('body').innerText()) +
        '\n' +
        JSON.stringify(failures),
    );
  }
  throw error;
} finally {
  release();
  await browser?.close();
  await vite?.close();
  if (child && child.exitCode === null && !child.killed) {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  log.end();
  for (const server of [proxy, provider]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('Evidence:', output);
}
