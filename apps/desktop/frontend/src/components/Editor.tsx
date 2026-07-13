/**
 * Monaco Editor 编辑器组件
 * 保存时先把磁盘上的旧内容存为版本快照，再写入新内容；提供历史查看与恢复。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import {
  EXPORT_CURRENT_FILE_EVENT,
  REQUEST_EDITOR_COMMAND_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  REVIEW_ISSUES_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
  type EditorCommand,
  type SaveActiveFileDoneDetail,
  type ReviewIssueMarker,
} from '../lib/assistant-events';
import { TauriFileSystem } from '../lib/tauri-fs';
import { readVersion, snapshotBeforeWrite } from '../lib/versions';
import { exportCurrentFile, recordRevisionLoop } from '../lib/author-loop';
import { emitAuthorLoopResult } from '../lib/assistant-events';
import { PatchReviewPanel } from './PatchReviewPanel';
import { type GraphNode } from '../lib/branches';
import { issueDecorationOptions, locateEvidence } from './editor/decorations';
import { useEditorFileLoader } from './editor/useEditorFileLoader';
import { useMonacoEditor, type EditorModelCache } from './editor/useMonacoEditor';
import { resolveEditorFontFamily, type EditorFontMode } from './editor/options';
import { useBranchManifest } from './editor/useBranchManifest';
import { useSuggestionWriteback } from './editor/useSuggestionWriteback';
import { formatTimestamp, VersionHistory } from './editor/VersionHistory';
import type { AppDialogApi } from './app/AppDialog';
import { performGuardedWriteback } from '../lib/writeback';
import { isReadOnlyDerivedProjectPath } from '../lib/project/entry-visibility';
import { canCommitEditorSave, isRetainedEditorModel } from './app/editor-tabs-state';

// Monaco 与磁盘原文的换行风格可能不一致（Windows CRLF vs 模型/编辑器 LF）；
// 比较补丁能否写回时按 LF 归一，避免仅换行差异被误判为“内容已变化”而挡住写回。
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// Q3a：右侧视图（正文 / 剧情分支画布占位）的切换从编辑区工具行的下拉挪到 EditorTabs「…」菜单，
// 经编辑器命令事件驱动；这里只保留视图 id 类型与按项目持久化。
type RightViewId = 'files' | 'branch';

function readRightView(key: string): RightViewId {
  try {
    return localStorage.getItem(key) === 'branch' ? 'branch' : 'files';
  } catch {
    return 'files';
  }
}

type EditorProps = {
  projectPath: string | null;
  filePath: string | null;
  editorFontSize?: number;
  editorFontMode?: EditorFontMode;
  autoSave?: boolean;
  retainedFilePaths?: string[];
  sidebarVisible?: boolean;
  onDirtyChange?: (filePath: string | null, dirty: boolean) => void;
  dialogs: AppDialogApi;
};

export function EditorLoadStatus({
  filePath,
  loadedFilePath,
  loadError,
}: {
  filePath: string | null;
  loadedFilePath: string | null;
  loadError: string;
}) {
  if (!filePath || loadedFilePath === filePath) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-0 top-0 z-20 flex items-center justify-center bg-background px-6 text-center"
      data-testid={loadError ? 'editor-load-error' : 'editor-loading'}
    >
      <div>
        <p className={loadError ? 'text-sm text-error' : 'text-sm text-muted'}>
          {loadError ? '读取文件失败' : '正在读取文件…'}
        </p>
        {loadError && <p className="mt-2 max-w-xl text-xs text-subtle">{loadError}</p>}
      </div>
    </div>
  );
}

export function Editor({
  projectPath,
  filePath,
  editorFontSize = 14,
  editorFontMode = 'grid',
  autoSave = false,
  retainedFilePaths = [],
  sidebarVisible,
  onDirtyChange,
  dialogs,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loadedContentPreview, setLoadedContentPreview] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const rightViewStorageKey = `storyforge:right-view:${projectPath ?? '__global__'}`;
  const [rightView, setRightView] = useState<RightViewId>(() => readRightView(rightViewStorageKey));
  const readOnly = isReadOnlyDerivedProjectPath(filePath);

  useEffect(() => {
    // 按项目记住上次的右侧视图选择：换项目时恢复，不再要求重新选择。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRightView(readRightView(rightViewStorageKey));
  }, [rightViewStorageKey]);

  const cleanVersionIdRef = useRef<number | null>(null);
  const modelCacheRef = useRef<EditorModelCache>(new Map());
  const issueDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveRef = useRef(autoSave);
  // 用 ref 持有最新值，避免 Monaco 命令/回调闭包读到旧状态。
  const originalContentRef = useRef('');
  const filePathRef = useRef<string | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const {
    branchManifest,
    advanceBranchHead,
    createBranchFromNode,
    getActiveBranchSnapshot,
    selectBranch,
  } = useBranchManifest(projectPath, filePath);
  const {
    adoptPendingSuggestion,
    handleAcceptHunk,
    handleAcceptSuggestion,
    handleSaveSuggestionNote,
    isReviseLoading,
    pendingSuggestion,
    rejectPendingSuggestion,
    resetSuggestionWriteback,
    setSuggestionStatus,
    suggestionStatus,
  } = useSuggestionWriteback({
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    filePathRef,
    projectPathRef,
    setLoadedContentPreview,
    setIsDirty,
    normalizeEol,
    getActiveBranchSnapshot,
    advanceBranchHead,
    recordRevisionLoop,
    emitAuthorLoopResult,
  });

  // 每次渲染后同步最新值到 ref（见上注释），供 Monaco 命令/回调闭包读取最新状态。
  useLayoutEffect(() => {
    filePathRef.current = filePath;
    projectPathRef.current = projectPath;
    isDirtyRef.current = isDirty;
    autoSaveRef.current = autoSave;
  });

  const { loadedFilePath, loadedContent, loadedIsDirty, loadAttemptFilePath, loadError } =
    useEditorFileLoader({
      filePath,
      originalContentRef,
      issueDecorationsRef,
      filePathRef,
      isDirtyRef,
      autoSaveTimerRef,
      resetSuggestionWriteback,
      adoptPendingSuggestion,
      setLoadedContentPreview,
      setIsDirty,
      setShowHistory,
      modelCacheRef,
    });

  useEffect(() => {
    if (loadedFilePath === filePath) onDirtyChange?.(filePath, isDirty);
  }, [filePath, isDirty, loadedFilePath, onDirtyChange]);

  const applyIssueDecorations = useCallback((issues: ReviewIssueMarker[]) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const issue of issues) {
      const range = locateEvidence(model, issue.evidence);
      if (!range) continue;
      decorations.push({ range, options: issueDecorationOptions(issue) });
    }
    if (issueDecorationsRef.current) {
      issueDecorationsRef.current.set(decorations);
    } else {
      issueDecorationsRef.current = editor.createDecorationsCollection(decorations);
    }
  }, []);

  // 保存文件：先快照旧内容，再写入新内容。内部函数向上抛错，供 Agent 预读握手阻断读盘。
  const saveCurrentFile = useCallback(async () => {
    const path = filePathRef.current;
    const projectRoot = projectPathRef.current;
    if (!projectRoot || !path || !editorRef.current || isReadOnlyDerivedProjectPath(path)) return;

    const savedModel = editorRef.current.getModel();
    if (!savedModel) return;
    const content = savedModel.getValue();
    const previous = originalContentRef.current;
    const contentChanged = previous !== '' && normalizeEol(previous) !== normalizeEol(content);
    const branch = contentChanged ? getActiveBranchSnapshot() : null;

    await performGuardedWriteback(contentChanged, {
      snapshot: async () =>
        snapshotBeforeWrite(projectRoot, path, previous, {
          source: 'Editor',
          summary: '手动保存前快照',
          branchId: branch?.id,
          branchLabel: branch?.label,
          parentId: branch?.headNodeId,
        }),
      advanceBranchHead: async (timestamp) => {
        await advanceBranchHead(timestamp);
      },
      write: async () => {
        await TauriFileSystem.writeFile(projectRoot, path, content);
      },
      record: async () => undefined,
    });

    const savedState = modelCacheRef.current.get(path);
    if (!savedState || !isRetainedEditorModel(savedModel, savedState.model)) return;
    savedState.originalContent = content;
    const remainsDirty = savedModel.getValue() !== content;
    onDirtyChange?.(path, remainsDirty);
    if (
      canCommitEditorSave(
        path,
        savedModel,
        filePathRef.current,
        editorRef.current?.getModel() ?? null,
      )
    ) {
      originalContentRef.current = content;
      cleanVersionIdRef.current = remainsDirty ? null : savedModel.getAlternativeVersionId();
      setIsDirty(remainsDirty);
    }
  }, [advanceBranchHead, getActiveBranchSnapshot, onDirtyChange]);
  const saveCurrentFileRef = useRef(saveCurrentFile);

  useEffect(() => {
    saveCurrentFileRef.current = saveCurrentFile;
  }, [saveCurrentFile]);

  const handleSave = useCallback(async () => {
    try {
      await saveCurrentFile();
    } catch (err) {
      console.error('保存文件失败:', err);
      await dialogs.alert({
        title: '保存文件失败',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [dialogs, saveCurrentFile]);

  const { editorReady, editorInitError } = useMonacoEditor({
    containerRef,
    editorRef,
    filePath,
    loadedFilePath,
    loadedContent,
    editorFontSize,
    editorFontFamily: resolveEditorFontFamily(editorFontMode),
    filePathRef,
    isDirtyRef,
    autoSaveRef,
    autoSaveTimerRef,
    cleanVersionIdRef,
    originalContentRef,
    setLoadedContentPreview,
    setIsDirty,
    handleSave,
    readOnly,
    loadedIsDirty,
    modelCacheRef,
    retainedFilePaths,
  });

  // 审稿完成后把 issues 标进正文：gutter 圆点 + 词级下划线 + hover 显示问题与建议。
  useEffect(() => {
    const onIssues = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath: string; issues: ReviewIssueMarker[] }>)
        .detail;
      if (!detail || detail.filePath !== filePathRef.current) return;
      applyIssueDecorations(detail.issues);
    };
    window.addEventListener(REVIEW_ISSUES_EVENT, onIssues);
    return () => window.removeEventListener(REVIEW_ISSUES_EVENT, onIssues);
  }, [applyIssueDecorations]);

  // 审稿/修订读盘前，外部请活动编辑器先落盘，避免后端读到未保存的旧内容。
  useEffect(() => {
    const onRequestSave = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      const respond = (detail: SaveActiveFileDoneDetail) =>
        window.dispatchEvent(
          new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
            detail,
          }),
        );
      const requestedFilePath = detail?.filePath ?? null;
      if (
        !detail ||
        detail.filePath !== filePathRef.current ||
        !editorRef.current ||
        !isDirtyRef.current
      ) {
        respond({ filePath: requestedFilePath, status: 'skipped' });
        return;
      }
      void saveCurrentFileRef
        .current()
        .then(() => respond({ filePath: requestedFilePath, status: 'saved' }))
        .catch((error) =>
          respond({
            filePath: requestedFilePath,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    };
    window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
    return () => window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
    // 挂载期只注册一次；保存逻辑经 ref 读取最新文件和分支闭包。
  }, []);

  const handleExport = async () => {
    const path = filePathRef.current;
    const project = projectPathRef.current;
    if (!path || !project || !editorRef.current) return;

    try {
      const result = await exportCurrentFile({
        projectPath: project,
        filePath: path,
        content: editorRef.current.getValue(),
      });
      setSuggestionStatus(`已导出到 ${result.exportPath}`);
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'exported',
        message: `已导出到 ${result.exportPath}`,
        artifactPath: result.exportPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSuggestionStatus(`导出失败: ${message}`);
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'exported',
        message,
      });
    }
  };

  useEffect(() => {
    const onExportCurrent = () => {
      if (!filePathRef.current) return;
      void handleExport();
    };
    window.addEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
    return () => window.removeEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
  }, []);

  // Q3a：编辑区工具行已收进 EditorTabs「…」菜单，历史/分支视图切换改由命令事件驱动
  // （保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE，均沿用既有事件通道）。
  useEffect(() => {
    const onEditorCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command: EditorCommand }>).detail?.command;
      if (command === 'toggle-history') {
        setShowHistory((visible) => !visible);
      } else if (command === 'toggle-branch-view') {
        setRightView((current) => {
          const next = current === 'branch' ? 'files' : 'branch';
          try {
            localStorage.setItem(rightViewStorageKey, next);
          } catch {
            // localStorage 不可用时忽略持久化
          }
          return next;
        });
      }
    };
    window.addEventListener(REQUEST_EDITOR_COMMAND_EVENT, onEditorCommand);
    return () => window.removeEventListener(REQUEST_EDITOR_COMMAND_EVENT, onEditorCommand);
  }, [rightViewStorageKey]);

  // 恢复某个历史版本到编辑器（不立即写盘，标记为脏，由用户确认保存）
  const handleRestore = (content: string) => {
    if (!editorRef.current) return;
    editorRef.current.setValue(content);
    setIsDirty(content !== originalContentRef.current);
    setShowHistory(false);
  };

  // 分支画布：把某节点正文恢复到编辑器（checkout）。
  const handleCheckoutNode = async (node: GraphNode) => {
    try {
      const content = await readVersion(node.path);
      handleRestore(content);
    } catch (err) {
      console.error('读取版本快照失败:', err);
    }
  };

  // 分支画布：从某节点开一条新分支并设为活动分支，随后把该节点正文带入编辑器。
  const handleBranchFromNode = async (node: GraphNode) => {
    const project = projectPathRef.current;
    const path = filePathRef.current;
    if (!project || !path) return;
    const label = await dialogs.prompt({
      title: '新分支',
      message: '输入新分支名称：',
      defaultValue: `分支 @ ${formatTimestamp(node.timestamp)}`,
      confirmLabel: '创建',
    });
    if (label === null) return;
    await createBranchFromNode(node.id, label);
    await handleCheckoutNode(node);
  };

  const emptyStateHint = !projectPath
    ? '打开项目后即可开始编辑'
    : sidebarVisible === false
      ? '展开资源管理器后选择文件'
      : '在资源管理器中双击文件开始编辑';

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="editor-root"
      data-current-file={filePath ?? ''}
      data-render-has-file={filePath ? 'true' : 'false'}
      data-editor-loaded={loadedFilePath === filePath ? 'true' : 'false'}
      data-editor-ready={editorReady ? 'true' : 'false'}
      data-load-attempt-file={loadAttemptFilePath ?? ''}
      data-load-error={loadError}
      data-editor-init-error={editorInitError}
      data-content-preview={loadedContentPreview}
      data-read-only={readOnly ? 'true' : 'false'}
    >
      {rightView === 'files' && !filePath && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-20 flex items-center justify-center bg-background text-muted"
          data-testid="editor-empty"
        >
          <div className="text-center">
            <svg
              className="w-10 h-10 mx-auto mb-3 text-muted/60"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M2 2h7l2 2h3v10H2V2zm1 1v10h10V5h-3l-2-2H3z" />
            </svg>
            <p className="text-base mb-1 text-foreground">未选择文件</p>
            <p className="text-sm">{emptyStateHint}</p>
          </div>
        </div>
      )}

      {rightView === 'branch' && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-20 flex items-center justify-center bg-background px-6 text-center text-sm leading-relaxed text-subtle"
          data-testid="branch-canvas-placeholder"
        >
          剧情分支画布即将接入：保存修改后会记录版本，可在此开分支、对比平行写法。
        </div>
      )}

      {rightView === 'files' && (
        <EditorLoadStatus
          filePath={filePath}
          loadedFilePath={loadedFilePath}
          loadError={loadError}
        />
      )}

      {isReviseLoading && (
        <div
          className="px-3 py-2 border-b border-border bg-panel text-xs text-accent animate-fade-in flex-shrink-0 flex items-center gap-2"
          data-testid="suggestion-loading"
        >
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          正在请求 AI 修订…
        </div>
      )}

      {suggestionStatus && (
        <div
          className={`px-3 py-2 border-b border-border bg-panel text-xs animate-fade-in flex-shrink-0 ${suggestionStatus.startsWith('AI 修订失败') ? 'text-error' : 'text-success'}`}
          data-testid="suggestion-status"
        >
          {suggestionStatus}
        </div>
      )}

      {pendingSuggestion && (
        <PatchReviewPanel
          suggestion={pendingSuggestion}
          onAccept={handleAcceptSuggestion}
          onAcceptHunk={handleAcceptHunk}
          onReject={rejectPendingSuggestion}
          onSaveNote={handleSaveSuggestionNote}
        />
      )}

      {/* Monaco Editor */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        data-testid="editor-container"
      />

      {showHistory &&
        (filePath ? (
          <VersionHistory
            projectPath={projectPath}
            filePath={filePath}
            manifest={branchManifest}
            onRestore={handleRestore}
            onCheckoutNode={handleCheckoutNode}
            onBranchFromNode={handleBranchFromNode}
            onSelectBranch={selectBranch}
            onClose={() => setShowHistory(false)}
          />
        ) : null)}
    </div>
  );
}
