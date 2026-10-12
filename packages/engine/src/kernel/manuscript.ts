import { compareChapterPaths } from '@storyforge/project-core';
import { matchPythonPath } from './pathMatch';

export const NON_MANUSCRIPT_DIRS = new Set([
  '大纲',
  'outline',
  'outlines',
  '人物',
  '角色',
  'character',
  'characters',
  '设定',
  '世界观',
  'setting',
  'settings',
  'world',
  'worldbuilding',
  '时间线',
  'timeline',
  'timelines',
  'chronology',
  '伏笔',
  'foreshadowing',
  'foreshadows',
  'seeds',
  '.资料',
  '资料',
  'materials',
  'knowledge',
  '质量',
  'quality',
  'reports',
  '导出',
  'export',
  'exports',
]);

export function isManuscriptPath(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === '灵感.md') return false;
  if (parts.length < 2) return parts.length > 0;
  return !NON_MANUSCRIPT_DIRS.has(parts[0].toLowerCase());
}

/**
 * Canonical POSIX-relative entries from a complete, contained traversal. The producer must
 * already reject aliases whose resolved target is hidden/non-manuscript; no links resolve here.
 */
export function orderManuscriptFiles(
  entries: readonly { relative_path: string; is_directory: boolean }[],
  platform: 'windows' | 'posix',
): string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => {
          if (entry.is_directory || !isManuscriptPath(entry.relative_path)) return false;
          const parts = entry.relative_path.split('/');
          if (parts.some((part) => part.startsWith('.'))) return false;
          return matchPythonPath(entry.relative_path, '*.md', platform);
        })
        .map((entry) => entry.relative_path),
    ),
  ].sort(compareChapterPaths);
}
