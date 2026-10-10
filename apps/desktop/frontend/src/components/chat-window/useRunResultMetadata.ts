import { useCallback } from 'react';
import type { AgentResultMessage } from '../../lib/api-client';
import type { ChatWindowState } from './useChatWindowState';
import type { ChatWindowProps } from './types';
import { conversationKey } from './session-guard';
import { titleFromSystemJobs } from './conversation-utils';

/** Existing final-result metadata projection, kept apart from external wait dispatch. */
export function useRunResultMetadata(
  state: ChatWindowState,
  onSessionChange: ChatWindowProps['onAssistantSessionChange'],
) {
  const {
    assistantSessionIdRef,
    runStartConversationKeyRef,
    projectPathRef,
    selfPersistedSessionIdRef,
    setConversationTitle,
  } = state;
  return useCallback(
    (response: AgentResultMessage) => {
      const draft = assistantSessionIdRef.current === null;
      assistantSessionIdRef.current = response.assistant_session_id;
      runStartConversationKeyRef.current = conversationKey(
        projectPathRef.current,
        response.assistant_session_id,
        '',
      );
      if (draft) selfPersistedSessionIdRef.current = response.assistant_session_id;
      onSessionChange?.(response.assistant_session_id);
      const title = titleFromSystemJobs(response);
      if (title) setConversationTitle(title);
    },
    [
      assistantSessionIdRef,
      runStartConversationKeyRef,
      projectPathRef,
      selfPersistedSessionIdRef,
      onSessionChange,
      setConversationTitle,
    ],
  );
}
