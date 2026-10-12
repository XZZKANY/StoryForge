import { ProjectReadError, type ProjectReader } from '../readPort';
import { MAX_READ_BYTES, ProjectTreeError, scanProjectFiles } from './projectTree';

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
  throw new FsToolError(`项目目录不存在：${root}`);
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
      throw new FsToolError(`路径越界，只允许访问项目目录内文件：${subpath}`);
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
        ? '路径越界，只允许访问项目目录内文件。'
        : '无法解析项目文件路径。',
    );
  }
}

/** 文件工具可见的全部项目文件（跳过隐藏与工具目录，但保留作者自定义指令），按路径排序。 */
export async function iterProjectFiles(reader: ProjectReader, root: string): Promise<string[]> {
  try {
    return await scanProjectFiles(reader, root, {
      visible: (relative) => !isSkippedProjectPath(relative),
      explicitFiles: [AUTHOR_INSTRUCTIONS_PATH],
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
