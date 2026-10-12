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
