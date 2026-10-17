import { useCallback } from 'react';

import { countsAsChapter } from '../../lib/api/manuscript-paths';
import { relativePathInsideProject, invalidateContextBundleCache } from '../../lib/project-context';
import { isVisibleProjectTreeEntry } from '../../lib/project/entry-visibility';
import { TauriFileSystem } from '../../lib/tauri-fs';
import {
  copyName,
  displayDocName,
  ensureMarkdownName,
  entryName,
  joinChild,
  parentDir,
  sanitizeEntryName,
  siblingPath,
  suggestNewFileName,
} from '../../lib/fs-path-ops';
import type { AppDialogApi } from './AppDialog';
import { emitToast } from '../../lib/toast';
import { recordRenameLineage, snapshotBeforeDelete } from '../../lib/versions';
import { isSameOrInsidePath, retargetEditorPath } from './editor-tabs-state';

type UseFileTreeActionsOptions = {
  activeProject: string | null;
  dialogs: AppDialogApi;
  openFile: (path: string, actionLabel?: string) => Promise<void>;
  // 删除后把旧路径（文件夹则连同里面的文件）从打开页签里摘掉。
  dropOpenPathsUnder: (path: string) => void;
  // 改名前先问未保存修改：保存后再改，或由作者明确放弃（与切换项目同一套确认）。
  confirmDiscardFiles: (paths: string[], actionLabel: string) => Promise<boolean>;
  openPaths: string[];
  retargetOpenPaths: (from: string, to: string) => void;
};

export type FileTreeActions = {
  onNewFile: (dir: string) => Promise<void>;
  onNewFolder: (dir: string) => Promise<void>;
  onRename: (path: string, isDir: boolean) => Promise<void>;
  onDelete: (path: string, isDir: boolean) => Promise<void>;
  /** 在同一个文件夹里复制一份（只对文件）。 */
  onDuplicate?: (path: string) => Promise<void>;
  /** 挑一个文件夹移过去，可撤销。 */
  onMove?: (path: string, isDir: boolean) => Promise<void>;
  onReveal?: (path: string) => Promise<void>;
};

// 文件夹选项用绝对路径当 id，绝对路径不会以 < 开头。
const ROOT_CHOICE = '<root>';

export function useFileTreeActions({
  activeProject,
  dialogs,
  openFile,
  dropOpenPathsUnder,
  confirmDiscardFiles,
  openPaths,
  retargetOpenPaths,
}: UseFileTreeActionsOptions): FileTreeActions {
  const insideProject = useCallback(
    (absPath: string): boolean =>
      Boolean(activeProject) &&
      relativePathInsideProject(activeProject as string, absPath) !== null,
    [activeProject],
  );

  const failAlert = useCallback(
    (title: string, error: unknown) =>
      dialogs.alert({ title, message: error instanceof Error ? error.message : String(error) }),
    [dialogs],
  );

  const onNewFile = useCallback(
    async (dir: string) => {
      if (!activeProject) return;
      const siblings = await TauriFileSystem.listDir(dir, false).catch(() => []);
      const input = await dialogs.prompt({
        title: '新建文件',
        message: `在 ${entryName(dir)} 下新建 Markdown 文件：`,
        defaultValue: suggestNewFileName(siblings.map((entry) => entry.name)),
        confirmLabel: '创建',
      });
      if (input === null) return;
      const name = ensureMarkdownName(input);
      if (!name) return;
      const target = joinChild(dir, name);
      if (!insideProject(target)) {
        await dialogs.alert({ title: '新建文件失败', message: '文件名必须留在当前项目内。' });
        return;
      }
      try {
        if (await TauriFileSystem.pathExists(target)) {
          await openFile(target, '打开已有文件');
          emitToast('该文件已存在，已为你打开');
          return;
        }
        await TauriFileSystem.writeFile(activeProject, target, `# ${displayDocName(name)}\n\n`);
        invalidateContextBundleCache(activeProject);
        await openFile(target, '打开新文件');
      } catch (error) {
        await failAlert('新建文件失败', error);
      }
    },
    [activeProject, dialogs, failAlert, insideProject, openFile],
  );

  const onNewFolder = useCallback(
    async (dir: string) => {
      if (!activeProject) return;
      const input = await dialogs.prompt({
        title: '新建文件夹',
        message: `在 ${entryName(dir)} 下新建文件夹：`,
        defaultValue: '新文件夹',
        confirmLabel: '创建',
      });
      if (input === null) return;
      const name = sanitizeEntryName(input);
      if (!name) return;
      const target = joinChild(dir, name);
      if (!insideProject(target)) {
        await dialogs.alert({ title: '新建文件夹失败', message: '名称必须留在当前项目内。' });
        return;
      }
      try {
        await TauriFileSystem.createDir(activeProject, target);
      } catch (error) {
        await failAlert('新建文件夹失败', error);
      }
    },
    [activeProject, dialogs, failAlert, insideProject],
  );

  // 改名与移动共用：先问未保存的修改，再挪盘上的文件，版本记录与打开的页签跟着走。
  const relocate = useCallback(
    async (project: string, from: string, to: string, isDir: boolean, actionLabel: string) => {
      const affected = openPaths.filter((open) => isSameOrInsidePath(open, from));
      if (!(await confirmDiscardFiles(affected, actionLabel))) return false;
      await TauriFileSystem.renamePath(project, from, to);
      invalidateContextBundleCache(project);
      await carryVersionHistory(project, from, to, isDir);
      retargetOpenPaths(from, to);
      return true;
    },
    [confirmDiscardFiles, openPaths, retargetOpenPaths],
  );

  const onRename = useCallback(
    async (path: string, isDir: boolean) => {
      if (!activeProject) return;
      const input = await dialogs.prompt({
        title: isDir ? '重命名文件夹' : '重命名文件',
        message: '输入新名称：',
        defaultValue: entryName(path),
        confirmLabel: '重命名',
      });
      if (input === null) return;
      const name = isDir ? sanitizeEntryName(input) : ensureMarkdownName(input);
      if (!name || name === entryName(path)) return;
      const target = siblingPath(path, name);
      if (!insideProject(target)) {
        await dialogs.alert({ title: '重命名失败', message: '新名称必须留在当前项目内。' });
        return;
      }
      try {
        if (await TauriFileSystem.pathExists(target)) {
          await dialogs.alert({ title: '重命名失败', message: '同目录下已存在同名项。' });
          return;
        }
        if (!(await relocate(activeProject, path, target, isDir, '重命名'))) return;
        if (!isDir) await openFile(target, '打开重命名后的文件');
      } catch (error) {
        await failAlert('重命名失败', error);
      }
    },
    [activeProject, dialogs, failAlert, insideProject, openFile, relocate],
  );

  const onMove = useCallback(
    async (path: string, isDir: boolean) => {
      if (!activeProject) return;
      const project = activeProject;
      const name = entryName(path);
      const from = parentDir(path);
      let folders: string[];
      try {
        folders = (await TauriFileSystem.listDir(project, true))
          .filter((entry) => entry.isDir && isVisibleProjectTreeEntry(entry))
          .map((entry) => entry.path)
          .filter(
            (dir) =>
              Boolean(relativePathInsideProject(project, dir)) &&
              !isAppDataPath(project, dir) &&
              !isSameOrInsidePath(dir, path) &&
              dir !== from,
          )
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        await failAlert('移动失败', error);
        return;
      }
      const choices = [
        ...(from === project ? [] : [{ id: ROOT_CHOICE, label: '作品根目录' }]),
        ...folders.map((dir) => ({
          id: dir,
          label: relativePathInsideProject(project, dir) ?? dir,
        })),
      ];
      if (choices.length === 0) {
        await dialogs.alert({ title: '移动', message: '作品里没有别的文件夹可以移过去。' });
        return;
      }
      const picked = await dialogs.choose({
        title: `把「${name}」移到哪个文件夹？`,
        message: '版本记录跟着走，已打开的页签换成新位置；移完右下角可以撤销。',
        choices,
        noDefault: true,
      });
      if (!picked) return;
      const dest = picked === ROOT_CHOICE ? project : picked;
      const target = joinChild(dest, name);
      const label = picked === ROOT_CHOICE ? '作品根目录' : entryName(dest);
      try {
        if (await TauriFileSystem.pathExists(target)) {
          await dialogs.alert({
            title: '移动失败',
            message: `「${label}」里已经有同名的「${name}」。`,
          });
          return;
        }
        if (!(await relocate(project, path, target, isDir, '移动'))) return;
      } catch (error) {
        await failAlert('移动失败', error);
        return;
      }
      emitToast(`已把「${name}」移到「${label}」`, {
        action: {
          label: '撤销',
          run: async () => {
            try {
              if (await TauriFileSystem.pathExists(path)) {
                emitToast(`原位置已经有「${name}」了，没法挪回去`, { tone: 'error' });
                return;
              }
              await relocate(project, target, path, isDir, '撤销移动');
            } catch (error) {
              emitToast(`没能挪回去：${error instanceof Error ? error.message : String(error)}`, {
                tone: 'error',
              });
            }
          },
        },
      });
    },
    [activeProject, dialogs, failAlert, relocate],
  );

  const onDuplicate = useCallback(
    async (path: string) => {
      if (!activeProject) return;
      const project = activeProject;
      const dir = parentDir(path);
      const siblings = await TauriFileSystem.listDir(dir, false).catch(() => []);
      const suggested = copyName(
        entryName(path),
        siblings.map((entry) => entry.name),
      );
      const relative = relativePathInsideProject(project, joinChild(dir, suggested));
      // 手稿按路径排章：正文里多出一份就多出一章，作者得事先知道。
      const chapterNote =
        relative && countsAsChapter(relative)
          ? '\n\n注意：这个文件夹里的文件都算成一章，副本也会排进手稿。只想留个底稿的话，可以挪进「.草稿」这类点开头的文件夹。'
          : '';
      const input = await dialogs.prompt({
        title: '复制一份',
        message: `在「${entryName(dir)}」里复制「${entryName(path)}」：${chapterNote}`,
        defaultValue: suggested,
        confirmLabel: '复制',
      });
      if (input === null) return;
      const name = ensureMarkdownName(input);
      if (!name) return;
      const target = joinChild(dir, name);
      if (!insideProject(target)) {
        await dialogs.alert({ title: '复制失败', message: '文件名必须留在当前项目内。' });
        return;
      }
      try {
        if (await TauriFileSystem.pathExists(target)) {
          await dialogs.alert({ title: '复制失败', message: `「${name}」已经存在。` });
          return;
        }
        const content = await TauriFileSystem.readProjectFile(project, path);
        await TauriFileSystem.writeFile(project, target, content);
        invalidateContextBundleCache(project);
        await openFile(target, '打开副本');
        emitToast(`已复制为「${name}」`);
      } catch (error) {
        await failAlert('复制失败', error);
      }
    },
    [activeProject, dialogs, failAlert, insideProject, openFile],
  );

  const onReveal = useCallback(
    async (path: string) => {
      if (!activeProject) return;
      try {
        await TauriFileSystem.revealInFileManager(activeProject, path);
      } catch (error) {
        await failAlert('没能在资源管理器里打开', error);
      }
    },
    [activeProject, failAlert],
  );

  // 删除可撤销（作者 10-17 选的「应用内撤销」）：删前把内容读进内存、给每个文件留一条版本，
  // 删完右下角给「撤销」；过后同名文件建回来，还能在它的版本记录里找回。
  const onDelete = useCallback(
    async (path: string, isDir: boolean) => {
      if (!activeProject) return;
      const project = activeProject;
      const name = entryName(path);
      let backup: DeleteBackup;
      try {
        backup = await collectDeleteBackup(project, path, isDir);
      } catch (error) {
        await failAlert('删除失败', error);
        return;
      }
      const recovery =
        backup.unreadable.length > 0
          ? `其中 ${backup.unreadable.length} 个文件（图片或过大的文件）留不了快照，删掉就找不回来。`
          : '删前会留一份快照，删完可以撤销。';
      const confirmed = await dialogs.confirm({
        title: isDir ? '删除文件夹？' : '删除文件？',
        message: isDir
          ? `将删除「${name}」及其中全部内容。${recovery}`
          : `将删除「${name}」。${recovery}`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await snapshotBeforeDelete(
          project,
          backup.files.map((file) => file.path).filter((file) => !isAppDataPath(project, file)),
        );
      } catch (error) {
        await failAlert('没能留下删除前快照，已取消删除', error);
        return;
      }
      try {
        await TauriFileSystem.deletePath(project, path, isDir);
        invalidateContextBundleCache(project);
        dropOpenPathsUnder(path);
      } catch (error) {
        await failAlert('删除失败', error);
        return;
      }
      emitToast(`已删除「${name}」`, {
        action: { label: '撤销', run: () => restoreDeleted(project, name, backup) },
      });
    },
    [activeProject, dialogs, dropOpenPathsUnder, failAlert],
  );

  return { onNewFile, onNewFolder, onRename, onDelete, onDuplicate, onMove, onReveal };
}

type DeleteBackup = {
  dirs: string[];
  files: Array<{ path: string; content: string }>;
  unreadable: string[];
};

async function collectDeleteBackup(
  project: string,
  path: string,
  isDir: boolean,
): Promise<DeleteBackup> {
  const entries = isDir ? await TauriFileSystem.listDir(path, true) : [];
  const filePaths = isDir
    ? entries.filter((entry) => !entry.isDir).map((entry) => entry.path)
    : [path];
  const backup: DeleteBackup = {
    dirs: isDir ? [path, ...entries.filter((entry) => entry.isDir).map((entry) => entry.path)] : [],
    files: [],
    unreadable: [],
  };
  for (const file of filePaths) {
    try {
      backup.files.push({
        path: file,
        content: await TauriFileSystem.readProjectFile(project, file),
      });
    } catch {
      // 读不成文本（图片等）或超过读盘上限：只能如实告诉作者删了找不回。
      backup.unreadable.push(file);
    }
  }
  return backup;
}

// .storyforge 是应用自己的数据（版本记录也在里面），不给它们再记版本。
function isAppDataPath(project: string, path: string): boolean {
  const relative = relativePathInsideProject(project, path);
  return relative !== null && /^\.storyforge(?:[\\/]|$)/.test(relative);
}

async function restoreDeleted(project: string, name: string, backup: DeleteBackup): Promise<void> {
  try {
    for (const file of backup.files) {
      if (await TauriFileSystem.pathExists(file.path)) {
        emitToast(
          `「${entryName(file.path)}」已经有同名文件，没有覆盖；可以去它的版本记录里找回。`,
          {
            tone: 'error',
          },
        );
        return;
      }
    }
    for (const dir of backup.dirs) await TauriFileSystem.createDir(project, dir, true);
    for (const file of backup.files)
      await TauriFileSystem.writeFile(project, file.path, file.content);
    invalidateContextBundleCache(project);
    emitToast(`已恢复「${name}」`, { tone: 'success' });
  } catch (error) {
    emitToast(`恢复「${name}」失败：${error instanceof Error ? error.message : String(error)}`, {
      tone: 'error',
    });
  }
}

// 改名已经成功；版本记录没跟上只提示，不回滚改名。
async function carryVersionHistory(
  project: string,
  from: string,
  to: string,
  isDir: boolean,
): Promise<void> {
  try {
    const moved = isDir
      ? (await TauriFileSystem.listDir(to, true))
          .filter((entry) => !entry.isDir)
          .map((entry) => ({ from: retargetEditorPath(entry.path, to, from), to: entry.path }))
      : [{ from, to }];
    await recordRenameLineage(project, moved);
  } catch (error) {
    emitToast(
      `改名完成，但版本记录没能跟过去：${error instanceof Error ? error.message : String(error)}`,
      { tone: 'error' },
    );
  }
}
