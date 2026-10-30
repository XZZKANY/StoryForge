import { ProjectReadError, type ProjectReader } from '../readPort';
import { MAX_READ_BYTES, ProjectTreeError, scanProjectFiles } from './projectTree';
import { pythonStrip as pythonStripText } from './pythonText';

export const AUTHOR_INSTRUCTIONS_PATH = '.storyforge/agent-instructions.md';
const SKIPPED_DIR_NAMES = new Set(['.git', '.storyforge', '.codex', 'node_modules', '__pycache__']);

/** 文件工具对作者/模型可见的失败：消息原样给到作者或模型。 */
export class FsToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsToolError';
  }
}

/** 普通文件但不是文本，文本检索时可以跳过。 */
export class FsBinaryFileError extends FsToolError {
  constructor(message: string) {
    super(message);
    this.name = 'FsBinaryFileError';
  }
}

export function isSkippedProjectPath(relative: string): boolean {
  if (relative === AUTHOR_INSTRUCTIONS_PATH) return false;
  return relative.split('/').some((part) => SKIPPED_DIR_NAMES.has(part) || part.startsWith('.'));
}

export function positiveLimit(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new FsToolError(`${name} 必须是正整数。`);
  return Math.min(value, maximum);
}

/** 项目根必须是已存在的目录。 */
export async function resolveProjectRoot(reader: ProjectReader, root: string): Promise<void> {
  if (!root.trim()) throw new FsToolError('project_root 不能为空。');
  try {
    await reader.resolveProjectPath(root, '.');
    if ((await reader.inspectProjectPath(root, '.')).targetKind === 'directory') return;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  throw new FsToolError(`作品文件夹不存在：${root}`);
}

/** 项目内路径（可不存在）解析为项目相对路径；越界拒绝。`subpath` 为空表示项目根。 */
export async function resolveScopedPath(
  reader: ProjectReader,
  root: string,
  subpath: string | null | undefined,
): Promise<string> {
  try {
    return (await reader.resolveProjectPath(root, subpath ? subpath : '.')).resolvedRelativePath;
  } catch (error) {
    if (error instanceof ProjectReadError && error.kind === 'outside-project')
      throw new FsToolError(`路径越界，只允许访问作品文件夹内的文件：${subpath}`);
    throw error;
  }
}

/** fs_safety.scoped_target：解析符号链接后的项目相对路径，越界或解析失败都报错。 */
export async function scopedTarget(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<string> {
  try {
    return (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new FsToolError(
      error.kind === 'outside-project'
        ? '路径越界，只允许访问作品文件夹内的文件。'
        : '无法解析作品文件路径。',
    );
  }
}

/** 文件工具可见的全部项目文件（跳过隐藏与工具目录，但保留作者自定义指令），按路径排序。 */
export async function iterProjectFiles(
  reader: ProjectReader,
  root: string,
  scope?: string,
): Promise<string[]> {
  try {
    return await scanProjectFiles(reader, root, {
      visible: (relative) => !isSkippedProjectPath(relative),
      explicitFiles: [AUTHOR_INSTRUCTIONS_PATH],
      ...(scope === undefined ? {} : { scope }),
    });
  } catch (error) {
    if (!(error instanceof ProjectTreeError)) throw error;
    throw new FsToolError(error.message);
  }
}

export type TextRead = { content: string; bytesRead: number; truncated: boolean };

/**
 * fs_safety.read_bounded_text：给了 maxBytes 就截断（不拒绝），没给就超过 2 MiB 拒绝；
 * 前 1 KiB 有 NUL 视为二进制；保留 BOM，非法 UTF-8 按替换字符解码，截断处的半个字符丢弃；
 * 换行统一成 `\n`。
 */
export async function readBoundedText(
  reader: ProjectReader,
  root: string,
  path: string,
  maxBytes?: number,
): Promise<TextRead> {
  const cap =
    maxBytes === undefined ? MAX_READ_BYTES : positiveLimit(maxBytes, 'max_bytes', MAX_READ_BYTES);
  const name = path.split('/').slice(-1)[0];
  let raw: Uint8Array;
  try {
    if ((await reader.inspectProjectPath(root, path)).targetKind !== 'file')
      throw new FsToolError('只允许读取普通文件。');
    const target = await reader.resolveProjectPath(root, path);
    const read = await reader.readProjectBytes(root, target.resolvedRelativePath, cap);
    raw = read.bytes;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new FsToolError(`文件无法读取：${name}`);
  }
  const truncated = raw.length > cap;
  if (truncated && maxBytes === undefined)
    throw new FsToolError(`文件超过完整读取预算（${MAX_READ_BYTES} 字节）：${name}`);
  if (raw.subarray(0, 1024).includes(0))
    throw new FsBinaryFileError(`不是文本文件，无法读取：${name}`);
  const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw.subarray(0, cap), {
    stream: truncated,
  });
  return { content: content.replace(/\r\n?/g, '\n'), bytesRead: raw.length, truncated };
}

/** Python 返回给调用方的绝对路径（`str(Path)`），由调用方给出的项目根拼出。 */
export function nativeProjectPath(
  root: string,
  relative: string,
  platform: 'windows' | 'posix',
): string {
  if (platform === 'posix') return `${root.replace(/\/+$/, '')}/${relative}`;
  return `${root.replace(/\//g, '\\').replace(/\\+$/, '')}\\${relative.replace(/\//g, '\\')}`;
}

const READ_LIMIT_DEFAULT = 20_000;
const READ_LIMIT_MAX = 200_000;

/** 规范化模型 / 作者给的项目相对路径（不解析链接）；绝对、带盘符或含 `..` 的拒绝。 */
export function normalizeProjectRelativePath(path: string): string {
  if (typeof path !== 'string' || !pythonStripText(path)) throw new FsToolError('path 不能为空。');
  const raw = pythonStripText(path).replace(/\\/g, '/');
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (raw.startsWith('/') || !parts.length || parts[0].includes(':') || parts.includes('..'))
    throw new FsToolError(`只接受规范化的作品内相对路径：${path}`);
  return parts.join('/');
}

/** 词法上的项目相对路径（保留 `..`，不解析），用于判断调用方给的路径本身是否隐藏。 */
function lexicalRelative(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

/** 文件工具可见的目标：解析后越界、调用方路径或解析目标是隐藏路径都拒绝。 */
export async function visibleTarget(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<string> {
  const target = await scopedTarget(reader, root, path);
  if (isSkippedProjectPath(lexicalRelative(path)) || isSkippedProjectPath(target))
    throw new FsToolError('隐藏路径不可通过文件工具读取。');
  return target;
}

/** fs.read：读取项目内单个文本文件的内容切片（按码点计）。 */
export async function fsRead(
  reader: ProjectReader,
  root: string,
  path: string,
  options: { offset?: number; limit?: number } = {},
) {
  if (typeof path !== 'string' || !pythonStripText(path)) throw new FsToolError('path 不能为空。');
  await resolveProjectRoot(reader, root);
  const scoped = await resolveScopedPath(reader, root, path);
  if ((await reader.inspectProjectPath(root, scoped)).targetKind !== 'file')
    throw new FsToolError(`文件不存在：${path}`);
  const target = await visibleTarget(reader, root, path);
  const { offset = 0, limit = READ_LIMIT_DEFAULT } = options;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new FsToolError('offset 不能为负数。');
  if (!Number.isSafeInteger(limit)) throw new FsToolError('limit 必须是整数。');
  const bounded = Math.min(Math.max(limit, 1), READ_LIMIT_MAX);
  const content = Array.from((await readBoundedText(reader, root, target)).content);
  const slice = content.slice(offset, offset + bounded);
  return {
    path: target,
    content: slice.join(''),
    offset,
    returned_chars: slice.length,
    total_chars: content.length,
    truncated: offset + slice.length < content.length,
  };
}

/** 项目内已存在文件的解析后相对路径（越界拒绝）。 */
export async function resolveProjectFile(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<string> {
  if (typeof path !== 'string' || !pythonStripText(path)) throw new FsToolError('path 不能为空。');
  await resolveProjectRoot(reader, root);
  const target = await resolveScopedPath(reader, root, path);
  if ((await reader.inspectProjectPath(root, target)).targetKind !== 'file')
    throw new FsToolError(`文件不存在：${path}`);
  return target;
}
