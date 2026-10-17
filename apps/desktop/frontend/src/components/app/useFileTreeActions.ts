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
import { snapshotBeforeDelete } from '../../lib/versions';
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

  return { onNewFile, onNewFolder, onRename, onDelete };
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
