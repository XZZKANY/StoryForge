import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { App } from '../src/App';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';
import { listLlmProfiles, type LlmProfiles } from '../src/lib/desktop-llm-config';

vi.mock('../src/components/Editor', () => ({ Editor: () => null }));
vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return {
    LlmProbeError: actual.LlmProbeError,
    listLlmProfiles: vi.fn(async () => null),
    saveLlmProfile: vi.fn(),
    deleteLlmProfile: vi.fn(),
    activateLlmProfile: vi.fn(),
    setPolishLlmProfile: vi.fn(),
    probeLlmDraft: vi.fn(),
  };
});
vi.mock('../src/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api-client')>();
  return {
    ...actual,
    probeProviderHealth: vi.fn(async () => ({
      status: 'unreachable',
      reachable: false,
      baseUrl: null,
      model: null,
      latencyMs: null,
      modelCount: null,
      models: [],
      detail: null,
      missingEnv: [],
    })),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const twoProfiles: LlmProfiles = {
  profiles: [
    {
      id: 'p1',
      name: '',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet',
      hasApiKey: true,
    },
    {
      id: 'p2',
      name: '',
      provider: 'kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2',
      hasApiKey: false,
    },
  ],
  activeProfileId: 'p1',
  polishProfileId: null,
};

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
  const light = required<HTMLButtonElement>(container, '[data-testid="appearance-mode-light"]');
  await act(async () => {
    light.focus();
    light.click();
  });
  assert.equal(light.getAttribute('aria-checked'), 'true');
  assert.equal(document.activeElement === light, true);
});

test('设置 Tab 首尾环绕，Escape 关闭并恢复入口焦点', async () => {
  const { container, opener } = await openSettings();
  const first = required<HTMLButtonElement>(container, '[data-testid="settings-close"]');
  // 最后一个可聚焦控件：关于区末尾的「检查更新」。
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

test('设置所有输入、选择、范围控件均有关联名称与说明（含模型配置表单与润色选择）', async () => {
  vi.mocked(listLlmProfiles).mockResolvedValueOnce(twoProfiles);
  const { container } = await openSettings();
  await click(required<HTMLButtonElement>(container, '[data-testid="model-profile-new"]'));
  await click(
    required<HTMLButtonElement>(container, '[data-testid="model-profile-kind-openai-compatible"]'),
  );
  for (const id of [
    'model-profile-base-url',
    'model-profile-api-key',
    'model-profile-model',
    'model-polish-profile',
  ])
    required(container, `[data-testid="${id}"]`);
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

test('开关行走 controlId 关联：点标题即可切换，按钮不再自带 aria-label', async () => {
  const { container } = await openSettings();
  const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.getAttribute('aria-pressed') !== null,
  );
  assert.ok(toggle, '应渲染至少一个 ToggleRow 开关');
  assert.ok(toggle.id, '开关应带 controlId');
  assert.equal(toggle.getAttribute('aria-label'), null, '命名交给 label htmlFor，不再重复');
  const label = container.querySelector<HTMLLabelElement>(`label[for="${toggle.id}"]`);
  assert.ok(label, '标题 label 应通过 htmlFor 关联开关');
  assert.ok(label.textContent?.trim(), 'label 应有可见标题');
  const describedBy = toggle.getAttribute('aria-describedby');
  assert.ok(describedBy);
  assert.ok(document.getElementById(describedBy)?.textContent, '描述应可定位');
  const before = toggle.getAttribute('aria-pressed');
  await click(label);
  assert.notEqual(toggle.getAttribute('aria-pressed'), before, '点标题应切换开关');
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

test('配置卡与服务商选择有可读名称：当前那套标 aria-current，菜单按钮说清是哪一套', async () => {
  vi.mocked(listLlmProfiles).mockResolvedValueOnce(twoProfiles);
  const { container } = await openSettings();
  const cards = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="model-profile-select"]',
  );
  assert.equal(cards.length, 2);
  assert.equal(cards[0].getAttribute('aria-current'), 'true');
  assert.match(cards[0].getAttribute('aria-label') ?? '', /正在用：Anthropic · claude-sonnet/);
  assert.match(cards[1].getAttribute('aria-label') ?? '', /切换到：Kimi · kimi-k2（还没存 Key）/);
  const menus = container.querySelectorAll('[data-testid="model-profile-menu"]');
  assert.match(menus[1].getAttribute('aria-label') ?? '', /Kimi · kimi-k2/);
  await click(required<HTMLButtonElement>(container, '[data-testid="model-profile-new"]'));
  const group = required(container, '[role="radiogroup"]');
  const labelId = group.getAttribute('aria-labelledby');
  assert.ok(labelId);
  assert.equal(document.getElementById(labelId)?.textContent, '服务商');
  const radios = group.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  assert.equal(
    Array.from(radios).filter((radio) => radio.tabIndex === 0).length,
    1,
    '服务商选择只有一个 Tab 停靠点',
  );
});

test('设置从临时齿轮菜单打开，关闭后焦点回到持久齿轮入口', async () => {
  // The library hides the activity rail: a real user must open a project before using its gear.
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['D:/settings-focus-fixture']));
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
  const container = await mount(<App />);
  await click(
    required<HTMLButtonElement>(container, '[data-project-path="D:/settings-focus-fixture"]'),
  );
  const gear = required<HTMLButtonElement>(container, '[data-testid="activity-settings"]');
  await click(gear);
  const menuItem = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ).find((item) => item.textContent === '设置');
  assert.ok(menuItem);
  await click(menuItem);
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  assert.equal(document.activeElement === search, true);
  key(search, 'Escape');
  assert.equal(document.activeElement === gear, true);
});

test('设置关闭按钮与作品库入口之间恢复焦点', async () => {
  const container = await mount(<App />);
  const entry = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === '设置' && !button.closest('[hidden]'),
  );
  assert.ok(entry);
  await click(entry);
  await click(required<HTMLButtonElement>(container, '[data-testid="settings-close"]'));
  assert.equal(document.activeElement === entry, true);
});

test('模型技术详情默认折叠但保留真实配置来源；获取模型的说明写明不用先保存', async () => {
  const { container } = await openSettings();
  const details = required<HTMLDetailsElement>(
    container,
    '[data-testid="provider-runtime-details"]',
  );
  assert.equal(details.open, false);
  assert.match(details.textContent ?? '', /llm-provider\.json/);
  assert.match(details.textContent ?? '', /由桌面应用直接发到你填的服务地址/);
  assert.doesNotMatch(details.textContent ?? '', /后端|环境变量|STORYFORGE_LLM_/);
  assert.equal(
    required(container, '[data-testid="provider-runtime-env-source"]').textContent,
    '仅存本机',
  );
  await click(required<HTMLButtonElement>(container, '[data-testid="model-profile-new"]'));
  await click(required<HTMLButtonElement>(container, '[data-testid="model-profile-kind-kimi"]'));
  const modelInput = required<HTMLInputElement>(container, '[data-testid="model-profile-model"]');
  const descriptionId = modelInput.getAttribute('aria-describedby');
  assert.ok(descriptionId);
  const description = document.getElementById(descriptionId);
  assert.ok(description);
  assert.equal(description.closest('details') === null, true);
  assert.match(description.textContent ?? '', /不用先保存/);
});

test('搜索可以找到技术详情，无匹配时 Tab 不落入被过滤的控件', async () => {
  const { container } = await openSettings();
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setValue);
  await act(async () => {
    setValue.call(search, 'llm-provider');
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

test('搜索有内容时 Esc 只清空搜索、设置不关，清空后再按 Esc 才关', async () => {
  const { container, opener } = await openSettings();
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setValue);
  await act(async () => {
    setValue.call(search, '不存在的设置项XYZ');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const first = key(search, 'Escape');
  assert.equal(search.value, '');
  assert.equal(first.defaultPrevented, false);
  assert.ok(container.querySelector('[role="dialog"]'));
  assert.equal(document.activeElement === search, true);
  key(search, 'Escape');
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement === opener, true);
});

test('输入法组字中按 Esc 不清搜索', async () => {
  const { container } = await openSettings();
  const search = required<HTMLInputElement>(container, '[data-testid="settings-search"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setValue);
  await act(async () => {
    setValue.call(search, '外观');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  key(search, 'Escape', { isComposing: true });
  assert.equal(search.value, '外观');
  assert.ok(container.querySelector('[role="dialog"]'));
});
