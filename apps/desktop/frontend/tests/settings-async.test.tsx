import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { SettingsView } from '../src/components/SettingsView';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../src/lib/user-settings';
import {
  getDesktopLlmConfig,
  saveDesktopLlmConfig,
  type DesktopLlmConfig,
} from '../src/lib/desktop-llm-config';
import { probeProviderHealth } from '../src/lib/api-client';

vi.mock('../src/lib/desktop-llm-config', () => ({
  getDesktopLlmConfig: vi.fn(),
  saveDesktopLlmConfig: vi.fn(),
}));
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/update-check', () => ({
  currentAppVersion: async () => null,
  checkForUpdate: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: DesktopLlmConfig = {
  provider: 'openai',
  baseUrl: 'https://main.example/v1',
  model: 'stored-main',
  hasApiKey: true,
  polish: {
    provider: 'anthropic',
    baseUrl: 'https://polish.example/v1',
    model: 'stored-polish',
    hasApiKey: true,
  },
};
const mounted: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getDesktopLlmConfig).mockResolvedValue(null);
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
async function mount() {
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
        onClose={() => {}}
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
function required<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
}
async function edit(container: ParentNode, id: string, value: string) {
  const element = required<HTMLInputElement | HTMLSelectElement>(
    container,
    `[data-testid="${id}"]`,
  );
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
function button(container: ParentNode, section: string, text: string) {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>(`#${section} button`),
  ).find((item) => item.textContent === text);
  assert.ok(result, text);
  return result;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}

test('迟到读取保留外观编辑，同时加载两个未编辑模型槽位', async () => {
  const read = deferred<DesktopLlmConfig | null>();
  vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(read.promise);
  const view = await mount();
  await edit(view.container, 'appearance-theme', 'light');
  await act(async () => read.resolve(config));
  assert.equal(view.latest().theme, 'light');
  assert.equal(view.latest().provider.model, 'stored-main');
  assert.equal(view.latest().polishProvider.model, 'stored-polish');
});

test('读取只跳过已编辑的模型槽位，不丢失另一槽位配置，不回显密钥', async () => {
  const read = deferred<DesktopLlmConfig | null>();
  vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(read.promise);
  const view = await mount();
  await edit(view.container, 'provider-model', 'author-model');
  await act(async () => read.resolve(config));
  assert.equal(view.latest().provider.model, 'author-model');
  assert.equal(view.latest().polishProvider.model, 'stored-polish');
  assert.equal(
    required<HTMLInputElement>(view.container, '[data-testid="provider-api-key"]').value,
    '',
  );
  assert.equal(
    required<HTMLInputElement>(view.container, '[data-testid="polish-provider-api-key"]').value,
    '',
  );
});

test('配置读取失败可见，可重试且重试期间输入不丢失', async () => {
  vi.mocked(getDesktopLlmConfig).mockRejectedValueOnce(new Error('配置文件暂时不可读'));
  const view = await mount();
  assert.match(view.container.textContent ?? '', /配置读取失败.*配置文件暂时不可读/);
  const read = deferred<DesktopLlmConfig | null>();
  vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(read.promise);
  await click(required(view.container, '[data-testid="provider-config-retry"]'));
  await edit(view.container, 'provider-model', 'retry-draft');
  await act(async () => read.resolve(config));
  assert.equal(view.latest().provider.model, 'retry-draft');
  assert.equal(view.container.querySelector('[data-testid="provider-config-error"]'), null);
});

test('主槽保存迟到成功不回滚主题与润色草稿，清空提交密钥后保留成功状态', async () => {
  const save = deferred<DesktopLlmConfig | null>();
  vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
  const view = await mount();
  await edit(view.container, 'provider-api-key', 'synthetic-test-input');
  await click(button(view.container, 'provider', '保存并应用'));
  await edit(view.container, 'appearance-theme', 'light');
  await edit(view.container, 'polish-provider-model', 'fresh-polish');
  await act(async () => save.resolve(config));
  assert.equal(view.latest().theme, 'light');
  assert.equal(view.latest().polishProvider.model, 'fresh-polish');
  assert.equal(
    required<HTMLInputElement>(view.container, '[data-testid="provider-api-key"]').value,
    '',
  );
  assert.match(view.container.textContent ?? '', /已保存并应用/);
});

test('润色保存迟到成功不回滚外观输入', async () => {
  const save = deferred<DesktopLlmConfig | null>();
  vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
  const view = await mount();
  await click(button(view.container, 'polish-provider', '保存并应用'));
  await edit(view.container, 'appearance-theme', 'light');
  await act(async () => save.resolve(config));
  assert.equal(view.latest().theme, 'light');
  assert.equal(view.latest().polishProvider.apiKeyRef, 'stored://storyforge/llm-provider/polish');
});

test('保存后的旧读取不能回滚元数据或字段', async () => {
  const read = deferred<DesktopLlmConfig | null>();
  vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(read.promise);
  const view = await mount();
  vi.mocked(saveDesktopLlmConfig).mockResolvedValueOnce(config);
  await click(button(view.container, 'provider', '保存并应用'));
  await act(async () => read.resolve({ ...config, model: 'old-read', hasApiKey: false }));
  assert.notEqual(view.latest().provider.model, 'old-read');
  assert.ok(button(view.container, 'provider', '移除密钥'));
});

test('同帧双击和跨槽写入共享占用，避免整份配置写入乱序', async () => {
  const save = deferred<DesktopLlmConfig | null>();
  vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
  const view = await mount();
  const main = button(view.container, 'provider', '保存并应用');
  const polish = button(view.container, 'polish-provider', '保存并应用');
  act(() => {
    main.click();
    main.click();
    polish.click();
  });
  assert.equal(vi.mocked(saveDesktopLlmConfig).mock.calls.length, 1);
  await edit(view.container, 'provider-model', 'new-draft');
  assert.equal(main.disabled, true);
  await act(async () => save.resolve(config));
  assert.equal(main.disabled, false);
  assert.equal(view.latest().provider.model, 'new-draft');
});

for (const slot of ['provider', 'polish-provider'] as const) {
  for (const action of ['保存并应用', '移除密钥']) {
    for (const outcome of ['success', 'error']) {
      test(`${slot} ${action} 的 A→B→A 迟到 ${outcome} 不获得新作用域资格`, async () => {
        vi.mocked(getDesktopLlmConfig).mockResolvedValueOnce(config);
        const view = await mount();
        const original = required<HTMLInputElement>(
          view.container,
          `[data-testid="${slot}-model"]`,
        ).value;
        const save = deferred<DesktopLlmConfig | null>();
        vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
        await click(button(view.container, slot, action));
        await edit(view.container, `${slot}-model`, 'temporary-model');
        await edit(view.container, `${slot}-model`, original);
        await act(async () => {
          if (outcome === 'error') save.reject(new Error('obsolete-write-error'));
          else
            save.resolve({
              ...config,
              hasApiKey: false,
              polish: config.polish && { ...config.polish, hasApiKey: false },
            });
        });
        assert.doesNotMatch(
          view.container.textContent ?? '',
          /obsolete-write-error|已保存并应用|专用润色模型已保存/,
        );
        const current = slot === 'provider' ? view.latest().provider : view.latest().polishProvider;
        assert.notEqual(current.apiKeyRef, '');
        assert.ok(button(view.container, slot, '移除密钥'));
        assert.equal(button(view.container, slot, '保存并应用').disabled, false);
      });
    }
  }
}

test('初始读取遇到 A→B→A 仍保留作者明确恢复的字段', async () => {
  const read = deferred<DesktopLlmConfig | null>();
  vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(read.promise);
  const view = await mount();
  const original = view.latest().provider.model;
  await edit(view.container, 'provider-model', 'temporary');
  await edit(view.container, 'provider-model', original);
  await act(async () => read.resolve(config));
  assert.equal(view.latest().provider.model, original);
  assert.equal(view.latest().polishProvider.model, 'stored-polish');
});

test('探测保存阶段改了服务，旧保存结果不再启动健康探测', async () => {
  const save = deferred<DesktopLlmConfig | null>();
  vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
  const view = await mount();
  await click(required(view.container, '[data-testid="provider-detect-models"]'));
  await edit(view.container, 'provider-kind', 'deepseek');
  await act(async () => save.resolve(config));
  assert.equal(vi.mocked(probeProviderHealth).mock.calls.length, 0);
  assert.equal(view.container.querySelector('[data-testid="provider-detect-status"]'), null);
});

for (const kind of ['detect', 'probe']) {
  for (const outcome of ['success', 'error']) {
    test(`${kind} 健康请求 A→B→A 迟到 ${outcome} 不显示旧结果`, async () => {
      vi.mocked(saveDesktopLlmConfig).mockResolvedValue(config);
      const health = deferred<Awaited<ReturnType<typeof probeProviderHealth>>>();
      vi.mocked(probeProviderHealth).mockReturnValueOnce(health.promise);
      const view = await mount();
      const original = view.latest().provider.model;
      await click(
        required(
          view.container,
          kind === 'detect'
            ? '[data-testid="provider-detect-models"]'
            : '[data-testid="provider-health-probe"]',
        ),
      );
      await edit(view.container, 'provider-model', 'temporary');
      await edit(view.container, 'provider-model', original);
      await act(async () => {
        if (outcome === 'error') health.reject(new Error('obsolete-health-error'));
        else
          health.resolve({
            status: 'ok',
            reachable: true,
            baseUrl: 'https://old.example/v1',
            model: 'old-health-model',
            latencyMs: 1,
            modelCount: 1,
            models: ['old-health-model'],
            detail: null,
            missingEnv: [],
          });
      });
      assert.doesNotMatch(
        view.container.textContent ?? '',
        /obsolete-health-error|old-health-model/,
      );
      assert.equal(view.container.querySelector('[data-testid="provider-model-options"]'), null);
      assert.equal(view.container.querySelector('[data-testid="provider-health-status"]'), null);
    });
  }
}

test('移除旧密钥等待中输入的新密钥不会被清空，且不写回其它槽位凭据', async () => {
  vi.mocked(getDesktopLlmConfig).mockResolvedValueOnce(config);
  const view = await mount();
  const save = deferred<DesktopLlmConfig | null>();
  vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(save.promise);
  await click(button(view.container, 'polish-provider', '移除密钥'));
  await edit(view.container, 'polish-provider-api-key', 'synthetic-new-key');
  await act(async () =>
    save.resolve({ ...config, polish: config.polish && { ...config.polish, hasApiKey: false } }),
  );
  assert.equal(
    required<HTMLInputElement>(view.container, '[data-testid="polish-provider-api-key"]').value,
    'synthetic-new-key',
  );
  const request = vi.mocked(saveDesktopLlmConfig).mock.calls[0][0];
  assert.equal(request.apiKey, undefined);
  assert.equal(request.clearApiKey, undefined);
  assert.equal(request.polish?.clearApiKey, true);
});

for (const slot of ['provider', 'polish-provider'] as const) {
  test(`${slot} 保存失败保留输入并可显式重试`, async () => {
    vi.mocked(saveDesktopLlmConfig).mockRejectedValueOnce(new Error('本机配置暂时锁定'));
    const view = await mount();
    await edit(view.container, `${slot}-model`, 'author-model');
    await edit(view.container, `${slot}-api-key`, 'synthetic-retry-input');
    await click(button(view.container, slot, '保存并应用'));
    assert.match(view.container.textContent ?? '', /保存失败：本机配置暂时锁定/);
    assert.equal(
      required<HTMLInputElement>(view.container, `[data-testid="${slot}-api-key"]`).value,
      'synthetic-retry-input',
    );
    vi.mocked(saveDesktopLlmConfig).mockResolvedValueOnce(config);
    await click(button(view.container, slot, '保存并应用'));
    assert.equal(
      required<HTMLInputElement>(view.container, `[data-testid="${slot}-model"]`).value,
      'author-model',
    );
    assert.equal(
      required<HTMLInputElement>(view.container, `[data-testid="${slot}-api-key"]`).value,
      '',
    );
    assert.equal(vi.mocked(saveDesktopLlmConfig).mock.calls.length, 2);
  });
}

for (const operation of ['read', 'save', 'polish-save', 'detect-save'] as const) {
  for (const outcome of ['success', 'error']) {
    test(`${operation} 卸载后的 ${outcome} 不回写偏好、不继续探测`, async () => {
      const request = deferred<DesktopLlmConfig | null>();
      if (operation === 'read') vi.mocked(getDesktopLlmConfig).mockReturnValueOnce(request.promise);
      else vi.mocked(saveDesktopLlmConfig).mockReturnValueOnce(request.promise);
      const view = await mount();
      if (operation === 'save') await click(button(view.container, 'provider', '保存并应用'));
      if (operation === 'polish-save')
        await click(button(view.container, 'polish-provider', '保存并应用'));
      if (operation === 'detect-save')
        await click(required(view.container, '[data-testid="provider-detect-models"]'));
      view.cleanup();
      const changeCount = view.change.mock.calls.length;
      await act(async () => {
        if (outcome === 'error') request.reject(new Error('obsolete-unmounted-error'));
        else request.resolve(config);
      });
      assert.equal(view.change.mock.calls.length, changeCount);
      assert.equal(vi.mocked(probeProviderHealth).mock.calls.length, 0);
    });
  }
}
