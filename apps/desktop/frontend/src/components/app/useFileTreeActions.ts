import { useCallback } from 'react';

import { relativePathInsideProject, invalidateContextBundleCache } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import {
  displayDocName,
  ensureMarkdownName,
  entryName,
  joinChild,
  sanitizeEntryName,
  siblingPath,
  suggestNewFileName,
} from '../../lib/fs-path-ops';
import type { AppDialogApi } from './AppDialog';
import { emitToast } from '../../lib/toast';
import { isSameOrInsidePath } from './editor-tabs-state';

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
};

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
        const affected = openPaths.filter((open) => isSameOrInsidePath(open, path));
        if (!(await confirmDiscardFiles(affected, '重命名'))) return;
        await TauriFileSystem.renamePath(activeProject, path, target);
        invalidateContextBundleCache(activeProject);
        retargetOpenPaths(path, target);
        if (!isDir) await openFile(target, '打开重命名后的文件');
      } catch (error) {
        await failAlert('重命名失败', error);
      }
    },
    [
      activeProject,
      confirmDiscardFiles,
      dialogs,
      failAlert,
      insideProject,
      openFile,
      openPaths,
      retargetOpenPaths,
    ],
  );

  const onDelete = useCallback(
    async (path: string, isDir: boolean) => {
      if (!activeProject) return;
      const confirmed = await dialogs.confirm({
        title: isDir ? '删除文件夹？' : '删除文件？',
        message: isDir
          ? `将删除「${entryName(path)}」及其中全部内容，无法撤销。`
          : `将删除「${entryName(path)}」，无法撤销。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await TauriFileSystem.deletePath(activeProject, path, isDir);
        invalidateContextBundleCache(activeProject);
        dropOpenPathsUnder(path);
      } catch (error) {
        await failAlert('删除失败', error);
      }
    },
    [activeProject, dialogs, dropOpenPathsUnder, failAlert],
  );

  return { onNewFile, onNewFolder, onRename, onDelete };
}
