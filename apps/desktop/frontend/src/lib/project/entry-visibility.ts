import type { FileEntry } from '../tauri-fs';

function visibleStoryforgeChild(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  const child = normalizedPath.match(/\/\.storyforge\/(.+)$/)?.[1];
  return !child || child === 'canon' || child.startsWith('canon/');
}

function normalizedExtension(entry: FileEntry): string {
  return entry.extension?.toLowerCase() ?? '';
}

export function isCanonDeclarationPath(path: string | null): boolean {
  return Boolean(path && /[/\\]\.storyforge[/\\]canon[/\\]canon\.json$/i.test(path));
}

export function isReadOnlyDerivedProjectPath(path: string | null): boolean {
  return Boolean(path && /[/\\]\.storyforge[/\\]canon[/\\]derived[/\\]/i.test(path));
}

export function isVisibleProjectTreeEntry(entry: FileEntry): boolean {
  const extension = normalizedExtension(entry);
  return (
    visibleStoryforgeChild(entry.path) &&
    (entry.isDir ||
      extension === 'md' ||
      extension === 'markdown' ||
      isCanonDeclarationPath(entry.path))
  );
}

export function isOpenableProjectFileEntry(entry: FileEntry): boolean {
  return !entry.isDir && isVisibleProjectTreeEntry(entry);
}
