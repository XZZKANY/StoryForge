import { TauriFileSystem, type FileEntry } from '../tauri-fs';
import { relativePathInsideProject } from './path';
import { classifyRelativePath, emptyCounts, isProjectKnowledgeRelativePath } from './semantics';
import type { ProjectIndex } from './types';

const PROJECT_KNOWLEDGE_MAX_FILE_BYTES = 512 * 1024;
const BLOCKED_KNOWLEDGE_DIRECTORIES = new Set([
  'derived',
  'version',
  'versions',
  'cache',
  'caches',
  'log',
  'logs',
  'database',
  'databases',
  'db',
  'config',
  'configs',
]);
const SENSITIVE_KNOWLEDGE_NAME =
  /(?:^|[._-])(credential|credentials|secret|secrets|token|tokens|password|passwd|api[-_]?key|private[-_]?key)(?:[._-]|$)/i;

function isIndexableProjectFile(
  relativePath: string,
  extension: string | undefined,
  size: number,
): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (isProjectKnowledgeRelativePath(normalized)) {
    return size <= PROJECT_KNOWLEDGE_MAX_FILE_BYTES;
  }
  if (!['md', 'markdown'].includes(extension?.toLowerCase() ?? '')) return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part, index) => part.startsWith('.') && !(index === 0 && part === '.资料'))) {
    return false;
  }
  if (classifyRelativePath(normalized) === 'knowledge') {
    if (size > PROJECT_KNOWLEDGE_MAX_FILE_BYTES) return false;
    if (parts.some((part) => BLOCKED_KNOWLEDGE_DIRECTORIES.has(part.toLocaleLowerCase()))) {
      return false;
    }
    if (parts.some((part) => part === '.env' || SENSITIVE_KNOWLEDGE_NAME.test(part))) {
      return false;
    }
  }
  return true;
}

export function buildProjectIndexFromEntries(
  projectPath: string,
  entries: FileEntry[],
): ProjectIndex {
  const files = entries
    .filter((entry) => !entry.isDir)
    .map((entry) => ({ entry, relativePath: relativePathInsideProject(projectPath, entry.path) }))
    .filter(
      (item): item is { entry: FileEntry; relativePath: string } => item.relativePath !== null,
    )
    .filter((item) =>
      isIndexableProjectFile(item.relativePath, item.entry.extension, item.entry.size),
    )
    .map((entry) => {
      return {
        path: entry.entry.path,
        relativePath: entry.relativePath,
        name: entry.entry.name,
        kind: classifyRelativePath(entry.relativePath),
        modified: entry.entry.modified,
        size: entry.entry.size,
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const counts = emptyCounts();
  for (const file of files) {
    counts[file.kind] += 1;
  }

  const hasStoryStructure =
    counts.outline +
      counts.character +
      counts.setting +
      counts.timeline +
      counts.foreshadowing +
      counts.knowledge +
      counts.draft >
    0;
  return { projectPath, files, summary: { hasStoryStructure, counts } };
}

export async function buildProjectIndex(projectPath: string): Promise<ProjectIndex> {
  const entries = await TauriFileSystem.listDir(projectPath, true);
  return buildProjectIndexFromEntries(projectPath, entries);
}
