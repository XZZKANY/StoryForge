import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AppDialogApi } from './AppDialog';
import {
  closeEditorFile,
  nextEditorFileAfterClose,
  openEditorFile,
  updateDirtyEditorFiles,
} from './editor-tabs-state';

type UseEditorWorkspaceTabsOptions = {
  activeProject: string | null;
  currentFile: string | null;
  selectProject: (path: string) => void;
  selectFile: (path: string) => void;
  closeFile: () => void;
  removeProject: (path: string) => void;
  dialogs: AppDialogApi;
  onShowEditor: () => void;
};

export function useEditorWorkspaceTabs({
  activeProject,
  currentFile,
  selectProject,
  selectFile,
  closeFile,
  removeProject,
  dialogs,
  onShowEditor,
}: UseEditorWorkspaceTabsOptions) {
  // 单击树里的文件先进预览（斜体、可被覆盖），双击/编辑后固定为普通页签。
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(() => new Set());
  const displayedFile = previewFile ?? currentFile;

  const handleEditorDirtyChange = useCallback(
    (filePath: string | null, dirty: boolean) => {
      if (!filePath) return;
      setDirtyFiles((current) => updateDirtyEditorFiles(current, filePath, dirty));
      if (dirty && previewFile === filePath) {
        setOpenFiles((current) => openEditorFile(current, filePath));
        setPreviewFile(null);
        selectFile(filePath);
      }
    },
    [previewFile, selectFile],
  );

  const confirmDiscardFiles = useCallback(
    async (paths: string[], actionLabel: string) => {
      const dirtyPaths = paths.filter((path) => dirtyFiles.has(path));
      if (dirtyPaths.length === 0) return true;
      return dialogs.confirm({
        title: '放弃未保存修改？',
        message: `${dirtyPaths.length} 个文件有未保存修改，${actionLabel}会放弃这些修改。`,
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'danger',
      });
    },
    [dialogs, dirtyFiles],
  );

  const openFile = useCallback(
    async (path: string, _actionLabel = '打开其他文件') => {
      setOpenFiles((current) => openEditorFile(current, path));
      setPreviewFile(null);
      onShowEditor();
      selectFile(path);
    },
    [onShowEditor, selectFile],
  );

  const previewFileOpen = useCallback(
    async (path: string) => {
      onShowEditor();
      if (openFiles.includes(path)) {
        setPreviewFile(null);
        selectFile(path);
      } else {
        setPreviewFile(path);
      }
    },
    [onShowEditor, openFiles, selectFile],
  );

  const retainedEditorFiles = useMemo(
    () => (previewFile ? [...openFiles, previewFile] : openFiles),
    [openFiles, previewFile],
  );

  // previewFile 属于当前项目；项目切换后必须清空，避免展示或保存到旧项目路径。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 项目切换时重置预览态，React18 合法模式
    setPreviewFile(null);
  }, [activeProject]);

  const resetEditorFiles = useCallback(() => {
    setOpenFiles([]);
    setDirtyFiles(new Set());
    setPreviewFile(null);
  }, []);

  const selectProjectSafely = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardFiles(openFiles, '切换项目'))) return false;
      resetEditorFiles();
      selectProject(path);
      return true;
    },
    [confirmDiscardFiles, openFiles, resetEditorFiles, selectProject],
  );

  const removeProjectSafely = useCallback(
    async (path: string) => {
      if (path === activeProject) {
        if (!(await confirmDiscardFiles(openFiles, '移除当前项目'))) return;
        setOpenFiles([]);
        setDirtyFiles(new Set());
      }
      removeProject(path);
    },
    [activeProject, confirmDiscardFiles, openFiles, removeProject],
  );

  const handleFileClose = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardFiles([path], '关闭文件'))) return;
      const nextFile = nextEditorFileAfterClose(openFiles, path);
      setOpenFiles((current) => closeEditorFile(current, path));
      setDirtyFiles((current) => updateDirtyEditorFiles(current, path, false));
      if (currentFile === path) {
        if (nextFile) selectFile(nextFile);
        else closeFile();
      }
    },
    [closeFile, confirmDiscardFiles, currentFile, openFiles, selectFile],
  );

  const handleCloseAll = useCallback(async () => {
    const openPaths = previewFile ? [...openFiles, previewFile] : openFiles;
    if (!(await confirmDiscardFiles(openPaths, '关闭全部页签'))) return;
    resetEditorFiles();
    closeFile();
  }, [closeFile, confirmDiscardFiles, openFiles, previewFile, resetEditorFiles]);

  const handleCloseOthers = useCallback(async () => {
    const keep = displayedFile;
    if (!keep) return;
    const allOpen = previewFile ? [...openFiles, previewFile] : openFiles;
    const others = allOpen.filter((path) => path !== keep);
    if (others.length === 0) return;
    if (!(await confirmDiscardFiles(others, '关闭其他页签'))) return;
    setDirtyFiles((current) => {
      const next = new Set(current);
      for (const path of others) next.delete(path);
      return next;
    });
    setOpenFiles([keep]);
    setPreviewFile(null);
    selectFile(keep);
  }, [confirmDiscardFiles, displayedFile, openFiles, previewFile, selectFile]);

  const focusFile = useCallback(
    (path: string) => {
      onShowEditor();
      setPreviewFile(null);
      selectFile(path);
    },
    [onShowEditor, selectFile],
  );

  const pinPreview = useCallback(() => {
    if (previewFile) void openFile(previewFile);
  }, [openFile, previewFile]);

  // 预览页签一旦变脏会立即固定为普通页签（handleEditorDirtyChange），
  // 走到这里必是干净预览，直接丢弃即可，不需要放弃确认。
  const closePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  return {
    previewFile,
    openFiles,
    dirtyFiles,
    displayedFile,
    retainedEditorFiles,
    handleEditorDirtyChange,
    confirmDiscardFiles,
    openFile,
    previewFileOpen,
    resetEditorFiles,
    selectProjectSafely,
    removeProjectSafely,
    handleFileClose,
    handleCloseAll,
    handleCloseOthers,
    focusFile,
    focusPreview: onShowEditor,
    pinPreview,
    closePreview,
  };
}

export type EditorWorkspaceTabs = ReturnType<typeof useEditorWorkspaceTabs>;
