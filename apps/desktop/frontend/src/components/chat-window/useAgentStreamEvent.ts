import { useCallback } from 'react';

import {
  isAgentControlAckMessage,
  isAgentPermissionRequiredMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
  type AgentSocketMessage,
} from '../../lib/api-client';
import { isAgentPermissionProfile } from '../../lib/agent-permission';
import { stepFromAgentPlanEvent, stepFromToolTraceEvent } from './agent-step-mapping';
import { conversationKey, isRunResultForActiveSession } from './session-guard';
import type { AgentRun, AgentStep } from './types';
import type { ChatWindowState } from './useChatWindowState';

export function useAgentStreamEvent(
  state: ChatWindowState,
  refreshAgentRunRecovery: (runId: string) => Promise<void>,
) {
  const {
    agentRunIdRef,
    assistantSessionIdRef,
    projectPathRef,
    draftNonceRef,
    runStartConversationKeyRef,
    setAgentRun,
    setAgentBusy,
  } = state;

  return useCallback(
    (message: AgentSocketMessage) => {
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
      if (isAgentRunStartedMessage(message)) {
        const permissionProfile = message.permission_profile;
        if (isAgentPermissionProfile(permissionProfile)) {
          setAgentRun((run) =>
            run && run.id === message.run_id ? { ...run, permissionProfile } : run,
          );
        }
        return;
      }
      if (isAgentStepEventMessage(message)) {
        const nextStep = stepFromAgentPlanEvent(
          message.index,
          message.step,
          message.detail,
          message.status,
        );
        setAgentRun((run) => (run?.id === message.run_id ? upsertAgentStep(run, nextStep) : run));
        return;
      }
      if (isAgentToolTraceEventMessage(message)) {
        const nextStep = stepFromToolTraceEvent(message.index, message.trace);
        setAgentRun((run) => (run?.id === message.run_id ? upsertAgentStep(run, nextStep) : run));
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
          if (run?.id !== message.run_id) return run;
          const next = upsertAgentStep(run, nextStep);
          return next ? { ...next, status: 'waiting' } : next;
        });
        // 权限事件不是 worker 出口；busy 由最终结果或 settled ACK 释放。
        void refreshAgentRunRecovery(message.run_id);
        return;
      }
      if (isAgentControlAckMessage(message)) {
        if (message.run_id !== agentRunIdRef.current) return;
        // recorded 只证明命令记账。必须等 API 证实执行已结束，不能按按钮名伪造终态。
        if (message.control_effect === 'requested') {
          const stopping = message.type === 'stop_run';
          const nextStep: AgentStep = {
            id: 'runtime-control',
            title: stopping ? '正在停止' : '正在暂停',
            tool: 'agent.runtime.control',
            status: 'running',
            detail: stopping ? '已请求停止，等待当前操作结束' : '已请求暂停，等待当前操作结束',
          };
          setAgentRun((run) =>
            run &&
            run.id === message.run_id &&
            run.status !== 'completed' &&
            run.status !== 'failed' &&
            run.status !== 'stopped'
              ? upsertAgentStep(run, nextStep)
              : run,
          );
        } else if (message.control_effect === 'applied' && message.runtime_state === 'settled') {
          const nextStatus = agentStatusFromControl(message.run_status);
          if (nextStatus) {
            setAgentRun((run) =>
              run && run.id === message.run_id
                ? {
                    ...run,
                    status:
                      nextStatus === 'completed' && run.executionOutcome ? 'failed' : nextStatus,
                    steps: run.steps.map((step) => {
                      if (step.id === 'runtime-control') {
                        return { ...step, status: 'completed', detail: '当前操作已结束。' };
                      }
                      if (
                        step.id === 'permission-required' &&
                        message.type === 'permission_approved'
                      ) {
                        return { ...step, status: 'completed', detail: '作者已批准权限请求。' };
                      }
                      if (
                        step.id === 'permission-required' &&
                        message.type === 'permission_denied'
                      ) {
                        return { ...step, status: 'failed', detail: '作者已拒绝权限请求。' };
                      }
                      return step;
                    }),
                  }
                : run,
            );
            setAgentBusy(nextStatus === 'running');
          }
        }
        void refreshAgentRunRecovery(message.run_id);
      }
    },
    [
      agentRunIdRef,
      assistantSessionIdRef,
      draftNonceRef,
      projectPathRef,
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

function agentStatusFromControl(status: string | null | undefined): AgentRun['status'] | null {
  return status === 'running' ||
    status === 'waiting' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'paused' ||
    status === 'stopped'
    ? status
    : null;
}
