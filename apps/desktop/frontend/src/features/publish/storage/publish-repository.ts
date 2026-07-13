import {
  emptyMonthQuota,
  type MonthQuota,
  type PublishAccount,
  type PublishBook,
  type PublishSettings,
} from '../model';
import { FANQIE_DEFAULT_SETTINGS } from '../packs/fanqie/defaults';
import { readJsonFile, writeJsonFile } from './json-store';
import {
  getPublishDataDir,
  normalizeProjectKey,
  publishAccountsPath,
  publishLibraryPath,
  publishQuotaPath,
  publishSettingsPath,
} from './paths';
import { pullProjectIntoBook, syncBookToProject } from './project-publish';

export type AccountsFile = { version: 1; accounts: PublishAccount[] };
export type LibraryFile = { version: 1; books: PublishBook[] };

export async function loadPublishSettings(): Promise<PublishSettings> {
  const root = await getPublishDataDir();
  return readJsonFile(publishSettingsPath(root), FANQIE_DEFAULT_SETTINGS);
}

export async function savePublishSettings(settings: PublishSettings): Promise<void> {
  const root = await getPublishDataDir();
  await writeJsonFile(publishSettingsPath(root), settings);
}

export async function loadAccounts(): Promise<PublishAccount[]> {
  const root = await getPublishDataDir();
  const file = await readJsonFile<AccountsFile>(publishAccountsPath(root), {
    version: 1,
    accounts: [],
  });
  return file.accounts ?? [];
}

export async function saveAccounts(accounts: PublishAccount[]): Promise<void> {
  const root = await getPublishDataDir();
  await writeJsonFile(publishAccountsPath(root), { version: 1, accounts });
}

export async function loadLibrary(): Promise<PublishBook[]> {
  const root = await getPublishDataDir();
  const file = await readJsonFile<LibraryFile>(publishLibraryPath(root), {
    version: 1,
    books: [],
  });
  return file.books ?? [];
}

export async function saveLibrary(books: PublishBook[]): Promise<void> {
  const root = await getPublishDataDir();
  await writeJsonFile(publishLibraryPath(root), { version: 1, books });
  // 书侧真相：尽力同步各项目 publish.json（失败不阻断）
  await Promise.all(books.map((book) => syncBookToProject(book)));
}

/** 加载 library 并用项目 publish.json 合并较新字段 */
export async function loadLibraryMerged(): Promise<PublishBook[]> {
  const books = await loadLibrary();
  const merged = await Promise.all(books.map((b) => pullProjectIntoBook(b)));
  return merged;
}

export async function loadMonthQuota(yearMonth: string): Promise<MonthQuota> {
  const root = await getPublishDataDir();
  return readJsonFile(publishQuotaPath(root, yearMonth), emptyMonthQuota(yearMonth));
}

export async function saveMonthQuota(quota: MonthQuota): Promise<void> {
  const root = await getPublishDataDir();
  await writeJsonFile(publishQuotaPath(root, quota.yearMonth), quota);
}

export function currentYearMonth(timeZone = FANQIE_DEFAULT_SETTINGS.quotaResetTimezone): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    /* fallthrough */
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildBookFromProject(input: {
  path: string;
  title: string;
  platform?: string;
}): PublishBook {
  const now = new Date().toISOString();
  return {
    projectKey: normalizeProjectKey(input.path),
    title: input.title,
    path: input.path.replace(/\\/g, '/'),
    platform: input.platform ?? 'fanqie',
    status: 'writing',
    assignedAccountId: null,
    assignmentLocked: false,
    planOpenDate: null,
    readyScore: 0,
    readyConfirmed: false,
    forceReadyReason: null,
    openedAt: null,
    lastLocalEditAt: null,
    dropReason: null,
    updatedAt: now,
  };
}

export async function upsertBookInLibrary(book: PublishBook): Promise<PublishBook[]> {
  const pulled = await pullProjectIntoBook(book);
  const books = await loadLibrary();
  const idx = books.findIndex((b) => b.projectKey === pulled.projectKey);
  const stamped = { ...pulled, updatedAt: new Date().toISOString() };
  const next = [...books];
  if (idx >= 0) next[idx] = stamped;
  else next.push(stamped);
  await saveLibrary(next);
  return next;
}
