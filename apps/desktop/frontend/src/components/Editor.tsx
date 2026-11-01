/**
 * Monaco Editor 编辑器组件
 * 保存时先把磁盘上的旧内容存为版本快照，再写入新内容；提供历史查看与恢复。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as monaco from 'monaco-editor';
import { emitRetryWithoutKnowledge } from '../lib/assistant-events';
import type { EditorLineNumbersMode } from '../lib/user-settings';
import { recordRevisionLoop } from '../lib/author-loop';
import { emitAuthorLoopResult } from '../lib/assistant-events';
import { PatchReviewPanel } from './PatchReviewPanel';
import { EditorLoadStatus } from './editor/EditorLoadStatus';
import { useEditorFileLoader } from './editor/useEditorFileLoader';
import { useMonacoEditor, type EditorModelCache } from './editor/useMonacoEditor';
import { resolveEditorFontFamily, type EditorFontMode, type ProseMeasure } from './editor/options';
import { useBranchManifest } from './editor/useBranchManifest';
import { useSuggestionWriteback } from './editor/useSuggestionWriteback';
import { useInlineChat } from './editor/useInlineChat';
import { useEditorSave } from './editor/useEditorSave';
import { useReviewIssueMarkers } from './editor/useReviewIssueMarkers';
import { useEditorCursorSync } from './editor/useEditorCursorSync';
import { useEditorWindowCommands } from './editor/useEditorWindowCommands';
import { useVersionRestore } from './editor/useVersionRestore';
import { VersionHistory } from './editor/VersionHistory';
import type { AppDialogApi } from './app/AppDialog';
import { createWritebackQueue, type WritebackQueue } from '../lib/writeback';
import { isReadOnlyDerivedProjectPath } from '../lib/project/entry-visibility';
import type { FileCursor } from '../lib/workspace-session';
import { Folder } from './icons/shell-icons';
import { Button, Spinner } from './ui';

export { EditorLoadStatus };

// Monaco 与磁盘原文的换行风格可能不一致（Windows CRLF vs 模型/编辑器 LF）；
// 比较补丁能否写回时按 LF 归一，避免仅换行差异被误判为“内容已变化”而挡住写回。
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export type EditorPendingSuggestionSummary = {
  projectPath: string;
  filePath: string;
  suggestionId: string;
  requiresConfirmation: boolean;
};

type EditorProps = {
  projectPath: string | null;
  filePath: string | null;
  editorFontSize?: number;
  editorFontMode?: EditorFontMode;
  editorProseMeasure?: ProseMeasure;
  editorLineNumbers?: EditorLineNumbersMode;
  autoSave?: boolean;
  retainedFilePaths?: string[];
  sidebarVisible?: boolean;
  onDirtyChange?: (filePath: string | null, dirty: boolean) => void;
  dialogs: AppDialogApi;
  /** 恢复现场：启动时按文件路径带回的光标位置，只在该文件首次装载时应用一次。 */
  initialCursors?: Record<string, FileCursor> | null;
  onCursorPersist?: (filePath: string, cursor: FileCursor) => void;
  /** 撤销一次「新建」删掉文件后，把该路径从页签里摘掉（同文件树删除那条路）。 */
  dropOpenFilePath?: (path: string) => void;
  onPendingSuggestionChange?: (summary: EditorPendingSuggestionSummary | null) => void;
  /** 打开了项目但中栏没有文件时的去处（接着写停下的那章 / 空书先聊）；不给就用通用提示。 */
  emptyState?: ReactNode;
};

export function Editor({
  projectPath,
  filePath,
  editorFontSize = 14,
  editorFontMode = 'grid',
  editorProseMeasure = 'medium',
  editorLineNumbers = 'auto',
  autoSave = false,
  retainedFilePaths = [],
  sidebarVisible,
  onDirtyChange,
  dialogs,
  initialCursors = null,
  onCursorPersist,
  dropOpenFilePath,
  onPendingSuggestionChange,
  emptyState,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loadedContentPreview, setLoadedContentPreview] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const readOnly = isReadOnlyDerivedProjectPath(filePath);

  const cleanVersionIdRef = useRef<number | null>(null);
  const modelCacheRef = useRef<EditorModelCache>(new Map());
  const dropOpenFilePathRef = useRef(dropOpenFilePath);
  useLayoutEffect(() => {
    dropOpenFilePathRef.current = dropOpenFilePath;
  }, [dropOpenFilePath]);
  // 落盘串行队列：autosave 与 Ctrl+S 并发时按调用顺序依次写盘，防旧内容后落覆盖新内容。
  const [enqueueWriteback] = useState<WritebackQueue>(createWritebackQueue);
  const issueDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveRef = useRef(autoSave);
  // 用 ref 持有最新值，避免 Monaco 命令/回调闭包读到旧状态。
  const originalContentRef = useRef('');
  const filePathRef = useRef<string | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  // 导航、模型切换、卸载或新的恢复请求使旧操作失效，切走再切回也不能复活。
  const restoreOperationRef = useRef(0);
  const {
    branchManifest,
    advanceBranchHead,
    createBranchFromNode,
    getActiveBranchSnapshot,
    selectBranch,
  } = useBranchManifest(projectPath, filePath);
  const {
    adoptPendingSuggestion,
    recoverPendingSuggestion,
    handleAcceptHunk,
    handleAcceptSuggestion,
    handleSaveSuggestionNote,
    handleRetrySuggestion,
    actionState,
    actionError,
    actionErrorCause,
    truncationAcceptArmed,
    cancelTruncatedAccept,
    isReviseLoading,
    pendingSuggestion,
    rejectPendingSuggestion,
    resetSuggestionWriteback,
    setSuggestionStatus,
    writeAcceptedSuggestion,
  } = useSuggestionWriteback({
    enqueueWriteback,
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    filePathRef,
    projectPathRef,
    modelCacheRef,
    setLoadedContentPreview,
    setIsDirty,
    normalizeEol,
    getActiveBranchSnapshot,
    advanceBranchHead,
    recordRevisionLoop,
    emitAuthorLoopResult,
    dropOpenFilePath,
    onRequestVersionHistory: () => setShowHistory(true),
  });

  // 每次渲染后同步最新值到 ref（见上注释），供 Monaco 命令/回调闭包读取最新状态。
  useLayoutEffect(() => {
    filePathRef.current = filePath;
    projectPathRef.current = projectPath;
    isDirtyRef.current = isDirty;
    autoSaveRef.current = autoSave;
  });

  useLayoutEffect(() => {
    restoreOperationRef.current += 1;
    return () => {
      restoreOperationRef.current += 1;
    };
  }, [projectPath, filePath]);

  const {
    loadedFilePath,
    loadedContent,
    loadedDiskBaseline,
    loadedIsDirty,
    loadAttemptFilePath,
    loadError,
    retry: retryFileLoad,
  } = useEditorFileLoader({
    filePath,
    originalContentRef,
    issueDecorationsRef,
    filePathRef,
    projectPathRef,
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

  useEffect(() => {
    if (!onPendingSuggestionChange) return;
    onPendingSuggestionChange(
      pendingSuggestion && projectPath && filePath
        ? {
            projectPath,
            filePath,
            suggestionId: pendingSuggestion.id,
            requiresConfirmation: pendingSuggestion.requiresConfirmation !== false,
          }
        : null,
    );
  }, [filePath, onPendingSuggestionChange, pendingSuggestion, projectPath]);

  const { saveCurrentFileRef, handleSave } = useEditorSave({
    editorRef,
    filePathRef,
    projectPathRef,
    modelCacheRef,
    originalContentRef,
    cleanVersionIdRef,
    enqueueWriteback,
    getActiveBranchSnapshot,
    advanceBranchHead,
    onDirtyChange,
    setIsDirty,
    dialogs,
  });

  const { editorReady, editorInitError } = useMonacoEditor({
    containerRef,
    editorRef,
    filePath,
    loadedFilePath,
    loadedContent,
    loadedDiskBaseline,
    editorFontSize,
    editorFontMode,
    editorLineNumbers,
    editorProseMeasure,
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

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return;
    const subscription = editor.onDidChangeModel?.(() => {
      restoreOperationRef.current += 1;
    });
    return () => {
      restoreOperationRef.current += 1;
      subscription?.dispose();
    };
  }, [editorReady]);

  useEffect(() => {
    if (editorReady && loadedFilePath === filePath) void recoverPendingSuggestion(filePath);
  }, [editorReady, filePath, loadedFilePath, projectPath, recoverPendingSuggestion]);

  // 行间对话（Ctrl+K）：编辑聚焦下就地改稿，接受收敛到同一套守卫写回。
  useInlineChat({
    editorRef,
    editorReady,
    filePath,
    filePathRef,
    projectPathRef,
    projectName: null,
    writeAcceptedSuggestion,
    setSuggestionStatus,
  });

  useReviewIssueMarkers({
    editorRef,
    editorReady,
    filePathRef,
    issueDecorationsRef,
    loadedFilePath,
  });

  useEditorCursorSync({
    editorRef,
    editorReady,
    filePath,
    filePathRef,
    loadedFilePath,
    initialCursors,
    onCursorPersist,
    setSuggestionStatus,
  });

  useEditorWindowCommands({
    editorRef,
    filePathRef,
    projectPathRef,
    modelCacheRef,
    isDirtyRef,
    saveCurrentFileRef,
    setShowHistory,
  });

  const { handleRestore, handleCheckoutNode, handleBranchFromNode } = useVersionRestore({
    projectPath,
    filePath,
    editorReady,
    loadedFilePath,
    dropOpenFilePath,
    dialogs,
    editorRef,
    projectPathRef,
    filePathRef,
    modelCacheRef,
    restoreOperationRef,
    isDirtyRef,
    originalContentRef,
    dropOpenFilePathRef,
    saveCurrentFileRef,
    getActiveBranchSnapshot,
    advanceBranchHead,
    createBranchFromNode,
    setLoadedContentPreview,
    setIsDirty,
    setShowHistory,
  });

  const emptyStateHint = !projectPath
    ? '打开作品后即可开始编辑'
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
      {!filePath && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-20 flex items-center justify-center bg-background text-muted"
          data-testid="editor-empty"
        >
          {projectPath && emptyState ? (
            emptyState
          ) : (
            <div className="text-center">
              <Folder size={40} strokeWidth={1.4} className="mx-auto mb-3 text-muted/60" />
              <p className="text-base mb-1 text-foreground">未选择文件</p>
              <p className="text-sm">{emptyStateHint}</p>
            </div>
          )}
        </div>
      )}

      {/* 编辑器构建失败此前只写进 data-editor-init-error 属性、界面上什么都不显示：
          作者看到的是一整块空白中栏，不知道出了什么事，也不知道能做什么。 */}
      {editorInitError && (
        <div
          className="absolute inset-x-0 top-0 bottom-0 z-30 flex items-center justify-center bg-background px-6"
          data-testid="editor-init-error"
          role="alert"
        >
          <div className="max-w-md text-center">
            <p className="text-sm text-error">编辑器未能启动</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              正文没有丢失，磁盘上的文件未被改动。重新载入界面通常可以恢复。
            </p>
            <p className="mt-2 break-words text-2xs leading-relaxed text-subtle">
              {editorInitError}
            </p>
            <Button onClick={() => window.location.reload()} className="mt-3">
              重新载入界面
            </Button>
          </div>
        </div>
      )}

      <EditorLoadStatus
        filePath={filePath}
        loadedFilePath={loadedFilePath}
        loadError={loadError}
        onRetry={retryFileLoad}
      />

      {isReviseLoading && (
        <div
          className="px-3 py-2 border-b border-border bg-panel text-xs text-agent animate-fade-in flex-shrink-0 flex items-center gap-2"
          data-testid="suggestion-loading"
        >
          <Spinner size={12} />
          正在请求 AI 修订…
        </div>
      )}

      {/* Monaco Editor：编辑区始终铺满；行长由 Monaco bounded 换行控制，不限宽居中 */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        data-testid="editor-container"
        data-prose-measure={editorProseMeasure}
      />

      {/* AI 修订确认面板：贴在正文下方（原先在编辑器上方，观感割裂，#7）。 */}
      {pendingSuggestion &&
        loadedFilePath === filePath &&
        pendingSuggestion.filePath === filePath && (
          <PatchReviewPanel
            suggestion={pendingSuggestion}
            projectPath={projectPath}
            actionKind={actionState?.kind ?? null}
            error={actionError}
            errorCause={actionErrorCause}
            editorFontSize={editorFontSize}
            editorFontFamily={resolveEditorFontFamily(editorFontMode)}
            truncationArmed={truncationAcceptArmed}
            onCancelTruncatedAccept={cancelTruncatedAccept}
            onAccept={handleAcceptSuggestion}
            onAcceptHunk={handleAcceptHunk}
            onReject={rejectPendingSuggestion}
            onSaveNote={handleSaveSuggestionNote}
            onRetryWithoutKnowledge={(knowledgeId, relativePath) =>
              handleRetrySuggestion(() =>
                emitRetryWithoutKnowledge({
                  projectPath: projectPath ?? undefined,
                  filePath: filePath ?? undefined,
                  knowledgeId,
                  relativePath,
                  goal: pendingSuggestion.userIntent ?? '重新修订当前文件',
                }),
              )
            }
          />
        )}

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
            getCurrentContent={() => editorRef.current?.getValue() ?? ''}
          />
        ) : null)}
    </div>
  );
}
