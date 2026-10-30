import { Channel, invoke } from '@tauri-apps/api/core';
import { useEffect, useSyncExternalStore } from 'react';
import { emitToast } from './toast';
import { checkForUpdate, currentAppVersion } from './update-check';

/**
 * 自动更新的进度，启动时的右下角提示与设置页「关于」共用一份：检查 → 下载（宿主 `app_update_download`，
 * 下载完用公钥核对签名）→ 作者点「重启安装」（宿主照点 × 关窗：先问未保存、走完退出握手，最后一步才装）。
 */

export type UpdateInfo = { current: string; latest: string; notes: string | null };

export type AppUpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date'; current: string }
  | { phase: 'check-failed'; message: string }
  | { phase: 'available'; update: UpdateInfo; downloadError?: string }
  | { phase: 'downloading'; update: UpdateInfo; received: number; total: number | null }
  | { phase: 'ready'; update: UpdateInfo; installError?: string };

type DownloadProgress = { received: number; total: number | null };

let state: AppUpdateState = { phase: 'idle' };
const listeners = new Set<() => void>();

function setState(next: AppUpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const getAppUpdate = () => state;

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(subscribeAppUpdate, getAppUpdate, getAppUpdate);
}

/** 下载中、已下载好时不重新检查：别把进度和「重启安装」冲掉。 */
export async function checkAppUpdate(currentVersion: string | null): Promise<AppUpdateState> {
  if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready')
    return state;
  if (!currentVersion) {
    setState({ phase: 'check-failed', message: '非桌面运行时无版本信息' });
    return state;
  }
  setState({ phase: 'checking' });
  const result = await checkForUpdate(currentVersion);
  setState(
    result.kind === 'update-available'
      ? {
          phase: 'available',
          update: { current: result.current, latest: result.latest, notes: result.notes },
        }
      : result.kind === 'up-to-date'
        ? { phase: 'up-to-date', current: result.current }
        : { phase: 'check-failed', message: result.message },
  );
  return state;
}

/** 下载好就在右下角给「重启安装」；失败时抛出（提示条的按钮就地显示原因），状态退回可以重下。 */
export async function downloadAppUpdate(): Promise<void> {
  if (state.phase !== 'available') return;
  const { update } = state;
  setState({ phase: 'downloading', update, received: 0, total: null });
  const onProgress = new Channel<DownloadProgress>((progress) => {
    if (state.phase === 'downloading') setState({ ...state, ...progress });
  });
  try {
    await invoke<string>('app_update_download', { onProgress });
  } catch (error) {
    setState({ phase: 'available', update, downloadError: messageOf(error) });
    throw error instanceof Error ? error : new Error(String(error));
  }
  setState({ phase: 'ready', update });
  emitToast(`新版本 ${update.latest} 已下载好`, {
    durationMs: 30000,
    action: { label: '重启安装', run: restartToInstall },
  });
}

export async function restartToInstall(): Promise<void> {
  if (state.phase !== 'ready') return;
  const { update } = state;
  try {
    await invoke('app_update_restart_install');
  } catch (error) {
    setState({ phase: 'ready', update, installError: messageOf(error) });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** 打开 8 秒后静默检查一次：有新版在右下角提示并给「下载」，失败不打扰。只在打包版里查。 */
export function useStartupUpdateCheck() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const version = await currentAppVersion();
        if (!version) return;
        const result = await checkAppUpdate(version);
        if (result.phase !== 'available') return;
        const { latest, current } = result.update;
        emitToast(`有新版本 ${latest}（当前 ${current}）`, {
          durationMs: 15000,
          action: { label: '下载', run: downloadAppUpdate },
        });
      })();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);
}
