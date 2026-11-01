/**
 * Tauri 宿主运行环境：是不是在宿主里、宿主事件通道、系统目录。
 */

import { isTauri as coreIsTauri } from '@tauri-apps/api/core';

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

export function isTauriRuntime(): boolean {
  const globalScope = globalThis as unknown as TauriWindow;
  return (
    typeof window !== 'undefined' &&
    (coreIsTauri() ||
      globalScope.isTauri === true ||
      typeof (window as TauriWindow).__TAURI__ !== 'undefined' ||
      typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined')
  );
}

export function assertTauriRuntime(apiName: string): void {
  if (!isTauriRuntime()) {
    throw new Error(`${apiName} is only available inside the Tauri desktop runtime.`);
  }
}

export type HostEventListen = typeof import('@tauri-apps/api/event').listen;

/** 按需加载宿主事件通道；加载失败照常抛出，调用方据此区分「加载失败」与「注册失败」。 */
export async function loadHostEventListen(): Promise<HostEventListen> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen;
}

/** 作者的「文档」目录。 */
export async function documentDirectory(): Promise<string> {
  const { documentDir } = await import('@tauri-apps/api/path');
  return await documentDir();
}
