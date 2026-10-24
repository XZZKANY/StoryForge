import { compareManuscriptPaths } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader } from '../readPort';
import { FsToolError } from './fsTools';
import { normcase, type GenerationSourceCapture } from './generationSources';
import { NON_MANUSCRIPT_DIRS, isManuscriptPath, orderManuscriptFiles } from './manuscript';
import { MAX_READ_BYTES, ProjectTreeError, scanProjectFiles } from './projectTree';
import { pythonStrip } from './pythonText';

/**
 * 上一章尾巴的取窗上限。比当前文件的上文窗口小：接笔只需要上一章怎么收的场，
 * 给多了会把预算从「当前章上文」那头挤掉，而那头才是近因最强的位置。
 */
export const PREVIOUS_TAIL_MAX_CHARS = 1200;

/**
 * 起草新文件时上一章的取窗上限。起草要接住上一章发生的所有事，不只是怎么收的场
 * （只给结尾 1200 字时，相邻章常对不上前文里的物件、钱数和日期）；一章通常两三千字，
 * 这个上限基本就是全文，超长章才退回取结尾。
 */
export const PREVIOUS_FULL_MAX_CHARS = 8000;

/** 非 dot 目录下的正文 `*.md`，按路径序（= 阅读序）。 */
export async function iterManuscriptFiles(
  reader: ProjectReader,
  root: string,
  platform: 'windows' | 'posix',
): Promise<string[]> {
  const paths = await scanProjectFiles(reader, root, {
    visible: (path) => {
      const parts = path.split('/');
      return (
        !parts.some((part) => part.startsWith('.')) &&
        !NON_MANUSCRIPT_DIRS.has(parts[0].toLowerCase()) &&
        isManuscriptPath(path)
      );
    },
  });
  return orderManuscriptFiles(
    paths.map((relative_path) => ({ relative_path, is_directory: false })),
    platform,
  );
}

const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
const stripNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');

/** 取尾部 maxChars，并从段落边界起头——上文以半句开头会误导模型的语感判断。 */
function tailOf(text: string, maxChars: number): string {
  const points = Array.from(stripNewlines(normalizeNewlines(text)));
  if (points.length <= maxChars) return pythonStrip(points.join(''));
  let window = points.slice(-maxChars);
  const boundary = window.findIndex((char, i) => char === '\n' && window[i + 1] === '\n');
  if (boundary !== -1 && boundary < Math.floor(maxChars / 2)) window = window.slice(boundary + 2);
  return pythonStrip(window.join(''));
}

function codePointLastIndexOf(text: string, search: string): number {
  const hay = Array.from(text);
  const needle = Array.from(search);
  for (let i = hay.length - needle.length; i >= 0; i--) {
    if (needle.every((char, j) => hay[i + j] === char)) return i;
  }
  return -1;
}

export type PreviousChapterPassage = {
  readonly path: string;
  readonly text: string;
  /** 上一章比取窗长、只给了结尾。 */
  readonly truncated: boolean;
};

type PassageOptions = {
  platform: 'windows' | 'posix';
  capture?: GenerationSourceCapture;
  maxChars?: number;
};

/**
 * 阅读序上一章的结尾正文，返回 `[相对路径, 尾巴]`；无上一章或读不到则 null。
 * 拿不到上一章是「少一块加分上下文」，绝不能挡住作者继续写：读盘与越界失败一律返回 null。
 */
export async function previousChapterTail(
  reader: ProjectReader,
  projectRoot: string | null,
  currentFile: string | null,
  options: PassageOptions,
): Promise<readonly [string, string] | null> {
  const passage = await previousChapterPassage(reader, projectRoot, currentFile, options);
  return passage === null ? null : [passage.path, passage.text];
}

/** 同 {@link previousChapterTail}，另外说明是否截掉了开头。 */
export async function previousChapterPassage(
  reader: ProjectReader,
  projectRoot: string | null,
  currentFile: string | null,
  options: PassageOptions,
): Promise<PreviousChapterPassage | null> {
  const { platform, capture } = options;
  const maxChars = options.maxChars ?? PREVIOUS_TAIL_MAX_CHARS;
  if (!currentFile || !projectRoot) return null;
  try {
    const rel = (await reader.resolveProjectPath(projectRoot, currentFile.replace(/\\/g, '/')))
      .resolvedRelativePath;
    if (!isManuscriptPath(rel)) return null;
    // 未创建的章节也参与同一阅读序，不能要求先建占位文件才拿得到上一章。
    const keys = await iterManuscriptFiles(reader, projectRoot, platform);
    let index = keys.findIndex((key) => normcase(key, platform) === normcase(rel, platform));
    if (index === -1) {
      index = keys.findIndex((key) => compareManuscriptPaths(key, rel) >= 0);
      if (index === -1) index = keys.length;
    }
    await capture?.selectWithHashes(
      'previous_chapter',
      { current_file: rel, selected_file: index ? keys[index - 1] : null },
      { orderedPaths: keys },
    );
    if (index === 0) {
      capture?.project('previous_chapter', null, {
        channel: 'user',
        omissionReason: 'no_previous_chapter',
      });
      return null;
    }
    const previous = keys[index - 1];
    // 不追踪项目外的链接来源（越界时 resolveProjectPath 抛 outside-project）。
    const resolved = (await reader.resolveProjectPath(projectRoot, previous)).resolvedRelativePath;
    const read = await reader.readProjectBytes(projectRoot, resolved, MAX_READ_BYTES);
    const raw = read.bytes;
    if (read.exceeded || raw.subarray(0, 1024).includes(0)) {
      const reason = read.exceeded ? 'source_byte_budget' : 'binary_source';
      await capture?.observe('previous_chapter', resolved, {
        raw,
        complete: false,
        omissionReason: reason,
      });
      capture?.project('previous_chapter', null, { channel: 'user', omissionReason: reason });
      return null; // 部分前缀代表不了这一章真正的结尾。
    }
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw);
    const normalized = stripNewlines(normalizeNewlines(decoded));
    await capture?.observe('previous_chapter', resolved, { raw, text: normalized, complete: true });
    const tail = tailOf(decoded, maxChars);
    if (!tail) {
      capture?.project('previous_chapter', null, {
        channel: 'user',
        omissionReason: 'empty_source',
      });
      return null;
    }
    const start = codePointLastIndexOf(normalized, tail);
    const truncated = Array.from(normalized).length > maxChars;
    capture?.project('previous_chapter', tail, {
      channel: 'user',
      truncated,
      sourceSpan: {
        start,
        end: start + Array.from(tail).length,
        basis: 'normalized_text',
        unit: 'chars',
      },
      transformation: 'previous_paragraph_tail_v1',
    });
    return { path: previous, text: tail, truncated };
  } catch (error) {
    if (
      error instanceof ProjectReadError ||
      error instanceof ProjectTreeError ||
      error instanceof FsToolError
    )
      return null;
    throw error;
  }
}
