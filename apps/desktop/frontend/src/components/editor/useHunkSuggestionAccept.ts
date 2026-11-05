import { useCallback } from 'react';

import { replacePendingFileSuggestion } from '../../lib/assistant-events';
import { recordAcceptedChapterFacts } from '../../lib/fact-write';
import {
  reportChapterWriteback,
  writtenChapter,
  type ChapterWriteback,
} from '../../lib/write-batch-writeback';
import type { PatchHunk } from '../../lib/patch-hunks';
import {
  hasIssueAttribution,
  planHunkAccept,
  resolveIssueStatuses,
  summarizeIssueResolutions,
  verifiedAppliedOpIds,
} from '../../lib/suggestion-ops';
import {
  matchChangeSetOperation,
  projectRemainingSuggestion,
} from '../../lib/suggestion-change-set';
import { emitToast } from '../../lib/toast';
import { issueResolutionNote } from './suggestion-op-state';
import type { GuardedSuggestionWrite } from './useGuardedSuggestionWrite';
import type { SuggestionIntake } from './useSuggestionIntake';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';
import type { SuggestionUndo } from './useSuggestionUndo';

// 分块接受：把作者点的那一块映射回原始 op，再用与整份接受同一套锚定定位器写进当前稿。

export function useHunkSuggestionAccept(
  {
    editorRef,
    modelCacheRef,
    emitAuthorLoopResult,
    filePathRef,
    projectPathRef,
  }: UseSuggestionWritebackParams,
  {
    setSuggestionStatus,
    mountedRef,
    pendingSuggestionRef,
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
  const handleAcceptHunk = useCallback(
    async (hunk: PatchHunk) => {
      const suggestion = pendingSuggestionRef.current;
      const path = filePathRef.current;
      if (!suggestion || !path || suggestion.filePath !== path || !editorRef.current) {
        setSuggestionStatus('当前没有待写进文件的修订。');
        return;
      }

      const actionToken = beginAction('hunk', suggestion);
      if (!actionToken) return;
      const projectRoot = projectPathRef.current;
      let settlement: Promise<ChapterWriteback> | null = null;
      let failure: string | null = null;

      try {
        const model = modelCacheRef.current.get(path)?.model;
        if (!model || editorRef.current.getModel() !== model)
          throw new Error('目标正文还在加载，请加载完成后再接受修订。');
        const currentContent = model.getValue();
        const opState =
          suggestionOpsRef.current?.suggestionId === suggestion.id
            ? suggestionOpsRef.current
            : null;
        if (!opState) throw new Error('缺少原始操作集合，不能接受分块。');
        const matched = matchChangeSetOperation(opState.changeSet, hunk);
        if (!matched) {
          // 分块无法一一对应回原始修订的某一处 op（作者改动落在该处，或出现歧义重复），
          // 拒绝这次半选，避免把作者的内容当成补丁改动写掉。
          throw new Error(
            '这个修改块对应不上原始修订的任何一处改动（该处可能已被改写或存在歧义），已拒绝接受；请重新生成修订或手动处理。',
          );
        }
        // 分块接受改走与整份接受同一套锚定定位器：定位不到唯一目标即抛冲突、零写入，
        // 不再用「取部分上下文最佳分」的旧定位（重复块 + 目标上下文被改会静默写错处）。
        const hunkPlan = planHunkAccept(
          currentContent,
          matched ?? hunk,
          opState?.changeSet.before ?? suggestion.before,
          { operations: opState.changeSet.operations, appliedOpIds: opState.appliedOpIds },
        );
        const nextContent = hunkPlan.content;
        // 消费/确认是历史，解决归属须重新核验实际写入稿；不能因旧 op 曾接受就算仍在稿内。
        const previousAcceptedOpIds = new Set(opState.appliedOpIds);
        const appliedAfterHunk = new Set(previousAcceptedOpIds);
        if (matched) appliedAfterHunk.add(matched.id);
        const opsForIssues = opState?.changeSet.operations ?? [];
        const settledAfterHunk = verifiedAppliedOpIds(
          nextContent,
          opState.changeSet.before,
          opsForIssues,
          appliedAfterHunk,
        );
        // 本次实际施加的原 op 有规划证据；只观察到某处已有结果则仍须核验原位置。
        if (matched && !hunkPlan.alreadyApplied) settledAfterHunk.add(matched.id);
        const issuesAttributed = hasIssueAttribution(
          suggestion.issueIds ?? [],
          suggestion.issueScopes ?? [],
        );
        const hunkIssueResolutions =
          suggestion.issueIds?.length && opState
            ? resolveIssueStatuses(
                suggestion.issueIds,
                suggestion.issueScopes ?? [],
                opsForIssues,
                settledAfterHunk,
              )
            : undefined;
        const hunkIssueCounts = hunkIssueResolutions
          ? summarizeIssueResolutions(
              hunkIssueResolutions,
              resolveIssueStatuses(
                suggestion.issueIds ?? [],
                suggestion.issueScopes ?? [],
                opsForIssues,
                appliedAfterHunk,
              ),
            )
          : undefined;
        const loopRecord = await writeAcceptedSuggestion(
          suggestion,
          path,
          currentContent,
          nextContent,
          {
            operationKind: `hunk:${matched.id}${opState.lastUndoOperationId ? `:after-undo:${opState.lastUndoOperationId}` : ''}`,
            summary: `${suggestion.summary}（接受分块）`,
            note: `${suggestion.note}\n\n分块接受：第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`,
            issueResolutions: hunkIssueResolutions,
            issueCounts: hunkIssueCounts,
            issueAttributed: hunkIssueResolutions ? issuesAttributed : undefined,
          },
        );
        if (opState && matched) opState.appliedOpIds.add(matched.id);
        const displayedCurrent = isCurrentAction(actionToken)
          ? (editorRef.current?.getValue() ?? nextContent)
          : nextContent;
        const projection = projectRemainingSuggestion(
          displayedCurrent,
          opState.changeSet,
          opState.appliedOpIds,
        );
        const remaining = projection.finished
          ? null
          : {
              ...suggestion,
              before: displayedCurrent,
              after: projection.after,
              operationView: projection.view,
            };
        const finished = remaining === null;
        if (!loopRecord.auditComplete || loopRecord.warning)
          failure = loopRecord.warning ?? '分块已写入，但保存审计尚未完成，请先核对原修订。';
        const runStatus =
          finished && loopRecord.auditComplete
            ? await forgetSuggestionRecovery(suggestion, true)
            : undefined;
        // 只有整份原操作都已确认、审计与原运行结算均成功，才能交出连续修改的完成回执。
        if (finished && failure === null) {
          if (suggestion.runId && runStatus !== 'completed') {
            failure = '修订已写入，但原运行尚未成功结算；后续章节未启动。';
          } else {
            const facts = recordAcceptedChapterFacts(
              projectRoot,
              path,
              suggestion.runId,
              () => mountedRef.current && projectPathRef.current === projectRoot,
            );
            settlement = writtenChapter(projectRoot, path, loopRecord.snapshotPath, facts);
          }
        }
        replacePendingFileSuggestion(suggestion, remaining);
        if (!isCurrentAction(actionToken)) return;
        updatePendingSuggestion(remaining);
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
        if (finished)
          emitAuthorLoopResult({
            filePath: path,
            status: 'completed',
            action: 'revision_accepted',
            message: '修订已全部接受并写进文件',
            recordPath: loopRecord.recordPath ?? undefined,
            runId: suggestion.runId,
            projectPath: opState.recovery?.projectPath,
            assistantSessionId: suggestion.assistantSessionId,
            runStatus: typeof runStatus === 'string' ? runStatus : undefined,
          });
        offerUndo(
          suggestion,
          path,
          currentContent,
          nextContent,
          loopRecord.createdFile,
          loopRecord.receipt.operationId,
          `第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines} 行`,
          previousAcceptedOpIds,
        );
        setSuggestionStatus(
          (finished
            ? '修订已全部接受并写进文件；一键撤销只回退最后写进文件的那一次分块，更早的写入见版本历史。'
            : loopRecord.recordPath
              ? '已接受该修改块并写入当前文件，剩余修改仍可继续确认'
              : '已接受该修改块并写入当前文件') +
            issueResolutionNote(hunkIssueResolutions, issuesAttributed, hunkIssueCounts),
          'success',
        );
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        failAction(
          actionToken,
          `接受分块失败: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      } finally {
        finishAction(actionToken);
        // 部分接受没有整章回执；失败则立即停止队列，不能等成已经写完。
        if (failure !== null)
          reportChapterWriteback(suggestion.runId, { written: false, reason: failure });
        else if (settlement !== null) reportChapterWriteback(suggestion.runId, settlement);
      }
    },
    [
      beginAction,
      emitAuthorLoopResult,
      failAction,
      isCurrentAction,
      updatePendingSuggestion,
      editorRef,
      modelCacheRef,
      filePathRef,
      projectPathRef,
      mountedRef,
      finishAction,
      forgetSuggestionRecovery,
      offerUndo,
      setSuggestionStatus,
      writeAcceptedSuggestion,
      pendingSuggestionRef,
      suggestionOpsRef,
    ],
  );

  return { handleAcceptHunk };
}
