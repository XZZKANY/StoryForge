/**
 * 全书统计：数「正文」语义目录下的章节文件与总字数。
 *
 * 逐个读盘求和，不用 FileEntry.size 估算——UTF-8 下一个汉字 3 字节，
 * 按字节推字数会给作者一个虚高约 3 倍的假数字。
 */
import { buildProjectIndex } from './project-context';
import { TauriFileSystem } from './tauri-fs';
import { countProseChars } from './text-metrics';

export type ManuscriptTotals = {
  chapters: number;
  chars: number;
  /** 读失败的文件数：如实报出，不当 0 字混进总和。 */
  unreadable: number;
};

export async function scanManuscriptTotals(projectPath: string): Promise<ManuscriptTotals> {
  const index = await buildProjectIndex(projectPath);
  // buildProjectIndex 已按 relativePath 排序，正文文件名三位补零时即章节序。
  const drafts = index.files.filter((file) => file.kind === 'draft');

  let chars = 0;
  let unreadable = 0;
  for (const draft of drafts) {
    try {
      chars += countProseChars(await TauriFileSystem.readFile(draft.path));
    } catch {
      unreadable += 1;
    }
  }
  return { chapters: drafts.length, chars, unreadable };
}
