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

/** 细纲文件对应的章号：路径里有「细纲」（文件名或所在文件夹），文件名里有「第N章」；别的文件为 null。 */
export function chapterOutlineOrdinal(path: string): number | null {
  const segments = path.split('/');
  if (!segments.some((segment) => segment.includes('细纲'))) return null;
  const match = ORDINAL.exec(segments[segments.length - 1]);
  const value = match === null ? null : parseOrdinal(match[1]);
  return value === null || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
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

/** 这一章的细纲全文（同一章有几份时取路径序第一份能读出内容的）；没有或读不到为 null。 */
export async function findChapterOutline(
  reader: ProjectReader,
  root: string,
  ordinal: number | null,
  options: { secrets: SecretContext },
): Promise<ChapterOutline | null> {
  if (ordinal === null) return null;
  let candidates: Awaited<ReturnType<typeof projectKnowledgeCandidates>>;
  try {
    candidates = await projectKnowledgeCandidates(reader, root);
  } catch (error) {
    if (optional(error)) return null;
    throw error;
  }
  const paths = candidates
    .filter(
      (item) => isChapterOutlineCandidate(item) && chapterOutlineOrdinal(item.path) === ordinal,
    )
    .map((item) => item.path)
    .sort(compareChapterPaths);
  for (const path of paths) {
    let content: string;
    try {
      content = (await readProjectContextFile(reader, root, path)).content;
    } catch (error) {
      if (optional(error)) continue;
      throw error;
    }
    const text = pythonStrip(redactSensitiveText(normalizeNewlines(content), options.secrets));
    if (!text) continue;
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
