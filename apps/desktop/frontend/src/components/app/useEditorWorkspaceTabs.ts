import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AppDialogApi } from './AppDialog';
import {
  closeEditorFile,
  nextEditorFileAfterClose,
  openEditorFile,
  reorderEditorFiles,
  resolveDisplayedEditorFile,
  updateDirtyEditorFiles,
  type EditorTabPane,
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
  // 当前激活的是预览页签还是固定页签；切到固定页签不再清空预览槽（修 #5：预览页签消失）。
  const [activePane, setActivePane] = useState<EditorTabPane>('file');
  const displayedFile = resolveDisplayedEditorFile(activePane, previewFile, currentFile);

  const handleEditorDirtyChange = useCallback(
    (filePath: string | null, dirty: boolean) => {
      if (!filePath) return;
      setDirtyFiles((current) => updateDirtyEditorFiles(current, filePath, dirty));
      if (dirty && previewFile === filePath) {
        setOpenFiles((current) => openEditorFile(current, filePath));
        setPreviewFile(null);
        setActivePane('file');
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
      // 只有固定的正是当前预览时才清预览槽（= 固定预览页签）；打开其他文件应保留已有预览页签。
      setPreviewFile((current) => (current === path ? null : current));
      setActivePane('file');
      onShowEditor();
      selectFile(path);
    },
    [onShowEditor, selectFile],
  );

  const previewFileOpen = useCallback(
    async (path: string) => {
      onShowEditor();
      if (openFiles.includes(path)) {
        // 单击已固定的文件：激活它的固定页签，不动预览槽（不再误清无关预览）。
        setActivePane('file');
        selectFile(path);
      } else {
        setPreviewFile(path);
        setActivePane('preview');
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
    setActivePane('file');
  }, [activeProject]);

  const resetEditorFiles = useCallback(() => {
    setOpenFiles([]);
    setDirtyFiles(new Set());
    setPreviewFile(null);
    setActivePane('file');
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
        else {
          closeFile();
          // 固定文件全关但仍有预览时，落到预览页签，别让编辑区空掉。
          setActivePane(previewFile ? 'preview' : 'file');
        }
      }
    },
    [closeFile, confirmDiscardFiles, currentFile, openFiles, previewFile, selectFile],
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
    setActivePane('file');
    selectFile(keep);
  }, [confirmDiscardFiles, displayedFile, openFiles, previewFile, selectFile]);

  const focusFile = useCallback(
    (path: string) => {
      onShowEditor();
      // 修 #5：只激活固定页签，不再清空预览槽——预览页签不会因切走而消失。
      setActivePane('file');
      selectFile(path);
    },
    [onShowEditor, selectFile],
  );

  const focusPreview = useCallback(() => {
    onShowEditor();
    setActivePane('preview');
  }, [onShowEditor]);

  const pinPreview = useCallback(() => {
    if (previewFile) void openFile(previewFile);
  }, [openFile, previewFile]);

  // 预览页签一旦变脏会立即固定为普通页签（handleEditorDirtyChange），
  // 走到这里必是干净预览，直接丢弃即可，不需要放弃确认。
  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setActivePane('file');
  }, []);

  const reorderOpenFiles = useCallback((from: string, to: string) => {
    setOpenFiles((current) => reorderEditorFiles(current, from, to));
  }, []);

  // 删除 / 改名后把某文件从打开页签里摘掉：文件已不在，不走脏检查确认（与 handleFileClose 区别）。
  const dropOpenFilePath = useCallback(
    (path: string) => {
      const nextFile = nextEditorFileAfterClose(openFiles, path);
      setOpenFiles((current) => closeEditorFile(current, path));
      setDirtyFiles((current) => updateDirtyEditorFiles(current, path, false));
      if (previewFile === path) {
        setPreviewFile(null);
        setActivePane('file');
      }
      if (currentFile === path) {
        if (nextFile) selectFile(nextFile);
        else {
          closeFile();
          setActivePane(previewFile && previewFile !== path ? 'preview' : 'file');
        }
      }
    },
    [closeFile, currentFile, openFiles, previewFile, selectFile],
  );

  return {
    previewFile,
    openFiles,
    dirtyFiles,
    displayedFile,
    retainedEditorFiles,
    reorderOpenFiles,
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
    focusPreview,
    pinPreview,
    closePreview,
    dropOpenFilePath,
  };
}

export type EditorWorkspaceTabs = ReturnType<typeof useEditorWorkspaceTabs>;
