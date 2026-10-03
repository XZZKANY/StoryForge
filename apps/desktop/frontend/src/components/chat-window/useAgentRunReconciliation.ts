import { useCallback, useEffect, useRef } from 'react';
import {
  getAgentRunEvents,
  getAgentRunSavePoints,
  isAgentErrorMessage,
  isAgentResultMessage,
  type AgentResultMessage,
} from '../../lib/api-client';
import { readAgentRunWithin as boundedRead } from '../../lib/api/agent-delivery';
import { reconstructAgentResultFromEvents } from '../../lib/api/agent-run-events';
import { buildAgentRunRecoveryDisplay, recoveryDisplayFromCheckpoint } from './recovery';
import { checkpointResumeFromResult, statusFromAgentResult } from './resumed-result';
import { conversationKey } from './session-guard';
import type { AgentRun } from './types';
import type { ChatWindowState } from './useChatWindowState';

type ResumeObservation = {
  runId: string;
  sessionId: string;
  scope: string;
  afterSequence: number | null;
  settled: boolean;
};

/** Read-only observation of an already dispatched control, not a resume/retry implementation. */
export function useAgentRunReconciliation(
  state: ChatWindowState,
  applyResult: (result: AgentResultMessage) => void,
) {
  const observation = useRef<ResumeObservation | null>(null);
  const reading = useRef<{ runId: string } | null>(null);
  const lifetime = useRef({ key: '', epoch: 0, active: true });
  const {
    textStream,
    agentRun,
    agentRunIdRef,
    projectPathRef,
    assistantSessionIdRef,
    draftNonceRef,
    setAgentRun,
    setAgentBusy,
    setAgentRunRecovery,
    setMessages,
    setRetryRequest,
  } = state;
  const scope = useCallback(
    () =>
      conversationKey(projectPathRef.current, assistantSessionIdRef.current, draftNonceRef.current),
    [projectPathRef, assistantSessionIdRef, draftNonceRef],
  );
  useEffect(() => {
    const key = `${scope()}|run:${agentRun?.id ?? ''}|session:${agentRun?.sessionId ?? ''}`;
    if (lifetime.current.key !== key) {
      lifetime.current = { key, epoch: lifetime.current.epoch + 1, active: true };
    }
  });
  useEffect(() => {
    lifetime.current.active = true;
    return () => {
      lifetime.current.active = false;
    };
  }, []);

  const captureCurrentRun = useCallback(
    (run: AgentRun) => {
      const startedScope = scope();
      const epoch = lifetime.current.epoch;
      return () =>
        lifetime.current.active &&
        lifetime.current.epoch === epoch &&
        agentRunIdRef.current === run.id &&
        scope() === startedScope;
    },
    [agentRunIdRef, scope],
  );

  const prepareResume = useCallback(
    async (run: AgentRun) => {
      const active = captureCurrentRun(run);
      const events = await boundedRead((signal) => getAgentRunEvents(run.id, { signal }));
      if (!active()) return false;
      let afterSequence = 0;
      for (const event of events) {
        if (
          typeof event.sequence !== 'number' ||
          !Number.isSafeInteger(event.sequence) ||
          event.sequence < 1
        ) {
          throw new Error('无法读取当前运行的持久事件边界，尚未发送恢复请求。');
        }
        afterSequence = Math.max(afterSequence, event.sequence);
      }
      observation.current = {
        runId: run.id,
        sessionId: run.sessionId,
        scope: scope(),
        afterSequence,
        settled: false,
      };
      return true;
    },
    [captureCurrentRun, scope],
  );

  // A local delivery claim shared by readback and ACK. It does not claim exactly-once tool effects.
  const settleResume = useCallback((runId: string) => {
    const current = observation.current;
    if (current?.runId !== runId) return true;
    if (current.settled) return false;
    observation.current = { ...current, settled: true };
    return true;
  }, []);

  const isResumeSettled = useCallback(
    (runId: string) => observation.current?.runId === runId && observation.current.settled,
    [],
  );

  const markUnknown = useCallback(
    (run: AgentRun) => {
      if (observation.current?.runId !== run.id) {
        observation.current = {
          runId: run.id,
          sessionId: run.sessionId,
          scope: scope(),
          afterSequence: null,
          settled: false,
        };
      }
    },
    [scope],
  );

  const reconcile = useCallback(async () => {
    const run = agentRun;
    if (!run || reading.current?.runId === run.id) return;
    const unknown = run.deliveryUnknown;
    if (unknown && unknown.scope !== scope()) return;
    if (unknown && observation.current?.runId !== run.id) {
      // A new user request has no previous execution in this unique run. Controls use their own watermark.
      observation.current = {
        runId: run.id,
        sessionId: run.sessionId,
        scope: unknown.scope,
        afterSequence: 0,
        settled: false,
      };
    }
    const request = { runId: run.id };
    reading.current = request;
    const active = captureCurrentRun(run);
    try {
      const [events, projection] = await boundedRead((signal) =>
        Promise.all([
          getAgentRunEvents(run.id, { signal }),
          getAgentRunSavePoints(run.id, { signal }),
        ]),
      );
      if (!active()) return;
      if (projection.run_id !== run.id) throw new Error('运行核对结果归属不匹配。');
      let display = buildAgentRunRecoveryDisplay(projection);
      const current = observation.current;
      const observed =
        current?.runId === run.id &&
        current.sessionId === run.sessionId &&
        current.scope === scope()
          ? current
          : null;
      if (observed && !observed.settled) {
        const after = observed.afterSequence;
        const freshEvents =
          after === null
            ? []
            : events.filter(
                (event) =>
                  typeof event.sequence === 'number' &&
                  Number.isSafeInteger(event.sequence) &&
                  event.sequence > after,
              );
        const result = reconstructAgentResultFromEvents(freshEvents, {
          runId: run.id,
          sessionId: run.sessionId,
        });
        if (result && isAgentResultMessage(result)) {
          if (
            assistantSessionIdRef.current !== null &&
            result.assistant_session_id !== assistantSessionIdRef.current
          ) {
            throw new Error('运行结果所属会话不匹配，未交付。');
          }
          if (settleResume(run.id)) {
            applyResult(result);
            setRetryRequest(
              unknown && statusFromAgentResult(result) === 'failed' ? unknown.retryRequest : null,
            );
          }
          if (unknown && statusFromAgentResult(result) !== 'paused') display = null;
          const checkpoint = checkpointResumeFromResult(result);
          if (checkpoint && !checkpoint.canResume)
            display = recoveryDisplayFromCheckpoint(checkpoint);
        } else if (result && isAgentErrorMessage(result)) {
          if (unknown) display = null;
          if (settleResume(run.id)) {
            setAgentRun((value) =>
              value?.id === run.id
                ? { ...value, status: 'failed', deliveryUnknown: undefined }
                : value,
            );
            if (unknown) setRetryRequest(unknown.retryRequest);
            setAgentBusy(false);
            textStream.settle(run.id, { kind: 'diagnostic', detail: result.detail }, 'failed');
          }
        } else {
          if (unknown) {
            // No terminal evidence: retain uncertainty even when a savepoint says safe/failed.
            setAgentBusy(false);
            setMessages((value) => [
              ...value,
              {
                role: 'assistant',
                content: '尚未找到本轮终态，结果仍未知；可再次核对，不会重新执行。',
              },
            ]);
            return;
          }
          setAgentRunRecovery(
            recoveryDisplayFromCheckpoint({
              canResume: false,
              artifactId: display?.checkpointResume?.artifactId ?? null,
              message: display?.checkpointResume?.awaitingSettlement
                ? display.checkpointResume.message
                : '恢复：尚未找到本次请求的新结算，需要继续核对；不会自动重放。',
            }),
          );
          // Busy is an activity projection, not a proof of success. Unknown stays blocked above.
          setAgentBusy(
            projection.status === 'running' ||
              display?.checkpointResume?.awaitingSettlement === true,
          );
          return;
        }
      }
      setAgentRunRecovery(display);
      if (!observed && projection.status === 'paused') {
        // A reopened view trusts explicit recoverability, not a prior permission event's payload.
        setAgentRun((value) => (value?.id === run.id ? { ...value, status: 'paused' } : value));
        setAgentBusy(display?.checkpointResume?.awaitingSettlement === true);
      }
    } catch (error) {
      if (!active()) return;
      const message = error instanceof Error ? error.message : String(error);
      setMessages((value) => [
        ...value,
        { role: 'assistant', content: `核对本轮失败，未重新执行：${message}` },
      ]);
    } finally {
      if (reading.current === request) reading.current = null;
    }
  }, [
    textStream,
    agentRun,
    assistantSessionIdRef,
    applyResult,
    captureCurrentRun,
    scope,
    settleResume,
    setAgentBusy,
    setAgentRun,
    setAgentRunRecovery,
    setMessages,
    setRetryRequest,
  ]);

  return {
    prepareResume,
    settleResume,
    isResumeSettled,
    markUnknown,
    reconcile,
    captureCurrentRun,
  };
}
