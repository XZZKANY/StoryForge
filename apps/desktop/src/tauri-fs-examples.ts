/**
 * Tauri 文件系统使用示例
 */

import { TauriFileSystem, PathUtils, FileSystemError } from './tauri-fs';

/**
 * 示例 1：读取文件
 */
export async function readMarkdownFile(path: string): Promise<string> {
  try {
    const content = await TauriFileSystem.readFile(path);
    console.log(`成功读取文件: ${path}`);
    return content;
  } catch (error) {
    if (FileSystemError.isNotFound(error)) {
      console.error(`文件不存在: ${path}`);
    } else {
      console.error(`读取文件失败: ${error}`);
    }
    throw error;
  }
}

/**
 * 示例 2：保存文件
 */
export async function saveMarkdownFile(
  path: string,
  content: string
): Promise<void> {
  try {
    await TauriFileSystem.writeFile(path, content);
    console.log(`成功保存文件: ${path}`);
  } catch (error) {
    console.error(`保存文件失败: ${error}`);
    throw error;
  }
}

/**
 * 示例 3：列出目录中的所有 Markdown 文件
 */
export async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await TauriFileSystem.listDir(dirPath, true); // recursive
    const markdownFiles = entries
      .filter(
        (entry) =>
          !entry.isDir &&
          (entry.extension === 'md' || entry.extension === 'markdown')
      )
      .map((entry) => entry.path);

    console.log(`找到 ${markdownFiles.length} 个 Markdown 文件`);
    return markdownFiles;
  } catch (error) {
    console.error(`列出目录失败: ${error}`);
    throw error;
  }
}

/**
 * 示例 4：监听文件变化
 */
export async function watchProjectDirectory(
  projectPath: string,
  onChange: (changedFiles: string[]) => void
): Promise<() => void> {
  console.log(`开始监听目录: ${projectPath}`);

  const unlisten = await TauriFileSystem.watchFile(projectPath, (event) => {
    console.log(`文件变化: ${event.kind}`, event.paths);

    // 只关注 Markdown 文件
    const markdownFiles = event.paths.filter((path) => {
      const ext = PathUtils.extname(path);
      return ext === 'md' || ext === 'markdown';
    });

    if (markdownFiles.length > 0) {
      onChange(markdownFiles);
    }
  });

  return unlisten;
}

/**
 * 示例 5：创建新章节文件
 */
export async function createChapterFile(
  projectPath: string,
  chapterNumber: number,
  title: string
): Promise<string> {
  const fileName = `chapter-${chapterNumber.toString().padStart(3, '0')}.md`;
  const filePath = PathUtils.join(projectPath, 'chapters', fileName);

  // 确保目录存在
  const dirPath = PathUtils.dirname(filePath);
  await TauriFileSystem.createDir(dirPath, true);

  // 创建文件内容
  const content = `# 第 ${chapterNumber} 章：${title}

<!-- 章节元数据 -->
<!-- chapter: ${chapterNumber} -->
<!-- title: ${title} -->

## 正文

[在此处开始写作...]
`;

  await TauriFileSystem.writeFile(filePath, content);
  console.log(`创建章节文件: ${filePath}`);

  return filePath;
}

/**
 * 示例 6：删除文件
 */
export async function deleteChapterFile(filePath: string): Promise<void> {
  const exists = await TauriFileSystem.pathExists(filePath);
  if (!exists) {
    console.warn(`文件不存在，无需删除: ${filePath}`);
    return;
  }

  await TauriFileSystem.deletePath(filePath, false);
  console.log(`删除文件: ${filePath}`);
}

/**
 * 示例 7：重命名文件
 */
export async function renameChapterFile(
  oldPath: string,
  newPath: string
): Promise<void> {
  await TauriFileSystem.renamePath(oldPath, newPath);
  console.log(`重命名文件: ${oldPath} -> ${newPath}`);
}

/**
 * 示例 8：获取项目统计信息
 */
export async function getProjectStats(projectPath: string) {
  const entries = await TauriFileSystem.listDir(projectPath, true);

  const stats = {
    totalFiles: 0,
    totalDirs: 0,
    markdownFiles: 0,
    totalSize: 0,
    lastModified: 0,
  };

  for (const entry of entries) {
    if (entry.isDir) {
      stats.totalDirs++;
    } else {
      stats.totalFiles++;
      stats.totalSize += entry.size;

      if (entry.extension === 'md' || entry.extension === 'markdown') {
        stats.markdownFiles++;
      }

      if (entry.modified > stats.lastModified) {
        stats.lastModified = entry.modified;
      }
    }
  }

  return stats;
}

/**
 * 示例 9：完整的编辑器集成流程
 */
export class LocalFileEditor {
  private currentFilePath: string | null = null;
  private originalContent: string = '';
  private isDirty: boolean = false;
  private unwatchFile: (() => void) | null = null;

  /**
   * 打开文件
   */
  async openFile(path: string): Promise<string> {
    // 关闭之前的文件
    await this.closeFile();

    this.currentFilePath = path;
    this.originalContent = await TauriFileSystem.readFile(path);
    this.isDirty = false;

    // 监听文件外部变化
    this.unwatchFile = await TauriFileSystem.watchFile(path, (event) => {
      if (event.kind === 'modified') {
        console.warn('文件被外部修改！');
        // 可以提示用户重新加载
      }
    });

    return this.originalContent;
  }

  /**
   * 保存文件
   */
  async saveFile(content: string): Promise<void> {
    if (!this.currentFilePath) {
      throw new Error('没有打开的文件');
    }

    await TauriFileSystem.writeFile(this.currentFilePath, content);
    this.originalContent = content;
    this.isDirty = false;
  }

  /**
   * 标记内容已修改
   */
  markDirty(content: string): void {
    this.isDirty = content !== this.originalContent;
  }

  /**
   * 检查是否有未保存的修改
   */
  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  /**
   * 关闭文件
   */
  async closeFile(): Promise<void> {
    if (this.unwatchFile) {
      this.unwatchFile();
      this.unwatchFile = null;
    }

    this.currentFilePath = null;
    this.originalContent = '';
    this.isDirty = false;
  }

  /**
   * 获取当前文件路径
   */
  getCurrentFilePath(): string | null {
    return this.currentFilePath;
  }
}
