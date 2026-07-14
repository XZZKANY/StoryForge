import type { MonthQuota, PublishAccount, PublishBook, PublishSettings } from './types';

/** 冷号：coldUntil 存在且 >= asOfDate */
export function isAccountCold(
  account: Pick<PublishAccount, 'coldUntil'>,
  asOfDate: string,
): boolean {
  if (!account.coldUntil) return false;
  return account.coldUntil >= asOfDate;
}

/** 有效月开上限：冷号用 coldMaxOpensPerMonth */
export function effectiveMonthlyOpenLimit(account: PublishAccount, asOfDate: string): number {
  if (isAccountCold(account, asOfDate)) {
    return Math.min(account.monthlyOpenLimit, account.coldMaxOpensPerMonth);
  }
  return account.monthlyOpenLimit;
}

export function effectiveOpened(quota: MonthQuota, accountId: string): number {
  if (Object.prototype.hasOwnProperty.call(quota.calibratedOpenedByAccount, accountId)) {
    return Math.max(0, quota.calibratedOpenedByAccount[accountId] ?? 0);
  }
  return Math.max(0, quota.openedByAccount[accountId] ?? 0);
}

export function reservedForAccount(quota: MonthQuota, accountId: string): number {
  return quota.reservations.filter((r) => r.accountId === accountId).length;
}

export function remainingForAccount(
  account: PublishAccount,
  quota: MonthQuota,
  asOfDate?: string,
): number {
  const opened = effectiveOpened(quota, account.id);
  const reserved = reservedForAccount(quota, account.id);
  const day = asOfDate ?? new Date().toISOString().slice(0, 10);
  const limit = effectiveMonthlyOpenLimit(account, day);
  return limit - opened - reserved;
}

export function theoryCapacity(accounts: PublishAccount[], asOfDate?: string): number {
  const day = asOfDate ?? new Date().toISOString().slice(0, 10);
  return accounts
    .filter((a) => a.active && a.riskStatus !== 'blocked')
    .reduce((sum, a) => sum + effectiveMonthlyOpenLimit(a, day), 0);
}

export function spareCapacity(
  accounts: PublishAccount[],
  settings: Pick<PublishSettings, 'monthlyOpenTarget'>,
): number {
  return theoryCapacity(accounts) - settings.monthlyOpenTarget;
}

export function targetGap(
  settings: Pick<PublishSettings, 'monthlyOpenTarget'>,
  quota: MonthQuota,
  accounts: PublishAccount[],
): number {
  const opened = accounts.reduce((sum, a) => sum + effectiveOpened(quota, a.id), 0);
  const reserved = quota.reservations.length;
  return Math.max(0, settings.monthlyOpenTarget - opened - reserved);
}

export function poolGap(
  settings: Pick<PublishSettings, 'monthlyOpenTarget'>,
  accounts: PublishAccount[],
): number {
  return Math.max(0, settings.monthlyOpenTarget - theoryCapacity(accounts));
}

/** 确认已开：预留转 opened，止损不调用本函数退额度。 */
export function markOpenedInQuota(
  quota: MonthQuota,
  projectKey: string,
  accountId: string,
): MonthQuota {
  const reservations = quota.reservations.filter((r) => r.projectKey !== projectKey);
  const openedByAccount = { ...quota.openedByAccount };
  openedByAccount[accountId] = (openedByAccount[accountId] ?? 0) + 1;
  const calibratedOpenedByAccount = { ...quota.calibratedOpenedByAccount };
  if (Object.prototype.hasOwnProperty.call(calibratedOpenedByAccount, accountId)) {
    calibratedOpenedByAccount[accountId] = (calibratedOpenedByAccount[accountId] ?? 0) + 1;
  }
  return {
    ...quota,
    reservations,
    openedByAccount,
    calibratedOpenedByAccount,
  };
}

/** 止损：移除预留（若仍预留）；已计入 opened 不回退。 */
export function dropBookFromQuota(quota: MonthQuota, projectKey: string): MonthQuota {
  return {
    ...quota,
    reservations: quota.reservations.filter((r) => r.projectKey !== projectKey),
  };
}

export function upsertReservation(
  quota: MonthQuota,
  projectKey: string,
  accountId: string,
  planOpenDate: string | null,
): MonthQuota {
  const without = quota.reservations.filter((r) => r.projectKey !== projectKey);
  return {
    ...quota,
    reservations: [...without, { projectKey, accountId, planOpenDate }],
  };
}

export function calibrateOpened(
  quota: MonthQuota,
  accountId: string,
  openedCount: number,
): MonthQuota {
  return {
    ...quota,
    calibratedOpenedByAccount: {
      ...quota.calibratedOpenedByAccount,
      [accountId]: Math.max(0, Math.floor(openedCount)),
    },
  };
}

export function emptyMonthQuota(yearMonth: string): MonthQuota {
  return {
    yearMonth,
    openedByAccount: {},
    calibratedOpenedByAccount: {},
    reservations: [],
  };
}

/** 从 library 书状态重建当月预留（scheduled 且未 opened）。 */
export function reservationsFromBooks(books: PublishBook[]): MonthQuota['reservations'] {
  return books
    .filter(
      (b) =>
        (b.status === 'scheduled' || b.status === 'ready') && b.assignedAccountId && !b.openedAt,
    )
    .filter((b) => b.status === 'scheduled')
    .map((b) => ({
      projectKey: b.projectKey,
      accountId: b.assignedAccountId as string,
      planOpenDate: b.planOpenDate,
    }));
}
