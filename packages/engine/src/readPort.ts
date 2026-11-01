export type ProjectPathKind = 'file' | 'directory' | 'symlink' | 'other' | 'missing';

export interface ResolvedProjectPath {
  relativePath: string;
  resolvedRelativePath: string;
}

export interface ProjectPathMetadata {
  entryKind: ProjectPathKind;
  targetKind: ProjectPathKind;
  isReparsePoint: boolean;
  sizeBytes: number;
}

export interface RawProjectDirectory {
  names: string[];
  exceeded: boolean;
  /** Consume names in order before raising this terminal iterator failure. */
  terminalError: string | null;
}

export interface RawProjectBytes {
  bytes: Uint8Array;
  exceeded: boolean;
}

/**
 * 宿主读口一次读取接受的最大预算：Rust `fs_engine_reader.rs` 的 `MAX_BYTES` 与它相等，超出即拒读。
 * 取各读取方声明的最大预算（拆书读源文件 64 MiB）；内存替身也按它拒读，预算超出在测试里就暴露。
 */
export const MAX_NATIVE_READ_BYTES = 64 * 1024 * 1024;

/** Only expected host read failures are optional sources; programming errors are not. */
export class ProjectReadError extends Error {
  constructor(
    message: string,
    readonly kind: 'io' | 'outside-project' = 'io',
  ) {
    super(message);
    this.name = 'ProjectReadError';
  }
}

export interface ProjectReader {
  resolveProjectPath(root: string, path: string): Promise<ResolvedProjectPath>;
  inspectProjectPath(root: string, path: string): Promise<ProjectPathMetadata>;
  readProjectDirectory(
    root: string,
    path: string,
    remainingEntries: number,
  ): Promise<RawProjectDirectory>;
  readProjectBytes(root: string, path: string, maxBytes: number): Promise<RawProjectBytes>;
}

const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * 引擎唯一的 UTF-8 解码（项目文件、模型响应、docx 里的 XML 都走这里）。忠实：开头的 BOM 保留、
 * 换行不动——修订的改前文本要和界面经宿主读到的磁盘内容逐字比对。`fatal` 时非法字节抛 TypeError，
 * 否则换成 U+FFFD；`truncated` 表示 bytes 是截断的前缀，末尾没读完的半个字符丢掉。
 * 只拿去解析或计数的调用方，解码后自己接 stripBom / normalizeNewlines。
 */
export function decodeUtf8(
  bytes: Uint8Array,
  options: { fatal?: boolean; truncated?: boolean } = {},
): string {
  const { fatal = false, truncated = false } = options;
  // 流式解码把末尾半个字符留在解码器里，不能用共享实例。
  if (truncated)
    return new TextDecoder('utf-8', { fatal, ignoreBOM: true }).decode(bytes, { stream: true });
  return (fatal ? STRICT_UTF8 : UTF8).decode(bytes);
}

/** 去掉开头的一个 BOM。 */
export const stripBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

/** CRLF 与单独的 CR 都换成 LF。 */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * 读项目文件并忠实解码（decodeUtf8，非法字节换成 U+FFFD）。超过 maxBytes 时为 null：
 * 截断的前缀不当整份文件用；宿主读错照常抛 ProjectReadError。
 */
export async function readProjectText(
  reader: ProjectReader,
  root: string,
  path: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; text: string } | null> {
  const read = await reader.readProjectBytes(root, path, maxBytes);
  return read.exceeded ? null : { bytes: read.bytes, text: decodeUtf8(read.bytes) };
}

/** 可选来源的 readProjectText：宿主读错也为 null；给了 cache 就同一路径只读一次。 */
export async function readOptionalProjectText(
  reader: ProjectReader,
  root: string,
  path: string,
  maxBytes: number,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (cache?.has(path)) return cache.get(path)!;
  let text: string | null = null;
  try {
    text = (await readProjectText(reader, root, path, maxBytes))?.text ?? null;
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  cache?.set(path, text);
  return text;
}
