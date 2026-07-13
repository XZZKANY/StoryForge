import type {
  AutoAssignResult,
  MonthQuota,
  PublishAccount,
  PublishBook,
  PublishSettings,
} from './types';
import { remainingForAccount, upsertReservation } from './quota';
import { canScheduleOnDate, isAccountAssignable, weekKey } from './survival';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekday(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export type AutoAssignInput = {
  books: PublishBook[];
  accounts: PublishAccount[];
  quota: MonthQuota;
  settings: PublishSettings;
  /** 窗口起始日 YYYY-MM-DD */
  windowStart: string;
  /** 窗口天数 */
  windowDays: number;
};

/**
 * 确定性智能指派：剩余额度 → 均衡 → 周负载 → 错峰 → 分散。
 * 不修改入参；返回建议列表（调用方确认后再写库）。
 */
export function autoAssignReadyBooks(input: AutoAssignInput): AutoAssignResult {
  const { accounts, settings, windowStart, windowDays } = input;
  let quota = {
    ...input.quota,
    reservations: [...input.quota.reservations],
    openedByAccount: { ...input.quota.openedByAccount },
    calibratedOpenedByAccount: { ...input.quota.calibratedOpenedByAccount },
  };

  const workingBooks = input.books.map((b) => ({ ...b }));
  const candidates = workingBooks
    .filter(
      (b) =>
        (b.status === 'ready' || b.status === 'polish') &&
        !b.assignmentLocked &&
        !b.assignedAccountId,
    )
    .sort((a, b) => a.projectKey.localeCompare(b.projectKey));

  const suggestions: AutoAssignResult['suggestions'] = [];
  const blockers: AutoAssignResult['blockers'] = [];

  const weekLoad = new Map<string, number>();
  for (const b of workingBooks) {
    if (!b.planOpenDate || !b.assignedAccountId || b.status === 'dropped') continue;
    const key = `${b.assignedAccountId}:${weekKey(b.planOpenDate)}`;
    weekLoad.set(key, (weekLoad.get(key) ?? 0) + 1);
  }

  let lastAccountId: string | null = null;

  for (const book of candidates) {
    const assignable = accounts
      .filter(isAccountAssignable)
      .map((account) => ({
        account,
        remaining: remainingForAccount(account, quota),
      }))
      .filter((x) => x.remaining > 0)
      .sort((a, b) => {
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        if (b.account.priority !== a.account.priority) {
          return b.account.priority - a.account.priority;
        }
        return a.account.id.localeCompare(b.account.id);
      });

    if (assignable.length === 0) {
      blockers.push({ projectKey: book.projectKey, reason: '无可用额度账号' });
      continue;
    }

    let placed = false;
    const orderedAccounts = [...assignable];
    if (lastAccountId && orderedAccounts.length > 1) {
      orderedAccounts.sort((a, b) => {
        if (a.account.id === lastAccountId) return 1;
        if (b.account.id === lastAccountId) return -1;
        return 0;
      });
    }

    for (const { account } of orderedAccounts) {
      for (let offset = 0; offset < windowDays; offset += 1) {
        const date = addDays(windowStart, offset);
        if (settings.preferWeekdaysOnly && !isWeekday(date)) continue;

        const wk = `${account.id}:${weekKey(date)}`;
        if ((weekLoad.get(wk) ?? 0) >= settings.maxOpensPerAccountPerWeek) continue;

        const dayCheck = canScheduleOnDate(
          workingBooks,
          date,
          settings,
          account.id,
          book.projectKey,
        );
        if (!dayCheck.ok) continue;

        suggestions.push({
          projectKey: book.projectKey,
          accountId: account.id,
          planOpenDate: date,
        });
        quota = upsertReservation(quota, book.projectKey, account.id, date);
        const idx = workingBooks.findIndex((b) => b.projectKey === book.projectKey);
        if (idx >= 0) {
          workingBooks[idx] = {
            ...workingBooks[idx],
            assignedAccountId: account.id,
            planOpenDate: date,
            status: 'scheduled',
          };
        }
        weekLoad.set(wk, (weekLoad.get(wk) ?? 0) + 1);
        lastAccountId = account.id;
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed) {
      blockers.push({
        projectKey: book.projectKey,
        reason: '窗口内无法满足错峰/周负载/额度',
      });
    }
  }

  return { suggestions, blockers };
}
