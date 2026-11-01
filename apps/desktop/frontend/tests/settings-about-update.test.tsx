import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsView } from '../src/components/settings/SettingsView';
import { DEFAULT_APP_SETTINGS } from '../src/lib/user-settings';

const host = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: (message: unknown) => void }[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: host.invoke,
  Channel: class {
    onmessage: (message: unknown) => void;
    constructor(onmessage: (message: unknown) => void) {
      this.onmessage = onmessage;
      host.channels.push(this);
    }
  },
}));
vi.mock('../src/lib/host/desktop-llm-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/host/desktop-llm-config')>()),
  listLlmProfiles: vi.fn(async () => null),
}));
vi.mock('../src/lib/api-client', () => ({ probeProviderHealth: vi.fn() }));
vi.mock('../src/lib/host/update-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/host/update-check')>()),
  currentAppVersion: async () => '0.2.3',
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

test('关于区：检查更新 → 下载新版（显示进度与更新说明）→ 重启安装', async () => {
  let finishDownload: (version: string) => void = () => {};
  host.invoke.mockImplementation(async (command: string) => {
    if (command === 'app_update_check')
      return { version: '0.2.4', currentVersion: '0.2.3', notes: '修了两处断流\n加了自动更新' };
    if (command === 'app_update_download')
      return new Promise<string>((resolve) => (finishDownload = resolve));
    if (command === 'app_update_restart_install') return undefined;
    return null;
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SettingsView
        settings={DEFAULT_APP_SETTINGS}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
  });

  const button = () => byTestId('about-update-check')!;
  expect(button().textContent).toBe('检查更新');
  expect(byTestId('about-update-notes')).toBeNull();
  await act(async () => button().click());
  expect(byTestId('about-update-status')!.textContent).toBe('有新版本 v0.2.4（当前 v0.2.3）');
  expect(byTestId('about-update-notes')!.textContent).toBe(
    'v0.2.4 更新说明修了两处断流\n加了自动更新',
  );
  expect(button().textContent).toBe('下载新版');

  await act(async () => button().click());
  await act(async () => host.channels[0].onmessage({ received: 25, total: 100 }));
  expect(byTestId('about-update-status')!.textContent).toBe('正在下载 v0.2.4… 25%');
  expect(button().textContent).toBe('下载中…');
  expect((button() as HTMLButtonElement).disabled).toBe(true);

  await act(async () => finishDownload('0.2.4'));
  expect(byTestId('about-update-status')!.textContent).toBe('v0.2.4 已下载好');
  expect(button().textContent).toBe('重启安装');
  await act(async () => button().click());
  expect(host.invoke).toHaveBeenLastCalledWith('app_update_restart_install');
});
