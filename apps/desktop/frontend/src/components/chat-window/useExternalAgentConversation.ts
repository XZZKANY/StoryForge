import { useCallback, useEffect, useRef } from 'react';
import { useExternalWritebackCoordinator } from '../app/ExternalWritebackProvider';
import {
  isAgentErrorMessage,
  isAgentResultMessage,
  isAgentRunWaitingMessage,
} from '../../lib/api-client';
import type { AgentSocketMessage } from '../../lib/api/types';
import type { ChatWindowState } from './useChatWindowState';
import type { AgentRunStatus, ChatWindowProps } from './types';
import { statusFromAgentResult, textSettlementFromAgentResult } from './resumed-result';

/** External waits are routed to App, not projected into the legacy suggestion queue. */
export function useExternalAgentConversation(
  state: ChatWindowState,
  updateStatus: (status: AgentRunStatus) => void,
  refresh: (runId: string) => Promise<void>,
  onSessionChange: ChatWindowProps['onAssistantSessionChange'],
) {
  const coordinator = useExternalWritebackCoordinator();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const {
    assistantSessionIdRef,
    selfPersistedSessionIdRef,
    agentRunIdRef,
    projectPathRef,
    setAgentBusy,
    setAgentRun,
    textStream,
  } = state;
  const handleWaiting = useCallback(
    async (
      response: AgentSocketMessage,
      scope: {
        negotiated: boolean;
        project: string;
        runId: string;
        owned: boolean;
      },
    ) => {
      if (!isAgentRunWaitingMessage(response)) return false;
      if (!scope.negotiated || !coordinator) throw new Error('未协商的等待协议，已阻止投递');
      if (scope.owned) {
        textStream.hold(scope.runId, 'working');
        const draft = assistantSessionIdRef.current === null;
        assistantSessionIdRef.current = response.assistant_session_id;
        if (draft) selfPersistedSessionIdRef.current = response.assistant_session_id;
        onSessionChange?.(response.assistant_session_id);
        updateStatus('waiting');
        setAgentRun((run) =>
          run?.id === scope.runId ? { ...run, executionProtocol: response.protocol } : run,
        );
        setAgentBusy(false);
        void refresh(scope.runId);
      }
      // reset/begin/settle revoke this page projection permanently, including A -> B -> A.
      // Self-persisting the same draft does not change the revision.
      const textRevision = textStream.revision();
      const onResult = (result: AgentSocketMessage) => {
        if (
          !mounted.current ||
          textStream.revision() !== textRevision ||
          agentRunIdRef.current !== scope.runId ||
          projectPathRef.current !== scope.project ||
          assistantSessionIdRef.current !== response.assistant_session_id
        )
          return;
        if (isAgentResultMessage(result)) {
          updateStatus(statusFromAgentResult(result));
          textStream.settle(
            scope.runId,
            textSettlementFromAgentResult(
              result,
              result.agent_result.summary ?? '原运行已经完成。',
            ),
            statusFromAgentResult(result),
          );
        } else if (isAgentErrorMessage(result)) {
          updateStatus('failed');
          textStream.settle(scope.runId, { kind: 'diagnostic', detail: result.detail }, 'failed');
        }
        setAgentBusy(false);
        void refresh(scope.runId);
      };
      // App may track an old wait, but it must not replace an owned page callback.
      await coordinator.track(response, scope.project, scope.owned ? onResult : undefined);
      return true;
    },
    [
      coordinator,
      assistantSessionIdRef,
      selfPersistedSessionIdRef,
      onSessionChange,
      updateStatus,
      setAgentBusy,
      setAgentRun,
      refresh,
      agentRunIdRef,
      projectPathRef,
      textStream,
    ],
  );
  return { coordinator, handleWaiting };
}
