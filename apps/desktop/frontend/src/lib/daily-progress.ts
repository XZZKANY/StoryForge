/**
 * 日更账本：按项目按天累计「今天写了多少字」。
 *
 * 口径是**已落盘的净增量**——每次成功写回后累加 (写入后字数 − 写入前字数)，
 * 而不是扫描全书求差。这样不必反复读盘，跨重启也不会把昨天的存量算成今天的产出；
 * 代价是未保存的草稿不计入，故 UI 文案必须写「今日已存」而不是「今日已写」。
 * 删稿产生负增量，如实相减，不夹到 0——夹了就会把「今天净删了 2000 字」显示成 0。
 */
import { countProseChars } from './text-metrics';

export type DailyProgress = {
  /** 本地日期 YYYY-MM-DD；跨天自动归零。 */
  date: string;
  chars: number;
};

const STORAGE_PREFIX = 'storyforge:daily-progress:';

/** 本地时区日历日（不能用 toISOString，那是 UTC，会让午夜前后的写作算到隔壁天）。 */
export function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 纯累加：日期不同即丢弃旧账本重开一天。 */
export function accumulateDailyProgress(
  previous: DailyProgress | null,
  today: string,
  delta: number,
): DailyProgress {
  const base = previous && previous.date === today ? previous.chars : 0;
  return { date: today, chars: base + delta };
}

/** 一次写回的净增量；两侧都走网文口径，与状态栏字数同源。 */
export function writebackDelta(before: string, after: string): number {
  return countProseChars(after) - countProseChars(before);
}

function storageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${projectPath}`;
}

function parseDailyProgress(raw: string | null): DailyProgress | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<DailyProgress>;
    if (typeof candidate.date !== 'string') return null;
    if (typeof candidate.chars !== 'number' || !Number.isFinite(candidate.chars)) return null;
    return { date: candidate.date, chars: candidate.chars };
  } catch {
    return null;
  }
}

/** 读今天的账；不是今天（或没有账）则返回 0 字的今日账，调用方不必再判跨天。 */
export function readDailyProgress(projectPath: string | null, now = new Date()): DailyProgress {
  const today = localDateKey(now);
  if (!projectPath || typeof localStorage === 'undefined') return { date: today, chars: 0 };
  const stored = parseDailyProgress(localStorage.getItem(storageKey(projectPath)));
  return stored && stored.date === today ? stored : { date: today, chars: 0 };
}

/** 记一次写回增量并返回累计后的今日账。 */
export function recordDailyProgress(
  projectPath: string | null,
  delta: number,
  now = new Date(),
): DailyProgress {
  const today = localDateKey(now);
  if (!projectPath || typeof localStorage === 'undefined') return { date: today, chars: delta };
  const stored = parseDailyProgress(localStorage.getItem(storageKey(projectPath)));
  const next = accumulateDailyProgress(stored, today, delta);
  localStorage.setItem(storageKey(projectPath), JSON.stringify(next));
  return next;
}
