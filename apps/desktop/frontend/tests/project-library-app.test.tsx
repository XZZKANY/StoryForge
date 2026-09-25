import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';

function Probe({ name }: { name: string }) {
  const [value, setValue] = useState('');
  return (
    <input
      aria-label={name}
      data-testid={`${name}-probe`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
vi.mock('../src/components/Editor', () => ({ Editor: () => <Probe name="editor" /> }));
vi.mock('../src/components/ChatWindow', () => ({ ChatWindow: () => <Probe name="agent" /> }));
vi.mock('../src/components/SettingsView', () => ({ SettingsView: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"detail":"offline fixture"}', { status: 503 })),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mountApp() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(<App />));
  return host;
}
const get = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function click(host: HTMLElement, id: string) {
  const target = get(host, id);
  assert.ok(target, `${id} must exist`);
  await act(async () => target.click());
}

test('旧欢迎关闭偏好和chat布局不能吞掉作品选择与新建入口', async () => {
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, showWelcomeOnStartup: false }),
  );
  localStorage.setItem('storyforge:shell:layoutMode', 'chat');
  const host = await mountApp();
  assert.ok(get(host, 'project-library'), '启动必须有作品库，而不是空workbench');
  assert.ok(get(host, 'library-new-project'), '新建作品不能伪装成新建文件或自动AI开书');
  assert.ok(get(host, 'library-open-project'));
  assert.equal(get(host, 'welcome-close'), null, '作品入口不能被永久关闭');
  assert.equal(get(host, 'assistant-panel'), null);
});

test('最近作品可直接进入，返回作品库再继续不重建正文和Agent', async () => {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['D:/小说/海边来信']));
  const host = await mountApp();
  const recent = host.querySelector<HTMLButtonElement>('[data-project-path="D:/小说/海边来信"]');
  assert.ok(recent);
  await act(async () => recent.click());
  assert.equal(get(host, 'desktop-shell')?.dataset.mainSurface, 'overview');
  await click(host, 'open-writing-workspace');
  const editor = get(host, 'editor-probe');
  const agent = get(host, 'agent-probe');
  assert.ok(editor);
  assert.ok(agent);
  await click(host, 'titlebar-library');
  assert.equal(get(host, 'desktop-shell')?.dataset.mainSurface, 'library');
  assert.equal(get(host, 'writing-workspace-surface')?.hidden, true);
  assert.equal(get(host, 'assistant-panel')?.hidden, true);
  assert.equal(get(host, 'shell-center')?.classList.contains('hidden'), false);
  await click(host, 'library-resume-project');
  assert.equal(get(host, 'desktop-shell')?.dataset.mainSurface, 'workspace');
  assert.equal(get(host, 'editor-probe'), editor);
  assert.equal(get(host, 'agent-probe'), agent);
});
