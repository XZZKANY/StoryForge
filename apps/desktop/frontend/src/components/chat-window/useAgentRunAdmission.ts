import { useCallback, useEffect, useRef } from 'react';
import { AgentRunOutcomeUnknownError } from '../../lib/api/agent-delivery';
import { conversationKey } from './session-guard';
import type { RetryRequest } from './types';
import type { ChatWindowState } from './useChatWindowState';

type AdmissionState = Pick<
  ChatWindowState,
  | 'agentBusy'
  | 'agentRun'
  | 'projectPathRef'
  | 'assistantSessionIdRef'
  | 'draftNonceRef'
  | 'setAgentRun'
  | 'setRetryRequest'
  | 'setAgentBusy'
  | 'setMessages'
>;

/** Owns the local dispatch claim and its uncertain-delivery lifetime, not backend execution. */
export function useAgentRunAdmission({
  agentBusy,
  agentRun,
  projectPathRef,
  assistantSessionIdRef,
  draftNonceRef,
  setAgentRun,
  setRetryRequest,
  setAgentBusy,
  setMessages,
}: AdmissionState) {
  const claim = useRef<{ scope: string; runId: string; unknown?: boolean } | null>(null);
  const lifetime = useRef({ scope: '', epoch: 0, active: true });
  useEffect(() => {
    const scope = conversationKey(
      projectPathRef.current,
      assistantSessionIdRef.current,
      draftNonceRef.current,
    );
    if (lifetime.current.scope !== scope)
      lifetime.current = { scope, epoch: lifetime.current.epoch + 1, active: true };
    if (claim.current?.unknown && agentRun?.id === claim.current.runId && !agentRun.deliveryUnknown)
      claim.current = null;
  });
  useEffect(() => {
    lifetime.current.active = true;
    return () => {
      lifetime.current.active = false;
    };
  }, []);

  const rejectBlockedAdmission = useCallback(
    (scope: string) => {
      if (agentRun?.deliveryUnknown?.scope === scope) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '这轮结果未知，请先核对状态；不会重新执行或启动新一轮。' },
        ]);
        return true;
      }
      if (agentBusy || claim.current?.scope === scope) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '这轮还在整理。我先把当前读取、修订或确认收口，再接新的问题。',
          },
        ]);
        return true;
      }
      return false;
    },
    [agentBusy, agentRun, setMessages],
  );

  const claimRun = useCallback((scope: string, runId: string) => {
    claim.current = { scope, runId };
    const epoch = lifetime.current.epoch;
    return () => lifetime.current.active && lifetime.current.epoch === epoch;
  }, []);

  const retainUnknown = useCallback(
    (error: unknown, scope: string, runId: string, retryRequest: RetryRequest) => {
      if (
        !(error instanceof AgentRunOutcomeUnknownError) ||
        error.runId !== runId ||
        error.sessionId !== runId
      ) {
        return false;
      }
      claim.current = { scope, runId, unknown: true };
      setAgentRun((run) =>
        run?.id === runId ? { ...run, deliveryUnknown: { scope, retryRequest } } : run,
      );
      setRetryRequest(null);
      setAgentBusy(false);
      setMessages((prev) => [...prev, { role: 'assistant', content: error.message }]);
      return true;
    },
    [setAgentRun, setRetryRequest, setAgentBusy, setMessages],
  );

  const releaseClaim = useCallback((runId: string) => {
    if (claim.current?.runId === runId && !claim.current.unknown) claim.current = null;
  }, []);

  return { rejectBlockedAdmission, claimRun, retainUnknown, releaseClaim };
}
