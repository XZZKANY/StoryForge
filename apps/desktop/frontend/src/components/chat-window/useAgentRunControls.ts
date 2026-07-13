import { useCallback, useEffect } from 'react';

import {
  AUTHOR_LOOP_RESULT_EVENT,
  SUGGESTION_RESULT_EVENT,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../../lib/assistant-events';
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
import { shouldApplyAgentControlAck } from './agent-result';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import type { AgentRunControlHandlers, AgentStep } from './types';
import type { ChatWindowState } from './useChatWindowState';
import type { RunAuthorAgent } from './useRunAuthorAgent';

type RecoveryHandlers = {
  updateAgentStep: (stepId: string, patch: Partial<AgentStep>) => void;
  updateAgentStatus: (status: 'running' | 'waiting' | 'completed' | 'failed') => void;
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
    setMessages,
    agentRun,
    pendingRepairCommand,
    setPendingRepairCommand,
    agentRunIdRef,
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    projectPathRef,
  } = state;
  const {
    updateAgentStep,
    updateAgentStatus,
    refreshAgentRunRecovery,
    applyResumedAgentResult,
    applyResumeDiagnostic,
  } = recovery;

  const retryLastFailedRun = useCallback(() => {
    if (!retryRequest || agentBusy) return;
    setMessages((prev) => [...prev, { role: 'user', content: `重试：${retryRequest.goal}` }]);
    void runAuthorAgent(retryRequest.goal, retryRequest.action, retryRequest.intent);
  }, [agentBusy, retryRequest, runAuthorAgent, setMessages]);

  const sendAgentRunControl = useCallback(
    async (type: AgentControlMessageType) => {
      const run = agentRun;
      if (!run) return;
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
      try {
        const ack = await sendAgentControlMessage({
          sessionId: run.sessionId,
          runId: run.id,
          type,
          payload: { source: 'desktop.timeline' },
        });
        if (
          !shouldApplyAgentControlAck(
            agentRunIdRef.current,
            run.id,
            typeof ack.run_id === 'string' ? ack.run_id : undefined,
          )
        ) {
          return;
        }
        if (isAgentErrorMessage(ack)) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Agent 控制失败：${ack.detail}` },
          ]);
          return;
        }
        applyAgentStreamEvent(ack);
        if (ack.resumed_result && isAgentResultMessage(ack.resumed_result)) {
          applyResumedAgentResult(ack.resumed_result);
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
        if (ack.resume_diagnostic) {
          applyResumeDiagnostic(ack.resume_diagnostic);
          void refreshAgentRunRecovery(ack.run_id);
          return;
        }
        if (type === 'approve_permission') {
          updateAgentStep('permission-required', {
            status: 'completed',
            detail: '作者已批准权限请求。',
          });
          updateAgentStatus('completed');
        } else if (type === 'deny_permission') {
          updateAgentStep('permission-required', {
            status: 'failed',
            detail: '作者已拒绝权限请求。',
          });
          updateAgentStatus('failed');
        } else if (type === 'pause_run') {
          updateAgentStatus('waiting');
        } else if (type === 'resume_run') {
          updateAgentStatus('running');
        } else if (type === 'stop_run') {
          updateAgentStatus('failed');
        }
      } catch (error) {
        if (agentRunIdRef.current !== run.id) return;
        const message = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Agent 控制失败：${message}` },
        ]);
      }
    },
    [
      agentRun,
      agentRunIdRef,
      applyAgentStreamEvent,
      applyResumeDiagnostic,
      applyResumedAgentResult,
      pendingRepairCommand,
      refreshAgentRunRecovery,
      setMessages,
      setPendingRepairCommand,
      updateAgentStatus,
      updateAgentStep,
    ],
  );

  const agentRunControls: AgentRunControlHandlers = {
    onApprovePermission: () => void sendAgentRunControl('approve_permission'),
    onDenyPermission: () => void sendAgentRunControl('deny_permission'),
    onPauseRun: () => void sendAgentRunControl('pause_run'),
    onResumeRun: () => void sendAgentRunControl('resume_run'),
    onStopRun: () => void sendAgentRunControl('stop_run'),
  };

  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      if (
        !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
          runStartConversationKeyRef.current,
        )
      ) {
        return;
      }
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在右侧查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'ready' ? 'waiting' : 'failed',
          detail: result.status === 'ready' ? '等待作者在右侧 diff 面板确认' : result.message,
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

  useEffect(() => {
    const onAuthorLoopResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (!result) return;
      if (
        !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
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
            : `作者闭环已完成：\`${ref}\` 已写回正文，并生成闭环记录。\n${result.recordPath ?? result.message}`
          : `作者闭环失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'completed' ? 'completed' : 'failed',
          detail: result.artifactPath ?? result.recordPath ?? result.message,
        });
        updateAgentStatus(result.status === 'completed' ? 'completed' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
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

  return { retryLastFailedRun, agentRunControls };
}
