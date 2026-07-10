/**
 * Monaco Editor 编辑器组件
 * 保存时先把磁盘上的旧内容存为版本快照，再写入新内容；提供历史查看与恢复。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import {
  EXPORT_CURRENT_FILE_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  REVIEW_ISSUES_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
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
import { useMonacoEditor } from './editor/useMonacoEditor';
import { useBranchManifest } from './editor/useBranchManifest';
import { useSuggestionWriteback } from './editor/useSuggestionWriteback';
import { formatTimestamp, VersionHistory } from './editor/VersionHistory';
import type { AppDialogApi } from './app/AppDialog';
import { performGuardedWriteback } from '../lib/writeback';

// Monaco 与磁盘原文的换行风格可能不一致（Windows CRLF vs 模型/编辑器 LF）；
// 比较补丁能否写回时按 LF 归一，避免仅换行差异被误判为“内容已变化”而挡住写回。
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

const RIGHT_VIEWS = [
  { id: 'files', label: '文件', icon: '▤', hint: 'Ctrl+P' },
  { id: 'branch', label: '剧情分支画布', icon: '⑂', hint: '' },
] as const;

type RightViewId = (typeof RIGHT_VIEWS)[number]['id'];

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
  autoSave?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  onExportCurrent?: () => void;
  onDirtyChange?: (filePath: string | null, dirty: boolean) => void;
  dialogs: AppDialogApi;
};

export function Editor({
  projectPath,
  filePath,
  editorFontSize = 14,
  autoSave = false,
  onClose,
  onToggleSidebar,
  sidebarVisible,
  onExportCurrent,
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
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const rightViewLabel = RIGHT_VIEWS.find((view) => view.id === rightView)?.label ?? '文件';

  useEffect(() => {
    // 按项目记住上次的右侧视图选择：换项目时恢复，不再要求重新选择。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRightView(readRightView(rightViewStorageKey));
  }, [rightViewStorageKey]);

  const selectRightView = (id: RightViewId) => {
    setRightView(id);
    try {
      localStorage.setItem(rightViewStorageKey, id);
    } catch {
      // localStorage 不可用时忽略持久化
    }
    setViewPickerOpen(false);
  };
  const cleanVersionIdRef = useRef<number | null>(null);
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
  useEffect(() => {
    filePathRef.current = filePath;
    projectPathRef.current = projectPath;
    isDirtyRef.current = isDirty;
    autoSaveRef.current = autoSave;
  });

  useEffect(() => {
    onDirtyChange?.(filePath, isDirty);
  }, [filePath, isDirty, onDirtyChange]);

  const { loadedFilePath, loadedContent, loadAttemptFilePath, loadError } = useEditorFileLoader({
    filePath,
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    issueDecorationsRef,
    filePathRef,
    isDirtyRef,
    autoSaveTimerRef,
    resetSuggestionWriteback,
    adoptPendingSuggestion,
    setLoadedContentPreview,
    setIsDirty,
    setShowHistory,
  });

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
    if (!path || !editorRef.current) return;

    const content = editorRef.current.getValue();
    const previous = originalContentRef.current;
    const contentChanged = previous !== '' && normalizeEol(previous) !== normalizeEol(content);
    const branch = contentChanged ? getActiveBranchSnapshot() : null;

    await performGuardedWriteback(contentChanged, {
      snapshot: async () =>
        snapshotBeforeWrite(projectPathRef.current, path, previous, {
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
        await TauriFileSystem.writeFile(path, content);
      },
      record: async () => undefined,
    });

    originalContentRef.current = content;
    cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
    setIsDirty(false);
  }, [advanceBranchHead, getActiveBranchSnapshot]);

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
    filePathRef,
    isDirtyRef,
    autoSaveRef,
    autoSaveTimerRef,
    cleanVersionIdRef,
    setLoadedContentPreview,
    setIsDirty,
    handleSave,
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
      void saveCurrentFile()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性注册窗口监听；handleSave 经 ref 读取文件路径/编辑器/dirty 态，闭包不读旧值；列入依赖会因其含分支血缘逻辑、每渲染重建为不稳定引用而反复重挂监听
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

  const handleClose = () => {
    onClose();
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
    >
      {rightView === 'files' && !filePath && (
        <div
          className="absolute inset-x-0 top-[var(--sf-bar-height)] bottom-0 z-20 flex items-center justify-center bg-background text-muted"
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
          className="absolute inset-x-0 top-[var(--sf-bar-height)] bottom-0 z-20 flex items-center justify-center bg-background px-6 text-center text-sm leading-relaxed text-subtle"
          data-testid="branch-canvas-placeholder"
        >
          剧情分支画布即将接入：保存修改后会记录版本，可在此开分支、对比平行写法。
        </div>
      )}

      {/* 顶部工具栏 */}
      <div className="sf-panel-header border-border bg-panel">
        <div className="flex min-w-[96px] flex-1 items-center gap-2 overflow-hidden">
          <div className="relative flex-shrink-0">
            <button
              type="button"
              data-testid="right-view-picker"
              onClick={() => setViewPickerOpen((open) => !open)}
              className="sf-toolbar-button"
              title="切换右侧视图"
              aria-expanded={viewPickerOpen}
            >
              {rightViewLabel} ⌄
            </button>
            {viewPickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setViewPickerOpen(false)} />
                <div
                  className="absolute left-0 top-9 z-20 w-56 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
                  data-testid="right-view-menu"
                >
                  {RIGHT_VIEWS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => selectRightView(view.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-elevated hover:text-foreground ${
                        rightView === view.id ? 'text-foreground' : 'text-muted'
                      }`}
                    >
                      <span className="w-4 flex-shrink-0 text-center text-subtle">{view.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{view.label}</span>
                      {view.hint && <span className="text-xs text-subtle">{view.hint}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {rightView === 'files' && (
            <span className="sf-topbar-title" title={filePath ?? undefined}>
              {filePath ? filePath.split(/[/\\]/).pop() : '未打开文件'}
            </span>
          )}
          {rightView === 'files' && isDirty && (
            <span className="text-warning text-lg leading-none" title="未保存的修改">
              ●
            </span>
          )}
        </div>
        <div className="sf-topbar-actions">
          {onExportCurrent && (
            <button
              onClick={handleExport}
              data-testid="editor-export-btn"
              title="导出当前稿"
              className="sf-toolbar-button"
            >
              导出
            </button>
          )}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              data-testid="collapse-file-tree"
              title={sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
              className={`sf-icon-button ${sidebarVisible ? '' : 'bg-foreground/10 text-foreground'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d={sidebarVisible ? 'M6 4l4 4-4 4V4z' : 'M10 4l-4 4 4 4V4z'} />
              </svg>
            </button>
          )}
          <button
            data-testid="editor-history-btn"
            onClick={() => setShowHistory((v) => !v)}
            className="sf-toolbar-button"
            title="查看版本记录"
          >
            历史
          </button>
          <button
            id="editor-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            title="保存 (Ctrl+S)"
            className="sf-toolbar-button disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            保存 (Ctrl+S)
          </button>
          <button
            id="editor-close-btn"
            onClick={handleClose}
            title="关闭文件"
            className="sf-icon-button"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth="1.5" d="M2 2l12 12M2 14L14 2" />
            </svg>
          </button>
        </div>
      </div>

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
