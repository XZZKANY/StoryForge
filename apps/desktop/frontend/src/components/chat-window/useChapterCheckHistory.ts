import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readAgentRunWithin } from '../../lib/api/agent-delivery';
import { queryChapterCheckHistory, type ChapterCheckHistory } from '../../lib/api/chapter-checks';

type Owner = { project: string; session: number; active: boolean };
type Snapshot = ChapterCheckHistory & { owner: Owner; refresh: string; error: string | null };

/** Read-only evidence. Scope generations, not path equality, own asynchronous delivery. */
export function useChapterCheckHistory(
  projectPath: string | null,
  assistantSessionId: number | null | undefined,
  refreshKey = 'history',
) {
  const owner = useRef<Owner | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [retry, setRetry] = useState(0);
  const enabled = !!projectPath && !!assistantSessionId;
  const refresh = `${refreshKey}:${retry}`;
  useLayoutEffect(() => {
    if (!projectPath || !assistantSessionId) {
      owner.current = null;
      return;
    }
    const scope = { project: projectPath, session: assistantSessionId, active: true };
    owner.current = scope;
    return () => {
      scope.active = false;
    };
  }, [projectPath, assistantSessionId]);

  useEffect(() => {
    const scope = owner.current;
    if (!scope || !projectPath || !assistantSessionId) return;
    let active = true;
    const controller = new AbortController();
    const owns = () => active && scope.active && owner.current === scope;
    void readAgentRunWithin((signal) => {
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      return queryChapterCheckHistory(
        { project_root: projectPath, assistant_session_id: assistantSessionId, limit: 20 },
        {
          signal: controller.signal,
        },
      ).finally(() => signal.removeEventListener('abort', abort));
    })
      .then((history) => {
        if (owns()) setSnapshot({ ...history, owner: scope, refresh, error: null });
      })
      .catch((error: unknown) => {
        if (!owns()) return;
        setSnapshot((previous) => ({
          owner: scope,
          refresh,
          error: error instanceof Error ? error.message : String(error),
          entries: previous?.owner === scope ? previous.entries : [],
          truncated: previous?.owner === scope ? previous.truncated : false,
        }));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectPath, assistantSessionId, refresh]);

  const current =
    snapshot &&
    snapshot.owner.active &&
    snapshot.owner.project === projectPath &&
    snapshot.owner.session === assistantSessionId
      ? snapshot
      : null;
  const reload = useCallback(() => setRetry((value) => value + 1), []);
  return {
    enabled,
    entries: current?.entries ?? [],
    truncated: current?.truncated ?? false,
    loading: enabled && current?.refresh !== refresh,
    error: current?.error ?? null,
    reload,
  };
}

export type ChapterCheckHistoryState = ReturnType<typeof useChapterCheckHistory>;
