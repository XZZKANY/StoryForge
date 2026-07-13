import type { PlatformSessionStatus, PublishAccount } from './types';

export function sessionStatusLabel(status: PlatformSessionStatus): string {
  switch (status) {
    case 'pending':
      return '待确认';
    case 'logged_in':
      return '已登录';
    case 'logged_out':
      return '已退出';
    case 'expired':
      return '可能失效';
    default:
      return '未知';
  }
}

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
