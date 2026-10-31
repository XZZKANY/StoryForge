import { useCallback, useEffect, useRef } from 'react';

import { replacePendingFileSuggestion } from '../../lib/assistant-events';
import { recordAcceptedChapterFacts } from '../../lib/fact-write';
import { isWriteBatchRun } from '../../lib/write-batch-grant';
import {
  reportChapterWriteback,
  writtenChapter,
  type ChapterWriteback,
} from '../../lib/write-batch-writeback';
import {
  hasIssueAttribution,
  planWholeAccept,
  resolveIssueStatuses,
  summarizeIssueResolutions,
  verifiedAppliedOpIds,
} from '../../lib/suggestion-ops';
import { shouldAutoAcceptSuggestion } from '../../lib/agent-permission';
import { markChapterWrittenInPlan } from '../../lib/serial-plan';
import { emitToast } from '../../lib/toast';
import { readSuggestionAcceptance } from '../../lib/suggestion-recovery';
import { createOperationState, issueResolutionNote } from './suggestion-op-state';
import type { GuardedSuggestionWrite } from './useGuardedSuggestionWrite';
import type { SuggestionIntake } from './useSuggestionIntake';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';
import type { SuggestionUndo } from './useSuggestionUndo';

// 接受整份补丁（作者点击或自动档）：半截稿两步硬闸、批量写章结算、连载计划标记与事实记账都挂在这一层。

export function useWholeSuggestionAccept(
  {
    editorRef,
    emitAuthorLoopResult,
    filePathRef,
    normalizeEol,
    projectPathRef,
  }: UseSuggestionWritebackParams,
  {
    pendingSuggestion,
    setSuggestionStatus,
    pendingSuggestionRef,
    actionInFlightRef,
    actionState,
    mountedRef,
    truncationArmedIdRef,
    cancelTruncatedAccept,
    armTruncatedAccept,
    suggestionOpsRef,
    updatePendingSuggestion,
    beginAction,
    isCurrentAction,
    failAction,
    finishAction,
  }: SuggestionState,
  {
    forgetSuggestionRecovery,
    writeAcceptedSuggestion,
    offerUndo,
  }: Pick<SuggestionIntake, 'forgetSuggestionRecovery'> & GuardedSuggestionWrite & SuggestionUndo,
) {
  const handleAcceptSuggestion = useCallback(async () => {
    const suggestion = pendingSuggestionRef.current;
    const path = filePathRef.current;
    if (!suggestion || !path || suggestion.filePath !== path || !editorRef.current) {
      emitAuthorLoopResult({
        filePath: path ?? '',
        status: 'error',
        action: 'revision_accepted',
        message: '当前没有待写进文件的修订。',
      });
      return;
    }

    // 硬闸：有截断警告且没武装就不写，这一次只武装。逐处接受不经过这里。
    if (suggestion.truncationWarning && truncationArmedIdRef.current !== suggestion.id) {
      if (!actionInFlightRef.current) armTruncatedAccept(suggestion.id);
      reportChapterWriteback(suggestion.runId, {
        written: false,
        reason: '这份修订疑似没写完，要你在编辑器里看过再接受。',
      });
      return;
    }
    cancelTruncatedAccept();

    const projectRoot = projectPathRef.current;
    const actionToken = beginAction('accept', suggestion);
    if (!actionToken) return;
    // 批量写章自动写进文件的那几章不逐章弹撤销提示（正文与事实记账的都不弹），撤销改由清单提供；
    // 按这一批登记的运行 id 认，作者手动接受的修订照旧弹。
    const batchWrite =
      suggestion.requiresConfirmation === false && isWriteBatchRun(suggestion.runId);
    // 批量写章的调度器按运行 id 等这份结果：写进去了就连同事实记账一起交，没写进去交原因。
    let settlement: Promise<ChapterWriteback> | null = null;
    let failure: string | null = null;

    try {
      const currentContent = editorRef.current.getValue();
      const opState =
        suggestionOpsRef.current?.suggestionId === suggestion.id
          ? suggestionOpsRef.current
          : createOperationState(suggestion);
      const operationKind = opState.lastUndoOperationId
        ? `whole:after-undo:${opState.lastUndoOperationId}`
        : 'whole';
      const recoveredRecord = projectRoot
        ? await readSuggestionAcceptance(
            projectRoot,
            {
              operationKey: `${suggestion.id}:${operationKind}`,
              source: JSON.stringify([
                suggestion.id,
                opState.changeSet.before,
                opState.changeSet.after,
                suggestion.runId ?? null,
              ]),
              path,
              content: opState.changeSet.after,
            },
            suggestion.id,
          )
        : null;
      if (!isCurrentAction(actionToken)) return;
      // Reentry must not derive a new request from later author edits. The writer still checks
      // Native's complete source/content fingerprint; an audit alone cannot authorize a write.
      const plan = recoveredRecord
        ? null
        : planWholeAccept(
            currentContent,
            opState.changeSet.before,
            opState.changeSet.after,
            opState.appliedOpIds,
            normalizeEol,
            opState.changeSet.operations,
          );
      const nextContent = recoveredRecord ? recoveredRecord.after : plan!.content;
      const opsForIssues = opState.changeSet.operations;
      const settledForIssues = verifiedAppliedOpIds(
        nextContent,
        opState.changeSet.before,
        opsForIssues,
        plan?.settledOpIds ?? new Set<string>(),
      );
      for (const { op } of plan?.applied ?? []) settledForIssues.add(op.id);
      const issuesAttributed = recoveredRecord
        ? recoveredRecord.issueAttributed !== false
        : hasIssueAttribution(suggestion.issueIds ?? [], suggestion.issueScopes ?? []);
      const wholeIssueResolutions = recoveredRecord
        ? recoveredRecord.issueResolutions
        : suggestion.issueIds?.length
          ? resolveIssueStatuses(
              suggestion.issueIds,
              suggestion.issueScopes ?? [],
              opsForIssues,
              settledForIssues,
            )
          : undefined;
      const wholeIssueCounts = recoveredRecord
        ? recoveredRecord.issueCounts
        : wholeIssueResolutions
          ? summarizeIssueResolutions(
              wholeIssueResolutions,
              resolveIssueStatuses(
                suggestion.issueIds ?? [],
                suggestion.issueScopes ?? [],
                opsForIssues,
                new Set([...opState.appliedOpIds, ...(plan?.settledOpIds ?? [])]),
              ),
            )
          : undefined;
      // 无撤销历史沿用 :whole；明确撤销后的重选使用 Native 回执链，不能复用旧 applied。
      // 显式 operationKind 仍让整文件漂移闸让位给逐 op 映射。
      const loopRecord = await writeAcceptedSuggestion(
        suggestion,
        path,
        currentContent,
        nextContent,
        {
          operationKind,
          recoveredRecord: recoveredRecord ?? undefined,
          issueResolutions: wholeIssueResolutions,
          issueCounts: wholeIssueCounts,
          issueAttributed: wholeIssueResolutions ? issuesAttributed : undefined,
        },
      );
      // 正文已落盘，这才轮到连载计划把该章标 done（补丁未确认时后端会拒绝标记）。
      // 刻意只挂在「接受整个补丁」这一层：分块接受与行间对话 Ctrl+K 是段落级微调，
      // 接受一次不等于这章写完了；撤销走的是反向写回，届时正文没了，后端自会拒绝。
      if (!recoveredRecord) await markChapterWrittenInPlan(projectRoot, path);
      // 同一层上把写章检查时抽出的新事实记进台账；不等它，失败只提示，不影响已落盘的正文。
      // 批量写章要等它落定才开下一章（下一章的章纲读已写事实），所以把它连同写前快照交出去。
      const facts = recoveredRecord
        ? null
        : recordAcceptedChapterFacts(
            projectRoot,
            path,
            suggestion.runId,
            () => !batchWrite && mountedRef.current && projectPathRef.current === projectRoot,
          );
      settlement = writtenChapter(projectRoot, path, loopRecord.snapshotPath, facts);
      const runStatus = loopRecord.auditComplete
        ? await forgetSuggestionRecovery(suggestion, true)
        : undefined;
      replacePendingFileSuggestion(suggestion, null);
      if (!isCurrentAction(actionToken)) return;
      updatePendingSuggestion(null);
      if (loopRecord.warning) {
        emitToast(loopRecord.warning, {
          tone: 'info',
          action: loopRecord.retryAudit
            ? { label: '重试记录（不重写正文）', run: loopRecord.retryAudit }
            : loopRecord.retryCaches
              ? { label: '修复缓存（不重写正文）', run: loopRecord.retryCaches }
              : undefined,
        });
        emitAuthorLoopResult({
          filePath: path,
          status: 'completed',
          action: 'revision_accepted',
          message: loopRecord.warning,
          warning: loopRecord.warning,
        });
        return;
      }
      if (!recoveredRecord && !batchWrite)
        offerUndo(
          suggestion,
          path,
          currentContent,
          nextContent,
          loopRecord.createdFile,
          loopRecord.receipt.operationId,
        );
      setSuggestionStatus(
        (recoveredRecord
          ? '已核验原来那次写入与闭环记录；未再次写入，保留作者当前编辑'
          : batchWrite
            ? '已写入当前文件 · 已留写前快照，撤销在批量写章的清单上'
            : loopRecord.recordPath
              ? '已写入当前文件 · 已留写前快照与闭环记录，可点通知里的「撤销」一键回退'
              : '已写入当前文件 · 已留写前快照，可点通知里的「撤销」一键回退') +
          issueResolutionNote(wholeIssueResolutions, issuesAttributed, wholeIssueCounts),
        'success',
      );
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'revision_accepted',
        message: loopRecord.recordPath ? '修订已写进文件并记录闭环' : '修订已写进文件',
        runId: suggestion.runId,
        projectPath: projectRoot,
        assistantSessionId: suggestion.assistantSessionId,
        runStatus: typeof runStatus === 'string' ? runStatus : undefined,
        recordPath: loopRecord.recordPath ?? undefined,
      });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      if (!isCurrentAction(actionToken)) return;
      failAction(actionToken, `接受失败: ${err instanceof Error ? err.message : String(err)}`);
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'revision_accepted',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      finishAction(actionToken);
      reportChapterWriteback(
        suggestion.runId,
        settlement ?? { written: false, reason: failure ?? '这次接受没有写进文件。' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
  }, [
    armTruncatedAccept,
    beginAction,
    cancelTruncatedAccept,
    failAction,
    isCurrentAction,
    updatePendingSuggestion,
    editorRef,
    emitAuthorLoopResult,
    filePathRef,
    offerUndo,
    projectPathRef,
    setSuggestionStatus,
    finishAction,
    forgetSuggestionRecovery,
    normalizeEol,
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
  const autoAcceptedSuggestionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingSuggestion || !shouldAutoAcceptSuggestion(pendingSuggestion)) {
      if (!pendingSuggestion) autoAcceptedSuggestionIdRef.current = null;
      return;
    }
    if (actionState) return;
    if (autoAcceptedSuggestionIdRef.current === pendingSuggestion.id) return;
    if (autoAcceptingRef.current) return;
    autoAcceptedSuggestionIdRef.current = pendingSuggestion.id;
    autoAcceptingRef.current = true;
    void handleAcceptSuggestion().finally(() => {
      autoAcceptingRef.current = false;
    });
  }, [actionState, pendingSuggestion, handleAcceptSuggestion]);

  return { handleAcceptSuggestion };
}
