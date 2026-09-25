import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { App } from '../src/App';
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  sanitizeAppSettings,
} from '../src/lib/user-settings';

// SettingsView / Editor 的内容与本文件无关：② 用例测的是 App 的 onReopenWelcome 会一并收起
// 设置页、露出欢迎页，而非设置页或编辑器本身。桩掉这两个中栏重组件，避免其挂载副作用（读本机
// LLM 配置 / 版本历史）在无 tauri、无后端的测试环境里出网。
vi.mock('../src/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('../src/components/Editor', () => ({ Editor: () => null }));
// StatusBar 常驻挂载，会轮询 /health/ready；无后端时打向 127.0.0.1:8000 徒增网络噪声与
// 悬挂计时器。桩成「不可达」即可，健康态与欢迎页行为无关。
vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: async () => ({
    status: 'unreachable',
    reachable: false,
    baseUrl: 'http://127.0.0.1:8000',
    latencyMs: 0,
    checks: {},
    detail: 'mocked in welcome-page test',
  }),
}));

// App 挂载后走真实状态机：useProjectWorkspace / useTauriMenuBridge 均以 isTauriRuntime() 为闸，
// 非 tauri 环境下只吃 localStorage，故整个 App 可在 happy-dom 里零 tauri mock 挂载。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> = [];

beforeEach(() => {
  // 每例独立：偏好存 localStorage，脏值会让 SSR 结构护栏与「启动开关」持久化用例互相污染。
  localStorage.clear();
});

afterEach(() => {
  while (mounted.length) {
    const instance = mounted.pop();
    if (!instance) continue;
    act(() => instance.root.unmount());
    instance.container.remove();
  }
  vi.restoreAllMocks();
});

function mountApp(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  mounted.push({ container, root });
  return container;
}

function byTestId(container: HTMLElement, testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function clickElement(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

test('作品库明确提供新建和打开，移除可关闭欢迎页与自动开书引导', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /data-testid="project-library"/);
  assert.match(html, /新建作品/);
  assert.match(html, /打开本地作品/);
  assert.match(html, /最近作品/);
  assert.doesNotMatch(html, /welcome-close|welcome-composer-input|发送即开书|上手/);
});

test('旧欢迎偏好继续兼容存储，但 false 不会让作品入口消失', () => {
  assert.equal(DEFAULT_APP_SETTINGS.showWelcomeOnStartup, true);
  assert.equal(sanitizeAppSettings({ showWelcomeOnStartup: false }).showWelcomeOnStartup, false);
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, showWelcomeOnStartup: false }),
  );
  const container = mountApp();
  assert.ok(byTestId(container, 'project-library'));
  assert.equal(byTestId(container, 'welcome-dismissed'), null);
  assert.equal(loadAppSettings().showWelcomeOnStartup, false, '不改旧配置值来掩盖导航缺陷');
});

test('无项目时作品库独占主区，不摆出空Explorer或Agent', () => {
  const container = mountApp();
  assert.ok(byTestId(container, 'project-library'));
  assert.equal(byTestId(container, 'shell-side-panel'), null);
  assert.equal(byTestId(container, 'assistant-panel'), null);
  assert.equal(byTestId(container, 'shell-activity-bar')?.parentElement?.hidden, true);
});

test('标题栏在无项目时搜索命令，Ctrl+P仍保持文件搜索语义', async () => {
  const container = mountApp();
  const entry = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('搜索命令'),
  );
  assert.ok(entry);
  await act(async () => clickElement(entry));
  const commands = container.querySelector('[role="dialog"][aria-label="命令面板"]');
  assert.ok(commands);
  assert.match(commands.textContent ?? '', /打开作品库/);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true })));
  assert.ok(container.querySelector('[role="dialog"][aria-label="打开文件"]'));
});

test('标题栏作品库入口可反复点击，入口不产生可关闭空壳', async () => {
  const container = mountApp();
  for (let i = 0; i < 2; i++) {
    await act(async () => clickElement(byTestId(container, 'titlebar-library')!));
    assert.ok(byTestId(container, 'project-library'));
    assert.equal(byTestId(container, 'welcome-close'), null);
  }
});

test('设置打开不卸载作品库', async () => {
  const container = mountApp();
  const home = byTestId(container, 'project-library');
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true })),
  );
  assert.equal(byTestId(container, 'project-library'), home);
});

test('持久化chat布局在无项目时不隐藏作品库、不覆盖偏好', () => {
  localStorage.setItem('storyforge:shell:layoutMode', 'chat');
  const container = mountApp();
  assert.equal(byTestId(container, 'shell-center')?.classList.contains('hidden'), false);
  assert.ok(byTestId(container, 'project-library'));
  assert.equal(byTestId(container, 'assistant-panel'), null);
  assert.equal(localStorage.getItem('storyforge:shell:layoutMode'), 'chat');
});
