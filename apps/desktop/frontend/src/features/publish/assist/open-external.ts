import { invoke } from '@tauri-apps/api/core';
import { assertTauriRuntime } from '../../../lib/tauri-env';
import { resolvePlatformPack, type PlatformPack } from '../packs';

export type OpenExternalResult =
  | { ok: true; method: 'tauri-shell' | 'window-open' }
  | { ok: false; reason: string };

/**
 * 用户触发：打开系统浏览器。仅允许当前 pack 白名单 https URL。
 * 不登录、不注入、不控制页面。
 */
export async function openExternalUrl(
  url: string,
  pack?: PlatformPack | string | null,
): Promise<OpenExternalResult> {
  const resolved = typeof pack === 'string' || pack == null ? resolvePlatformPack(pack) : pack;
  const target = url.trim();
  if (!resolved.isAllowedOpenUrl(target)) {
    return { ok: false, reason: `URL 不在 ${resolved.label} 作者站白名单` };
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

/** 跳转作者后台（已登录会话可直接进） */
export async function openAuthorHome(
  pack?: PlatformPack | string | null,
): Promise<OpenExternalResult> {
  const resolved = typeof pack === 'string' || pack == null ? resolvePlatformPack(pack) : pack;
  if (!resolved.authorHomeUrl) {
    return { ok: false, reason: `${resolved.label} 未配置作者首页` };
  }
  return openExternalUrl(resolved.authorHomeUrl, resolved);
}

/**
 * 跳转登录/作者入口：仅系统浏览器打开，用户在站内登录。
 * 不是 OAuth 客户端集成，不接收回调 token。
 */
export async function openPlatformLogin(
  pack?: PlatformPack | string | null,
): Promise<OpenExternalResult> {
  const resolved = typeof pack === 'string' || pack == null ? resolvePlatformPack(pack) : pack;
  const url = resolved.loginUrl || resolved.authorHomeUrl;
  if (!url) {
    return { ok: false, reason: `${resolved.label} 未配置登录/作者页 URL` };
  }
  return openExternalUrl(url, resolved);
}
