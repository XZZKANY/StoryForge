import { compareChapterPaths } from '@storyforge/project-core';
import { ProjectReadError, type ProjectReader, type ResolvedProjectPath } from '../readPort';

export const MAX_DIRECTORY_ENTRIES = 20_000;
export const MAX_DIRECTORY_DEPTH = 64;
export const MAX_READ_BYTES = 2 * 1024 * 1024;

export class ProjectTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectTreeError';
  }
}

async function scopedTarget(
  reader: ProjectReader,
  root: string,
  path: string,
): Promise<ResolvedProjectPath> {
  try {
    return await reader.resolveProjectPath(root, path);
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new ProjectTreeError(
      error.kind === 'outside-project'
        ? '路径越界，只允许访问项目目录内文件。'
        : '无法解析项目文件路径。',
    );
  }
}

/** Complete raw traversal, not the UI's filtered/cached file index. */
export async function scanProjectFiles(
  reader: ProjectReader,
  root: string,
  options: {
    visible: (relativePath: string) => boolean;
    scope?: string;
    explicitFiles?: readonly string[];
    maxEntries?: number;
    maxDepth?: number;
  },
): Promise<string[]> {
  const { visible, scope = '.', explicitFiles = [] } = options;
  const maxEntries = options.maxEntries ?? MAX_DIRECTORY_ENTRIES;
  const maxDepth = options.maxDepth ?? MAX_DIRECTORY_DEPTH;
  await scopedTarget(reader, root, scope);
  const files = new Set<string>();
  const pending = scope === '.' || visible(scope) ? [{ path: scope, depth: 0 }] : [];
  let visited = 0;
  try {
    while (pending.length) {
      const directory = pending.pop()!;
      const target = await scopedTarget(reader, root, directory.path);
      if (directory.path !== '.') {
        const info = await reader.inspectProjectPath(root, directory.path);
        if (
          info.entryKind === 'symlink' ||
          info.isReparsePoint ||
          !visible(target.resolvedRelativePath)
        ) {
          continue;
        }
      }
      const entries = await reader.readProjectDirectory(root, directory.path, maxEntries - visited);
      for (const name of entries.names) {
        visited += 1;
        if (visited > maxEntries) {
          throw new ProjectTreeError('项目目录项超过遍历预算，请缩小范围。');
        }
        const path = directory.path === '.' ? name : `${directory.path}/${name}`;
        if (!visible(path)) continue;
        let target: ResolvedProjectPath;
        try {
          target = await scopedTarget(reader, root, path);
        } catch (error) {
          if (!(error instanceof ProjectTreeError)) throw error;
          continue;
        }
        if (!visible(target.resolvedRelativePath)) continue;
        const info = await reader.inspectProjectPath(root, path);
        if (info.entryKind === 'directory' && !info.isReparsePoint) {
          if (directory.depth >= maxDepth) {
            throw new ProjectTreeError('项目目录超过最大遍历深度，请缩小范围。');
          }
          pending.push({ path, depth: directory.depth + 1 });
        } else if (info.targetKind === 'file') {
          files.add(path);
        }
      }
      // A late iterator failure cannot override an earlier depth/metadata error.
      // Nor can exceeded be checked before consuming its ordered sentinel.
      if (entries.terminalError !== null) throw new ProjectReadError(entries.terminalError);
    }
    for (const path of explicitFiles) {
      if (scope !== '.' && path !== scope && !path.startsWith(`${scope}/`)) continue;
      let target: ResolvedProjectPath;
      try {
        target = await scopedTarget(reader, root, path);
      } catch (error) {
        if (!(error instanceof ProjectTreeError)) throw error;
        continue;
      }
      const info = await reader.inspectProjectPath(root, path);
      if (info.targetKind === 'file' && visible(target.resolvedRelativePath)) files.add(path);
    }
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
    throw new ProjectTreeError('项目目录无法完整遍历，请检查权限或文件是否已移动。');
  }
  return [...files].sort(compareChapterPaths);
}
