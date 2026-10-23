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

/**
 * 阅读序上一章的结尾正文，返回 `[相对路径, 尾巴]`；无上一章或读不到则 null。
 * 拿不到上一章是「少一块加分上下文」，绝不能挡住作者继续写：读盘与越界失败一律返回 null。
 */
export async function previousChapterTail(
  reader: ProjectReader,
  projectRoot: string | null,
  currentFile: string | null,
  options: {
    platform: 'windows' | 'posix';
    capture?: GenerationSourceCapture;
    maxChars?: number;
  },
): Promise<readonly [string, string] | null> {
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
    capture?.project('previous_chapter', tail, {
      channel: 'user',
      truncated: Array.from(normalized).length > maxChars,
      sourceSpan: {
        start,
        end: start + Array.from(tail).length,
        basis: 'normalized_text',
        unit: 'chars',
      },
      transformation: 'previous_paragraph_tail_v1',
    });
    return [previous, tail];
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
