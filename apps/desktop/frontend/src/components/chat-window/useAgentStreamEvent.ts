import { useCallback } from 'react';
import { isAgentTextFrame } from '../../lib/api/agent-text-stream';

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
import type { TextRoundStart } from './useChatTextStream';
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
    textStream,
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
      if (isAgentTextFrame(message)) {
        const started = textStream.accept(message);
        if (started)
          setAgentRun((run) => (run?.id === started.runId ? withRoundStarted(run, started) : run));
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
        textStream.roundTextDone(message.run_id);
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
        textStream.hold(message.run_id, 'working', false);
        const nextStep = stepFromToolTraceEvent(message.index, message.trace);
        setAgentRun((run) => (run?.id === message.run_id ? upsertAgentStep(run, nextStep) : run));
        return;
      }
      if (isAgentPermissionRequiredMessage(message)) {
        textStream.hold(message.run_id, 'working', false);
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
            if (nextStatus === 'stopped' || nextStatus === 'paused' || nextStatus === 'failed')
              textStream.hold(message.run_id, 'interrupted');
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
      textStream,
    ],
  );
}

/**
 * 新一轮开始：上一轮说完的话记进 notes（空话不记），再给新一轮占位。
 * 最后一轮的正文就是回答本身，没有下一轮来挪它，所以回答永远不会跑进思考过程。
 */
function withRoundStarted(run: AgentRun, started: TextRoundStart): AgentRun {
  const notes = [...(run.notes ?? [])];
  const toolIndex = run.steps.filter((step) => step.id.startsWith('tool-')).length;
  const previous = started.previous;
  const text = previous?.text.trim();
  if (previous && text) {
    let index = -1;
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      if (notes[i].round === previous.round) {
        index = i;
        break;
      }
    }
    if (index >= 0) notes[index] = { ...notes[index], text };
    else notes.push({ round: previous.round, toolIndex, text });
  }
  notes.push({ round: started.round, toolIndex, text: '' });
  return { ...run, notes };
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
