import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

type Progress = { received: number; total: number | null };

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

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.2.3' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toasts: ToastDetail[] = [];
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);

beforeEach(() => {
  vi.resetModules();
  host.invoke.mockReset();
  host.channels.length = 0;
  toasts.length = 0;
  window.addEventListener(TOAST_EVENT, onToast);
});
afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const available = { version: '0.2.4', currentVersion: '0.2.3', notes: '修了两处断流' };

async function loadWithUpdate() {
  const store = await import('../src/lib/app-update');
  host.invoke.mockResolvedValueOnce(available);
  await store.checkAppUpdate('0.2.3');
  return store;
}

test('检查到新版 → 下载（进度经 Channel）→ 已下载好，右下角给「重启安装」', async () => {
  const store = await loadWithUpdate();
  expect(store.getAppUpdate()).toEqual({
    phase: 'available',
    update: { current: 'v0.2.3', latest: 'v0.2.4', notes: '修了两处断流' },
  });
  const seen: string[] = [];
  store.subscribeAppUpdate(() => {
    const state = store.getAppUpdate();
    seen.push(state.phase === 'downloading' ? `${state.received}/${state.total}` : state.phase);
  });
  host.invoke.mockImplementationOnce(async (_command: string, args: { onProgress: unknown }) => {
    expect(args.onProgress).toBe(host.channels[0]);
    host.channels[0].onmessage({ received: 40, total: 100 } satisfies Progress);
    return '0.2.4';
  });
  await store.downloadAppUpdate();
  expect(host.invoke).toHaveBeenLastCalledWith('app_update_download', {
    onProgress: host.channels[0],
  });
  expect(seen).toEqual(['0/null', '40/100', 'ready']);
  // 下载完了晚到的进度不再改状态。
  host.channels[0].onmessage({ received: 100, total: 100 });
  expect(store.getAppUpdate().phase).toBe('ready');

  expect(toasts.map((toast) => [toast.message, toast.action?.label])).toEqual([
    ['新版本 v0.2.4 已下载好', '重启安装'],
  ]);
  host.invoke.mockResolvedValueOnce(undefined);
  await toasts[0].action!.run();
  expect(host.invoke).toHaveBeenLastCalledWith('app_update_restart_install');
});

test('下载失败：按钮上抛出原因，状态退回可以重下', async () => {
  const store = await loadWithUpdate();
  host.invoke.mockRejectedValueOnce('error sending request');
  await expect(store.downloadAppUpdate()).rejects.toThrow('error sending request');
  expect(store.getAppUpdate()).toMatchObject({
    phase: 'available',
    downloadError: 'error sending request',
  });
  expect(toasts).toEqual([]);
  host.invoke.mockResolvedValueOnce('0.2.4');
  await store.downloadAppUpdate();
  expect(store.getAppUpdate()).toMatchObject({ phase: 'ready' });
});

test('重启安装没起来：留在「已下载好」并带上原因，可以再点', async () => {
  const store = await loadWithUpdate();
  host.invoke.mockResolvedValueOnce('0.2.4');
  await store.downloadAppUpdate();
  host.invoke.mockRejectedValueOnce('还没有下载好的新版本');
  await expect(store.restartToInstall()).rejects.toThrow('还没有下载好的新版本');
  expect(store.getAppUpdate()).toMatchObject({
    phase: 'ready',
    installError: '还没有下载好的新版本',
  });
});

test('下载中、已下载好时再检查不冲掉进度；没有版本号就报检查失败', async () => {
  const store = await loadWithUpdate();
  let finish: (value: string) => void = () => {};
  host.invoke.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
  const downloading = store.downloadAppUpdate();
  expect((await store.checkAppUpdate('0.2.3')).phase).toBe('downloading');
  finish('0.2.4');
  await downloading;
  expect((await store.checkAppUpdate('0.2.3')).phase).toBe('ready');
  expect(host.invoke).toHaveBeenCalledTimes(2);

  vi.resetModules();
  const fresh = await import('../src/lib/app-update');
  expect(await fresh.checkAppUpdate(null)).toEqual({
    phase: 'check-failed',
    message: '非桌面运行时无版本信息',
  });
});

test('打包版打开 8 秒后静默检查：有新版在右下角提示并给「下载」', async () => {
  vi.stubEnv('PROD', true);
  vi.useFakeTimers();
  const store = await import('../src/lib/app-update');
  function Probe() {
    store.useStartupUpdateCheck();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  host.invoke.mockResolvedValueOnce(available);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7999);
  });
  expect(host.invoke).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(host.invoke).toHaveBeenCalledWith('app_update_check');
  expect(toasts.map((toast) => [toast.message, toast.action?.label])).toEqual([
    ['有新版本 v0.2.4（当前 v0.2.3）', '下载'],
  ]);
  host.invoke.mockResolvedValueOnce('0.2.4');
  await toasts[0].action!.run();
  expect(host.invoke).toHaveBeenLastCalledWith('app_update_download', {
    onProgress: host.channels[0],
  });
  act(() => root.unmount());
});
