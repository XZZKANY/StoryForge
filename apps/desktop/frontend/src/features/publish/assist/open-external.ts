import { invoke } from '@tauri-apps/api/core';
import { assertTauriRuntime } from '../../../lib/tauri-env';
import { isAllowedFanqieUrl } from '../packs/fanqie/urls';

export type OpenExternalResult =
  | { ok: true; method: 'tauri-shell' | 'window-open' }
  | { ok: false; reason: string };

/**
 * 用户触发：打开系统浏览器。仅允许白名单 https URL。
 * 不登录、不注入、不控制页面。
 */
export async function openExternalUrl(url: string): Promise<OpenExternalResult> {
  const target = url.trim();
  if (!isAllowedFanqieUrl(target)) {
    return { ok: false, reason: 'URL 不在番茄作者站白名单' };
  }

  try {
    assertTauriRuntime('openExternalUrl');
    // tauri-plugin-shell open（capability 已含 shell:allow-open）
    await invoke('plugin:shell|open', { path: target });
    return { ok: true, method: 'tauri-shell' };
  } catch {
    /* 尝试 window.open 降级（dev/browser） */
  }

  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      const w = window.open(target, '_blank', 'noopener,noreferrer');
      if (w) return { ok: true, method: 'window-open' };
    }
  } catch {
    /* fallthrough */
  }

  return {
    ok: false,
    reason: '无法打开外部浏览器（请手动打开番茄作者后台）',
  };
}
