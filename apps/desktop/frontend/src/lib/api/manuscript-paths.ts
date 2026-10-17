import { isManuscriptPath } from '@storyforge/engine';

/**
 * 这个作品内相对路径会不会被手稿当成一章：与引擎排阅读序同一条规则——点开头的文件夹、
 * 大纲 / 人物 / 设定这类资料文件夹之外的 .md 都算。复制、移动前用它提醒作者。
 */
export function countsAsChapter(relativePath: string): boolean {
  const posix = relativePath.replace(/\\/g, '/');
  if (!/\.md$/i.test(posix)) return false;
  if (posix.split('/').some((part) => part.startsWith('.'))) return false;
  return isManuscriptPath(posix);
}
