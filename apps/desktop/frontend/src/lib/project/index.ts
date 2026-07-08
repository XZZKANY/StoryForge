import { TauriFileSystem, type FileEntry } from '../tauri-fs';
import { relativePathInsideProject } from './path';
import { classifyRelativePath, emptyCounts } from './semantics';
import type { ProjectIndex } from './types';

export function buildProjectIndexFromEntries(
  projectPath: string,
  entries: FileEntry[],
): ProjectIndex {
  const files = entries
    .filter((entry) => !entry.isDir)
    .filter((entry) => entry.extension === 'md' || entry.extension === 'markdown')
    .filter((entry) => !/[/\\]\.storyforge[/\\]/.test(entry.path))
    .map((entry) => ({ entry, relativePath: relativePathInsideProject(projectPath, entry.path) }))
    .filter(
      (item): item is { entry: FileEntry; relativePath: string } => item.relativePath !== null,
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
      counts.draft >
    0;
  return { projectPath, files, summary: { hasStoryStructure, counts } };
}

export async function buildProjectIndex(projectPath: string): Promise<ProjectIndex> {
  const entries = await TauriFileSystem.listDir(projectPath, true);
  return buildProjectIndexFromEntries(projectPath, entries);
}
