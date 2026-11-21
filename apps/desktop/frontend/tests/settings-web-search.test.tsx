import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SettingsView } from '../src/components/settings/SettingsView';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';
import { getWebSearchConfig, saveWebSearchConfig, searchWeb } from '../src/lib/api/web-search';
vi.mock('../src/lib/api/web-search', () => ({
  getWebSearchConfig: vi.fn(),
  saveWebSearchConfig: vi.fn(),
  searchWeb: vi.fn(),
}));
vi.mock('../src/lib/host/desktop-llm-config', async (original) => ({
  ...(await original<typeof import('../src/lib/host/desktop-llm-config')>()),
  listLlmProfiles: vi.fn(async () => null),
}));
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/host/update-check', () => ({
  currentAppVersion: async () => null,
  checkForUpdate: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const onClose = vi.fn();
const config = { enabled: false, hasApiKey: false, provider: 'tavily' as const };
const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const button = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === label,
  )!;
async function mount() {
  await act(async () =>
    root.render(
      <SettingsView settings={DEFAULT_APP_SETTINGS} onChange={() => {}} onClose={onClose} />,
    ),
  );
}
async function type(value: string) {
  await act(async () => {
    const input = q<HTMLInputElement>('[data-testid="web-search-api-key"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function toggle() {
  await act(async () => q<HTMLButtonElement>('#web-search button[aria-pressed]').click());
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getWebSearchConfig).mockResolvedValue(config);
  vi.mocked(saveWebSearchConfig).mockResolvedValue({ ...config, hasApiKey: true, enabled: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('displays a disabled unconfigured service and never searches on load or save', async () => {
  await mount();
  expect(q('a[href="#web-search"]')?.textContent).toContain('联网搜索');
  expect(q<HTMLInputElement>('[data-testid="web-search-api-key"]').type).toBe('password');
  expect(q('#web-search').textContent).toContain('查询词发送到 Tavily');
  await toggle();
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(q('#web-search').textContent).toContain('请先填写自己的 Tavily API Key');
  expect(saveWebSearchConfig).not.toHaveBeenCalled();
  await type('tvly-test-only-key');
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(saveWebSearchConfig).toHaveBeenCalledWith({ enabled: true, apiKey: 'tvly-test-only-key' });
  expect(q<HTMLInputElement>('[data-testid="web-search-api-key"]').value).toBe('');
  expect(q('#web-search').textContent).toContain('配置已保存');
  expect(searchWeb).not.toHaveBeenCalled();
  expect(JSON.stringify(localStorage)).not.toContain('tvly-test-only-key');
});

test('search draft participates in the settings close guard and can be discarded', async () => {
  await mount();
  await type('draft-only');
  expect(q('[data-testid="settings-unsaved-web-search"]')).not.toBeNull();
  await act(async () => q<HTMLButtonElement>('[data-testid="settings-close"]').click());
  expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('放弃未保存的更改？');
  await act(async () => button('继续编辑').click());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => q<HTMLButtonElement>('[data-testid="settings-close"]').click());
  await act(async () => button('放弃并关闭').click());
  expect(onClose).toHaveBeenCalledOnce();
  expect(saveWebSearchConfig).not.toHaveBeenCalled();
});

test('removing a stored key requires confirmation and disables search', async () => {
  vi.mocked(getWebSearchConfig).mockResolvedValue({ ...config, enabled: true, hasApiKey: true });
  vi.mocked(saveWebSearchConfig).mockResolvedValue(config);
  await mount();
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-remove-key"]').click());
  expect(saveWebSearchConfig).not.toHaveBeenCalled();
  await act(async () => button('取消').click());
  expect(saveWebSearchConfig).not.toHaveBeenCalled();
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-remove-key"]').click());
  await act(async () => button('移除密钥').click());
  expect(saveWebSearchConfig).toHaveBeenCalledWith({ enabled: false, clearApiKey: true });
  expect(q('#web-search').textContent).toContain('密钥已移除');
});

test('saving a toggle retains an existing secret and failed save preserves the draft', async () => {
  vi.mocked(getWebSearchConfig).mockResolvedValue({ ...config, hasApiKey: true });
  await mount();
  await toggle();
  vi.mocked(saveWebSearchConfig).mockRejectedValueOnce('must not expose key');
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(saveWebSearchConfig).toHaveBeenLastCalledWith({ enabled: true });
  expect(q('#web-search').textContent).toContain('草稿仍保留');
  expect(host.textContent).not.toContain('must not expose');
  expect(q('[data-testid="settings-unsaved-web-search"]')).not.toBeNull();
});

test('old hosts report unavailable without crashing settings or inventing a config', async () => {
  vi.mocked(getWebSearchConfig).mockRejectedValue(
    new Error('unknown command with private details'),
  );
  await mount();
  expect(q('#web-search').textContent).toContain('配置暂不可用');
  expect(q('[data-testid="web-search-api-key"]')).toBeNull();
  expect(host.textContent).not.toContain('private details');
  expect(searchWeb).not.toHaveBeenCalled();
  vi.mocked(getWebSearchConfig).mockResolvedValue(config);
  await act(async () => button('重新读取搜索配置').click());
  expect(q('[data-testid="web-search-api-key"]')).not.toBeNull();
});

test('duplicate saves share one action and inputs cannot mutate the submitted draft', async () => {
  let finish!: (value: typeof config) => void;
  vi.mocked(saveWebSearchConfig).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await type('one-key');
  await act(async () => {
    const save = q<HTMLButtonElement>('[data-testid="web-search-save"]');
    save.click();
    save.click();
  });
  expect(saveWebSearchConfig).toHaveBeenCalledOnce();
  expect(q<HTMLInputElement>('[data-testid="web-search-api-key"]').disabled).toBe(true);
  await act(async () => finish(config));
  expect(q<HTMLInputElement>('[data-testid="web-search-api-key"]').value).toBe('');
});

async function selectProvider(provider: string) {
  await act(async () => {
    const select = q<HTMLSelectElement>('[data-testid="web-search-provider"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      select,
      provider,
    );
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
test('OpenAI reuses active model credentials and provider choice participates in close guard', async () => {
  vi.mocked(getWebSearchConfig).mockResolvedValue({
    ...config,
    openaiReady: true,
    openaiModel: 'gpt-active',
  });
  vi.mocked(saveWebSearchConfig).mockResolvedValue({
    ...config,
    provider: 'openai',
    openaiReady: true,
    openaiModel: 'gpt-active',
    enabled: true,
  });
  await mount();
  await type('draft-tavily-secret');
  await selectProvider('openai');
  expect(q('[data-testid="web-search-api-key"]')).toBeNull();
  expect(q('[data-testid="web-search-openai-model"]').textContent).toContain('gpt-active');
  expect(q('[data-testid="settings-unsaved-web-search"]')).not.toBeNull();
  await toggle();
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(saveWebSearchConfig).toHaveBeenCalledWith({ enabled: true, provider: 'openai' });
  expect(JSON.stringify(vi.mocked(saveWebSearchConfig).mock.calls)).not.toContain(
    'draft-tavily-secret',
  );
  expect(searchWeb).not.toHaveBeenCalled();
  expect(q('[data-testid="settings-unsaved-web-search"]')).toBeNull();
});
test('OpenAI cannot be enabled without active compatible model credentials', async () => {
  await mount();
  await selectProvider('openai');
  await toggle();
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(saveWebSearchConfig).not.toHaveBeenCalled();
  expect(q('#web-search').textContent).toContain('选择已配置密钥的 OpenAI 兼容模型');
});
test('switching back to Tavily preserves its stored key and never sends the OpenAI model key', async () => {
  vi.mocked(getWebSearchConfig).mockResolvedValue({
    ...config,
    enabled: true,
    provider: 'openai',
    hasApiKey: true,
    openaiReady: true,
    openaiModel: 'gpt-active',
  });
  vi.mocked(saveWebSearchConfig).mockResolvedValue({ ...config, enabled: true, hasApiKey: true });
  await mount();
  await selectProvider('tavily');
  expect(q<HTMLInputElement>('[data-testid="web-search-api-key"]').value).toBe('');
  await act(async () => q<HTMLButtonElement>('[data-testid="web-search-save"]').click());
  expect(saveWebSearchConfig).toHaveBeenCalledWith({ enabled: true, provider: 'tavily' });
});
