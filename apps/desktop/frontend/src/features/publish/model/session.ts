import type { PublishAccount } from './types';

/** 跳转登录后：标记 pending，记下时间（仍无 token） */
export function markLoginJumped(
  account: PublishAccount,
  atIso: string = new Date().toISOString(),
): PublishAccount {
  return {
    ...account,
    sessionStatus: 'pending',
    lastLoginJumpAt: atIso,
  };
}

/** 用户回 SF 确认：站内已登录成功 */
export function markSessionLoggedIn(
  account: PublishAccount,
  atIso: string = new Date().toISOString(),
  note?: string,
): PublishAccount {
  return {
    ...account,
    sessionStatus: 'logged_in',
    sessionConfirmedAt: atIso,
    sessionNote: note?.trim() || account.sessionNote,
  };
}

export function markSessionLoggedOut(account: PublishAccount): PublishAccount {
  return {
    ...account,
    sessionStatus: 'logged_out',
  };
}

export function markSessionExpired(account: PublishAccount): PublishAccount {
  return {
    ...account,
    sessionStatus: 'expired',
  };
}

/** 确认超过 N 天后提示可能失效（默认 14 天，仅提醒） */
export function isSessionStale(
  account: Pick<PublishAccount, 'sessionStatus' | 'sessionConfirmedAt'>,
  nowMs: number = Date.now(),
  staleAfterDays = 14,
): boolean {
  if (account.sessionStatus !== 'logged_in' || !account.sessionConfirmedAt) return false;
  const t = Date.parse(account.sessionConfirmedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleAfterDays * 24 * 60 * 60 * 1000;
}

/** 记录登录窗捕获的 csrf 令牌 */
export function markCsrfCaptured(
  account: PublishAccount,
  token: string,
  atIso: string = new Date().toISOString(),
): PublishAccount {
  return { ...account, csrfToken: token, csrfCapturedAt: atIso };
}

/** 该号能否走写侧直连（不依赖 webview 当前登着谁）：有 Cookie + csrf 令牌。 */
export function canPublishDirect(
  account: Pick<PublishAccount, 'cookieText' | 'csrfToken'>,
): boolean {
  return Boolean(account.cookieText?.trim()) && Boolean(account.csrfToken?.trim());
}

/** csrf 令牌捕获超过 N 天视为可能过期（默认 3 天，仅提醒，失效以写请求报错为准）。 */
export function isCsrfStale(
  account: Pick<PublishAccount, 'csrfToken' | 'csrfCapturedAt'>,
  nowMs: number = Date.now(),
  staleAfterDays = 3,
): boolean {
  if (!account.csrfToken?.trim() || !account.csrfCapturedAt) return false;
  const t = Date.parse(account.csrfCapturedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleAfterDays * 24 * 60 * 60 * 1000;
}
