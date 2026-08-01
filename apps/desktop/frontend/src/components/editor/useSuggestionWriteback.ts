import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type * as monaco from 'monaco-editor';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  SUGGESTION_RESULT_EVENT,
  bufferPendingFileSuggestion,
  emitPatchRejected,
  takePendingFileSuggestion,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopRecord, RevisionLoopResult } from '../../lib/author-loop';
import type { BranchInfo } from '../../lib/branches';
import type { EditorModelCache } from './useMonacoEditor';
import { applyPatchHunkToCurrent, isWholeFileDrifted, type PatchHunk } from '../../lib/patch-hunks';
import { shouldAutoAcceptSuggestion } from '../../lib/agent-permission';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import { markChapterWrittenInPlan, unmarkChapterWrittenInPlan } from '../../lib/serial-plan';
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
  /** 撤销一次「新建」要连页签一起摘掉，否则 autosave 会把刚删的文件原样写回来。 */
  dropOpenFilePath?: (path: string) => void;
  /** 一键撤销失效时把作者送到版本历史，而不是丢一句错误了事。 */
  onRequestVersionHistory?: () => void;
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
  dropOpenFilePath,
  onRequestVersionHistory,
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
      // 派生缓存由后端重建，写进去下次扫描即被覆盖。saveCurrentFile 一直有这道闸，
      // AI 写回这条路以前漏了；自动档下补丁不再经人眼，漏了就会静默写坏。
      if (isReadOnlyDerivedProjectPath(path)) {
        throw new Error('canon 派生缓存是只读的，不能写入修订结果');
      }
      const summary = overrides.summary ?? suggestion.summary;
      const note = overrides.note ?? suggestion.note;
      const contentChanged = normalizeEol(previous) !== normalizeEol(nextContent);
      // 这次写入是不是「凭空建出这个文件」。撤销一次新建要删文件而不是写回空串，
      // 否则盘上会留一个空文件，看着像回退了其实没有。
      let createdFile = false;
      // F27：快照失败必须阻断写回。snapshot 抛错时 performGuardedWriteback 直接向上传播，
      // writeFile 不执行——绝不在没有版本安全网时落盘。
      const loopRecord = await performGuardedWriteback(contentChanged, {
        snapshot: async () => {
          const branch = getActiveBranchSnapshot();
          const result = await snapshotBeforeWrite(projectPathRef.current, path, previous, {
            source: 'Agent',
            summary,
            patchId: suggestion.id,
            assistantSessionId: suggestion.assistantSessionId ?? assistantSessionIdRef.current,
            issueIds: suggestion.issueIds,
            contextFiles: suggestion.contextFiles,
            branchId: branch.id,
            branchLabel: branch.label,
            parentId: branch.headNodeId,
            runId: suggestion.runId,
            // AI 写回一律进 checkpoints/：自动档下这是作者事后唯一想回的那个点，
            // 不能和 autosave 挤同一个配额被冲掉。
            checkpoint: true,
          });
          createdFile = result?.created ?? false;
          return result;
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
      return { ...loopRecord, createdFile };
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
   * 三种情况分开处理，都不留死路：
   *  - 这次写入**创建**了文件 → 撤销是删掉它，不是写回一份空内容（空文件不等于没有这个文件）。
   *  - 文件之后又变了 → 一键撤销确实不能用了（会吃掉新输入），但检查点还躺在
   *    `.storyforge/versions/<file>/checkpoints/` 里，把版本历史开过去即可，不是错误终点。
   *  - 其余 → 原路写回。
   */
  const offerUndo = useCallback(
    (
      suggestion: AssistantFileSuggestion,
      path: string,
      restoreTo: string,
      wrote: string,
      createdFile: boolean,
    ) => {
      emitToast(createdFile ? '新文件已写入，已留检查点' : '修订已写回，已留检查点', {
        tone: 'success',
        action: {
          label: createdFile ? '撤销（删除该文件）' : '撤销',
          run: async () => {
            const current = editorRef.current?.getValue() ?? null;
            if (current === null || !canUndoWriteback(current, wrote, normalizeEol)) {
              emitToast('文件在此期间又变了，一键撤销会吃掉新内容——检查点仍在版本历史里', {
                tone: 'info',
                action: onRequestVersionHistory
                  ? { label: '打开版本历史', run: () => onRequestVersionHistory() }
                  : undefined,
              });
              return;
            }
            try {
              if (createdFile) {
                const projectRoot = projectPathRef.current;
                if (!projectRoot) throw new Error('未打开项目，不能撤销新建');
                await TauriFileSystem.deletePath(projectRoot, path);
                // 正文没了，这章就不再是「写完的」——把接受时标上的 done 退回 pending。
                // 只在这一支做：修订的撤销走下面的反向写回，文件还在，那章依然是写完的。
                await unmarkChapterWrittenInPlan(projectRoot, path);
                setPendingSuggestion(null);
                // 页签留着的话，开着 autosave 时下一次防抖就会把文件原样写回来。
                dropOpenFilePath?.(path);
                emitToast('已撤销，该文件回到「不存在」', { tone: 'success' });
                return;
              }
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
    [
      dropOpenFilePath,
      editorRef,
      normalizeEol,
      onRequestVersionHistory,
      projectPathRef,
      writeAcceptedSuggestion,
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
      // 正文已落盘，这才轮到连载计划把该章标 done（补丁未确认时后端会拒绝标记）。
      // 刻意只挂在「接受整个补丁」这一层：分块接受与行间对话 Ctrl+K 是段落级微调，
      // 接受一次不等于这章写完了；撤销走的是反向写回，届时正文没了，后端自会拒绝。
      await markChapterWrittenInPlan(projectPathRef.current, path);
      setPendingSuggestion(null);
      offerUndo(suggestion, path, currentContent, suggestion.after, loopRecord.createdFile);
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
    projectPathRef,
    setSuggestionStatus,
    writeAcceptedSuggestion,
  ]);

  /**
   * 自动档：补丁自己带着「不必等点击」就直接走同一条接受路径。
   *
   * 放宽的只有「作者点一下」这一层——快照 → 写盘 → 版本记录、漂移拒写、派生目录只读、
   * 项目边界全都照旧执行，撤销 toast 也照旧弹。任何一条守卫拦下来，补丁就留在
   * PatchReviewPanel 里退回手动确认，绝不静默丢弃。
   */
  const autoAcceptingRef = useRef(false);
  useEffect(() => {
    if (!pendingSuggestion || !shouldAutoAcceptSuggestion(pendingSuggestion)) return;
    if (autoAcceptingRef.current) return;
    autoAcceptingRef.current = true;
    void handleAcceptSuggestion().finally(() => {
      autoAcceptingRef.current = false;
    });
  }, [pendingSuggestion, handleAcceptSuggestion]);

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
        offerUndo(suggestion, path, currentContent, nextContent, loopRecord.createdFile);
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

  /**
   * 拒绝不是二元否决：作者往往知道该怎么改，只是这版没改对。
   *
   * direction 非空时由 ChatWindow 侧接住，当作一句真实的作者发言发出去——落进会话、
   * 自动进下一轮 prompt、顺带重做一版；留空则维持轻量否决，不烧新一轮 BYO-key。
   * 无论哪条路径，这里都只清面板，写盘一步都不做。
   */
  const rejectPendingSuggestion = useCallback(
    (direction = '') => {
      const suggestion = pendingSuggestionRef.current;
      const trimmed = direction.trim();
      setPendingSuggestion(null);
      setSuggestionStatus(trimmed ? '已否掉这版，正按你的说法重来' : '已拒绝修订');
      if (suggestion) {
        emitPatchRejected({
          filePath: filePathRef.current ?? suggestion.filePath,
          patchId: suggestion.id,
          direction: trimmed,
        });
      }
    },
    [filePathRef, pendingSuggestionRef, setSuggestionStatus],
  );

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
