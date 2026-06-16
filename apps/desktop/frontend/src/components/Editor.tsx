/**
 * Monaco Editor 编辑器组件
 * 保存时先把磁盘上的旧内容存为版本快照，再写入新内容；提供历史查看与恢复。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import {
  APPLY_FILE_SUGGESTION_EVENT,
  REQUEST_FILE_SUGGESTION_EVENT,
  emitSuggestionResult,
  type FileSuggestionRequest,
} from '../lib/assistant-events';
import { createRemoteFileSuggestion } from '../lib/assistant-suggestions';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { requestRevision } from '../lib/api-client';
import { TauriFileSystem } from '../lib/tauri-fs';
import { listVersions, readVersion, snapshotBeforeWrite, VersionEntry } from '../lib/versions';

type EditorProps = {
  projectPath: string | null;
  filePath: string | null;
  onClose: () => void;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
};

export function Editor({ projectPath, filePath, onClose, onToggleSidebar, sidebarVisible }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const loadRequestIdRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState('');
  const [loadedContentPreview, setLoadedContentPreview] = useState('');
  const [loadAttemptFilePath, setLoadAttemptFilePath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editorInitError, setEditorInitError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<AssistantFileSuggestion | null>(null);
  const [suggestionStatus, setSuggestionStatus] = useState('');
  const [isReviseLoading, setIsReviseLoading] = useState(false);
  const assistantSessionIdRef = useRef<number | null>(null);
  const cleanVersionIdRef = useRef<number | null>(null);

  // 用 ref 持有最新值，避免 Monaco 命令/回调闭包读到旧状态。
  const originalContentRef = useRef('');
  const filePathRef = useRef<string | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  filePathRef.current = filePath;
  projectPathRef.current = projectPath;
  isDirtyRef.current = isDirty;

  // 加载文件内容
  useLayoutEffect(() => {
    loadRequestIdRef.current += 1;
    const requestId = loadRequestIdRef.current;

    if (!filePath) {
      originalContentRef.current = '';
      setLoadedFilePath(null);
      setLoadedContent('');
      setLoadedContentPreview('');
      setLoadAttemptFilePath(null);
      setLoadError('');
      setShowHistory(false);
      setPendingSuggestion(null);
      setSuggestionStatus('');
      setIsReviseLoading(false);
      setIsDirty(false);
      editorRef.current?.setValue('');
      return;
    }

    setLoadAttemptFilePath(filePath);
    setLoadedFilePath(null);
    setLoadedContent('');
    setLoadedContentPreview('');
    setLoadError('');
    setShowHistory(false);
    setPendingSuggestion(null);
    setSuggestionStatus('');
    setIsReviseLoading(false);

    const loadFile = async () => {
      try {
        const content = await TauriFileSystem.readFile(filePath);
        if (loadRequestIdRef.current !== requestId || filePathRef.current !== filePath) {
          return;
        }
        originalContentRef.current = content;
        setLoadedContent(content);
        if (editorRef.current) {
          editorRef.current.setValue(content);
          cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
        }
        setIsDirty(false);
        setLoadedFilePath(filePath);
        setLoadedContentPreview(content.slice(0, 120));
      } catch (err) {
        if (loadRequestIdRef.current !== requestId || filePathRef.current !== filePath) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error('读取文件失败:', err);
        setLoadError(message);
      }
    };

    void loadFile();
  }, [filePath]);

  // 初始化编辑器
  useEffect(() => {
    if (editorRef.current) return;

    let disposed = false;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let frame = 0;

    frame = window.requestAnimationFrame(() => {
      if (disposed || !containerRef.current || editorRef.current) return;

      try {
        editor = monaco.editor.create(containerRef.current, {
          value: loadedContent,
          language: 'markdown',
          theme: 'vs-dark',
          fontSize: 14,
          lineNumbers: 'on',
          minimap: { enabled: true },
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
        });
        cleanVersionIdRef.current = editor.getModel()?.getAlternativeVersionId() ?? null;
      } catch (err) {
        setEditorInitError(err instanceof Error ? err.message : String(err));
        return;
      }

      editorRef.current = editor;
      setEditorReady(true);
      setEditorInitError('');

      editor.onDidChangeModelContent(() => {
        const model = editorRef.current?.getModel();
        if (filePathRef.current && model) {
          setIsDirty(model.getAlternativeVersionId() !== cleanVersionIdRef.current);
        }
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (filePathRef.current && isDirtyRef.current) {
          void handleSave();
        }
      });
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      editor?.dispose();
      editorRef.current = null;
      setEditorReady(false);
    };
  }, []);

  useEffect(() => {
    if (!editorReady || !editorRef.current || loadedFilePath !== filePath) return;
    editorRef.current.setValue(loadedContent);
    cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
  }, [editorReady, filePath, loadedContent, loadedFilePath]);

  // 接收中间 AI 交互区生成的文件建议补丁。
  useEffect(() => {
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion || suggestion.filePath !== filePathRef.current) return;
      setPendingSuggestion(suggestion);
      setSuggestionStatus('');
    };
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<FileSuggestionRequest>).detail;
      const path = filePathRef.current;
      if (!request || !path || request.filePath !== path || !editorRef.current) return;
      const content = editorRef.current.getValue();
      const project = projectPathRef.current;
      const projectName = project ? project.split(/[/\\]/).pop() ?? null : null;

      setPendingSuggestion(null);
      setSuggestionStatus('正在请求 AI 修订…');
      setIsReviseLoading(true);

      void (async () => {
        try {
          const result = await requestRevision({
            filePath: path,
            content,
            instruction: request.userIntent,
            projectName,
            assistantSessionId: assistantSessionIdRef.current,
          });
          assistantSessionIdRef.current = result.assistantSessionId;
          // 文件在请求期间被切换则丢弃结果，避免把建议套到别的文件上。
          if (filePathRef.current !== path) return;
          const suggestion = createRemoteFileSuggestion({
            filePath: path,
            before: result.before,
            after: result.after,
            summary: result.summary,
            model: result.model,
            userIntent: request.userIntent,
          });
          setPendingSuggestion(suggestion);
          setSuggestionStatus('');
          emitSuggestionResult({ filePath: path, status: 'ready', message: result.summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (filePathRef.current === path) {
            setSuggestionStatus(`AI 修订失败：${message}`);
          }
          emitSuggestionResult({ filePath: path, status: 'error', message });
        } finally {
          if (filePathRef.current === path) {
            setIsReviseLoading(false);
          }
        }
      })();
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    window.addEventListener(REQUEST_FILE_SUGGESTION_EVENT, onRequest);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
      window.removeEventListener(REQUEST_FILE_SUGGESTION_EVENT, onRequest);
    };
  }, []);

  // 保存文件：先快照旧内容，再写入新内容
  const handleSave = async () => {
    const path = filePathRef.current;
    if (!path || !editorRef.current) return;

    try {
      const content = editorRef.current.getValue();
      const previous = originalContentRef.current;
      if (previous !== '' && previous !== content) {
        try {
          await snapshotBeforeWrite(projectPathRef.current, path, previous);
        } catch (snapshotErr) {
          console.error('写入版本快照失败:', snapshotErr);
        }
      }
      await TauriFileSystem.writeFile(path, content);
      originalContentRef.current = content;
      cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
      setIsDirty(false);
    } catch (err) {
      console.error('保存文件失败:', err);
      alert(`保存文件失败: ${err}`);
    }
  };

  const handleAcceptSuggestion = async () => {
    const suggestion = pendingSuggestion;
    const path = filePathRef.current;
    if (!suggestion || !path || !editorRef.current) return;

    try {
      const previous = originalContentRef.current;
      if (previous !== suggestion.after) {
        try {
          await snapshotBeforeWrite(projectPathRef.current, path, previous);
        } catch (snapshotErr) {
          console.error('写入版本快照失败:', snapshotErr);
        }
      }
      await TauriFileSystem.writeFile(path, suggestion.after);
      editorRef.current.setValue(suggestion.after);
      originalContentRef.current = suggestion.after;
      cleanVersionIdRef.current = editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
      setLoadedContentPreview(suggestion.after.slice(0, 120));
      setIsDirty(false);
      setPendingSuggestion(null);
      setSuggestionStatus('已接受并写入当前文件');
    } catch (err) {
      setSuggestionStatus(`接受失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSaveSuggestionNote = async () => {
    const suggestion = pendingSuggestion;
    const project = projectPathRef.current;
    if (!suggestion || !project) return;

    try {
      const separator = project.includes('\\') ? '\\' : '/';
      const fileName = suggestion.filePath.split(/[/\\]/).pop() ?? 'file';
      const notePath = [
        project.replace(/[/\\]+$/, ''),
        '.storyforge',
        'notes',
        `${Date.now()}-${fileName}.md`,
      ].join(separator);
      const note = [
        `# ${suggestion.title}`,
        '',
        `- 文件：${suggestion.filePath}`,
        `- 时间：${new Date(suggestion.createdAt).toISOString()}`,
        '',
        '## 摘要',
        '',
        suggestion.summary,
        '',
        '## 旁注',
        '',
        suggestion.note,
        '',
        '## 当前内容摘录',
        '',
        '```markdown',
        suggestion.before.slice(0, 2000),
        suggestion.before.length > 2000 ? '...' : '',
        '```',
        '',
        '## 建议后摘录',
        '',
        '```markdown',
        suggestion.after.slice(0, 2000),
        suggestion.after.length > 2000 ? '...' : '',
        '```',
      ].join('\n');
      await TauriFileSystem.writeFile(notePath, note);
      setPendingSuggestion(null);
      setSuggestionStatus(`已保存旁注: ${notePath}`);
    } catch (err) {
      setSuggestionStatus(`保存旁注失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 恢复某个历史版本到编辑器（不立即写盘，标记为脏，由用户确认保存）
  const handleRestore = (content: string) => {
    if (!editorRef.current) return;
    editorRef.current.setValue(content);
    setIsDirty(content !== originalContentRef.current);
    setShowHistory(false);
  };

  const handleClose = () => {
    if (isDirty) {
      const confirmed = confirm('文件有未保存的修改，确定关闭吗？');
      if (!confirmed) return;
    }
    onClose();
  };

  return (
    <div
      className="h-full flex flex-col bg-background relative"
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
      {!filePath && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background text-muted" data-testid="editor-empty">
          <div className="text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-base mb-1 text-foreground">未打开文件</p>
            <p className="text-sm">从右侧文件树选择一个文件</p>
          </div>
        </div>
      )}

      {/* 顶部工具栏 */}
      <div className="h-10 px-3 border-b border-border flex items-center justify-between bg-panel flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate max-w-md" title={filePath ?? undefined}>
            {filePath ? filePath.split(/[/\\]/).pop() : '未打开文件'}
          </span>
          {isDirty && <span className="text-warning text-lg leading-none" title="未保存的修改">●</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              title={sidebarVisible ? "收起侧边栏" : "展开侧边栏"}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${sidebarVisible ? 'text-muted hover:text-foreground hover:bg-foreground/10' : 'text-foreground bg-foreground/10 hover:bg-foreground/20'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarVisible ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
              </svg>
            </button>
          )}
          <button
            data-testid="editor-history-btn"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-foreground/10 transition-colors"
            title="查看版本记录"
          >
            历史
          </button>
          <button
            id="editor-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            保存 (Ctrl+S)
          </button>
          <button
            onClick={handleClose}
            title="关闭文件"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {isReviseLoading && (
        <div className="px-3 py-2 border-b border-border bg-panel text-xs text-accent animate-fade-in flex-shrink-0 flex items-center gap-2" data-testid="suggestion-loading">
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
        <SuggestionReviewPanel
          suggestion={pendingSuggestion}
          onAccept={handleAcceptSuggestion}
          onReject={() => {
            setPendingSuggestion(null);
            setSuggestionStatus('已拒绝建议补丁');
          }}
          onSaveNote={handleSaveSuggestionNote}
        />
      )}

      {/* Monaco Editor */}
      <div ref={containerRef} className="flex-1" data-testid="editor-container" />

      {showHistory && (
        filePath ? (
          <VersionHistory
            projectPath={projectPath}
            filePath={filePath}
            onRestore={handleRestore}
            onClose={() => setShowHistory(false)}
          />
        ) : null
      )}
    </div>
  );
}

function SuggestionReviewPanel({
  suggestion,
  onAccept,
  onReject,
  onSaveNote,
}: {
  suggestion: AssistantFileSuggestion;
  onAccept: () => void;
  onReject: () => void;
  onSaveNote: () => void;
}) {
  return (
    <div className="border-b border-border bg-surface animate-slide-up-fade flex-shrink-0" data-testid="suggestion-review">
      <div className="px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-warning">{suggestion.title}</p>
          <p className="mt-1 text-xs text-muted">{suggestion.summary}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onAccept}
            data-testid="suggestion-accept"
            className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 transition-opacity"
          >
            接受
          </button>
          <button
            onClick={onSaveNote}
            data-testid="suggestion-note"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-foreground/10 transition-colors"
          >
            保存旁注
          </button>
          <button
            onClick={onReject}
            data-testid="suggestion-reject"
            className="text-xs px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            拒绝
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border text-xs">
        <DiffColumn title="当前内容" content={suggestion.before} tone="before" />
        <DiffColumn title="建议后" content={suggestion.after} tone="after" />
      </div>
    </div>
  );
}

function DiffColumn({
  title,
  content,
  tone,
}: {
  title: string;
  content: string;
  tone: 'before' | 'after';
}) {
  return (
    <div className={`min-w-0 border-r last:border-r-0 border-border ${tone === 'after' ? 'bg-success/[0.06]' : 'bg-error/[0.05]'}`}>
      <div className={`px-3 py-1.5 font-semibold ${tone === 'after' ? 'text-success' : 'text-muted'}`}>
        {title}
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 pb-3 text-[11px] leading-5 text-foreground">
        {content.slice(0, 2400)}
        {content.length > 2400 ? '\n...' : ''}
      </pre>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function VersionHistory({
  projectPath,
  filePath,
  onRestore,
  onClose,
}: {
  projectPath: string | null;
  filePath: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listVersions(projectPath, filePath);
        if (!cancelled) setVersions(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取版本失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, filePath]);

  const restore = async (snapshotPath: string) => {
    setBusy(true);
    try {
      const content = await readVersion(snapshotPath);
      onRestore(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复版本失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute top-10 right-0 bottom-0 w-80 bg-panel border-l border-border flex flex-col shadow-2xl z-30 animate-slide-up-fade" data-testid="version-history">
      <div className="h-10 px-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-sm font-semibold">版本记录</span>
        <button
          onClick={onClose}
          title="关闭"
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/10 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {error ? (
          <p className="text-sm text-error p-2">{error}</p>
        ) : versions === null ? (
          <p className="text-sm text-muted p-2">加载中...</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted p-2">还没有历史版本。保存修改后会自动记录。</p>
        ) : (
          versions.map((v) => (
            <div
              key={v.path}
              className="rounded-md border border-border bg-surface p-2 flex items-center justify-between gap-2"
            >
              <span className="text-xs text-foreground truncate" title={formatTimestamp(v.timestamp)}>
                {formatTimestamp(v.timestamp)}
              </span>
              <button
                disabled={busy}
                onClick={() => restore(v.path)}
                className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 disabled:opacity-40 flex-shrink-0 transition-opacity"
              >
                恢复
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
