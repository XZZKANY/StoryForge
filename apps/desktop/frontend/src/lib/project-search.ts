/**
 * 全文内容搜索的纯逻辑（宪法 B 轴「全局搜索」，且写在 §07 离线底线里：没有网络 / 模型
 * 也必须能搜）。
 *
 * 与命令面板的区别：命令面板搜的是**文件名**，这里搜的是**正文内容**。
 * PR #171 删掉的那个左栏搜索框是个从未接线的占位（确实与命令面板重复），此处不是把它加回来。
 *
 * 一个本领域特有的坑：小说 .md 的一「行」往往是一整个自然段，几百上千字。
 * 直接把命中行整行塞进结果列表会把面板撑爆，所以这里产出的是**命中处附近的窗口片段**，
 * 且 start/end 是相对片段而非相对原行的偏移。
 */

export type SearchHit = {
  /** 1-based 行号，与 Monaco 行号同惯例，可直接用于跳转定位。 */
  line: number;
  /** 命中处附近的窗口片段（两端可能带省略号）。 */
  text: string;
  /** 命中在 text 中的起止偏移，供高亮用。 */
  start: number;
  end: number;
};

export type SearchFileResult = {
  path: string;
  hits: SearchHit[];
  /** 该文件命中数超过上限，只保留前 N 条。 */
  truncated: boolean;
};

export const SEARCH_MIN_QUERY = 2;
export const MAX_HITS_PER_FILE = 40;
export const MAX_TOTAL_HITS = 400;
/** 片段窗口：命中前后各留多少字符。中文一屏大约能读这么多。 */
const SNIPPET_PAD = 32;

function buildSnippet(
  line: string,
  matchStart: number,
  matchEnd: number,
): { text: string; start: number; end: number } {
  const from = Math.max(0, matchStart - SNIPPET_PAD);
  const to = Math.min(line.length, matchEnd + SNIPPET_PAD);
  const head = from > 0 ? '…' : '';
  const tail = to < line.length ? '…' : '';
  const body = line.slice(from, to);
  return {
    text: `${head}${body}${tail}`,
    start: head.length + (matchStart - from),
    end: head.length + (matchEnd - from),
  };
}

/**
 * 在一份文件内容里找出所有命中。空查询 / 过短查询返回空数组（调用方不该发起搜索）。
 * 逐行扫描而不是对全文做 indexOf：行号是结果里最有用的信息，跳转要靠它。
 */
export function findHitsInContent(
  content: string,
  query: string,
  {
    caseSensitive = false,
    maxHits = MAX_HITS_PER_FILE,
  }: { caseSensitive?: boolean; maxHits?: number } = {},
): { hits: SearchHit[]; truncated: boolean } {
  if (query.length < SEARCH_MIN_QUERY) return { hits: [], truncated: false };

  const needle = caseSensitive ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  // 统一按 LF 切行：CRLF 文件的行尾 \r 只影响片段末尾观感，不影响行号。
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].replace(/\r$/, '');
    const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
    let cursor = 0;
    while (cursor <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, cursor);
      if (found === -1) break;
      if (hits.length >= maxHits) return { hits, truncated: true };
      const snippet = buildSnippet(rawLine, found, found + query.length);
      hits.push({ line: index + 1, ...snippet });
      cursor = found + needle.length;
    }
  }

  return { hits, truncated: false };
}

/** 结果总数（跨文件），用于「共 N 处 / M 个文件」与全局上限判定。 */
export function countHits(results: readonly SearchFileResult[]): number {
  return results.reduce((total, result) => total + result.hits.length, 0);
}
