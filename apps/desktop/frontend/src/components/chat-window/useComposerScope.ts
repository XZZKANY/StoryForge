import { useLayoutEffect, useState, type RefObject } from 'react';

// A newly persisted ID still belongs to the current draft; only actual navigation resets it.
export function useComposerScope(
  projectPath: string | null | undefined,
  assistantSessionId: number | null | undefined,
  selfPersistedSessionIdRef: RefObject<number | null>,
) {
  const [scope, setScope] = useState({
    project: projectPath,
    session: assistantSessionId ?? null,
    generation: 0,
  });
  useLayoutEffect(() => {
    const session = assistantSessionId ?? null;
    const selfPersisted = session !== null && selfPersistedSessionIdRef.current === session;
    setScope((previous) => {
      if (previous.project === projectPath && previous.session === session) return previous;
      return {
        project: projectPath,
        session,
        generation:
          previous.generation + (previous.project === projectPath && selfPersisted ? 0 : 1),
      };
    });
  }, [projectPath, assistantSessionId, selfPersistedSessionIdRef]);
  return {
    composerKey: scope.generation,
    resetComposer: () =>
      setScope((previous) => ({ ...previous, generation: previous.generation + 1 })),
  };
}
