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
import { statusFromAgentResult } from './resumed-result';

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
    setMessages,
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
      await coordinator.track(response, scope.project, (result) => {
        if (
          !mounted.current ||
          agentRunIdRef.current !== scope.runId ||
          projectPathRef.current !== scope.project ||
          assistantSessionIdRef.current !== response.assistant_session_id
        )
          return;
        if (isAgentResultMessage(result)) {
          updateStatus(statusFromAgentResult(result));
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: result.agent_result.summary ?? '原运行已经完成。' },
          ]);
        } else if (isAgentErrorMessage(result)) {
          updateStatus('failed');
          setMessages((prev) => [...prev, { role: 'assistant', content: result.detail }]);
        }
        setAgentBusy(false);
        void refresh(scope.runId);
      });
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
      setMessages,
    ],
  );
  return { coordinator, handleWaiting };
}
