import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { saveActiveEditorForClose } from '../../lib/assistant-events';
import { projectBasename } from '../../lib/project-context';
import type { WorkspaceSession } from '../../lib/workspace-session';
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

type CloseOperation = { current: () => boolean; canClose: (() => boolean) | null };

type UseEditorWorkspaceTabsOptions = {
  activeProject: string | null;
  currentFile: string | null;
  selectProject: (path: string) => void;
  selectFile: (path: string) => void;
  closeFile: () => void;
  removeProject: (path: string) => void;
  dialogs: AppDialogApi;
  onShowEditor: () => void;
  /** 启动恢复现场：项目已切到 pendingRestore.project 后，把页签集合与活动文件一次性铺回来。 */
  pendingRestore?: WorkspaceSession | null;
  onRestoreApplied?: () => void;
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
  pendingRestore = null,
  onRestoreApplied,
}: UseEditorWorkspaceTabsOptions) {
  // 单击树里的文件先进预览（斜体、可被覆盖），双击/编辑后固定为普通页签。
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(() => new Set());
  // 当前激活的是预览页签还是固定页签；切到固定页签不再清空预览槽（修 #5：预览页签消失）。
  const [activePane, setActivePane] = useState<EditorTabPane>('file');
  const displayedFile = resolveDisplayedEditorFile(activePane, previewFile, currentFile);
  const dirtyFilesRef = useRef(dirtyFiles);
  const workspaceEpochRef = useRef(0);
  const closeOperationRef = useRef(0);
  const setLatestDirtyFiles = useCallback(
    (update: Set<string> | ((current: Set<string>) => Set<string>)) => {
      const next = typeof update === 'function' ? update(dirtyFilesRef.current) : update;
      dirtyFilesRef.current = next;
      setDirtyFiles(next);
    },
    [],
  );
  useLayoutEffect(() => {
    workspaceEpochRef.current += 1;
  }, [activeProject, currentFile, previewFile, openFiles]);
  useLayoutEffect(
    () => () => {
      workspaceEpochRef.current += 1;
    },
    [],
  );
  const beginCloseOperation = useCallback((): CloseOperation => {
    const token = ++closeOperationRef.current;
    const epoch = workspaceEpochRef.current;
    const operation: CloseOperation = {
      canClose: null,
      current: () =>
        token === closeOperationRef.current &&
        epoch === workspaceEpochRef.current &&
        (operation.canClose?.() ?? true),
    };
    return operation;
  }, []);

  const handleEditorDirtyChange = useCallback(
    (filePath: string | null, dirty: boolean) => {
      if (!filePath) return;
      setLatestDirtyFiles((current) => updateDirtyEditorFiles(current, filePath, dirty));
      if (dirty && previewFile === filePath) {
        setOpenFiles((current) => openEditorFile(current, filePath));
        setPreviewFile(null);
        setActivePane('file');
        selectFile(filePath);
      }
    },
    [previewFile, selectFile, setLatestDirtyFiles],
  );

  const confirmDiscardFiles = useCallback(
    async (paths: string[], actionLabel: string, operation = beginCloseOperation()) => {
      const dirtyPaths = paths.filter((path) => dirtyFilesRef.current.has(path));
      if (dirtyPaths.length === 0) return operation.current();

      // 「保存并…」只在唯一脏文件恰好是当前显示目标时给；关闭专用握手
      // 必须确认该模型已保存，不把通用 Agent 路径的 skipped 当作关闭授权。
      const savablePath =
        dirtyPaths.length === 1 && dirtyPaths[0] === displayedFile ? dirtyPaths[0] : null;

      if (!savablePath) {
        const confirmed = await dialogs.confirm({
          title: '放弃未保存修改？',
          message: `${dirtyPaths.length} 个文件有未保存修改，${actionLabel}会放弃这些修改。`,
          confirmLabel: '放弃修改',
          cancelLabel: '继续编辑',
          tone: 'danger',
        });
        return confirmed && operation.current();
      }

      const choice = await dialogs.choose({
        title: '有未保存修改',
        message: `${projectBasename(savablePath)} 有未保存修改。`,
        choices: [
          { id: 'save', label: `保存并${actionLabel}` },
          { id: 'discard', label: '放弃修改', tone: 'danger' },
        ],
        cancelLabel: '继续编辑',
      });
      if (!operation.current()) return false;
      if (choice === 'discard') return true;
      if (choice !== 'save') return false;

      try {
        operation.canClose = await saveActiveEditorForClose(savablePath);
        return operation.current();
      } catch (error) {
        // 保存失败就别关：关了这份稿就没了。
        await dialogs.alert({
          title: '已取消操作，修改仍保留',
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [beginCloseOperation, dialogs, displayedFile],
  );

  const openFile = useCallback(
    async (path: string, _actionLabel = '打开其他文件') => {
      workspaceEpochRef.current += 1;
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
      workspaceEpochRef.current += 1;
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

  // 恢复现场（写作时刻 01）：必须排在上面那个 reset 之后声明 —— 同一 activeProject 依赖下
  // effect 按声明序执行，先 reset 再铺页签，否则刚恢复的页签会被 reset 抹掉。
  useEffect(() => {
    if (!pendingRestore || pendingRestore.project !== activeProject) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 启动恢复一次性铺回页签，React18 合法模式 */
    setOpenFiles(pendingRestore.openFiles);
    setActivePane('file');
    /* eslint-enable react-hooks/set-state-in-effect */
    if (pendingRestore.activeFile) selectFile(pendingRestore.activeFile);
    onRestoreApplied?.();
  }, [activeProject, onRestoreApplied, pendingRestore, selectFile]);

  const resetEditorFiles = useCallback(() => {
    setOpenFiles([]);
    setLatestDirtyFiles(new Set());
    setPreviewFile(null);
    setActivePane('file');
  }, [setLatestDirtyFiles]);

  const selectProjectSafely = useCallback(
    async (path: string) => {
      const operation = beginCloseOperation();
      if (!(await confirmDiscardFiles(openFiles, '切换项目', operation)) || !operation.current())
        return false;
      resetEditorFiles();
      selectProject(path);
      return true;
    },
    [beginCloseOperation, confirmDiscardFiles, openFiles, resetEditorFiles, selectProject],
  );

  const removeProjectSafely = useCallback(
    async (path: string) => {
      if (path === activeProject) {
        const operation = beginCloseOperation();
        if (
          !(await confirmDiscardFiles(openFiles, '移除当前项目', operation)) ||
          !operation.current()
        )
          return;
        setOpenFiles([]);
        setLatestDirtyFiles(new Set());
      }
      removeProject(path);
    },
    [
      activeProject,
      beginCloseOperation,
      confirmDiscardFiles,
      openFiles,
      removeProject,
      setLatestDirtyFiles,
    ],
  );

  const handleFileClose = useCallback(
    async (path: string) => {
      const operation = beginCloseOperation();
      if (!(await confirmDiscardFiles([path], '关闭文件', operation)) || !operation.current())
        return;
      const nextFile = nextEditorFileAfterClose(openFiles, path);
      setOpenFiles((current) => closeEditorFile(current, path));
      setLatestDirtyFiles((current) => updateDirtyEditorFiles(current, path, false));
      if (currentFile === path) {
        if (nextFile) selectFile(nextFile);
        else {
          closeFile();
          // 固定文件全关但仍有预览时，落到预览页签，别让编辑区空掉。
          setActivePane(previewFile ? 'preview' : 'file');
        }
      }
    },
    [
      beginCloseOperation,
      closeFile,
      confirmDiscardFiles,
      currentFile,
      openFiles,
      previewFile,
      selectFile,
      setLatestDirtyFiles,
    ],
  );

  const handleCloseAll = useCallback(async () => {
    const openPaths = previewFile ? [...openFiles, previewFile] : openFiles;
    const operation = beginCloseOperation();
    if (!(await confirmDiscardFiles(openPaths, '关闭全部页签', operation)) || !operation.current())
      return;
    resetEditorFiles();
    closeFile();
  }, [
    beginCloseOperation,
    closeFile,
    confirmDiscardFiles,
    openFiles,
    previewFile,
    resetEditorFiles,
  ]);

  const handleCloseOthers = useCallback(async () => {
    const keep = displayedFile;
    if (!keep) return;
    const allOpen = previewFile ? [...openFiles, previewFile] : openFiles;
    const others = allOpen.filter((path) => path !== keep);
    if (others.length === 0) return;
    const operation = beginCloseOperation();
    if (!(await confirmDiscardFiles(others, '关闭其他页签', operation)) || !operation.current())
      return;
    setLatestDirtyFiles((current) => {
      const next = new Set(current);
      for (const path of others) next.delete(path);
      return next;
    });
    setOpenFiles([keep]);
    setPreviewFile(null);
    setActivePane('file');
    selectFile(keep);
  }, [
    beginCloseOperation,
    confirmDiscardFiles,
    displayedFile,
    openFiles,
    previewFile,
    selectFile,
    setLatestDirtyFiles,
  ]);

  const focusFile = useCallback(
    (path: string) => {
      workspaceEpochRef.current += 1;
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
      setLatestDirtyFiles((current) => updateDirtyEditorFiles(current, path, false));
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
    [closeFile, currentFile, openFiles, previewFile, selectFile, setLatestDirtyFiles],
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
