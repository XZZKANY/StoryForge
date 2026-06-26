/**
 * Monaco Editor 编辑器组件
 * 保存时先把磁盘上的旧内容存为版本快照，再写入新内容；提供历史查看与恢复。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  EXPORT_CURRENT_FILE_EVENT,
  emitReviseIssue,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  REVIEW_ISSUES_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
  SUGGESTION_RESULT_EVENT,
  type ReviewIssueMarker,
  type SuggestionResult,
} from '../lib/assistant-events';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { TauriFileSystem } from '../lib/tauri-fs';
import { listVersions, readVersion, snapshotBeforeWrite, VersionEntry } from '../lib/versions';
import { exportCurrentFile, recordRevisionLoop } from '../lib/author-loop';
import { emitAuthorLoopResult } from '../lib/assistant-events';
import { PatchReviewPanel } from './PatchReviewPanel';
import { registerSmokeEditorController } from '../lib/smoke';
import { applyPatchHunk, type PatchHunk } from '../lib/patch-hunks';

// Monaco 与磁盘原文的换行风格可能不一致（Windows CRLF vs 模型/编辑器 LF）；
// 比较补丁能否写回时按 LF 归一，避免仅换行差异被误判为“内容已变化”而挡住写回。
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

const ISSUE_SEVERITY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#60a5fa',
};

function normalizeIssueSeverity(severity: string): 'high' | 'medium' | 'low' {
  return severity === 'high' || severity === 'low' ? severity : 'medium';
}

// 审稿 issue 只带 evidence 文本、无字符范围；按 evidence 在正文里就近定位一个范围用于打标记。
function locateEvidence(model: monaco.editor.ITextModel, evidence: string): monaco.IRange | null {
  const cleaned = evidence
    .replace(/\.{3,}$/, '')
    .replace(/^[\s"'「『（(]+|[\s"'」』）)]+$/g, '')
    .trim();
  const candidates = [cleaned, cleaned.slice(0, 40), cleaned.slice(0, 20)];
  for (const candidate of candidates) {
    if (candidate.length < 4) continue;
    const matches = model.findMatches(candidate, false, false, false, null, false, 1);
    if (matches.length > 0) return matches[0].range;
  }
  return null;
}

function issueDecorationOptions(issue: ReviewIssueMarker): monaco.editor.IModelDecorationOptions {
  const severity = normalizeIssueSeverity(issue.severity);
  const hover = {
    value: `**[${issue.id}] ${issue.severity}** ${issue.message}\n\n建议：${issue.suggestedAction}`,
  };
  return {
    className: `sf-issue-underline sf-issue-${severity}`,
    glyphMarginClassName: `sf-issue-glyph sf-issue-glyph-${severity}`,
    glyphMarginHoverMessage: hover,
    hoverMessage: hover,
    overviewRuler: {
      color: ISSUE_SEVERITY_COLOR[severity],
      position: monaco.editor.OverviewRulerLane.Right,
    },
  };
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
}: EditorProps) {
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
  const pendingSuggestionRef = useRef<AssistantFileSuggestion | null>(null);
  const cleanVersionIdRef = useRef<number | null>(null);
  const issueDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const issueByLineRef = useRef<Map<number, string>>(new Map());
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveRef = useRef(autoSave);

  // 用 ref 持有最新值，避免 Monaco 命令/回调闭包读到旧状态。
  const originalContentRef = useRef('');
  const filePathRef = useRef<string | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  // 每次渲染后同步最新值到 ref（见上注释），供 Monaco 命令/回调闭包读取最新状态。
  useEffect(() => {
    filePathRef.current = filePath;
    projectPathRef.current = projectPath;
    isDirtyRef.current = isDirty;
    pendingSuggestionRef.current = pendingSuggestion;
    autoSaveRef.current = autoSave;
  });

  const applyIssueDecorations = useCallback((issues: ReviewIssueMarker[]) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const issueByLine = new Map<number, string>();
    for (const issue of issues) {
      const range = locateEvidence(model, issue.evidence);
      if (!range) continue;
      decorations.push({ range, options: issueDecorationOptions(issue) });
      issueByLine.set(range.startLineNumber, issue.id);
    }
    issueByLineRef.current = issueByLine;
    if (issueDecorationsRef.current) {
      issueDecorationsRef.current.set(decorations);
    } else {
      issueDecorationsRef.current = editor.createDecorationsCollection(decorations);
    }
  }, []);

  // 加载文件内容
  useLayoutEffect(() => {
    loadRequestIdRef.current += 1;
    const requestId = loadRequestIdRef.current;
    issueDecorationsRef.current?.clear();

    if (!filePath) {
      originalContentRef.current = '';
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filePath 清空时同步重置加载态，React18 合法模式
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
          cleanVersionIdRef.current =
            editorRef.current.getModel()?.getAlternativeVersionId() ?? null;
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
          fontSize: editorFontSize,
          lineNumbers: 'on',
          glyphMargin: true,
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
          const dirty = model.getAlternativeVersionId() !== cleanVersionIdRef.current;
          setIsDirty(dirty);
          if (autoSaveRef.current && dirty) {
            if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = window.setTimeout(() => {
              // eslint-disable-next-line react-hooks/immutability -- 自动保存定时器回调，非渲染期触发保存
              if (filePathRef.current && editorRef.current) void handleSave();
            }, 900);
          }
        }
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (filePathRef.current && isDirtyRef.current) {
          void handleSave();
        }
      });

      editor.onMouseDown((event) => {
        if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const lineNumber = event.target.position?.lineNumber;
        if (!lineNumber) return;
        const issueId = issueByLineRef.current.get(lineNumber);
        if (issueId) emitReviseIssue(issueId);
      });
    });

    return () => {
      disposed = true;
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      window.cancelAnimationFrame(frame);
      editor?.dispose();
      editorRef.current = null;
      setEditorReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性创建 Monaco 实例，仅取 loadedContent/editorFontSize 初始值；二者后续变化分别由下方 fontSize updateOptions effect 和 loadedContent setValue effect 接管，列入依赖会销毁重建编辑器、丢失光标与撤销历史
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  useEffect(
    () =>
      registerSmokeEditorController({
        setContent(content: string) {
          if (!editorRef.current) return false;
          editorRef.current.setValue(content);
          setLoadedContentPreview(content.slice(0, 120));
          return true;
        },
        getContent() {
          return editorRef.current?.getValue() ?? null;
        },
      }),
    [],
  );

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
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, []);

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

  // 保存文件：先快照旧内容，再写入新内容
  const handleSave = async () => {
    const path = filePathRef.current;
    if (!path || !editorRef.current) return;

    try {
      const content = editorRef.current.getValue();
      const previous = originalContentRef.current;
      if (previous !== '' && normalizeEol(previous) !== normalizeEol(content)) {
        try {
          await snapshotBeforeWrite(projectPathRef.current, path, previous, {
            source: 'Editor',
            summary: '手动保存前快照',
          });
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

  // 审稿/修订读盘前，外部请活动编辑器先落盘，避免后端读到未保存的旧内容。
  useEffect(() => {
    const onRequestSave = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      const respond = () =>
        window.dispatchEvent(
          new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
            detail: { filePath: detail?.filePath ?? null },
          }),
        );
      if (
        !detail ||
        detail.filePath !== filePathRef.current ||
        !editorRef.current ||
        !isDirtyRef.current
      ) {
        respond();
        return;
      }
      void handleSave().finally(respond);
    };
    window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
    return () => window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequestSave);
  }, []);

  const writeAcceptedSuggestion = async (
    suggestion: AssistantFileSuggestion,
    path: string,
    previous: string,
    nextContent: string,
    overrides: { summary?: string; note?: string } = {},
  ) => {
    const summary = overrides.summary ?? suggestion.summary;
    const note = overrides.note ?? suggestion.note;
    if (normalizeEol(previous) !== normalizeEol(nextContent)) {
      try {
        await snapshotBeforeWrite(projectPathRef.current, path, previous, {
          source: 'Agent',
          summary,
          patchId: suggestion.id,
          assistantSessionId: suggestion.assistantSessionId ?? assistantSessionIdRef.current,
          issueIds: suggestion.issueIds,
          contextFiles: suggestion.contextFiles,
        });
      } catch (snapshotErr) {
        console.error('写入版本快照失败:', snapshotErr);
      }
    }
    await TauriFileSystem.writeFile(path, nextContent);
    const loopRecord = await recordRevisionLoop({
      projectPath: projectPathRef.current,
      filePath: path,
      before: previous,
      after: nextContent,
      summary,
      note,
      userIntent: note.split('\n')[0]?.replace(/^用户意图：/, '') ?? '审查并改进当前文件',
      assistantSessionId: suggestion.assistantSessionId ?? assistantSessionIdRef.current,
      patchId: suggestion.id,
      issueIds: suggestion.issueIds,
      contextFiles: suggestion.contextFiles,
    });
    editorRef.current?.setValue(nextContent);
    originalContentRef.current = nextContent;
    cleanVersionIdRef.current = editorRef.current?.getModel()?.getAlternativeVersionId() ?? null;
    setLoadedContentPreview(nextContent.slice(0, 120));
    setIsDirty(false);
    return loopRecord;
  };

  const handleAcceptSuggestion = async () => {
    const suggestion = pendingSuggestionRef.current;
    const path = filePathRef.current;
    if (!suggestion || !path || !editorRef.current) {
      emitAuthorLoopResult({
        filePath: path ?? '',
        status: 'error',
        action: 'revision_accepted',
        message: '当前没有待写回的修订。',
      });
      return;
    }

    try {
      const currentContent = editorRef.current.getValue();
      if (normalizeEol(currentContent) !== normalizeEol(suggestion.before)) {
        const message = '当前文件内容已变化，旧补丁不能直接写回。请重新生成修订，或手动处理冲突。';
        setSuggestionStatus(message);
        emitAuthorLoopResult({
          filePath: path,
          status: 'error',
          action: 'revision_accepted',
          message,
        });
        return;
      }

      const loopRecord = await writeAcceptedSuggestion(
        suggestion,
        path,
        currentContent,
        suggestion.after,
      );
      setPendingSuggestion(null);
      setSuggestionStatus(
        loopRecord.recordPath ? `已接受并写入当前文件，闭环记录已保存` : '已接受并写入当前文件',
      );
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'revision_accepted',
        message: loopRecord.recordPath ? '修订已写回并记录闭环' : '修订已写回',
        recordPath: loopRecord.recordPath ?? undefined,
      });
    } catch (err) {
      setSuggestionStatus(`接受失败: ${err instanceof Error ? err.message : String(err)}`);
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'revision_accepted',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleAcceptHunk = async (hunk: PatchHunk) => {
    const suggestion = pendingSuggestionRef.current;
    const path = filePathRef.current;
    if (!suggestion || !path || !editorRef.current) {
      setSuggestionStatus('当前没有待写回的修订。');
      return;
    }

    try {
      const currentContent = editorRef.current.getValue();
      if (normalizeEol(currentContent) !== normalizeEol(suggestion.before)) {
        setSuggestionStatus('当前文件内容已变化，请重新生成修订后再分块接受。');
        return;
      }
      const nextContent = applyPatchHunk(suggestion.before, suggestion.after, hunk);
      const loopRecord = await writeAcceptedSuggestion(
        suggestion,
        path,
        currentContent,
        nextContent,
        {
          summary: `${suggestion.summary}（接受分块）`,
          note: `${suggestion.note}\n\n分块接受：第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`,
        },
      );
      if (normalizeEol(nextContent) === normalizeEol(suggestion.after)) {
        setPendingSuggestion(null);
      } else {
        setPendingSuggestion({ ...suggestion, before: nextContent });
      }
      setSuggestionStatus(
        loopRecord.recordPath
          ? '已接受该修改块并写入当前文件，剩余修改仍可继续确认'
          : '已接受该修改块并写入当前文件',
      );
    } catch (err) {
      setSuggestionStatus(`接受分块失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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
    const onSuggestionResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      const path = filePathRef.current;
      if (!result || !path || result.filePath !== path) return;
      setIsReviseLoading(false);
      setSuggestionStatus(result.status === 'ready' ? '' : `AI 修订失败：${result.message}`);
      if (result.assistantSessionId) {
        assistantSessionIdRef.current = result.assistantSessionId;
      }
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
  }, []);

  useEffect(() => {
    const onExportCurrent = () => {
      if (!filePathRef.current) return;
      void handleExport();
    };
    window.addEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
    return () => window.removeEventListener(EXPORT_CURRENT_FILE_EVENT, onExportCurrent);
  }, []);

  useEffect(() => {
    const onAcceptCurrentSuggestion = () => {
      void handleAcceptSuggestion();
    };
    window.addEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
    return () =>
      window.removeEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性注册窗口监听；handleAcceptSuggestion 经 ref 读取待写回补丁/文件路径，闭包不读旧值；列入依赖会因其每渲染重建（现调用抽出的 writeAcceptedSuggestion）而反复重挂监听
  }, []);

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

  const emptyStateHint = !projectPath
    ? '打开项目后即可开始编辑'
    : sidebarVisible === false
      ? '展开资源管理器后选择文件'
      : '在资源管理器中双击文件开始编辑';

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

      {/* 顶部工具栏 */}
      <div className="sf-panel-header border-border bg-panel">
        <div className="flex min-w-[96px] flex-1 items-center gap-2 overflow-hidden">
          <span className="sf-topbar-title" title={filePath ?? undefined}>
            {filePath ? filePath.split(/[/\\]/).pop() : '未打开文件'}
          </span>
          {isDirty && (
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
          onReject={() => {
            setPendingSuggestion(null);
            setSuggestionStatus('已拒绝建议补丁');
          }}
          onSaveNote={handleSaveSuggestionNote}
        />
      )}

      {/* Monaco Editor */}
      <div ref={containerRef} className="flex-1" data-testid="editor-container" />

      {showHistory &&
        (filePath ? (
          <VersionHistory
            projectPath={projectPath}
            filePath={filePath}
            onRestore={handleRestore}
            onClose={() => setShowHistory(false)}
          />
        ) : null)}
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
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Editor' | 'Agent'>('all');

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
  const visibleVersions = versions?.filter((version) =>
    sourceFilter === 'all' ? true : version.source === sourceFilter,
  );

  return (
    <div
      className="absolute top-[var(--sf-bar-height)] right-0 bottom-0 w-80 bg-panel border-l border-border flex flex-col shadow-2xl z-30 animate-slide-up-fade"
      data-testid="version-history"
    >
      <div className="sf-panel-header border-border">
        <span className="text-sm font-semibold">版本记录</span>
        <button
          onClick={onClose}
          title="关闭"
          className="sf-icon-button text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div
        className="flex flex-shrink-0 gap-1 border-b border-border p-2"
        data-testid="version-source-filter"
      >
        {(['all', 'Editor', 'Agent'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`rounded-md px-2 py-1 text-xs ${sourceFilter === value ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-foreground/10'}`}
            onClick={() => setSourceFilter(value)}
            data-testid={`version-filter-${value}`}
          >
            {value === 'all' ? '全部' : value === 'Editor' ? '手动' : 'Agent'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {error ? (
          <p className="text-sm text-error p-2">{error}</p>
        ) : versions === null ? (
          <p className="text-sm text-muted p-2">加载中...</p>
        ) : visibleVersions?.length === 0 ? (
          <p className="text-sm text-muted p-2">还没有历史版本。保存修改后会自动记录。</p>
        ) : (
          visibleVersions?.map((v) => (
            <div
              key={v.path}
              className="rounded-md border border-border bg-surface p-2"
              data-testid="version-entry"
              data-version-source={v.source ?? ''}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs text-foreground truncate"
                  title={formatTimestamp(v.timestamp)}
                >
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
              <div
                className="mt-1 truncate text-[11px] text-muted"
                title={v.summary ?? v.file ?? ''}
              >
                {v.source ? `${v.source} · ` : ''}
                {v.summary ?? v.file ?? '版本快照'}
              </div>
              {(v.patchId || v.assistantSessionId || v.issueIds?.length) && (
                <div
                  className="mt-1 truncate text-[11px] text-muted"
                  data-testid="version-agent-meta"
                >
                  {v.patchId ? `patch ${v.patchId}` : ''}
                  {v.assistantSessionId ? ` · session ${v.assistantSessionId}` : ''}
                  {v.issueIds?.length ? ` · ${v.issueIds.join(', ')}` : ''}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
