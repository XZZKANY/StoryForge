// Attach only to an explicitly launched, isolated Native host. No FS/fetch/IPC mocks.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const launchPath = process.argv[2];
assert.ok(launchPath, 'Pass the launch.json from token-stream-native-host.mjs');
const launch = JSON.parse(await readFile(launchPath, 'utf8'));
assert.equal(launch.isolation, 'smoke-lifecycle-only');
for (const url of [launch.controlBaseUrl, launch.apiBaseUrl, launch.cdpBaseUrl])
  assert.equal(new URL(url).hostname, '127.0.0.1');
const evidence = [];
const network = [];
const errors = [];
let browser, page;
const control = async (path) => {
  const response = await fetch(launch.controlBaseUrl + path, { method: 'POST' });
  assert.equal(response.status, 200, await response.text());
};
const state = async () => (await fetch(launch.controlBaseUrl + '/state')).json();
const get = async (path) => {
  const response = await fetch(launch.apiBaseUrl + path, {
    headers: { 'X-StoryForge-API-Key': 'synthetic-native-acceptance-api' },
  });
  assert.equal(response.status, 200);
  return response.json();
};
const waitFile = async (path) => {
  for (let i = 0; i < 200; i++) {
    try {
      await access(path);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Missing fixture observation marker: ' + path);
};
const releaseFixture = (stage, call) =>
  writeFile(
    resolve(launch.directories.localDataDir, `token-stream-${stage}-${call}-release`),
    'observed',
  );
const openProject = async (project) => {
  // Original native path spelling, as returned by the OS picker. This is navigation only.
  await page.evaluate((path) => window.__STORYFORGE_SMOKE__.openProject(path), project);
  await page.getByTestId('book-overview-surface').waitFor();
  await page.getByTestId('open-writing-workspace').click();
};
const begin = async (text) => {
  await page.getByTestId('conversation-new-session').click();
  await page.getByLabel('给 StoryForge 发送消息').fill(text);
  await page.getByTestId('composer-submit').click();
  await page.getByTestId('stream-phase').filter({ hasText: '正在输出' }).waitFor();
  const posts = network.filter((item) => item.method === 'POST' && item.url.endsWith('/stream'));
  const runId = posts.at(-1).runId;
  assert.ok(runId);
  return { runId, node: await page.getByTestId('assistant-message').last().elementHandle() };
};
const save = async () =>
  writeFile(
    resolve(launch.output, 'evidence.json'),
    JSON.stringify(
      {
        launchPath,
        navigation: 'existing smoke navigation seam only',
        rendererMocks: false,
        evidence,
        network,
        errors,
      },
      null,
      2,
    ),
  );
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP(launch.cdpBaseUrl);
      break;
    } catch {
      await sleep(200);
    }
  }
  assert.ok(browser, 'Owned WebView2 CDP endpoint did not start');
  const pages = browser.contexts().flatMap((context) => context.pages());
  const candidates = [];
  for (const candidate of pages)
    if (await candidate.getByTestId('desktop-shell').count()) candidates.push(candidate);
  assert.equal(candidates.length, 1);
  page = candidates[0];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().startsWith(launch.apiBaseUrl))
      network.push({
        method: request.method(),
        url: request.url(),
        at: new Date().toISOString(),
        ...(request.method() === 'POST' && request.url().endsWith('/stream')
          ? { runId: request.postDataJSON().run_id }
          : {}),
      });
  });
  const capability = await get('/api/agent-runs/capabilities');
  assert.deepEqual(capability.execution_protocols, launch.fixture ? ['external_writeback_v1'] : []);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openProject(launch.project);
  const name = launch.fixture ? 'chapter.md' : '第01章.md';
  await page.locator('[data-testid="file-item"]').filter({ hasText: name }).dblclick();
  const file = resolve(launch.project, launch.fixture ? name : '正文/' + name);
  const before = await readFile(file, 'utf8');
  if (launch.fixture) {
    const { runId, node } = await begin('请修订当前章节，保存后读取实际稿件并总结。');
    await waitFile(resolve(launch.directories.localDataDir, 'token-stream-initial-1-entered.json'));
    assert.match(await node.innerText(), /修订前预览/);
    await page.screenshot({ path: resolve(launch.output, 'initial-preview.png') });
    await releaseFixture('initial', 1);
    await page.getByTestId('agent-decision-dialog').waitFor();
    assert.match(await node.innerText(), /等待下一步/);
    assert.doesNotMatch(await node.innerText(), /正在输出/);
    assert.equal(await readFile(file, 'utf8'), before);
    await page
      .getByTestId('agent-decision-dialog')
      .getByRole('button', { name: '接受整版并继续', exact: true })
      .click();
    await waitFile(resolve(launch.directories.localDataDir, 'token-stream-final-2-entered.json'));
    const after = await readFile(file, 'utf8');
    assert.equal(after, '雨停了。林舟收起伞，沿着河岸走向灯火。\n');
    assert.equal(await node.evaluate((e) => e.isConnected), true);
    await page.screenshot({ path: resolve(launch.output, 'writeback-final-barrier.png') });
    const detached = process.argv[3];
    assert.ok(!detached || ['--detach-session', '--detach-project'].includes(detached));
    if (detached === '--detach-session') {
      await page.getByTestId('conversation-new-session').click();
      // Opening the confirmation is not detaching from the old session.
      await page.getByRole('button', { name: '仍要新建', exact: true }).click();
      await page
        .getByTestId('conversation-session-switch')
        .filter({ hasText: '新的创作会话' })
        .waitFor();
    }
    if (detached === '--detach-project') await openProject(launch.alternateProject);
    await releaseFixture('final', 2);
    if (!detached)
      await page
        .getByTestId('assistant-message')
        .filter({ hasText: '测试provider已读取实际保存的修订' })
        .waitFor();
    if (!detached) {
      assert.equal(
        await node.evaluate(
          (e) => e === document.querySelector('[data-testid="assistant-message"]'),
        ),
        true,
      );
      assert.equal(await page.getByTestId('assistant-message').count(), 1);
    } else {
      await sleep(3500); // includes the real coordinator's next GET observation, never changes its budget
      assert.equal(await page.getByTestId('assistant-message').count(), 0);
      assert.equal(await node.evaluate((e) => e.isConnected), false);
    }
    assert.equal(await page.getByTestId('stream-phase').count(), 0);
    const run = await get('/api/agent-runs/' + runId);
    assert.equal(run.status, 'completed');
    const events = await get('/api/agent-runs/' + runId + '/events');
    assert.ok(events.some((event) => event.event_type === 'agent_run_completed'));
    const stats = JSON.parse(
      await readFile(resolve(launch.directories.localDataDir, 'gui-provider-stats.json'), 'utf8'),
    );
    assert.equal(stats.saved_read_observed, true);
    assert.equal(stats.provider_calls, 2);
    assert.equal(stats.revision_calls, 1);
    evidence.push({
      mode: detached ?? 'external',
      runId,
      stats,
      sameNode: !detached,
      before,
      after,
      final: detached ? null : await node.innerText(),
      continuation: 'GET callback, not resumed token SSE',
    });
  } else {
    for (const mode of ['success', 'stop', 'failure', 'navigate']) {
      await control('/mode/' + mode);
      const postCount = network.filter(
        (n) => n.method === 'POST' && n.url.endsWith('/stream'),
      ).length;
      const { runId, node } = await begin(
        '读取章节并分析人物动作；本轮场景 ' + mode + '，不要写入稿件。',
      );
      assert.equal((await state()).active.terminalSent, false);
      assert.match(await node.innerText(), /第一批正文/);
      assert.doesNotMatch(await node.innerText(), /不应显示的合成推理|native-read/);
      const phase = await page.getByTestId('stream-phase').elementHandle();
      await page.getByLabel('给 StoryForge 发送消息').fill('下一轮草稿保持焦点');
      if (mode === 'success') {
        assert.equal(
          await page
            .getByTestId('stream-phase')
            .evaluate((e) => getComputedStyle(e.querySelector('span')).animationName),
          'none',
        );
        await page.getByTestId('message-list-scroll').evaluate((e) => {
          e.scrollTop = 0;
          e.dispatchEvent(new Event('scroll'));
        });
        await control('/advance');
        await page.getByTestId('assistant-markdown').locator('strong').waitFor();
        await page.getByTestId('message-list-new-content').waitFor();
        assert.equal(await page.getByTestId('message-list-scroll').evaluate((e) => e.scrollTop), 0);
        assert.equal(
          await phase.evaluate((e) => e === document.querySelector('[data-testid="stream-phase"]')),
          true,
        );
        assert.equal(
          await page
            .getByLabel('给 StoryForge 发送消息')
            .evaluate((e) => e === document.activeElement),
          true,
        );
        await page.screenshot({ path: resolve(launch.output, 'preterminal.png') });
        await page.getByTestId('message-list-new-content').click();
      }
      if (mode === 'stop') {
        await page.getByTestId('run-stop').click();
        assert.equal(await page.getByTestId('run-stop').getAttribute('data-armed'), 'true');
        await page.getByTestId('run-stop').click();
        await page.getByText('已请求停止，等待当前操作结束', { exact: true }).waitFor();
        assert.equal((await state()).active.terminalSent, false);
        assert.doesNotMatch(await node.innerText(), /回复未完成/);
      }
      if (mode === 'navigate') await openProject(launch.alternateProject);
      await control('/release');
      if (['stop', 'failure'].includes(mode))
        await page.getByTestId('stream-phase').filter({ hasText: '回复未完成' }).waitFor();
      else if (mode === 'success')
        await page.getByTestId('stream-phase').waitFor({ state: 'detached' });
      const expected = mode === 'stop' ? 'stopped' : mode === 'failure' ? 'failed' : 'completed';
      let run;
      for (let i = 0; i < 100; i++) {
        run = await get('/api/agent-runs/' + runId);
        if (run.status === expected) break;
        await sleep(100);
      }
      assert.equal(run.status, expected);
      const events = await get('/api/agent-runs/' + runId + '/events');
      assert.equal(JSON.stringify(events).includes('agent_text_delta'), false);
      assert.equal(
        network.filter((n) => n.method === 'POST' && n.url.endsWith('/stream')).length,
        postCount + 1,
      );
      assert.equal(await readFile(file, 'utf8'), before);
      if (mode === 'navigate') assert.equal(await page.getByTestId('assistant-message').count(), 0);
      else
        assert.equal(
          await node.evaluate(
            (e) => e === document.querySelector('[data-testid="assistant-message"]'),
          ),
          true,
        );
      if (mode === 'success') {
        assert.match(
          await page.getByTestId('assistant-markdown').locator('code').innerText(),
          /转身走进雨里/,
        );
        const history = await get('/api/assistant/sessions/' + run.assistant_session_id);
        assert.equal(history.messages.filter((m) => m.role === 'assistant').length, 1);
      }
      await page.screenshot({ path: resolve(launch.output, mode + '-final.png') });
      evidence.push({
        mode,
        runId,
        expected,
        sameNode: mode !== 'navigate',
        noReplay: true,
        manuscriptUnchanged: true,
        terminal: mode === 'navigate' ? null : await node.innerText(),
      });
      await save();
    }
  }
  assert.deepEqual(errors, []);
  await save();
  console.log('Native token stream acceptance passed:', launch.output);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(launch.output, 'failure.png') });
    await writeFile(
      resolve(launch.output, 'failure.txt'),
      String(error) + '\n' + (await page.locator('body').innerText()),
    );
  }
  await save();
  throw error;
} finally {
  // End only the owned host; keep all original and derived evidence files.
  await fetch(launch.controlBaseUrl + '/shutdown', { method: 'POST' }).catch(() => {});
  await waitFile(resolve(launch.output, 'host-closed.json'));
  await browser?.close();
}
