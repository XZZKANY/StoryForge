/** 一个文件内的逐行正则检索结果。 */
export type RegexScan = {
  /** 命中行的下标，按顺序，最多 limit 个。 */
  readonly hits: readonly number[];
  /** 扫完后这次检索还剩的累计预算（秒）；逐行扣减，与 Python 的浮点顺序一致。 */
  readonly remainingSeconds: number;
  /** timeout：某一行超时；budget：开始下一行时累计预算已用尽。 */
  readonly failure: 'timeout' | 'budget' | null;
};

/** Python fs_safety 的单行超时（秒）。 */
export const REGEX_MATCH_SECONDS = 0.05;

/**
 * 逐行扫描的预算语义（Python `SearchMatcher.search`）：每行开始前预算已尽即报 budget，单行耗时
 * 超过 min(50 ms, 剩余预算) 即报 timeout；命中到 limit 个即停。无论在哪个线程跑都用这一份。
 * 本模块不 import 任何东西：桌面端的正则 Worker 只打包这一个文件。
 */
export function scanRegexLines(
  test: (line: string) => boolean,
  lines: readonly string[],
  limit: number,
  remainingSeconds: number,
  clock: () => number,
): RegexScan {
  const hits: number[] = [];
  let remaining = remainingSeconds;
  const result = (failure: RegexScan['failure']): RegexScan => ({
    hits,
    remainingSeconds: remaining,
    failure,
  });
  for (let index = 0; index < lines.length && hits.length < limit; index++) {
    if (remaining <= 0) return result('budget');
    const allowed = Math.min(REGEX_MATCH_SECONDS, remaining);
    const started = clock();
    const hit = test(lines[index]);
    const elapsed = clock() - started;
    remaining -= elapsed;
    if (elapsed > allowed) return result('timeout');
    if (hit) hits.push(index);
  }
  return result(null);
}
