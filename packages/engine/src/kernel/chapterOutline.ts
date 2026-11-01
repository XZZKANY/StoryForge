import { compareChapterPaths } from '@storyforge/project-core';
import { normalizeNewlines, ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError } from './fsTools';
import { isObj } from './json';
import { projectKnowledgeCandidates } from './projectKnowledge';
import { readProjectContextFile, suffixOf } from './projectKnowledgeFiles';
import { ProjectTreeError } from './projectTree';
import { codePoints, PYTHON_WHITESPACE, pythonStrip } from './pythonText';
import { redactSensitiveText, type SecretContext } from './redaction';
import { parseOrdinal } from './reviseScope';

/** 本章细纲交给章纲与起草的上限，和单份立项资料一样；更长的只放开头并注明总字数。 */
export const CHAPTER_OUTLINE_MAX_CHARS = 6000;
const TEXT_SUFFIXES = new Set(['.md', '.markdown', '.txt']);
const ORDINAL = new RegExp(
  `第${PYTHON_WHITESPACE}*(\\p{Nd}+|[一二两三四五六七八九十]+)${PYTHON_WHITESPACE}*章`,
  'u',
);

export type ChapterOutline = {
  readonly path: string;
  readonly text: string;
  readonly totalChars: number;
  readonly truncated: boolean;
};

const optional = (error: unknown) =>
  error instanceof ProjectReadError ||
  error instanceof ProjectTreeError ||
  error instanceof FsToolError;

function fileNameOrdinal(name: string): number | null {
  const match = ORDINAL.exec(name);
  const value = match === null ? null : parseOrdinal(match[1]);
  return value === null || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/** 细纲文件对应的章号：路径里有「细纲」（文件名或所在文件夹），文件名里有「第N章」；别的文件为 null。 */
export function chapterOutlineOrdinal(path: string): number | null {
  const segments = path.split('/');
  if (!segments.some((segment) => segment.includes('细纲'))) return null;
  return fileNameOrdinal(segments[segments.length - 1]);
}

/** 正文文件名里的章号（相对或绝对路径都行）；起草、章纲与来源签名按它挑总纲节点，三处要一致。 */
export function chapterFileOrdinal(path: string): number | null {
  return fileNameOrdinal(path.replace(/\\/gu, '/').split('/').pop() ?? path);
}

/**
 * 大纲里某一章自己的细纲。它只交给那一章的章纲与起草，不进立项资料：
 * 各章细纲都塞进立项资料会占满总额度，把人物和设定挤出去，章纲那一步又只看得到开头 1200 字。
 */
export function isChapterOutlineCandidate(item: { source_type: string; path: string }): boolean {
  return (
    item.source_type === 'outline' &&
    TEXT_SUFFIXES.has(suffixOf(item.path)) &&
    chapterOutlineOrdinal(item.path) !== null
  );
}

/** 第 N 章细纲的约定存放处：对话里起草细纲时存这里，写章时就会整份交给章纲与起草。 */
export const suggestedChapterOutlinePath = (ordinal: number) => `大纲/第${ordinal}章细纲.md`;

/** 作品里各章细纲的路径（按章号分组、路径序）；扫不到为 null。 */
async function outlinePathsByOrdinal(
  reader: ProjectReader,
  root: string,
): Promise<Map<number, string[]> | null> {
  let candidates: Awaited<ReturnType<typeof projectKnowledgeCandidates>>;
  try {
    candidates = await projectKnowledgeCandidates(reader, root);
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
  const byOrdinal = new Map<number, string[]>();
  for (const item of candidates) {
    if (!isChapterOutlineCandidate(item)) continue;
    const ordinal = chapterOutlineOrdinal(item.path)!;
    byOrdinal.set(ordinal, [...(byOrdinal.get(ordinal) ?? []), item.path]);
  }
  for (const paths of byOrdinal.values()) paths.sort(compareChapterPaths);
  return byOrdinal;
}

/** 路径序第一份读得出内容的细纲（已去空白、已脱敏）；都读不出为 null。 */
async function firstReadable(
  reader: ProjectReader,
  root: string,
  paths: readonly string[],
  secrets: SecretContext,
): Promise<{ path: string; text: string } | null> {
  for (const path of paths) {
    let content: string;
    try {
      content = (await readProjectContextFile(reader, root, path)).content;
    } catch (error) {
      if (optional(error)) continue;
      throw error;
    }
    const text = pythonStrip(redactSensitiveText(normalizeNewlines(content), secrets));
    if (text) return { path, text };
  }
  return null;
}

/** 这些章里哪几章有细纲（与 findChapterOutline 同一条认法），章号 → 路径；只看有没有，不交出内容。 */
export async function chapterOutlinePaths(
  reader: ProjectReader,
  root: string,
  ordinals: readonly number[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  const byOrdinal = ordinals.length ? await outlinePathsByOrdinal(reader, root) : null;
  if (byOrdinal === null) return found;
  for (const ordinal of ordinals) {
    const readable = await firstReadable(reader, root, byOrdinal.get(ordinal) ?? [], {
      values: [],
    });
    if (readable !== null) found.set(ordinal, readable.path);
  }
  return found;
}

/** 这一章的细纲全文（同一章有几份时取路径序第一份能读出内容的）；没有或读不到为 null。 */
export async function findChapterOutline(
  reader: ProjectReader,
  root: string,
  ordinal: number | null,
  options: { secrets: SecretContext },
): Promise<ChapterOutline | null> {
  if (ordinal === null) return null;
  const byOrdinal = await outlinePathsByOrdinal(reader, root);
  const readable =
    byOrdinal === null
      ? null
      : await firstReadable(reader, root, byOrdinal.get(ordinal) ?? [], options.secrets);
  if (readable !== null) {
    const { path, text } = readable;
    const points = codePoints(text);
    const truncated = points.length > CHAPTER_OUTLINE_MAX_CHARS;
    return {
      path,
      text: truncated ? points.slice(0, CHAPTER_OUTLINE_MAX_CHARS).join('') : text,
      totalChars: points.length,
      truncated,
    };
  }
  return null;
}

/** 工具载荷与断点里存的那份细纲；形状不对按没有处理。 */
export function chapterOutlineFrom(value: unknown): ChapterOutline | null {
  if (!isObj(value)) return null;
  const { path, text, totalChars, truncated } = value;
  if (typeof path !== 'string' || typeof text !== 'string' || !text) return null;
  if (typeof totalChars !== 'number' || typeof truncated !== 'boolean') return null;
  return { path, text, totalChars, truncated };
}

/** 细纲标题行里的出处说明：被截过时注明总字数。 */
export function chapterOutlineSource(outline: ChapterOutline): string {
  return outline.truncated
    ? `${outline.path}，共 ${outline.totalChars} 字，这里只放了开头 ${CHAPTER_OUTLINE_MAX_CHARS} 字`
    : outline.path;
}
