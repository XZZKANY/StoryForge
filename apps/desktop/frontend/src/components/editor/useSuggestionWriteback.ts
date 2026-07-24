import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  SUGGESTION_RESULT_EVENT,
  takePendingFileSuggestion,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopRecord, RevisionLoopResult } from '../../lib/author-loop';
import type { BranchInfo } from '../../lib/branches';
import { applyPatchHunkToCurrent, isWholeFileDrifted, type PatchHunk } from '../../lib/patch-hunks';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { snapshotBeforeWrite } from '../../lib/versions';
import { performGuardedWriteback } from '../../lib/writeback';

export type SuggestionStatusTone = 'success' | 'error' | 'info';
/** 编辑器顶部状态条文本 + 语义色调；null = 无状态。按 tone 判色，不再前缀匹配。 */
export type SuggestionStatus = { text: string; tone: SuggestionStatusTone } | null;

type UseSuggestionWritebackParams = {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  originalContentRef: MutableRefObject<string>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  setLoadedContentPreview: (preview: string) => void;
  setIsDirty: (dirty: boolean) => void;
  normalizeEol: (text: string) => string;
  getActiveBranchSnapshot: () => BranchInfo;
  advanceBranchHead: (timestamp: number) => Promise<void>;
  recordRevisionLoop: (record: RevisionLoopRecord) => Promise<RevisionLoopResult>;
  emitAuthorLoopResult: (result: AuthorLoopResult) => void;
};

export function useSuggestionWriteback({
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
}: UseSuggestionWritebackParams) {
  const [pendingSuggestion, setPendingSuggestion] = useState<AssistantFileSuggestion | null>(null);
  const [suggestionStatus, setSuggestionStatusState] = useState<SuggestionStatus>(null);
  const setSuggestionStatus = useCallback((text: string, tone: SuggestionStatusTone = 'info') => {
    setSuggestionStatusState(text ? { text, tone } : null);
  }, []);
  const [isReviseLoading, setIsReviseLoading] = useState(false);
  const assistantSessionIdRef = useRef<number | null>(null);
  const pendingSuggestionRef = useRef<AssistantFileSuggestion | null>(null);

  useEffect(() => {
    pendingSuggestionRef.current = pendingSuggestion;
  });

  const resetSuggestionWriteback = useCallback(() => {
    setPendingSuggestion(null);
    setSuggestionStatusState(null);
    setIsReviseLoading(false);
  }, []);

  useEffect(() => {
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion || suggestion.filePath !== filePathRef.current) return;
      // 目标文件已打开：直接消费缓冲，避免切换文件后被重复领取。
      takePendingFileSuggestion(suggestion.filePath);
      setPendingSuggestion(suggestion);
      setSuggestionStatusState(null);
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, [filePathRef]);

  // 补丁指向的文件刚被（自动）打开时，从缓冲领取等待中的建议。
  const adoptPendingSuggestion = useCallback((path: string | null) => {
    const pending = takePendingFileSuggestion(path);
    if (pending) {
      setPendingSuggestion(pending);
      setSuggestionStatusState(null);
    }
  }, []);

  const writeAcceptedSuggestion = useCallback(
    async (
      suggestion: AssistantFileSuggestion,
      path: string,
      previous: string,
      nextContent: string,
      overrides: { summary?: string; note?: string } = {},
    ) => {
      const projectRoot = projectPathRef.current;
      if (!projectRoot) throw new Error('未打开项目，不能写入修订结果');
      const summary = overrides.summary ?? suggestion.summary;
      const note = overrides.note ?? suggestion.note;
      const contentChanged = normalizeEol(previous) !== normalizeEol(nextContent);
      // F27：快照失败必须阻断写回。snapshot 抛错时 performGuardedWriteback 直接向上传播，
      // writeFile 不执行——绝不在没有版本安全网时落盘。
      const loopRecord = await performGuardedWriteback(contentChanged, {
        snapshot: () => {
          const branch = getActiveBranchSnapshot();
          return snapshotBeforeWrite(projectPathRef.current, path, previous, {
            source: 'Agent',
            summary,
            patchId: suggestion.id,
            assistantSessionId: suggestion.assistantSessionId ?? assistantSessionIdRef.current,
            issueIds: suggestion.issueIds,
            contextFiles: suggestion.contextFiles,
            branchId: branch.id,
            branchLabel: branch.label,
            parentId: branch.headNodeId,
          });
        },
        advanceBranchHead,
        write: () => TauriFileSystem.writeFile(projectRoot, path, nextContent),
        record: () =>
          recordRevisionLoop({
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
          }),
      });
      editorRef.current?.setValue(nextContent);
      originalContentRef.current = nextContent;
      cleanVersionIdRef.current = editorRef.current?.getModel()?.getAlternativeVersionId() ?? null;
      setLoadedContentPreview(nextContent.slice(0, 120));
      setIsDirty(false);
      return loopRecord;
    },
    [
      advanceBranchHead,
      cleanVersionIdRef,
      editorRef,
      getActiveBranchSnapshot,
      normalizeEol,
      originalContentRef,
      projectPathRef,
      recordRevisionLoop,
      setIsDirty,
      setLoadedContentPreview,
    ],
  );

  const handleAcceptSuggestion = useCallback(async () => {
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
      if (isWholeFileDrifted(currentContent, suggestion.before, normalizeEol)) {
        const message = '当前文件内容已变化，旧补丁不能直接写回。请重新生成修订，或手动处理冲突。';
        setSuggestionStatus(message, 'error');
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
        'success',
      );
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'revision_accepted',
        message: loopRecord.recordPath ? '修订已写回并记录闭环' : '修订已写回',
        recordPath: loopRecord.recordPath ?? undefined,
      });
    } catch (err) {
      setSuggestionStatus(`接受失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'revision_accepted',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    editorRef,
    emitAuthorLoopResult,
    filePathRef,
    normalizeEol,
    setSuggestionStatus,
    writeAcceptedSuggestion,
  ]);

  const handleAcceptHunk = useCallback(
    async (hunk: PatchHunk) => {
      const suggestion = pendingSuggestionRef.current;
      const path = filePathRef.current;
      if (!suggestion || !path || !editorRef.current) {
        setSuggestionStatus('当前没有待写回的修订。');
        return;
      }

      try {
        const currentContent = editorRef.current.getValue();
        const nextContent = applyPatchHunkToCurrent(currentContent, hunk);
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
          'success',
        );
      } catch (err) {
        setSuggestionStatus(
          `接受分块失败: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [editorRef, filePathRef, normalizeEol, setSuggestionStatus, writeAcceptedSuggestion],
  );

  useEffect(() => {
    const onSuggestionResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      const path = filePathRef.current;
      if (!result || !path || result.filePath !== path) return;
      setIsReviseLoading(false);
      if (result.status === 'ready') {
        setSuggestionStatusState(null);
      } else {
        setSuggestionStatus(`AI 修订失败：${result.message}`, 'error');
      }
      if (result.assistantSessionId) {
        assistantSessionIdRef.current = result.assistantSessionId;
      }
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
  }, [filePathRef, setSuggestionStatus]);

  useEffect(() => {
    const onAcceptCurrentSuggestion = () => {
      void handleAcceptSuggestion();
    };
    window.addEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
    return () =>
      window.removeEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
  }, [handleAcceptSuggestion]);

  const handleSaveSuggestionNote = useCallback(async () => {
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
      await TauriFileSystem.writeFile(project, notePath, note);
      setPendingSuggestion(null);
      setSuggestionStatus(`已保存旁注: ${notePath}`, 'success');
    } catch (err) {
      setSuggestionStatus(
        `保存旁注失败: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  }, [pendingSuggestion, projectPathRef, setSuggestionStatus]);

  const rejectPendingSuggestion = useCallback(() => {
    setPendingSuggestion(null);
    setSuggestionStatus('已拒绝建议补丁');
  }, [setSuggestionStatus]);

  return {
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
    // 行间对话（Ctrl+K）接受时复用同一套快照 + 写盘 + 闭环记录 + 分支头，避免另起一套写回。
    writeAcceptedSuggestion,
  };
}
