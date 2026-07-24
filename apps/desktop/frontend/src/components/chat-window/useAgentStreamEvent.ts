import { useCallback } from 'react';

import {
  isAgentControlAckMessage,
  isAgentPermissionRequiredMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
  type AgentSocketMessage,
} from '../../lib/api-client';
import { stepFromAgentPlanEvent, stepFromToolTraceEvent } from './agent-step-mapping';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import type { AgentRun, AgentStep } from './types';
import type { ChatWindowState } from './useChatWindowState';

export function useAgentStreamEvent(
  state: ChatWindowState,
  refreshAgentRunRecovery: (runId: string) => Promise<void>,
) {
  const {
    assistantSessionIdRef,
    draftNonceRef,
    runStartConversationKeyRef,
    setAgentRun,
    setAgentBusy,
  } = state;

  return useCallback(
    (message: AgentSocketMessage) => {
      if (
        !isRunResultForActiveSession(
          conversationKey(assistantSessionIdRef.current, draftNonceRef.current),
          runStartConversationKeyRef.current,
        )
      ) {
        return;
      }
      if (isAgentRunStartedMessage(message)) return;
      if (isAgentStepEventMessage(message)) {
        const nextStep = stepFromAgentPlanEvent(
          message.index,
          message.step,
          message.detail,
          message.status,
        );
        setAgentRun((run) => upsertAgentStep(run, nextStep));
        return;
      }
      if (isAgentToolTraceEventMessage(message)) {
        const nextStep = stepFromToolTraceEvent(message.index, message.trace);
        setAgentRun((run) => upsertAgentStep(run, nextStep));
        return;
      }
      if (isAgentPermissionRequiredMessage(message)) {
        const nextStep: AgentStep = {
          id: 'permission-required',
          title: '等待权限确认',
          tool: 'permission-gate',
          status: 'waiting',
          detail: message.proposed_patch
            ? '已生成待确认修订，写回前需要作者批准。'
            : '该步骤需要作者批准后才能继续。',
        };
        setAgentRun((run) => {
          const next = upsertAgentStep(run, nextStep);
          return next ? { ...next, status: 'waiting' } : next;
        });
        setAgentBusy(false);
        void refreshAgentRunRecovery(message.run_id);
        return;
      }
      if (isAgentControlAckMessage(message)) {
        // 作者主动 停止/暂停 是控制态而非失败：stop→stopped(中性收尾)、pause→paused(留恢复入口)；
        // permission_denied 才是真失败。
        const nextStatus: AgentRun['status'] =
          message.type === 'permission_denied'
            ? 'failed'
            : message.type === 'stop_run'
              ? 'stopped'
              : message.type === 'pause_run'
                ? 'paused'
                : message.type === 'resume_run'
                  ? 'running'
                  : 'completed';
        setAgentRun((run) => (run ? { ...run, status: nextStatus } : run));
        setAgentBusy(nextStatus === 'running');
        void refreshAgentRunRecovery(message.run_id);
      }
    },
    [
      assistantSessionIdRef,
      draftNonceRef,
      refreshAgentRunRecovery,
      runStartConversationKeyRef,
      setAgentBusy,
      setAgentRun,
    ],
  );
}

function upsertAgentStep(run: AgentRun | null, nextStep: AgentStep): AgentRun | null {
  if (!run) return run;
  const exists = run.steps.some((step) => step.id === nextStep.id);
  return {
    ...run,
    steps: exists
      ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
      : [...run.steps, nextStep],
  };
}
