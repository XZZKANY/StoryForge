import type { ProjectReader } from '../readPort';
import {
  fsRead,
  FsToolError,
  nativeProjectPath,
  normalizeProjectRelativePath,
  positiveLimit,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
} from './fsTools';
import { jsRegexCompiler, SearchMatcher, type RegexCompiler } from './fsProjectTools';
import { compareCodePoints } from './json';
import {
  hasKnowledgeBlockMarker,
  parseKnowledgeMarkdown,
  plainNotesOutsideKnowledgeBlocks,
  type KnowledgeEntry,
} from './knowledgeEntries';
import {
  BLOCKED,
  EXTENSIONS,
  projectKnowledgeCandidates,
  projectKnowledgeSourceType,
  SENSITIVE,
} from './projectKnowledge';
import { MAX_READ_BYTES } from './projectTree';
import { pythonSplitlines, pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';

const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_MATCHES = 50;
export const SEARCH_MAX_FILES = 2_000;
const MAX_SEARCH_BYTES = 16 * 1024 * 1024;
const READ_LIMIT_MAX = 200_000;
const SEMANTIC_SOURCES = [
  'outline',
  'character',
  'setting',
  'timeline',
  'foreshadowing',
  'materials',
];
const MARKDOWN = ['.md', '.markdown'];

/** PurePath.suffix：最后一段里最后一个点之后（含点）；点在开头或结尾时没有后缀。 */
export function suffixOf(path: string): string {
  const name = path.split('/').slice(-1)[0];
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : '';
}
const sensitivePart = (part: string) => SENSITIVE.test(part) || part.toLowerCase() === '.env';

export type EligibleKnowledgeFile = { target: string; normalized: string; sourceType: string };

/** Project Knowledge 来源的统一准入：类型、扩展名、凭据名、链接目标、存在与 512 KiB 上限。 */
export async function validateEligibleFile(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<EligibleKnowledgeFile> {
  const normalized = normalizeProjectRelativePath(path);
  const sourceType = projectKnowledgeSourceType(normalized);
  if (sourceType === null) throw new FsToolError(`不属于允许的 Project Knowledge 来源：${path}`);
  if (!EXTENSIONS.has(suffixOf(normalized)))
    throw new FsToolError(`Project Knowledge 文件类型不受支持：${path}`);
  if (normalized.split('/').some(sensitivePart))
    throw new FsToolError(`Project Knowledge 文件名疑似包含凭据：${path}`);
  const target = await resolveScopedPath(reader, root, normalized);
  if (
    target !== normalized &&
    (projectKnowledgeSourceType(target) === null ||
      target.split('/').some(sensitivePart) ||
      !EXTENSIONS.has(suffixOf(target)))
  )
    throw new FsToolError(`Project Knowledge 链接目标不属于允许来源：${path}`);
  const info = await reader.inspectProjectPath(root, target);
  if (info.targetKind !== 'file') throw new FsToolError(`Project Knowledge 文件不存在：${path}`);
  if (info.sizeBytes > MAX_KNOWLEDGE_FILE_BYTES)
    throw new FsToolError(`Project Knowledge 文件超过 512 KiB：${path}`);
  return { target, normalized, sourceType };
}

/** 未来的作者 Markdown 目标（不要求已存在）：须在作者语义资料目录、是 Markdown、不像凭据。 */
export function validateProjectKnowledgeMarkdownTarget(path: string): [string, string] {
  const normalized = normalizeProjectRelativePath(path);
  const sourceType = projectKnowledgeSourceType(normalized);
  if (sourceType === null || !SEMANTIC_SOURCES.includes(sourceType))
    throw new FsToolError(`知识提议目标必须位于作者语义资料目录：${path}`);
  if (!MARKDOWN.includes(suffixOf(normalized)))
    throw new FsToolError(`结构化 Project Knowledge 目标必须是 Markdown：${path}`);
  if (normalized.split('/').some(sensitivePart))
    throw new FsToolError(`Project Knowledge 文件名疑似包含凭据：${path}`);
  return [normalized, sourceType];
}

async function readWholeText(reader: ProjectReader, root: string, target: string) {
  return (await readBoundedText(reader, root, target)).content;
}

/**
 * 显式选中的普通来源：沿用文件策略。原文只用于版本哈希，交付前由调用方脱敏；
 * 已知 Knowledge 路径保留更严的准入与 512 KiB 上限。
 */
export async function readProjectContextFile(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<{ path: string; content: string }> {
  await resolveProjectRoot(reader, root);
  const normalized = normalizeProjectRelativePath(path);
  const parts = normalized.split('/');
  if (
    parts.some(sensitivePart) ||
    parts.slice(0, -1).some((part) => BLOCKED.has(part.toLowerCase())) ||
    !EXTENSIONS.has(suffixOf(normalized))
  )
    throw new FsToolError('context_source_ineligible');
  if (projectKnowledgeSourceType(normalized) !== null) {
    const { target } = await validateEligibleFile(reader, root, normalized);
    return { path: normalized, content: await readWholeText(reader, root, target) };
  }
  const read = await fsRead(reader, root, normalized, { limit: READ_LIMIT_MAX });
  // 链接的最终名字同样受上下文策略约束，不能借链接夹带配置或凭据。
  if (
    read.path.split('/').some((part) => SENSITIVE.test(part) || BLOCKED.has(part.toLowerCase())) ||
    !EXTENSIONS.has(suffixOf(read.path))
  )
    throw new FsToolError('context_source_ineligible');
  if (read.truncated) throw new FsToolError('context_source_read_budget');
  return read;
}

export async function projectKnowledgeRead(
  reader: ProjectReader,
  root: string,
  path: string,
  options: { secrets: SecretContext; offset?: number; limit?: number },
) {
  await resolveProjectRoot(reader, root);
  const { target, normalized, sourceType } = await validateEligibleFile(reader, root, path);
  const { offset = 0, limit = 20_000 } = options;
  if (offset < 0) throw new FsToolError('offset 不能为负数。');
  const bounded = Math.min(Math.max(limit, 1), READ_LIMIT_MAX);
  const content = await readWholeText(reader, root, target);
  const redactedContent = redactSensitiveText(content, options.secrets);
  const redacted = redactedContent !== content;
  const points = Array.from(redactedContent);
  const slice = points.slice(offset, offset + bounded);
  return {
    path: normalized,
    source_type: sourceType,
    content: slice.join(''),
    offset,
    returned_chars: slice.length,
    total_chars: points.length,
    truncated: offset + slice.length < points.length,
    redacted,
    warnings: redacted ? [`Project Knowledge 已脱敏：${normalized}`] : [],
  };
}

export type IndexedProjectKnowledgeEntry = { relativePath: string; entry: KnowledgeEntry };
export type ProjectKnowledgeEntryIndex = {
  entries: IndexedProjectKnowledgeEntry[];
  warnings: string[];
  /** 含知识块标记的 Markdown（即便全部损坏）：阻止损坏 / 失效知识经原始文件重入 writer。 */
  structuredPaths: string[];
  /** 结构化文件 → 块外作者说明：混合文件的说明不能随整文件排除而消失。 */
  plainNotes: [string, string][];
};

export async function projectKnowledgeEntryIndex(
  reader: ProjectReader,
  root: string,
): Promise<ProjectKnowledgeEntryIndex> {
  await resolveProjectRoot(reader, root);
  const entries: IndexedProjectKnowledgeEntry[] = [];
  const warnings: string[] = [];
  const structured = new Set<string>();
  const notes = new Map<string, string>();
  for (const candidate of await projectKnowledgeCandidates(reader, root, SEARCH_MAX_FILES)) {
    if (!MARKDOWN.includes(suffixOf(candidate.path))) continue;
    let normalized: string;
    let content: string;
    try {
      const eligible = await validateEligibleFile(reader, root, candidate.path);
      normalized = eligible.normalized;
      content = await readWholeText(reader, root, eligible.target);
    } catch (error) {
      if (!(error instanceof FsToolError)) throw error;
      warnings.push(`${candidate.path}: ${error.message}`);
      continue;
    }
    const parsed = parseKnowledgeMarkdown(content);
    if (hasKnowledgeBlockMarker(content)) {
      structured.add(normalized);
      const plain = plainNotesOutsideKnowledgeBlocks(content);
      if (plain) notes.set(normalized, plain);
    }
    for (const entry of parsed.entries) entries.push({ relativePath: normalized, entry });
    for (const warning of parsed.warnings) warnings.push(`${normalized}: ${warning}`);
  }
  return {
    entries,
    warnings,
    structuredPaths: [...structured].sort(compareCodePoints),
    plainNotes: [...notes].sort(([a], [b]) => compareCodePoints(a, b)),
  };
}

/** 供确定性补丁编译读取的未脱敏作者 Markdown（从不交给模型输出）。 */
export async function loadProjectKnowledgeDocument(
  reader: ProjectReader,
  root: string,
  path: string,
  platform: 'windows' | 'posix',
) {
  await resolveProjectRoot(reader, root);
  const { target, normalized, sourceType } = await validateEligibleFile(reader, root, path);
  if (!MARKDOWN.includes(suffixOf(normalized)))
    throw new FsToolError(`结构化 Project Knowledge 目标必须是 Markdown：${path}`);
  return {
    absolutePath: nativeProjectPath(root, target, platform),
    relativePath: normalized,
    sourceType,
    content: await readWholeText(reader, root, target),
  };
}

/** 在 Project Knowledge 来源里检索（脱敏后逐行匹配，子串或正则，与 fs.search 同一个匹配器）。 */
export async function projectKnowledgeSearch(
  reader: ProjectReader,
  root: string,
  query: string,
  options: {
    secrets: SecretContext;
    maxMatches?: number;
    useRegex?: boolean;
    compile?: RegexCompiler;
    clock?: () => number;
  },
) {
  const matcher = new SearchMatcher(query, {
    useRegex: options.useRegex === true,
    compile: options.compile ?? jsRegexCompiler,
    clock: options.clock ?? (() => performance.now() / 1000),
  });
  const maxMatches = positiveLimit(
    options.maxMatches ?? SEARCH_MAX_MATCHES,
    'max_matches',
    SEARCH_MAX_MATCHES,
  );
  await resolveProjectRoot(reader, root);
  const matches: { path: string; source_type: string; line: number; excerpt: string }[] = [];
  let scannedFiles = 0;
  const candidates = await projectKnowledgeCandidates(reader, root, SEARCH_MAX_FILES + 1);
  let truncated = candidates.length > SEARCH_MAX_FILES;
  let redacted = false;
  const warnings = new Set<string>();
  let remainingBytes = MAX_SEARCH_BYTES;
  for (const item of candidates.slice(0, SEARCH_MAX_FILES)) {
    if (remainingBytes <= 1) {
      truncated = true;
      break;
    }
    scannedFiles += 1;
    const { target, normalized } = await validateEligibleFile(reader, root, item.path);
    const read = await readBoundedText(
      reader,
      root,
      target,
      Math.min(MAX_KNOWLEDGE_FILE_BYTES, remainingBytes - 1, MAX_READ_BYTES),
    );
    remainingBytes -= read.bytesRead;
    // 脱敏必须看到整份文档：截断处的凭据可能绕过匹配。
    if (read.truncated) {
      truncated = true;
      warnings.add(`Project Knowledge 读取预算不足，未搜索：${normalized}`);
      break;
    }
    const content = redactSensitiveText(read.content, options.secrets);
    if (content !== read.content) {
      redacted = true;
      warnings.add(`Project Knowledge 已脱敏：${normalized}`);
    }
    for (const [index, line] of pythonSplitlines(content).entries()) {
      if (!matcher.search(line)) continue;
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      matches.push({
        path: item.path,
        source_type: item.source_type,
        line: index + 1,
        excerpt: Array.from(pythonStrip(line)).slice(0, 200).join(''),
      });
    }
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
  }
  return {
    matches,
    scanned_files: scannedFiles,
    truncated,
    redacted,
    warnings: [...warnings].sort(compareCodePoints),
  };
}
