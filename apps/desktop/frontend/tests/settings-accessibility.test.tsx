import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { App } from '../src/App';
import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';

vi.mock('../src/components/Editor', () => ({ Editor: () => null }));
vi.mock('../src/lib/desktop-llm-config', () => ({
  getDesktopLlmConfig: vi.fn(async () => null),
  saveDesktopLlmConfig: vi.fn(),
}));
vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: async () => ({ status: 'unreachable', reachable: false, checks: {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> = [];

beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

function SettingsHarness() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开设置测试入口</button>
      {open && (
        <SettingsView settings={settings} onChange={setSettings} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

async function mount(element = <SettingsHarness />) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

function required<T extends Element>(container: ParentNode, selector: string): T {
  const result = container.querySelector<T>(selector);
  assert.ok(result, `missing ${selector}`);
  return result;
}

async function click(button: HTMLElement) {
  await act(async () => {
    button.focus();
    button.click();
  });
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

async function openSettings() {
  const container = await mount();
  const opener = required<HTMLButtonElement>(container, 'button');
  await click(opener);
  return { container, opener };
}

test('设置有 dialog 语义并聚焦搜索，偏好重渲染不抢回当前控件焦点', async () => {
  const { container } = await openSettings();
  const dialog = required(container, '[role="dialog"][aria-modal="true"]');
  const titleId = dialog.getAttribute('aria-labelledby');
  assert.ok(titleId);
  assert.equal(document.getElementById(titleId)?.textContent, '设置');
  assert.equal(
    document.activeElement === required(container, '[data-testid="settings-search"]'),
    true,
  );
  const theme = required<HTMLSelectElement>(container, '[data-testid="appearance-theme"]');
  await act(async () => {
    theme.focus();
    theme.value = 'light';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(theme.value, 'light');
  assert.equal(document.activeElement === theme, true);
});

test('设置 Tab 首尾环绕，Escape 关闭并恢复入口焦点', async () => {
  const { container, opener } = await openSettings();
  const first = required<HTMLButtonElement>(container, '[data-testid="settings-close"]');
  const last = required<HTMLButtonElement>(container, '[data-testid="about-update-check"]');
  first.focus();
  assert.equal(key(first, 'Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(document.activeElement === last, true);
  assert.equal(key(last, 'Tab').defaultPrevented, true);
  assert.equal(document.activeElement === first, true);
  assert.equal(key(first, 'Escape').defaultPrevented, true);
  assert.equal(container.querySelector('[data-testid="settings-view"]'), null);
  assert.equal(document.activeElement === opener, true);
});

test('设置所有输入、选择、范围控件均有关联名称与说明', async () => {
  const { container } = await openSettings();
  const controls = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select');
  assert.ok(controls.length >= 10);
  for (const control of controls) {
    assert.ok(
      control.getAttribute('aria-label') || control.labels?.length,
      `控件缺少名称：${control.getAttribute('data-testid')}`,
    );
    if (control.getAttribute('data-testid') === 'settings-search') continue;
    const descriptionId = control.getAttribute('aria-describedby');
    assert.ok(descriptionId, `控件缺少说明：${control.id}`);
    assert.ok(document.getElementById(descriptionId)?.textContent);
  }
});

test('设置内快捷键不触发背景 App，文本编辑快捷键保留默认行为', async () => {
  const container = await mount(<App />);
  const book = required<HTMLButtonElement>(container, '[data-testid="activity-book"]');
  await click(book);
  key(book, ',', { ctrlKey: true });
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  key(search, 'b', { ctrlKey: true });
  assert.ok(container.querySelector('[data-testid="shell-side-panel"]'));
  key(search, 'p', { ctrlKey: true, shiftKey: true });
  assert.equal(container.querySelector('[data-testid="command-palette"]') === null, true);
  assert.equal(key(search, 'c', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(key(search, 'v', { ctrlKey: true }).defaultPrevented, false);
});

test('设置从临时齿轮菜单打开，关闭后焦点回到持久齿轮入口', async () => {
  const container = await mount(<App />);
  const gear = required<HTMLButtonElement>(container, '[data-testid="activity-settings"]');
  await click(gear);
  const menuItem = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ).find((item) => item.textContent === '设置');
  assert.ok(menuItem);
  await click(menuItem);
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  assert.equal(document.activeElement === search, true);
  key(search, 'Escape');
  assert.equal(document.activeElement === gear, true);
});

test('设置关闭按钮与欢迎卡入口之间恢复焦点', async () => {
  const container = await mount(<App />);
  const entry = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('模型'),
  );
  assert.ok(entry);
  await click(entry);
  await click(required<HTMLButtonElement>(container, '[data-testid="settings-close"]'));
  assert.equal(document.activeElement === entry, true);
});

test('模型技术详情默认折叠但保留真实配置来源，探测的保存副作用仍可见', async () => {
  const { container } = await openSettings();
  const details = required<HTMLDetailsElement>(
    container,
    '[data-testid="provider-runtime-details"]',
  );
  assert.equal(details.open, false);
  assert.match(details.textContent ?? '', /llm-provider\.json/);
  assert.match(details.textContent ?? '', /真实模型调用读取后端环境变量/);
  for (const variable of ['PROVIDER', 'BASE_URL', 'MODEL', 'API_KEY']) {
    assert.ok(details.textContent?.includes(`STORYFORGE_LLM_${variable}`));
  }
  assert.equal(
    required(container, '[data-testid="provider-runtime-env-source"]').textContent,
    '桌面注入',
  );
  const detector = required<HTMLButtonElement>(container, '[data-testid="provider-detect-models"]');
  const descriptionId = detector.getAttribute('aria-describedby');
  assert.ok(descriptionId);
  const description = document.getElementById(descriptionId);
  assert.ok(description);
  assert.equal(description.closest('details') === null, true);
  assert.match(description.textContent ?? '', /会先保存当前配置/);
});

test('搜索可以找到技术详情，无匹配时 Tab 不落入被过滤的控件', async () => {
  const { container } = await openSettings();
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setValue);
  await act(async () => {
    setValue.call(search, 'STORYFORGE_LLM_API_KEY');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    required<HTMLDetailsElement>(container, '[data-testid="provider-runtime-details"]').open,
    true,
  );
  await act(async () => {
    setValue.call(search, '不存在的设置项');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(container.querySelector('[data-testid="provider-runtime-details"]') === null, true);
  const first = required<HTMLButtonElement>(container, '[data-testid="settings-close"]');
  first.focus();
  key(first, 'Tab', { shiftKey: true });
  assert.equal(document.activeElement === search, true);
});
