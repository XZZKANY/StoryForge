import { useCallback, useEffect, useRef } from 'react';

import {
  AUTHOR_LOOP_RESULT_EVENT,
  PATCH_REJECTED_EVENT,
  SUGGESTION_RESULT_EVENT,
  emitAcceptCurrentFileSuggestion,
  requestRejectCurrentFileSuggestion,
  type AuthorLoopResult,
  type PatchRejection,
  type SuggestionResult,
} from '../../lib/assistant-events';
import { emitToast } from '../../lib/toast';
import {
  executeIdeCommand,
  isAgentErrorMessage,
  isAgentResultMessage,
  sendAgentControlMessage,
  type AgentControlMessageType,
  type AgentResultMessage,
  type AgentSocketMessage,
} from '../../lib/api-client';
import { relativePath } from './path-utils';
import { recoveryDisplayFromCheckpoint } from './recovery';
import { useAgentRunReconciliation } from './useAgentRunReconciliation';
import { shouldApplyAgentControlAck } from './agent-result';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import { startWritingRunProjectionSubscription } from './writing-run';
import type { AgentRunControlHandlers, AgentRunStatus, AgentStep, ChapterBrief } from './types';
import type { ChatWindowState } from './useChatWindowState';
import type { RunAuthorAgent } from './useRunAuthorAgent';

type RecoveryHandlers = {
  updateAgentStep: (stepId: string, patch: Partial<AgentStep>) => void;
  updateAgentStatus: (status: AgentRunStatus) => void;
  refreshAgentRunRecovery: (runId: string) => Promise<void>;
  applyResumedAgentResult: (response: AgentResultMessage) => void;
  applyResumeDiagnostic: (diagnostic: Record<string, unknown>) => void;
};

export function useAgentRunControls(
  state: ChatWindowState,
  runAuthorAgent: RunAuthorAgent,
  applyAgentStreamEvent: (message: AgentSocketMessage) => void,
  recovery: RecoveryHandlers,
) {
  const {
    retryRequest,
    agentBusy,
    agentRunRecovery,
    setAgentRunRecovery,
    setAgentBusy,
    setMessages,
    agentRun,
    pendingRepairCommand,
    setPendingRepairCommand,
    setChapterBrief,
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    projectPathRef,
    writingRunProjection,
    setWritingRunProjection,
    unsubscribeWritingRunRef,
  } = state;
  const {
    updateAgentStep,
    updateAgentStatus,
    refreshAgentRunRecovery,
    applyResumedAgentResult,
    applyResumeDiagnostic,
  } = recovery;

  const {
    prepareResume,
    settleResume,
    isResumeSettled,
    markUnknown,
    reconcile,
    captureCurrentRun,
  } = useAgentRunReconciliation(state, applyResumedAgentResult);
  const pendingResumeRef = useRef<string | null>(null);

  const retryLastFailedRun = useCallback(() => {
    if (
      !retryRequest ||
      agentRun?.status !== 'failed' ||
      agentBusy ||
      agentRun.deliveryUnknown ||
      agentRunRecovery?.checkpointResume
    )
      return;
    setMessages((prev) => [...prev, { role: 'user', content: `重试：${retryRequest.goal}` }]);
    void runAuthorAgent(retryRequest.goal, retryRequest.action, retryRequest.intent, [], {
      useMainModel: retryRequest.useMainModel,
    });
  }, [agentBusy, agentRun, agentRunRecovery, retryRequest, runAuthorAgent, setMessages]);

  // 写作任务进度订阅断线后的手动重连：先摘掉丢失标记，重连失败会再标回。
  const retryWritingRunSubscription = useCallback(() => {
    const projection = writingRunProjection;
    if (!projection || projection.latestEvent !== 'error') return;
    setWritingRunProjection((current) =>
      current && current.latestEvent === 'error'
        ? { ...current, latestEvent: '重连中', failureReason: null }
        : current,
    );
    startWritingRunProjectionSubscription(
      projection.writingRunId,
      unsubscribeWritingRunRef,
      setWritingRunProjection,
    );
  }, [setWritingRunProjection, unsubscribeWritingRunRef, writingRunProjection]);

  const sendAgentRunControl = useCallback(
    async (type: AgentControlMessageType, payload: Record<string, unknown> = {}) => {
      const run = agentRun;
      if (!run) return;
      if (run.deliveryUnknown && type !== 'pause_run' && type !== 'stop_run') return;
      const active = captureCurrentRun(run);
      const settledAtDispatch = isResumeSettled(run.id);
      // A denied checkpoint is a reconciliation task, never a replay/new-run shortcut.
      if (type === 'resume_run') {
        if (
          agentRunRecovery?.checkpointResume?.canResume === false ||
          pendingResumeRef.current === run.id ||
          agentBusy
        )
          return;
        pendingResumeRef.current = run.id;
        setAgentBusy(true);
      }
      if (type === 'approve_permission' && pendingRepairCommand) {
        try {
          await executeIdeCommand(pendingRepairCommand.command_id, pendingRepairCommand.args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `修复写回失败，补丁仍在等待确认：${message}` },
          ]);
          return;
        }
        setPendingRepairCommand(null);
        setMessages((prev) => [...prev, { role: 'assistant', content: '修复补丁已执行写回。' }]);
      } else if (type === 'deny_permission' && pendingRepairCommand) {
        setPendingRepairCommand(null);
      }
      let dispatched = false;
      let delivering = false;
      try {
        if (type === 'resume_run') {
          if (!(await prepareResume(run))) return;
        }
        dispatched = true;
        const ack = await sendAgentControlMessage({
          sessionId: run.sessionId,
          runId: run.id,
          type,
          payload: { source: 'desktop.timeline', ...payload },
        });
        if (
          !active() ||
          !shouldApplyAgentControlAck(
            agentRunIdRef.current,
            run.id,
            typeof ack.run_id === 'string' ? ack.run_id : undefined,
          )
        ) {
          return;
        }
        if ((type === 'resume_run' || !settledAtDispatch) && isResumeSettled(run.id)) return;
        if (isAgentErrorMessage(ack)) {
          if (type === 'resume_run') {
            settleResume(run.id);
            setAgentBusy(false);
          }
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Agent 控制失败：${ack.detail}` },
          ]);
          return;
        }
        if (
          ack.resumed_result &&
          (!isAgentResultMessage(ack.resumed_result) ||
            ack.resumed_result.run_id !== run.id ||
            ack.resumed_result.session_id !== run.sessionId)
        ) {
          throw new Error('恢复结果与当前运行不匹配，不能作为本轮结果交付。');
        }
        if (ack.resumed_result && isAgentResultMessage(ack.resumed_result)) {
          if (settleResume(run.id)) {
            setChapterBrief(null);
            delivering = true;
            applyResumedAgentResult(ack.resumed_result);
          }
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
        if (run.deliveryUnknown) {
          // Control acceptance/settlement is not delivery of the missing result. Read the original run.
          void reconcile();
          return;
        }
        applyAgentStreamEvent(ack);
        if (ack.resume_diagnostic) {
          applyResumeDiagnostic(ack.resume_diagnostic);
          if (ack.runtime_state === 'settled') settleResume(run.id);
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
      } catch (error) {
        if (
          !active() ||
          ((type === 'resume_run' || !settledAtDispatch) && !delivering && isResumeSettled(run.id))
        )
          return;
        const message = error instanceof Error ? error.message : String(error);
        if (type === 'resume_run' && dispatched) {
          markUnknown(run);
          const checkpoint = agentRunRecovery?.checkpointResume;
          setAgentRunRecovery(
            recoveryDisplayFromCheckpoint({
              canResume: false,
              artifactId: checkpoint?.artifactId ?? null,
              message: '恢复：请求结果未知，需要核对本轮状态；不会自动重放。',
            }),
          );
        }
        if (type === 'resume_run' && !dispatched) setAgentBusy(false);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              type === 'resume_run' && dispatched
                ? `恢复请求结果未知，不能判定执行是否结束；请核对本轮，不要重新执行：${message}`
                : `Agent 控制失败：${message}`,
          },
        ]);
      } finally {
        if (type === 'resume_run' && pendingResumeRef.current === run.id)
          pendingResumeRef.current = null;
      }
    },
    [
      agentBusy,
      captureCurrentRun,
      prepareResume,
      reconcile,
      settleResume,
      isResumeSettled,
      markUnknown,
      setAgentBusy,
      setAgentRunRecovery,
      agentRun,
      agentRunRecovery,
      agentRunIdRef,
      applyAgentStreamEvent,
      applyResumeDiagnostic,
      applyResumedAgentResult,
      pendingRepairCommand,
      refreshAgentRunRecovery,
      setMessages,
      setPendingRepairCommand,
      setChapterBrief,
    ],
  );

  const agentRunControls: AgentRunControlHandlers = {
    onApprovePermission: () => void sendAgentRunControl('approve_permission'),
    onDenyPermission: () => void sendAgentRunControl('deny_permission'),
    onPauseRun: () => void sendAgentRunControl('pause_run'),
    onResumeRun: () => void sendAgentRunControl('resume_run'),
    onReconcileRun: () => void reconcile(),
    onStopRun: () => void sendAgentRunControl('stop_run'),
    onConfirmChapterBrief: (brief: ChapterBrief) =>
      void sendAgentRunControl('resume_run', {
        chapter_brief: {
          brief_id: brief.briefId,
          revision: brief.revision,
          chapter_title: brief.chapterTitle,
          goal: brief.goal,
          pov: brief.pov,
          setting: brief.setting,
          required_beats: brief.requiredBeats,
          forbidden_items: brief.forbiddenItems,
          continuity_constraints: brief.continuityConstraints,
          target_chars_min: brief.targetCharsMin,
          target_chars_max: brief.targetCharsMax,
        },
      }),
    onAcceptPatch: () => {
      const approvalStep = agentRun?.steps.find((step) => step.id === 'approval');
      if (!approvalStep?.patchId || !approvalStep.filePath) return;
      const handled = emitAcceptCurrentFileSuggestion({
        patchId: approvalStep.patchId,
        filePath: approvalStep.filePath,
      });
      if (!handled) emitToast('补丁目标仍在打开，请稍后再试', { tone: 'info' });
    },
    onRejectPatch: (direction: string) => {
      if (!agentRun) return;
      const approvalStep = agentRun.steps.find((s) => s.id === 'approval');
      if (!approvalStep?.filePath) return;
      if (!approvalStep.patchId) return;
      const handled = requestRejectCurrentFileSuggestion({
        filePath: approvalStep.filePath,
        patchId: approvalStep.patchId,
        direction,
      });
      if (!handled) emitToast('补丁目标仍在打开，请稍后再试', { tone: 'info' });
    },
  };

  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      if (
        !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKeyRef.current,
        )
      ) {
        return;
      }
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在编辑器里查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'ready' ? 'waiting' : 'failed',
          detail: result.status === 'ready' ? '等待作者在编辑器里确认 diff' : result.message,
        });
        updateAgentStatus(result.status === 'ready' ? 'waiting' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onResult);
  }, [
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    projectPathRef,
    runStartConversationKeyRef,
    setMessages,
    updateAgentStatus,
    updateAgentStep,
  ]);

  // A resolved author decision completes the approval step; the run keeps its persisted outcome.
  useEffect(() => {
    const onPatchRejected = (event: Event) => {
      const rejection = (event as CustomEvent<PatchRejection>).detail;
      if (!rejection || !agentRunIdRef.current) return;
      if (
        rejection.runId &&
        (rejection.runId !== agentRunIdRef.current ||
          rejection.projectPath !== projectPathRef.current ||
          rejection.assistantSessionId !== assistantSessionIdRef.current)
      )
        return;
      if (
        !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKeyRef.current,
        )
      ) {
        return;
      }
      updateAgentStep('approval', {
        status: 'completed',
        detail: rejection.direction ? '作者否掉了这版，已按新说法重来' : '作者否掉了这版',
      });
      if (rejection.runStatus) {
        updateAgentStatus(rejection.runStatus);
        if (rejection.runId) void refreshAgentRunRecovery(rejection.runId);
      } else if (!rejection.runId) updateAgentStatus('completed');
    };
    window.addEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
    return () => window.removeEventListener(PATCH_REJECTED_EVENT, onPatchRejected);
  }, [
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    projectPathRef,
    refreshAgentRunRecovery,
    runStartConversationKeyRef,
    updateAgentStatus,
    updateAgentStep,
  ]);

  useEffect(() => {
    const onAuthorLoopResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (!result) return;
      if (
        result.runId &&
        (result.projectPath !== projectPathRef.current ||
          result.assistantSessionId !== assistantSessionIdRef.current)
      )
        return;
      if (
        !result.runId &&
        !isRunResultForActiveSession(
          conversationKey(
            projectPathRef.current,
            assistantSessionIdRef.current,
            draftNonceRef.current,
          ),
          runStartConversationKeyRef.current,
        )
      ) {
        return;
      }
      const ref = relativePath(projectPathRef.current, result.filePath);
      const content =
        result.status === 'completed'
          ? result.action === 'exported'
            ? `作者闭环已完成：\`${ref}\` 已导出为交付稿。\n${result.artifactPath ?? result.message}`
            : result.warning
              ? `正文已写回，但闭环记录未完成：\`${ref}\` 的记录需要补齐，不要重新应用补丁。\n${result.warning}`
              : `作者闭环已完成：\`${ref}\` 已写回正文，并生成闭环记录。\n${result.recordPath ?? result.message}`
          : `作者闭环失败：${result.message}`;
      if (result.runId && agentRunIdRef.current === result.runId) {
        updateAgentStep('approval', {
          status: result.status === 'completed' ? 'completed' : 'failed',
          detail: result.artifactPath ?? result.recordPath ?? result.message,
        });
        if (result.runStatus) {
          updateAgentStatus(result.runStatus);
          void refreshAgentRunRecovery(result.runId);
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            content +
            (result.runStatus === 'failed'
              ? '\n原运行仍有执行失败；接受这份修订不代表整轮成功。'
              : ''),
        },
      ]);
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
  }, [
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    projectPathRef,
    refreshAgentRunRecovery,
    runStartConversationKeyRef,
    setMessages,
    updateAgentStatus,
    updateAgentStep,
  ]);

  return { retryLastFailedRun, retryWritingRunSubscription, agentRunControls };
}
