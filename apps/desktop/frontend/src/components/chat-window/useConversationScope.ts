import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ChatWindowState } from './useChatWindowState';

/** Navigation creates a new lifetime; persisting the current draft does not. */
export function useConversationScope(
  projectPath: string | null,
  assistantSessionId: number | null,
  {
    draftNonceRef,
    selfPersistedSessionIdRef,
  }: Pick<ChatWindowState, 'draftNonceRef' | 'selfPersistedSessionIdRef'>,
) {
  const [scope, setScope] = useState(0);
  const lifetimeRef = useRef<{
    projectPath: string | null;
    sessionId: number | null;
    nonce: string;
    scope: number;
    active: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const synchronize = () => {
      const previous = lifetimeRef.current;
      const sameProject = previous?.projectPath === projectPath;
      const persistedDraft =
        sameProject &&
        previous?.sessionId === null &&
        assistantSessionId !== null &&
        selfPersistedSessionIdRef?.current === assistantSessionId;
      const sameConversation =
        sameProject &&
        previous?.sessionId === assistantSessionId &&
        (assistantSessionId !== null || previous.nonce === draftNonceRef.current);
      if (previous && (sameConversation || persistedDraft)) {
        previous.sessionId = assistantSessionId;
        previous.nonce = draftNonceRef.current;
        previous.active = true;
        return;
      }
      const nextScope = previous ? previous.scope + 1 : scope;
      lifetimeRef.current = {
        projectPath,
        sessionId: assistantSessionId,
        nonce: draftNonceRef.current,
        scope: nextScope,
        active: true,
      };
      if (previous) setScope(nextScope);
    };
    synchronize();
  });

  useLayoutEffect(
    () => () => {
      if (lifetimeRef.current) lifetimeRef.current.active = false;
    },
    [],
  );

  const isCurrentScope = useCallback(
    () => lifetimeRef.current?.active === true && lifetimeRef.current.scope === scope,
    [scope],
  );
  return { scope, isCurrentScope };
}
