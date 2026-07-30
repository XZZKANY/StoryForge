import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  SUGGESTION_RESULT_EVENT,
  bufferPendingFileSuggestion,
  takePendingFileSuggestion,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopRecord, RevisionLoopResult } from '../../lib/author-loop';
import type { BranchInfo } from '../../lib/branches';
import type { EditorModelCache } from './useMonacoEditor';
import { applyPatchHunkToCurrent, isWholeFileDrifted, type PatchHunk } from '../../lib/patch-hunks';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { snapshotBeforeWrite } from '../../lib/versions';
import {
  canUndoWriteback,
  performGuardedWriteback,
  shouldSettleActiveEditor,
} from '../../lib/writeback';
import { emitToast } from '../../lib/toast';

export type SuggestionStatusTone = 'success' | 'error' | 'info';

type UseSuggestionWritebackParams = {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  originalContentRef: MutableRefObject<string>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
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
  modelCacheRef,
  setLoadedContentPreview,
  setIsDirty,
  normalizeEol,
  getActiveBranchSnapshot,
  advanceBranchHead,
  recordRevisionLoop,
  emitAuthorLoopResult,
}: UseSuggestionWritebackParams) {
  const [pendingSuggestion, setPendingSuggestion] = useState<AssistantFileSuggestion | null>(null);
  // E15：接受/拒绝/旁注/导出/锚点失效等一次性结果统一走自动消退 toast，不再赖在编辑器顶栏；
  // 顶栏只保留真正持续的态（isReviseLoading）。沿用 setSuggestionStatus 名以少动调用点。
  const setSuggestionStatus = useCallback((text: string, tone: SuggestionStatusTone = 'info') => {
    if (text) emitToast(text, { tone });
  }, []);
  const [isReviseLoading, setIsReviseLoading] = useState(false);
  const assistantSessionIdRef = useRef<number | null>(null);
  const pendingSuggestionRef = useRef<AssistantFileSuggestion | null>(null);

  useEffect(() => {
    pendingSuggestionRef.current = pendingSuggestion;
  });

  const resetSuggestionWriteback = useCallback(() => {
    // P2c：切走当前文件前把未确认补丁回填缓冲，切回同一文件可重新领取，不静默丢弃。
    const pending = pendingSuggestionRef.current;
    if (pending) bufferPendingFileSuggestion(pending);
    setPendingSuggestion(null);
    setIsReviseLoading(false);
  }, []);

  useEffect(() => {
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion || suggestion.filePath !== filePathRef.current) return;
      // 目标文件已打开：直接消费缓冲，避免切换文件后被重复领取。
      takePendingFileSuggestion(suggestion.filePath);
      setPendingSuggestion(suggestion);
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
      // 红线：写回期间作者可能切走页签，绝不能把本文件内容灌进当前活动缓冲
      // （旧代码无条件 editorRef.setValue，A 文件内容会落进 B 缓冲并被 autosave 写盘）。
      // 盘上已落，故按「目标 model」结算而非「当前活动 model」结算：
      // 目标缓冲永远同步（切回来看到的就是已写回的内容），活动编辑器 UI 态只在目标仍在前台时动。
      const targetState = modelCacheRef.current.get(path) ?? null;
      if (targetState) {
        targetState.originalContent = nextContent;
        if (targetState.model.getValue() !== nextContent) targetState.model.setValue(nextContent);
      }
      const targetStillActive = shouldSettleActiveEditor(
        path,
        targetState?.model ?? null,
        filePathRef.current,
        editorRef.current?.getModel() ?? null,
      );
      if (targetStillActive) {
        originalContentRef.current = nextContent;
        cleanVersionIdRef.current =
          editorRef.current?.getModel()?.getAlternativeVersionId() ?? null;
        setLoadedContentPreview(nextContent.slice(0, 120));
        setIsDirty(false);
      }
      return loopRecord;
    },
    [
      advanceBranchHead,
      cleanVersionIdRef,
      editorRef,
      filePathRef,
      getActiveBranchSnapshot,
      modelCacheRef,
      normalizeEol,
      originalContentRef,
      projectPathRef,
      recordRevisionLoop,
      setIsDirty,
      setLoadedContentPreview,
    ],
  );

  /**
   * 写回成功后弹一条带「撤销」的通知：撤销就是把 previous 再走一遍同一条守卫写回
   * （快照 → 推进分支头 → 写盘 → 记录），所以撤销本身也留安全网、也能再被撤销。
   *
   * 不动「未确认不写盘」这条红线——补丁仍要作者点接受才落盘；这里降的是**接受之后**
   * 反悔的成本：从「翻版本历史找到那份快照 → 恢复进缓冲 → 再手动保存一次」变成一次点击。
   */
  const offerUndo = useCallback(
    (suggestion: AssistantFileSuggestion, path: string, restoreTo: string, wrote: string) => {
      emitToast('修订已写回，已留写前快照', {
        tone: 'success',
        action: {
          label: '撤销',
          run: async () => {
            const current = editorRef.current?.getValue() ?? null;
            if (current === null || !canUndoWriteback(current, wrote, normalizeEol)) {
              emitToast('文件在此期间又变了，撤销已取消——请到版本历史挑要恢复的那一份', {
                tone: 'error',
              });
              return;
            }
            try {
              await writeAcceptedSuggestion(
                {
                  ...suggestion,
                  id: `${suggestion.id}-undo`,
                  before: wrote,
                  after: restoreTo,
                },
                path,
                wrote,
                restoreTo,
                { summary: `撤销：${suggestion.summary}`, note: '用户意图：撤销刚写回的修订' },
              );
              emitToast('已撤销，文件回到写回前', { tone: 'success' });
            } catch (err) {
              emitToast(`撤销失败：${err instanceof Error ? err.message : String(err)}`, {
                tone: 'error',
              });
            }
          },
        },
      });
    },
    [editorRef, normalizeEol, writeAcceptedSuggestion],
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
      offerUndo(suggestion, path, currentContent, suggestion.after);
      setSuggestionStatus(
        loopRecord.recordPath
          ? '已写入当前文件 · 已留写前快照与闭环记录，可点通知里的「撤销」一键回退'
          : '已写入当前文件 · 已留写前快照，可点通知里的「撤销」一键回退',
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
    offerUndo,
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
        offerUndo(suggestion, path, currentContent, nextContent);
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
    [editorRef, filePathRef, normalizeEol, offerUndo, setSuggestionStatus, writeAcceptedSuggestion],
  );

  useEffect(() => {
    const onSuggestionResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      const path = filePathRef.current;
      if (!result || !path || result.filePath !== path) return;
      setIsReviseLoading(false);
      if (result.status !== 'ready') {
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
    setSuggestionStatus('已拒绝修订');
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
    // 行间对话（Ctrl+K）接受时复用同一套快照 + 写盘 + 闭环记录 + 分支头，避免另起一套写回。
    writeAcceptedSuggestion,
  };
}
