import { bookProfilePath, emptyBookProfile, serializeBookProfile } from '../book-profile';
import { TauriFileSystem } from '../tauri-fs';
import { initializeStoryProject } from './initialize';
import { normalizeRoot } from './path';

/** The book title is also the new directory name; never silently sanitize or rename it. */
export function validateBlankStoryTitle(title: string): void {
  if (!title.trim()) throw new Error('请输入书名。');
  if (title !== title.trim() || /[. ]$/.test(title) || title === '.' || title === '..') {
    throw new Error('书名不能以空白开头或结尾，也不能以句点结尾。');
  }
  if (
    title.length > 255 ||
    /[\\/:*?"<>|]/.test(title) ||
    [...title].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error(
      '书名不能包含路径分隔符、控制字符或 \\ / : * ? " < > |，且不能超过 255 个字符。',
    );
  }
  if (
    /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i.test(
      title.split('.')[0].trimEnd(),
    )
  ) {
    throw new Error('这个书名是 Windows 保留目录名，请换一个书名。');
  }
}

export function blankStoryProjectPath(parentPath: string, title: string): string {
  validateBlankStoryTitle(title);
  if (
    !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+|\/)/i.test(parentPath) ||
    parentPath.split(/[\\/]/).includes('..')
  ) {
    throw new Error('请选择有效的本地保存位置。');
  }
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return `${normalizeRoot(parentPath)}${separator}${title}`;
}

/** Explicit local creation only: no model request, sample prose, prompt, or overwrite. */
export async function createBlankStoryProject(parentPath: string, title: string): Promise<string> {
  const projectPath = blankStoryProjectPath(parentPath, title);
  if (await TauriFileSystem.pathExists(projectPath)) {
    throw new Error(`目标目录已存在：${projectPath}。请换一个书名或保存位置，不会覆盖已有内容。`);
  }
  // Non-recursive root mkdir is the atomic claim, including concurrent same-name creation.
  try {
    await TauriFileSystem.createDir(parentPath, projectPath, false);
  } catch (error) {
    throw Object.assign(
      new Error(
        `无法完成目录创建：${projectPath}。请检查该位置；若已生成目录，现有内容不会被删除。\n${error instanceof Error ? error.message : String(error)}`,
      ),
      { cause: error },
    );
  }
  try {
    await initializeStoryProject(projectPath);
    const separator = projectPath.includes('\\') ? '\\' : '/';
    await TauriFileSystem.createDir(projectPath, `${projectPath}${separator}.storyforge`, true);
    await TauriFileSystem.writeFile(
      projectPath,
      bookProfilePath(projectPath),
      serializeBookProfile({ ...emptyBookProfile(), title }),
    );
    return projectPath;
  } catch (error) {
    // No recursive cleanup: a newly-created tree may already contain author/external writes.
    throw Object.assign(
      new Error(
        `目录 ${projectPath} 已创建，但作品初始化未完成。已保留现有内容，请检查该目录后重试。\n${error instanceof Error ? error.message : String(error)}`,
      ),
      { cause: error },
    );
  }
}
