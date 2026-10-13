import type { ProjectReader } from '../readPort';
import {
  FsBinaryFileError,
  FsToolError,
  iterProjectFiles,
  nativeProjectPath,
  positiveLimit,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
  visibleTarget,
} from './fsTools';
import { matchPythonPath } from './pathMatch';
import { MAX_READ_BYTES } from './projectTree';
import { pythonSplitlines, pythonStrip } from './pythonText';

const LIST_MAX_ENTRIES_DEFAULT = 500;
const SEARCH_MAX_MATCHES_DEFAULT = 50;
const SEARCH_MAX_FILE_BYTES = 512_000;
const SEARCH_MAX_FILES = 2_000;
const MAX_SEARCH_BYTES = 16 * 1024 * 1024;
const EXCERPT_MAX_CHARS = 200;
const READ_LIMIT_MAX = 200_000;
const BLANK_PLACEHOLDER_MAX_BYTES = 4_096;
const MAX_QUERY_CHARS = 2_048;
const REGEX_TOTAL_SECONDS = 2.0;

const points = (text: string) => Array.from(text);

/** fs.list：列出项目内文件（递归、相对路径、按路径排序）。 */
export async function fsList(
  reader: ProjectReader,
  root: string,
  subpath: string | null,
  maxEntries = LIST_MAX_ENTRIES_DEFAULT,
) {
  await resolveProjectRoot(reader, root);
  const limit = positiveLimit(maxEntries, 'max_entries', LIST_MAX_ENTRIES_DEFAULT);
  const scope = await resolveScopedPath(reader, root, subpath);
  if ((await reader.inspectProjectPath(root, scope)).targetKind !== 'directory')
    throw new FsToolError(`不是目录：${subpath}`);
  const entries: { path: string; size_bytes: number }[] = [];
  let truncated = false;
  for (const path of await iterProjectFiles(reader, root, scope)) {
    if (entries.length >= limit) {
      truncated = true;
      break;
    }
    const target = await visibleTarget(reader, root, path);
    entries.push({ path, size_bytes: (await reader.inspectProjectPath(root, target)).sizeBytes });
  }
  return { entries, truncated };
}

/** 一次检索里的单行匹配；正则方言由编译器决定。 */
export type SearchPattern = { test(line: string): boolean };
/** 编译失败抛错，消息会接在「正则表达式无效：」后面给模型。 */
export type RegexCompiler = (query: string) => SearchPattern;

/**
 * 进程内的默认正则：JS RegExp（u 标志）。Python 用 regex 模块 VERSION0 且每行有 50 ms 超时；
 * JS 在进程内无法打断单次匹配，只能在行与行之间核累计预算。桌面接线时应换成能打断的实现。
 */
export const jsRegexCompiler: RegexCompiler = (query) => {
  const pattern = new RegExp(query, 'u');
  return { test: (line) => pattern.test(line) };
};

/** 一次检索的匹配器：子串或正则；正则的累计耗时有上限。 */
export class SearchMatcher {
  private readonly pattern: SearchPattern | null;
  private readonly clock: () => number;
  private remainingSeconds = REGEX_TOTAL_SECONDS;

  constructor(
    readonly query: string,
    options: { useRegex: boolean; compile: RegexCompiler; clock: () => number },
  ) {
    if (typeof query !== 'string' || !pythonStrip(query)) throw new FsToolError('query 不能为空。');
    if (points(query).length > MAX_QUERY_CHARS)
      throw new FsToolError(`query 超过 ${MAX_QUERY_CHARS} 字符。`);
    this.clock = options.clock;
    try {
      this.pattern = options.useRegex ? options.compile(query) : null;
    } catch (error) {
      throw new FsToolError(`正则表达式无效：${(error as Error).message}`);
    }
  }

  search(line: string): boolean {
    if (this.pattern === null) return line.includes(this.query);
    if (this.remainingSeconds <= 0)
      throw new FsToolError('正则搜索累计时间预算已耗尽，请简化查询。');
    const started = this.clock();
    try {
      return this.pattern.test(line);
    } finally {
      this.remainingSeconds -= this.clock() - started;
    }
  }
}

/** fs.search：在项目文本文件里跨文件检索，返回路径、行号与摘录。 */
export async function fsSearch(
  reader: ProjectReader,
  root: string,
  query: string,
  options: {
    glob?: string;
    useRegex?: boolean;
    maxMatches?: number;
    platform: 'windows' | 'posix';
    compile?: RegexCompiler;
    /** 单调时钟（秒），只用于正则累计预算。 */
    clock?: () => number;
  },
) {
  const { glob = '*.md', platform } = options;
  const matcher = new SearchMatcher(query, {
    useRegex: options.useRegex === true,
    compile: options.compile ?? jsRegexCompiler,
    clock: options.clock ?? (() => performance.now() / 1000),
  });
  const maxMatches = positiveLimit(
    options.maxMatches ?? SEARCH_MAX_MATCHES_DEFAULT,
    'max_matches',
    SEARCH_MAX_MATCHES_DEFAULT,
  );
  await resolveProjectRoot(reader, root);
  const matches: { path: string; line: number; excerpt: string }[] = [];
  let truncated = false;
  let scannedFiles = 0;
  let remainingBytes = MAX_SEARCH_BYTES;
  for (const path of await iterProjectFiles(reader, root)) {
    if (!matchPythonPath(nativeProjectPath(root, path, platform), glob, platform)) continue;
    if (scannedFiles >= SEARCH_MAX_FILES || remainingBytes <= 1) {
      truncated = true;
      break;
    }
    scannedFiles += 1;
    let read;
    try {
      const target = await visibleTarget(reader, root, path);
      read = await readBoundedText(
        reader,
        root,
        target,
        Math.min(SEARCH_MAX_FILE_BYTES, remainingBytes - 1),
      );
    } catch (error) {
      if (!(error instanceof FsBinaryFileError)) throw error;
      // 非文本文件也要消耗有界读取预算。
      remainingBytes -= Math.min(SEARCH_MAX_FILE_BYTES + 1, remainingBytes);
      continue;
    }
    remainingBytes -= read.bytesRead;
    truncated = truncated || read.truncated;
    const lines = pythonSplitlines(read.content);
    for (let index = 0; index < lines.length; index++) {
      if (!matcher.search(lines[index])) continue;
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      matches.push({
        path,
        line: index + 1,
        excerpt: points(pythonStrip(lines[index])).slice(0, EXCERPT_MAX_CHARS).join(''),
      });
    }
    if (matches.length >= maxMatches && truncated) break;
  }
  return { matches, truncated, scanned_files: scannedFiles };
}

const isAsciiSpace = (byte: number) => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);

/** 空文件或只有空白——作者先建占位再让 agent 写，起草可以直接落进去。 */
async function isBlankPlaceholder(reader: ProjectReader, root: string, path: string) {
  try {
    if ((await reader.inspectProjectPath(root, path)).sizeBytes > BLANK_PLACEHOLDER_MAX_BYTES)
      return false;
    const raw = (await reader.readProjectBytes(root, path, BLANK_PLACEHOLDER_MAX_BYTES)).bytes;
    return raw.length <= BLANK_PLACEHOLDER_MAX_BYTES && raw.every(isAsciiSpace);
  } catch {
    return false;
  }
}

/** 尚不存在（或只是空占位）的项目内相对路径，给新文件起草补丁用；越界拒绝。 */
export async function resolveNewProjectFile(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<string> {
  if (typeof path !== 'string' || !pythonStrip(path)) throw new FsToolError('path 不能为空。');
  await resolveProjectRoot(reader, root);
  const target = await resolveScopedPath(reader, root, path);
  const kind = (await reader.inspectProjectPath(root, target)).targetKind;
  // 项目根本身也解析成目录，同一条规则拒掉。
  if (kind === 'directory') throw new FsToolError(`不是可创建的文件路径：${path}`);
  // 空占位不算「已存在」：否则与修订「正文不能为空」互相推诿，空章节文件谁也写不进去。
  if (kind !== 'missing' && !(await isBlankPlaceholder(reader, root, target)))
    throw new FsToolError(`文件已存在：${path}，请改用 file_revise 修订既有文件。`);
  return target;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * 已存在、可见的 UTF-8 文件：一次原始读取同时给出提案输入与基线字节。
 * 错误文案沿用 Python（修订与审稿路径同样会把它们交给模型）。
 */
export async function readProjectFileRaw(reader: ProjectReader, root: string, path: string) {
  await resolveProjectRoot(reader, root);
  const target = await visibleTarget(reader, root, path);
  if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
    throw new FsToolError('external_writeback_requires_existing_file');
  const raw = (await reader.readProjectBytes(root, target, MAX_READ_BYTES)).bytes;
  if (raw.length > MAX_READ_BYTES || raw.includes(0))
    throw new FsToolError('external_writeback_input_exceeds_budget');
  let text: string;
  try {
    text = STRICT_UTF8.decode(raw);
  } catch {
    throw new FsToolError('external_writeback_requires_utf8');
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  if (points(normalized).length > READ_LIMIT_MAX)
    throw new FsToolError('external_writeback_input_exceeds_budget');
  return { target, content: normalized, raw };
}
