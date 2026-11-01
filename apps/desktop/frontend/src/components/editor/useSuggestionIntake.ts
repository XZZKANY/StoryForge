import { withNativeDelivery } from '../../lib/host/native-delivery';
import { useCallback, useEffect } from 'react';

import {
  APPLY_FILE_SUGGESTION_EVENT,
  bufferPendingFileSuggestion,
  emitPatchRejected,
  takePendingFileSuggestion,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { associateIssuesToOps } from '../../lib/suggestion-ops';
import { projectRemainingSuggestion } from '../../lib/suggestion-change-set';
import { emitToast } from '../../lib/toast';
import {
  MissingSuggestionAudit,
  forgetPendingSuggestion,
  loadPendingSuggestion,
  recoverSuggestionOperations,
  settleSuggestionRun,
  type PendingSuggestionDescriptor,
} from '../../lib/suggestion-recovery';
import { suggestionOperationStates } from './suggestion-op-state';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';

// 补丁怎么进出编辑器：切走时回填缓冲、按事件或从缓冲领取、按恢复 journal 核验后恢复、结算后清 journal。

export function useSuggestionIntake(
  {
    enqueueWriteback,
    editorRef,
    filePathRef,
    projectPathRef,
    modelCacheRef,
    recordRevisionLoop,
    emitAuthorLoopResult,
  }: UseSuggestionWritebackParams,
  {
    setSuggestionStatus,
    setIsReviseLoading,
    pendingSuggestionRef,
    actionInFlightRef,
    mountedRef,
    recoveryEpochRef,
    updatePendingSuggestion,
  }: SuggestionState,
) {
  const resetSuggestionWriteback = useCallback(() => {
    recoveryEpochRef.current += 1;
    // P2c：切走当前文件前把未确认补丁回填缓冲，切回同一文件可重新领取，不静默丢弃。
    const pending = pendingSuggestionRef.current;
    if (pending) bufferPendingFileSuggestion(pending);
    updatePendingSuggestion(null);
    setIsReviseLoading(false);
    // Navigation invalidates UI ownership, not an already authorized write transaction.
  }, [updatePendingSuggestion, pendingSuggestionRef, recoveryEpochRef, setIsReviseLoading]);

  useEffect(() => {
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion || suggestion.filePath !== filePathRef.current) return;
      // 目标文件已打开：直接消费缓冲，避免切换文件后被重复领取。
      takePendingFileSuggestion(suggestion.filePath);
      updatePendingSuggestion(suggestion, { fresh: true });
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, [filePathRef, updatePendingSuggestion]);

  // 补丁指向的文件刚被（自动）打开时，从缓冲领取等待中的建议。
  const adoptPendingSuggestion = useCallback(
    (path: string | null) => {
      const pending = takePendingFileSuggestion(path);
      if (pending) {
        updatePendingSuggestion(pending, { fresh: true });
      }
    },
    [updatePendingSuggestion],
  );

  // Called after Monaco attaches the loaded target, not during the file loader's earlier setState.
  const recoverPendingSuggestion = useCallback(
    async function recover(path: string | null, repairAudit = false): Promise<void> {
      const project = projectPathRef.current;
      const targetModel = editorRef.current?.getModel();
      if (
        !project ||
        !path ||
        !targetModel ||
        pendingSuggestionRef.current ||
        modelCacheRef.current.get(path)?.model !== targetModel ||
        actionInFlightRef.current
      )
        return;
      const epoch = ++recoveryEpochRef.current;
      const current = () =>
        mountedRef.current &&
        recoveryEpochRef.current === epoch &&
        projectPathRef.current === project &&
        filePathRef.current === path &&
        editorRef.current?.getModel() === targetModel &&
        !pendingSuggestionRef.current &&
        !actionInFlightRef.current;
      let descriptor: PendingSuggestionDescriptor | null = null;
      try {
        descriptor = await loadPendingSuggestion(project, path);
        if (!descriptor) return;
        const owner = descriptor;
        const recovered = repairAudit
          ? await enqueueWriteback(() =>
              withNativeDelivery(project, (ticket) =>
                recoverSuggestionOperations(project, owner, async (record) => {
                  if (
                    (await loadPendingSuggestion(project, path))?.owner !== owner.owner ||
                    !current()
                  )
                    throw new Error('恢复归属已变化，未补记旧记录');
                  await recordRevisionLoop({ ...record, deliveryTicket: ticket });
                }),
              ),
            )
          : await recoverSuggestionOperations(project, owner);
        if ((await loadPendingSuggestion(project, path))?.owner !== descriptor.owner || !current())
          return;
        if ((await settleSuggestionRun(project, descriptor, 'observe')) === 'failed') {
          await forgetPendingSuggestion(project, descriptor);
          emitPatchRejected({
            filePath: path,
            patchId: descriptor.proposal.id,
            direction: '',
            runId: descriptor.proposal.runId,
            projectPath: project,
            assistantSessionId: descriptor.proposal.assistantSessionId,
            runStatus: 'failed',
          });
          if (current())
            setSuggestionStatus('原运行已确认拒绝；未恢复旧修订，已有正文修改保持不变');
          return;
        }
        const displayed = targetModel.getValue();
        const projection = projectRemainingSuggestion(
          displayed,
          recovered.changeSet,
          recovered.appliedOpIds,
        );
        if (projection.finished) {
          const runStatus = await settleSuggestionRun(project, descriptor);
          await forgetPendingSuggestion(project, descriptor);
          if (runStatus)
            emitAuthorLoopResult({
              filePath: path,
              status: 'completed',
              action: 'revision_accepted',
              message: '已核验原来那次写入并结算原运行；未再次写入正文',
              runId: descriptor.proposal.runId,
              projectPath: project,
              assistantSessionId: descriptor.proposal.assistantSessionId,
              runStatus,
            });
          return;
        }
        const restored = {
          ...descriptor.proposal,
          before: displayed,
          after: projection.after,
          requiresConfirmation: true,
          operationView: projection.view,
        };
        suggestionOperationStates.set(restored, {
          suggestionId: restored.id,
          ...recovered,
          opIssueIds: associateIssuesToOps(
            recovered.changeSet.operations,
            restored.issueScopes ?? [],
          ),
          recovery: { projectPath: project, descriptor, ready: Promise.resolve() },
        });
        updatePendingSuggestion(restored, { fresh: true });
        setSuggestionStatus('已核验并恢复待确认修订；只保留原剩余修改，请确认后写进文件');
      } catch (error) {
        if (!current()) return;
        emitToast(`修订恢复未完成：${error instanceof Error ? error.message : String(error)}`, {
          tone: 'error',
          action: {
            label:
              error instanceof MissingSuggestionAudit
                ? '补记记录（不重写正文）'
                : '重试核验（不写正文）',
            run: async () => {
              if (
                descriptor &&
                (await loadPendingSuggestion(project, path))?.owner === descriptor.owner &&
                current()
              )
                await recover(path, error instanceof MissingSuggestionAudit);
            },
          },
        });
      }
    },
    [
      enqueueWriteback,
      emitAuthorLoopResult,
      recordRevisionLoop,
      editorRef,
      filePathRef,
      modelCacheRef,
      projectPathRef,
      setSuggestionStatus,
      updatePendingSuggestion,
      actionInFlightRef,
      mountedRef,
      pendingSuggestionRef,
      recoveryEpochRef,
    ],
  );

  const forgetSuggestionRecovery = useCallback(
    async (suggestion: AssistantFileSuggestion, accepted = false) => {
      const recovery = suggestionOperationStates.get(suggestion)?.recovery;
      if (!recovery) return true;
      await recovery.ready;
      const runStatus = await settleSuggestionRun(
        recovery.projectPath,
        recovery.descriptor,
        accepted ? 'accept' : 'reject',
      );
      try {
        await enqueueWriteback(() =>
          forgetPendingSuggestion(recovery.projectPath, recovery.descriptor),
        );
        return runStatus ?? true;
      } catch (error) {
        // Keep incomplete evidence; a cleanup error cannot undo the manuscript or retain the action lock.
        if (mountedRef.current && projectPathRef.current === recovery.projectPath)
          emitToast(
            `恢复缓存未清理，原写入证据已保留：${String(error)}。请先核对或补记，勿重复应用。`,
            {
              tone: 'info',
            },
          );
        return false;
      }
    },
    [enqueueWriteback, projectPathRef, mountedRef],
  );

  return {
    resetSuggestionWriteback,
    adoptPendingSuggestion,
    recoverPendingSuggestion,
    forgetSuggestionRecovery,
  };
}

export type SuggestionIntake = ReturnType<typeof useSuggestionIntake>;
