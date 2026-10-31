import type { ProjectReader } from '../readPort';
import {
  FsToolError,
  iterProjectFiles,
  nativeProjectPath,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
} from './fsTools';
import { compareCodePoints } from './json';
import { matchPythonPath } from './pathMatch';
import { cpSlice, PYTHON_WHITESPACE, pythonStrip } from './pythonText';

const MAX_TERMS = 30;
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 512_000;
const MAX_TIME_MARKERS = 80;
const MAX_REPEATED_CLAUSES = 20;
const MAX_TERM_FILE_ENTRIES = 50;
const MIN_CLAUSE_CHARS = 6;
const MIN_CLAUSE_REPEATS = 3;
const CLAUSE_MAX_CHARS = 40;
const EXCERPT_MAX_CHARS = 120;

const TIME_MARKER_PATTERN = new RegExp(
  '(?:第[零一二三四五六七八九十百千0-9]+[天日夜年月更]' +
    '|[一二三四五六七八九十百0-9]+(?:天|日|年|月|个月|时辰)(?:前|后|之前|之后)' +
    '|次日|翌日|当夜|当晚|昨夜|昨日|今晨|今夜|前夜|三更|五更|半夜' +
    '|清晨|黎明|拂晓|破晓|晌午|正午|午后|傍晚|黄昏|入夜|深夜|夜里' +
    '|开春|入夏|入秋|入冬|年关|岁末|开年' +
    '|[春夏秋冬][天日季末初]' +
    ')',
  'gu',
);
// Python 的 \s 是 Unicode 空白（含 U+001C..001F、U+0085，不含 U+FEFF）。
const CLAUSE_SPLIT_PATTERN = new RegExp(
  `[，。！？；：、\\n“”「」『』…—${PYTHON_WHITESPACE.slice(1, -1)}]+`,
  'u',
);

function countOccurrences(line: string, term: string): number {
  let count = 0;
  for (
    let index = line.indexOf(term);
    index !== -1;
    index = line.indexOf(term, index + term.length)
  )
    count += 1;
  return count;
}

function normalizedTerms(
  terms: readonly unknown[] | null | undefined,
  maxTerms: number | null,
): [string[], boolean] {
  if (!terms || !terms.length) return [[], false];
  const seen: string[] = [];
  for (const term of terms) {
    if (typeof term !== 'string') continue;
    const cleaned = pythonStrip(term);
    if (cleaned && !seen.includes(cleaned)) seen.push(cleaned);
  }
  // 内部消费方（canon 在场重建）要覆盖全部实体表面形，不截断。
  if (maxTerms === null) return [seen, false];
  return [seen.slice(0, maxTerms), seen.length > maxTerms];
}

export type TermFileEntry = {
  path: string;
  count: number;
  first_line: number | null;
  last_line: number | null;
};
export type ConsistencyScanResult = {
  scanned_files: number;
  files_truncated: boolean;
  term_occurrences: {
    term: string;
    total_count: number;
    missing: boolean;
    files: TermFileEntry[];
  }[];
  terms_truncated: boolean;
  time_markers: { path: string; line: number; marker: string; excerpt: string }[];
  time_markers_truncated: boolean;
  repeated_clauses: { clause: string; count: number; files: string[] }[];
};

/** 按阅读顺序（路径序）扫描项目文本，返回一致性观察信号；机械统计，不下结论。 */
export async function consistencyScan(
  reader: ProjectReader,
  root: string,
  terms: readonly unknown[] | null | undefined,
  options: {
    platform: 'windows' | 'posix';
    subpath?: string | null;
    glob?: string;
    maxTerms?: number | null;
    includedPaths?: ReadonlySet<string>;
  },
): Promise<ConsistencyScanResult> {
  const { platform, subpath = null, glob = '*.md', includedPaths } = options;
  await resolveProjectRoot(reader, root);
  const scope = await resolveScopedPath(reader, root, subpath);
  if ((await reader.inspectProjectPath(root, scope)).targetKind !== 'directory')
    throw new FsToolError(`不是目录：${subpath}`);
  const [trackedTerms, termsTruncated] = normalizedTerms(
    terms,
    options.maxTerms === undefined ? MAX_TERMS : options.maxTerms,
  );

  const files: [string, string][] = [];
  let filesTruncated = false;
  for (const relative of await iterProjectFiles(reader, root)) {
    if (scope !== '.' && !relative.startsWith(`${scope}/`)) continue;
    if (!matchPythonPath(nativeProjectPath(root, relative, platform), glob, platform)) continue;
    if (includedPaths !== undefined && !includedPaths.has(relative)) continue;
    if (files.length >= MAX_FILES) {
      filesTruncated = true;
      break;
    }
    try {
      files.push([
        relative,
        (await readBoundedText(reader, root, relative, MAX_FILE_BYTES)).content,
      ]);
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
    }
  }

  const termStats = new Map<string, TermFileEntry[]>(trackedTerms.map((term) => [term, []]));
  const timeMarkers: ConsistencyScanResult['time_markers'] = [];
  let timeMarkersTruncated = false;
  const clauseCounts = new Map<string, number>();
  const clauseFiles = new Map<string, string[]>();

  for (const [relative, content] of files) {
    const lines = content.split('\n');
    for (const term of trackedTerms) {
      let count = 0;
      let firstLine: number | null = null;
      let lastLine: number | null = null;
      lines.forEach((line, index) => {
        const hits = countOccurrences(line, term);
        if (!hits) return;
        count += hits;
        if (firstLine === null) firstLine = index + 1;
        lastLine = index + 1;
      });
      if (count)
        termStats
          .get(term)!
          .push({ path: relative, count, first_line: firstLine, last_line: lastLine });
    }

    for (const [index, line] of lines.entries()) {
      if (timeMarkersTruncated) break;
      for (const marker of line.match(TIME_MARKER_PATTERN) ?? []) {
        if (timeMarkers.length >= MAX_TIME_MARKERS) {
          timeMarkersTruncated = true;
          break;
        }
        timeMarkers.push({
          path: relative,
          line: index + 1,
          marker,
          excerpt: cpSlice(pythonStrip(line), EXCERPT_MAX_CHARS),
        });
      }
    }

    for (const clause of content.split(CLAUSE_SPLIT_PATTERN)) {
      const cleaned = pythonStrip(clause);
      if (Array.from(cleaned).length < MIN_CLAUSE_CHARS) continue;
      clauseCounts.set(cleaned, (clauseCounts.get(cleaned) ?? 0) + 1);
      const paths = clauseFiles.get(cleaned) ?? [];
      if (!paths.includes(relative)) paths.push(relative);
      clauseFiles.set(cleaned, paths);
    }
  }

  const repeatedClauses = [...clauseCounts]
    .sort(([a, left], [b, right]) => right - left || compareCodePoints(a, b))
    .filter(([, count]) => count >= MIN_CLAUSE_REPEATS)
    .map(([clause, count]) => ({
      clause: cpSlice(clause, CLAUSE_MAX_CHARS),
      count,
      files: clauseFiles.get(clause)!.slice(0, 5),
    }))
    .slice(0, MAX_REPEATED_CLAUSES);

  return {
    scanned_files: files.length,
    files_truncated: filesTruncated,
    term_occurrences: [...termStats].map(([term, entries]) => ({
      term,
      total_count: entries.reduce((sum, entry) => sum + entry.count, 0),
      missing: !entries.length,
      files: entries.slice(0, MAX_TERM_FILE_ENTRIES),
    })),
    terms_truncated: termsTruncated,
    time_markers: timeMarkers,
    time_markers_truncated: timeMarkersTruncated,
    repeated_clauses: repeatedClauses,
  };
}
