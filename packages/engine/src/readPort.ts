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
