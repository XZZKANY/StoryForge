import type { PublishAccount, PublishBook, PublishSettings } from './types';
import { spareCapacity, theoryCapacity } from './quota';

export type DayOpenCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function countOpensOnDate(
  books: Pick<PublishBook, 'planOpenDate' | 'status' | 'openedAt'>[],
  date: string,
  excludeProjectKey?: string,
): number {
  return books.filter((b) => {
    if (excludeProjectKey && 'projectKey' in b && (b as PublishBook).projectKey === excludeProjectKey) {
      return false;
    }
    if (b.planOpenDate !== date) return false;
    if (b.status === 'dropped') return false;
    return true;
  }).length;
}

export function canScheduleOnDate(
  books: PublishBook[],
  date: string,
  settings: Pick<PublishSettings, 'maxOpensPerDayGlobal' | 'maxOpensPerAccountPerDay'>,
  accountId: string | null,
  excludeProjectKey?: string,
): DayOpenCheck {
  const globalCount = books.filter((b) => {
    if (excludeProjectKey && b.projectKey === excludeProjectKey) return false;
    if (b.planOpenDate !== date || b.status === 'dropped') return false;
    return true;
  }).length;

  if (globalCount >= settings.maxOpensPerDayGlobal) {
    return {
      ok: false,
      reason: `同日全池开书已达上限 ${settings.maxOpensPerDayGlobal}`,
    };
  }

  if (accountId) {
    const accountCount = books.filter((b) => {
      if (excludeProjectKey && b.projectKey === excludeProjectKey) return false;
      if (b.planOpenDate !== date || b.status === 'dropped') return false;
      return b.assignedAccountId === accountId;
    }).length;
    if (accountCount >= settings.maxOpensPerAccountPerDay) {
      return {
        ok: false,
        reason: `同号同日开书已达上限 ${settings.maxOpensPerAccountPerDay}`,
      };
    }
  }

  return { ok: true };
}

export function isAccountAssignable(account: PublishAccount): boolean {
  return account.active && account.riskStatus !== 'blocked';
}

export type CapacitySnapshot = {
  theory: number;
  spare: number;
  fullLoad: boolean;
  spareWarn: boolean;
};

export function capacitySnapshot(
  accounts: PublishAccount[],
  settings: PublishSettings,
): CapacitySnapshot {
  const theory = theoryCapacity(accounts);
  const spare = spareCapacity(accounts, settings);
  return {
    theory,
    spare,
    fullLoad: spare <= 0,
    spareWarn: spare < settings.spareWarnIfBelow,
  };
}

export function weekKey(isoDate: string): string {
  // ISO 日期 YYYY-MM-DD → 年-周（简单：用周四所在周）
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
