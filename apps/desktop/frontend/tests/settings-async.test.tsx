import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../src/lib/user-settings';
import {
  activateLlmProfile,
  deleteLlmProfile,
  listLlmProfiles,
  LlmProbeError,
  probeLlmDraft,
  saveLlmProfile,
  setPolishLlmProfile,
  type LlmDraftModels,
  type LlmProfile,
  type LlmProfiles,
  type SavedLlmProfile,
} from '../src/lib/desktop-llm-config';
import { probeProviderHealth } from '../src/lib/api-client';

vi.mock('../src/lib/desktop-llm-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/desktop-llm-config')>();
  return {
    LlmProbeError: actual.LlmProbeError,
    listLlmProfiles: vi.fn(),
    saveLlmProfile: vi.fn(),
    deleteLlmProfile: vi.fn(),
    activateLlmProfile: vi.fn(),
    setPolishLlmProfile: vi.fn(),
    probeLlmDraft: vi.fn(),
  };
});
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/update-check', () => ({
  currentAppVersion: async () => null,
  checkForUpdate: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const claude: LlmProfile = {
  id: 'p1',
  name: '默认',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet',
  models: ['claude-sonnet'],
  hasApiKey: true,
};
const kimi: LlmProfile = {
  id: 'p2',
  name: '',
  provider: 'kimi',
  baseUrl: 'https://api.moonshot.cn/v1',
  model: 'kimi-k2',
  models: ['kimi-k2'],
  hasApiKey: true,
};
const listed: LlmProfiles = {
  profiles: [claude, kimi],
  activeProfileId: 'p1',
  polishProfileId: null,
};
const saved = (savedProfileId: string, base: LlmProfiles = listed): SavedLlmProfile => ({
  ...base,
  savedProfileId,
});

const mounted: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listLlmProfiles).mockResolvedValue(listed);
});
afterEach(() => {
  for (const cleanup of mounted.splice(0)) cleanup();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(onClose: () => void = () => {}) {
  let latest = DEFAULT_APP_SETTINGS;
  const change = vi.fn((value: AppSettings) => {
    latest = value;
  });
  function Harness() {
    const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS);
    return (
      <SettingsView
        settings={settings}
        onChange={(next) => {
          change(next);
          setSettings(next);
        }}
        onClose={onClose}
      />
    );
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let live = true;
  const cleanup = () => {
    if (live) {
      act(() => root.unmount());
      live = false;
      container.remove();
    }
  };
  mounted.push(cleanup);
  await act(async () => root.render(<Harness />));
  return { container, change, cleanup, latest: () => latest };
}
function required<T extends Element = HTMLElement>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
}
const byTestId = <T extends Element = HTMLElement>(container: ParentNode, id: string) =>
  required<T>(container, `[data-testid="${id}"]`);
const card = (container: ParentNode, id: string) =>
  required(container, `[data-testid="model-profile-card"][data-profile-id="${id}"]`);
const select = (container: ParentNode, id: string) =>
  required<HTMLButtonElement>(card(container, id), '[data-testid="model-profile-select"]');
const status = (container: ParentNode, id: string) =>
  card(container, id).querySelector('[data-testid="model-profile-status"]')?.textContent ?? '';
const picked = (container: ParentNode) =>
  Array.from(
    byTestId(container, 'model-profile-picked').querySelectorAll(
      '[data-testid="model-profile-picked-model"]',
    ),
  ).map((item) => item.firstElementChild?.textContent);

async function edit(container: ParentNode, id: string, value: string) {
  const element = byTestId<HTMLInputElement | HTMLSelectElement>(container, id);
  await act(async () => {
    if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function menuItem(container: ParentNode, profileId: string, label: RegExp) {
  await click(required(card(container, profileId), '[data-testid="model-profile-menu"]'));
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => label.test(button.textContent ?? ''),
  );
  assert.ok(item, String(label));
  return item;
}
async function dialogButton(container: ParentNode, text: string) {
  const host = await vi.waitFor(() => {
    const found = container.querySelector<HTMLElement>('[data-testid="app-dialog"]');
    assert.ok(found, '应弹出确认框');
    return found;
  });
  const target = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  assert.ok(target, text);
  return target;
}
const models = (names: string[]): LlmDraftModels => ({ models: names, partial: false });

test('当前那套打勾；点别的卡片才调用切换，并提示下一次调用生效', async () => {
  vi.mocked(activateLlmProfile).mockResolvedValueOnce({ ...listed, activeProfileId: 'p2' });
  const view = await mount();
  assert.equal(select(view.container, 'p1').getAttribute('aria-current'), 'true');
  assert.equal(select(view.container, 'p2').getAttribute('aria-current'), null);
  assert.match(card(view.container, 'p2').textContent ?? '', /Kimi · kimi-k2/);
  await click(select(view.container, 'p1'));
  assert.equal(vi.mocked(activateLlmProfile).mock.calls.length, 0);
  await click(select(view.container, 'p2'));
  assert.deepEqual(vi.mocked(activateLlmProfile).mock.calls, [['p2']]);
  assert.equal(select(view.container, 'p2').getAttribute('aria-current'), 'true');
  assert.equal(
    byTestId(view.container, 'model-profiles-notice').textContent,
    '已切到「Kimi · kimi-k2」，下一次调用生效',
  );
});

test('切换失败照实报错，卡片保持原样', async () => {
  vi.mocked(activateLlmProfile).mockRejectedValueOnce(new Error('本机配置暂时锁定'));
  const view = await mount();
  await click(select(view.container, 'p2'));
  assert.match(
    byTestId(view.container, 'model-profiles-notice').textContent ?? '',
    /切换失败：本机配置暂时锁定/,
  );
  assert.equal(select(view.container, 'p1').getAttribute('aria-current'), 'true');
});

test('新建：选服务商自动填地址并折叠，贴 Key 不用保存就能获取模型，勾选几个后保存并自动测一次', async () => {
  vi.mocked(listLlmProfiles).mockResolvedValueOnce({ ...listed, profiles: [claude] });
  vi.mocked(probeLlmDraft).mockResolvedValueOnce(models(['kimi-k2', 'moonshot-v1']));
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  assert.equal(view.container.querySelector('[data-testid="model-profile-api-key"]'), null);
  await click(byTestId(view.container, 'model-profile-kind-kimi'));
  assert.match(
    byTestId(view.container, 'model-profile-address').textContent ?? '',
    /https:\/\/api\.moonshot\.cn\/v1/,
  );
  assert.equal(view.container.querySelector('[data-testid="model-profile-base-url"]'), null);
  await edit(view.container, 'model-profile-api-key', 'synthetic-draft-key');
  await click(byTestId(view.container, 'model-profile-fetch'));
  assert.deepEqual(vi.mocked(probeLlmDraft).mock.calls[0][0], {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: 'synthetic-draft-key',
    profileId: undefined,
  });
  assert.equal(vi.mocked(saveLlmProfile).mock.calls.length, 0, '获取模型不先保存');
  const option = (name: string) =>
    Array.from(
      byTestId(view.container, 'model-profile-model-options').querySelectorAll('button'),
    ).find((item) => item.textContent === name)!;
  await click(option('moonshot-v1'));
  await click(option('kimi-k2'));
  assert.equal(option('moonshot-v1').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(picked(view.container), ['moonshot-v1', 'kimi-k2']);

  vi.mocked(saveLlmProfile).mockResolvedValueOnce(
    saved('p2', {
      ...listed,
      profiles: [claude, { ...kimi, model: 'moonshot-v1', models: ['moonshot-v1', 'kimi-k2'] }],
    }),
  );
  vi.mocked(probeLlmDraft).mockResolvedValueOnce(models(['moonshot-v1']));
  await click(byTestId(view.container, 'model-profile-save'));
  assert.deepEqual(vi.mocked(saveLlmProfile).mock.calls[0][0], {
    id: undefined,
    name: '',
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1',
    models: ['moonshot-v1', 'kimi-k2'],
    apiKey: 'synthetic-draft-key',
  });
  assert.equal(view.container.querySelector('[data-testid="model-profile-editor"]'), null);
  // 不是当前那套：用它已存的 Key 拉一次列表，不走引擎（引擎只认当前那套）。
  assert.deepEqual(vi.mocked(probeLlmDraft).mock.calls[1][0], {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    profileId: 'p2',
  });
  assert.equal(vi.mocked(probeProviderHealth).mock.calls.length, 0);
  assert.match(status(view.container, 'p2'), /模型列表可达/);
});

test('保存当前那套后走引擎的真实出网链路测一次，结果写在卡片上', async () => {
  vi.mocked(saveLlmProfile).mockResolvedValueOnce(saved('p1'));
  vi.mocked(probeProviderHealth).mockResolvedValueOnce({
    status: 'unauthorized',
    reachable: true,
    baseUrl: claude.baseUrl,
    model: claude.model,
    latencyMs: 3,
    modelCount: null,
    models: [],
    detail: 'HTTP 401',
    missingEnv: [],
  });
  const view = await mount();
  await click(await menuItem(view.container, 'p1', /^编辑$/));
  await click(byTestId(view.container, 'model-profile-save'));
  assert.equal(vi.mocked(probeProviderHealth).mock.calls.length, 1);
  assert.equal(vi.mocked(probeLlmDraft).mock.calls.length, 0);
  assert.match(status(view.container, 'p1'), /鉴权失败/);
});

test('自定义 / 中转展开地址栏且不预填，没填地址不能获取模型也不能保存', async () => {
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  await click(byTestId(view.container, 'model-profile-kind-openai-compatible'));
  const address = byTestId<HTMLInputElement>(view.container, 'model-profile-base-url');
  assert.equal(address.value, '');
  assert.equal(byTestId<HTMLButtonElement>(view.container, 'model-profile-fetch').disabled, true);
  await click(byTestId(view.container, 'model-profile-save'));
  assert.match(
    byTestId(view.container, 'model-profile-save-error').textContent ?? '',
    /先填服务地址/,
  );
  assert.equal(vi.mocked(saveLlmProfile).mock.calls.length, 0);
});

test('编辑已存的那套：Key 留空沿用，获取模型借它已存的 Key', async () => {
  vi.mocked(probeLlmDraft).mockResolvedValueOnce(models(['kimi-k2']));
  const view = await mount();
  await click(await menuItem(view.container, 'p2', /^编辑$/));
  assert.match(
    byTestId<HTMLInputElement>(view.container, 'model-profile-api-key').placeholder,
    /留空就沿用/,
  );
  await click(byTestId(view.container, 'model-profile-fetch'));
  assert.deepEqual(vi.mocked(probeLlmDraft).mock.calls[0][0], {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: undefined,
    profileId: 'p2',
  });
  vi.mocked(saveLlmProfile).mockResolvedValueOnce(saved('p2'));
  vi.mocked(probeLlmDraft).mockResolvedValueOnce(models(['kimi-k2']));
  await click(byTestId(view.container, 'model-profile-save'));
  const request = vi.mocked(saveLlmProfile).mock.calls[0][0];
  assert.equal(request.id, 'p2');
  assert.equal(request.apiKey, '');
  assert.equal(request.clearApiKey, undefined);
});

test('勾选：搜索只筛列表，回车加入列表里没有的名字，× 去掉；一个不勾不能保存', async () => {
  vi.mocked(probeLlmDraft).mockResolvedValueOnce(models(['kimi-k2', 'moonshot-v1', 'kimi-latest']));
  const view = await mount();
  await click(await menuItem(view.container, 'p2', /^编辑$/));
  assert.deepEqual(picked(view.container), ['kimi-k2']);
  await click(byTestId(view.container, 'model-profile-fetch'));
  await edit(view.container, 'model-profile-model', 'KIMI');
  const shown = () =>
    Array.from(
      byTestId(view.container, 'model-profile-model-options').querySelectorAll('button'),
    ).map((item) => [item.textContent, item.getAttribute('aria-pressed')]);
  assert.deepEqual(shown(), [
    ['kimi-k2', 'true'],
    ['kimi-latest', 'false'],
  ]);
  assert.equal(
    byTestId<HTMLButtonElement>(view.container, 'model-profile-add-model').disabled,
    false,
  );

  await edit(view.container, 'model-profile-model', 'kimi-k2');
  assert.equal(
    byTestId<HTMLButtonElement>(view.container, 'model-profile-add-model').disabled,
    true,
    '已勾的不重复加入',
  );
  await edit(view.container, 'model-profile-model', 'my-private-model');
  await act(async () => {
    byTestId(view.container, 'model-profile-model').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });
  assert.deepEqual(picked(view.container), ['kimi-k2', 'my-private-model']);
  assert.equal(byTestId<HTMLInputElement>(view.container, 'model-profile-model').value, '');

  for (const name of ['kimi-k2', 'my-private-model'])
    await click(
      byTestId(view.container, 'model-profile-picked').querySelector<HTMLButtonElement>(
        `[aria-label="去掉 ${name}"]`,
      )!,
    );
  assert.deepEqual(picked(view.container), []);
  await click(byTestId(view.container, 'model-profile-save'));
  assert.match(
    byTestId(view.container, 'model-profile-save-error').textContent ?? '',
    /先勾选或填一个模型/,
  );
  assert.equal(vi.mocked(saveLlmProfile).mock.calls.length, 0);
});

test('获取模型的迟到结果在换了服务商后作废', async () => {
  const pending = deferred<LlmDraftModels>();
  vi.mocked(probeLlmDraft).mockReturnValueOnce(pending.promise);
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  await click(byTestId(view.container, 'model-profile-kind-kimi'));
  await click(byTestId(view.container, 'model-profile-fetch'));
  await click(byTestId(view.container, 'model-profile-kind-deepseek'));
  await act(async () => pending.resolve(models(['stale-kimi-model'])));
  assert.equal(view.container.querySelector('[data-testid="model-profile-model-options"]'), null);
  assert.doesNotMatch(view.container.textContent ?? '', /stale-kimi-model/);
});

test('获取模型失败显示可读原因', async () => {
  vi.mocked(probeLlmDraft).mockRejectedValueOnce(
    new LlmProbeError('Key 不对或没有权限（HTTP 401）。', 'unauthorized'),
  );
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  await click(byTestId(view.container, 'model-profile-kind-kimi'));
  await click(byTestId(view.container, 'model-profile-fetch'));
  assert.match(
    byTestId(view.container, 'model-profile-fetch-status').textContent ?? '',
    /Key 不对或没有权限/,
  );
});

test('保存失败保留草稿并可重试', async () => {
  vi.mocked(saveLlmProfile).mockRejectedValueOnce(new Error('本机配置暂时锁定'));
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  await click(byTestId(view.container, 'model-profile-kind-deepseek'));
  await edit(view.container, 'model-profile-model', 'deepseek-chat');
  await click(byTestId(view.container, 'model-profile-add-model'));
  await edit(view.container, 'model-profile-api-key', 'synthetic-retry-input');
  await click(byTestId(view.container, 'model-profile-save'));
  assert.match(
    byTestId(view.container, 'model-profile-save-error').textContent ?? '',
    /保存失败：本机配置暂时锁定/,
  );
  assert.equal(
    byTestId<HTMLInputElement>(view.container, 'model-profile-api-key').value,
    'synthetic-retry-input',
  );
  vi.mocked(saveLlmProfile).mockResolvedValueOnce(saved('p3'));
  await click(byTestId(view.container, 'model-profile-save'));
  assert.equal(vi.mocked(saveLlmProfile).mock.calls.length, 2);
  assert.equal(view.container.querySelector('[data-testid="model-profile-editor"]'), null);
});

test('删除走确认：取消不删，确认才删；正在用的那套删除项不可用', async () => {
  const view = await mount();
  const activeDelete = await menuItem(view.container, 'p1', /^删除/);
  assert.equal(activeDelete.disabled, true);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await click(await menuItem(view.container, 'p2', /^删除$/));
  await click(await dialogButton(view.container, '取消'));
  assert.equal(vi.mocked(deleteLlmProfile).mock.calls.length, 0);
  vi.mocked(deleteLlmProfile).mockResolvedValueOnce({ ...listed, profiles: [claude] });
  await click(await menuItem(view.container, 'p2', /^删除$/));
  await click(await dialogButton(view.container, '删除'));
  assert.deepEqual(vi.mocked(deleteLlmProfile).mock.calls, [['p2']]);
  assert.equal(
    view.container.querySelector('[data-testid="model-profile-card"][data-profile-id="p2"]'),
    null,
  );
});

test('移除 Key 走确认，只清这一套', async () => {
  vi.mocked(saveLlmProfile).mockResolvedValueOnce(
    saved('p2', { ...listed, profiles: [claude, { ...kimi, hasApiKey: false }] }),
  );
  const view = await mount();
  await click(await menuItem(view.container, 'p2', /^移除 Key$/));
  await click(await dialogButton(view.container, '移除 Key'));
  assert.deepEqual(vi.mocked(saveLlmProfile).mock.calls[0][0], {
    id: 'p2',
    name: '',
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2',
    clearApiKey: true,
  });
  assert.match(status(view.container, 'p2'), /还没存 Key/);
  assert.doesNotMatch(status(view.container, 'p1'), /还没存 Key/);
});

test('整章润色默认跟随当前模型，可指定某一套再改回跟随', async () => {
  const view = await mount();
  const polish = byTestId<HTMLSelectElement>(view.container, 'model-polish-profile');
  assert.equal(polish.value, '');
  assert.match(polish.options[0].textContent ?? '', /跟随当前模型/);
  vi.mocked(setPolishLlmProfile).mockResolvedValueOnce({ ...listed, polishProfileId: 'p2' });
  await edit(view.container, 'model-polish-profile', 'p2');
  assert.deepEqual(vi.mocked(setPolishLlmProfile).mock.calls, [['p2']]);
  assert.equal(polish.value, 'p2');
  vi.mocked(setPolishLlmProfile).mockResolvedValueOnce(listed);
  await edit(view.container, 'model-polish-profile', '');
  assert.deepEqual(vi.mocked(setPolishLlmProfile).mock.calls[1], [null]);
  assert.equal(
    byTestId(view.container, 'model-profiles-notice').textContent,
    '整章润色跟随当前模型',
  );
});

test('写操作一次只走一件：切换没完成时再点别的卡片不会重复写', async () => {
  const pending = deferred<LlmProfiles | null>();
  vi.mocked(activateLlmProfile).mockReturnValueOnce(pending.promise);
  const three = {
    ...listed,
    profiles: [claude, kimi, { ...kimi, id: 'p3', model: 'moonshot-v1' }],
  };
  vi.mocked(listLlmProfiles).mockResolvedValueOnce(three);
  const view = await mount();
  act(() => {
    select(view.container, 'p2').click();
    select(view.container, 'p3').click();
  });
  assert.equal(vi.mocked(activateLlmProfile).mock.calls.length, 1);
  assert.equal(select(view.container, 'p3').disabled, true);
  await act(async () => pending.resolve({ ...three, activeProfileId: 'p2' }));
  assert.equal(select(view.container, 'p3').disabled, false);
});

test('未保存徽标与关窗确认只跟正在编辑的草稿走', async () => {
  const onClose = vi.fn();
  const view = await mount(onClose);
  const badge = () => view.container.querySelector('[data-testid="settings-unsaved-provider"]');
  await click(byTestId(view.container, 'model-profile-new'));
  assert.equal(badge(), null, '刚打开的空表单不算未保存');
  await click(byTestId(view.container, 'model-profile-kind-kimi'));
  assert.ok(badge());
  await click(byTestId(view.container, 'settings-close'));
  assert.equal(onClose.mock.calls.length, 0);
  await click(await dialogButton(view.container, '继续编辑'));
  await click(byTestId(view.container, 'model-profile-cancel'));
  assert.equal(badge(), null);
  await click(byTestId(view.container, 'settings-close'));
  assert.equal(onClose.mock.calls.length, 1);
});

test('改了一半去编辑别的那套先确认，取消就留在原草稿', async () => {
  const view = await mount();
  await click(byTestId(view.container, 'model-profile-new'));
  await click(byTestId(view.container, 'model-profile-kind-kimi'));
  await click(await menuItem(view.container, 'p1', /^编辑$/));
  await click(await dialogButton(view.container, '继续编辑'));
  assert.equal(
    byTestId(view.container, 'model-profile-kind-kimi').getAttribute('aria-checked'),
    'true',
  );
});

test('配置读取失败可见，可重试', async () => {
  vi.mocked(listLlmProfiles).mockRejectedValueOnce(new Error('配置文件暂时不可读'));
  const view = await mount();
  assert.match(view.container.textContent ?? '', /配置读取失败.*配置文件暂时不可读/);
  await click(byTestId(view.container, 'provider-config-retry'));
  assert.equal(view.container.querySelector('[data-testid="provider-config-error"]'), null);
  assert.ok(card(view.container, 'p2'));
});

test('保存发出后卸载：迟到结果不再更新、不再探测', async () => {
  const pending = deferred<SavedLlmProfile | null>();
  vi.mocked(saveLlmProfile).mockReturnValueOnce(pending.promise);
  const view = await mount();
  await click(await menuItem(view.container, 'p2', /^编辑$/));
  await click(byTestId(view.container, 'model-profile-save'));
  view.cleanup();
  await act(async () => pending.resolve(saved('p2')));
  assert.equal(vi.mocked(probeLlmDraft).mock.calls.length, 0);
  assert.equal(vi.mocked(probeProviderHealth).mock.calls.length, 0);
});

test('改外观只动本机偏好，不再带模型配置，也不写模型配置文件', async () => {
  const view = await mount();
  await click(byTestId(view.container, 'appearance-mode-light'));
  assert.equal(view.latest().theme, 'light');
  assert.equal('provider' in view.latest(), false);
  assert.equal(vi.mocked(saveLlmProfile).mock.calls.length, 0);
});

test('scrollspy：分组进入视口时对应导航项获得 aria-current', async () => {
  const callbacks: Array<(entries: Array<Record<string, unknown>>) => void> = [];
  class FakeIntersectionObserver {
    constructor(callback: (entries: Array<Record<string, unknown>>) => void) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  const view = await mount();
  vi.unstubAllGlobals();
  const editorLink = Array.from(view.container.querySelectorAll('a')).find(
    (item) => item.getAttribute('href') === '#editor',
  );
  assert.ok(editorLink);
  assert.notEqual(editorLink.getAttribute('aria-current'), 'true');
  await act(async () => callbacks[0]?.([{ isIntersecting: true, target: { id: 'editor' } }]));
  assert.equal(editorLink.getAttribute('aria-current'), 'true');
  const providerLink = Array.from(view.container.querySelectorAll('a')).find(
    (item) => item.getAttribute('href') === '#provider',
  );
  assert.equal(providerLink?.getAttribute('aria-current'), null);
});
