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

// ---- v3 结构护栏（SSR 不跑 effects → 无项目态，固化两栏 / 四卡 / 关键入口）----

test('无项目启动渲染 v3 欢迎页：品牌 + 启动/上手/最近 两栏', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /data-testid="welcome-workspace"/);
  assert.match(html, /可验证的长篇创作流水线 · 一句话就能开新书/);
  assert.match(html, /启动/);
  assert.match(html, /上手/);
  assert.match(html, /最近/);
  assert.match(html, /data-testid="welcome-composer-input"/);
  assert.match(html, /data-testid="welcome-primary-action"/);
  assert.match(html, /打开项目/);
  assert.match(html, /新建文件/);
  assert.match(html, /命令面板/);
  assert.match(html, /Ctrl O/);
  assert.match(html, /Ctrl P/);
});

test('欢迎页上手四张引导卡文案齐全', () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /配置模型服务，连接真实 LLM/);
  assert.match(html, /打开样例项目「雪夜斩」/);
  assert.match(html, /快捷键速查/);
  assert.match(html, /了解 StoryForge/);
});

test('「启动时显示欢迎页」偏好默认为开，旧配置缺字段回落为开，显式 false 保留', () => {
  assert.equal(DEFAULT_APP_SETTINGS.showWelcomeOnStartup, true);
  assert.equal(sanitizeAppSettings({}).showWelcomeOnStartup, true);
  assert.equal(sanitizeAppSettings({ showWelcomeOnStartup: false }).showWelcomeOnStartup, false);
});

// ---- 行为：关 / 重开 / 持久化 / 启动开关生效（挂载真实 App，验证真实 handler）----

test('偏好为「关」时启动直接落到空起始态，不显示欢迎页', () => {
  localStorage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_APP_SETTINGS, showWelcomeOnStartup: false }),
  );
  const container = mountApp();
  assert.ok(byTestId(container, 'welcome-dismissed'), '关态应直接落到空起始态');
  assert.equal(byTestId(container, 'welcome-workspace'), null);
});

test('关闭欢迎页页签 → 落到空起始态且不自动重开', async () => {
  const container = mountApp();
  assert.ok(byTestId(container, 'welcome-workspace'));
  const closeButton = byTestId(container, 'welcome-close');
  assert.ok(closeButton, '欢迎页应有可关的页签 ×');

  await act(async () => {
    clickElement(closeButton!);
  });
  assert.equal(byTestId(container, 'welcome-workspace'), null, '关闭后欢迎页应消失');
  assert.ok(byTestId(container, 'welcome-dismissed'), '关闭后应露出空起始态');

  // 冲刷一轮 effects，确认没有把欢迎页又自动拉回来的逻辑。
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(byTestId(container, 'welcome-workspace'), null, '不应自动重开欢迎页');
  assert.ok(byTestId(container, 'welcome-dismissed'));
});

test('空起始态点「显示欢迎页」→ 欢迎页重新出现', async () => {
  const container = mountApp();
  await act(async () => {
    clickElement(byTestId(container, 'welcome-close')!);
  });
  assert.ok(byTestId(container, 'welcome-dismissed'));

  const reopenButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('显示欢迎页'),
  );
  assert.ok(reopenButton, '空起始态应有「显示欢迎页」重开入口');

  await act(async () => {
    clickElement(reopenButton!);
  });
  assert.ok(byTestId(container, 'welcome-workspace'), '重开后欢迎页应回来');
  assert.equal(byTestId(container, 'welcome-dismissed'), null);
});

test('拨掉「启动时显示欢迎页」开关 → 偏好写盘为 false', async () => {
  const container = mountApp();
  const toggle = byTestId(container, 'welcome-startup-toggle') as HTMLInputElement | null;
  assert.ok(toggle, '欢迎页应有启动开关');
  assert.equal(toggle!.checked, true, '默认勾选');

  await act(async () => {
    toggle!.click();
  });

  // 读回内存偏好与原始存档，确认真的写盘（不是只改了 UI）。
  assert.equal(loadAppSettings().showWelcomeOnStartup, false);
  const persisted = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) ?? '{}');
  assert.equal(persisted.showWelcomeOnStartup, false);
});

test('设置页开着时点「显示欢迎页」也能稳定露出欢迎页（回归 onReopenWelcome 不清设置页的静默失效）', async () => {
  const container = mountApp();

  // Ctrl+, 打开设置页：无项目时设置页占据中栏，欢迎页此刻不在。
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }));
    await Promise.resolve();
  });
  assert.equal(byTestId(container, 'welcome-workspace'), null, '设置页开着时欢迎页应被挡住');

  // Ctrl+Shift+P 打开命令面板，点「显示欢迎页」。
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }));
    await Promise.resolve();
  });
  const showWelcome = Array.from(
    container.querySelectorAll('[data-testid="palette-item"]'),
  ).find((item) => item.textContent?.includes('显示欢迎页'));
  assert.ok(showWelcome, '无项目时命令面板应暴露「显示欢迎页」');

  await act(async () => {
    clickElement(showWelcome!);
  });
  // 修复后 onReopenWelcome 一并收起设置页 → 欢迎页从设置页态稳定露出。
  assert.ok(
    byTestId(container, 'welcome-workspace'),
    '「显示欢迎页」应从设置页态稳定露出欢迎页',
  );
});
