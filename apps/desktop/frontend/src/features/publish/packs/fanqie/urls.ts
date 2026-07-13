/** 番茄作者后台入口（公开站点路径；需用户本机已登录） */
export const FANQIE_AUTHOR_HOME_URL = 'https://fanqienovel.com/main/writer';

/** 允许通过 shell.open 打开的 URL 前缀（白名单） */
export const FANQIE_OPEN_URL_ALLOWLIST = [
  'https://fanqienovel.com/',
  'https://www.fanqienovel.com/',
  'https://author.toutiao.com/',
] as const;

export function isAllowedFanqieUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  return FANQIE_OPEN_URL_ALLOWLIST.some((prefix) => trimmed.startsWith(prefix));
}
