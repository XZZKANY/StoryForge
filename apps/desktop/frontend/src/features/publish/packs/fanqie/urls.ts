/** 番茄作者后台入口（公开站点路径；需用户本机已登录） */
export const FANQIE_AUTHOR_HOME_URL = 'https://fanqienovel.com/main/writer';

/**
 * 登录页：只做系统浏览器跳转，由用户在站内完成登录。
 * 不做 OAuth 回调、不收 token、不存密码。
 */
export const FANQIE_LOGIN_URL = 'https://fanqienovel.com/main/writer/login';

/** 允许通过 shell.open 打开的 URL 前缀（白名单） */
export const FANQIE_OPEN_URL_ALLOWLIST = [
  'https://fanqienovel.com/',
  'https://www.fanqienovel.com/',
  'https://author.toutiao.com/',
  'https://www.toutiao.com/',
  'https://sso.toutiao.com/',
  'https://passport.bytedance.com/',
  'https://passport.zijieapi.com/',
] as const;

export function isAllowedFanqieUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  return FANQIE_OPEN_URL_ALLOWLIST.some((prefix) => trimmed.startsWith(prefix));
}
