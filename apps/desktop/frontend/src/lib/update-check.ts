import { invoke } from '@tauri-apps/api/core';

/**
 * 更新检查：宿主命令 `app_update_check` 读 GitHub Release 上的 latest.json（tauri-plugin-updater，
 * 安装包签名由 tauri.conf.json 里的公钥校验）。0.2.3 及更早的装机版靠比对 v* tag 发现新版，发版仍要打 tag。
 * 用户网络对 GitHub 依赖代理（插件走系统代理），失败必须静默降级（启动自检）或明确报错（手动检查）。
 */

export type UpdateCheckResult =
  | { kind: 'up-to-date'; current: string }
  | { kind: 'update-available'; current: string; latest: string; notes: string | null }
  | { kind: 'error'; message: string };

type AvailableUpdate = { version: string; currentVersion: string; notes: string | null };

const versionLabel = (version: string) => (version.startsWith('v') ? version : `v${version}`);

export async function checkForUpdate(
  currentVersion: string,
  invokeImpl: typeof invoke = invoke,
): Promise<UpdateCheckResult> {
  let update: AvailableUpdate | null;
  try {
    update = await invokeImpl<AvailableUpdate | null>('app_update_check');
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!update) return { kind: 'up-to-date', current: versionLabel(currentVersion) };
  return {
    kind: 'update-available',
    current: versionLabel(update.currentVersion),
    latest: versionLabel(update.version),
    notes: update.notes,
  };
}

/** 运行中应用版本：Tauri 运行时读 tauri.conf 版本；非桌面运行时返回 null。 */
export async function currentAppVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}
