import { scanRegexLines } from '@storyforge/engine/regexScan';

export type RegexScanRequest = {
  readonly id: number;
  readonly source: string;
  readonly lines: readonly string[];
  readonly limit: number;
  readonly remainingSeconds: number;
};

export type RegexScanReply =
  | {
      readonly id: number;
      readonly hits: number[];
      readonly remainingSeconds: number;
      readonly failure: 'timeout' | 'budget' | null;
    }
  | { readonly id: number; readonly error: string };

let cached: { source: string; pattern: RegExp } | null = null;

/** Worker 里的一次扫描；编译只留最近一个（一次检索内各文件用同一条正则）。 */
export function answerRegexScan(request: RegexScanRequest, clock: () => number): RegexScanReply {
  try {
    if (cached?.source !== request.source)
      cached = { source: request.source, pattern: new RegExp(request.source, 'u') };
    const pattern = cached.pattern;
    const scan = scanRegexLines(
      (line) => pattern.test(line),
      request.lines,
      request.limit,
      request.remainingSeconds,
      clock,
    );
    return {
      id: request.id,
      hits: [...scan.hits],
      remainingSeconds: scan.remainingSeconds,
      failure: scan.failure,
    };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}
