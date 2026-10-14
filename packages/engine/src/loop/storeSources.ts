import type { RunStore } from '../store/runs';
import type { ConversationSources } from './conversationHistory';
import type { ToolArtifactQuery } from './tools/handlerDeps';

/** 已落库 artifact 的查询，读 run 存储（Python 查 AgentArtifact 表）。 */
export function storeToolArtifactQuery(store: RunStore): ToolArtifactQuery {
  return {
    async runHasArtifact(runId, kind) {
      const run = await store.findRun(runId);
      return run !== null && (await store.artifacts(run.id)).some((item) => item.kind === kind);
    },
    async artifactPayloads(kind) {
      return (await store.artifactsOfKind(kind)).map((item) => item.payload);
    },
  };
}

/** 会话事实里出自 run 存储的那一半：会话下所有 run 的事件与 artifact，按 id 升序。 */
export function storeRunSources(
  store: RunStore,
): Pick<ConversationSources, 'runEvents' | 'runArtifacts' | 'artifact'> {
  const runIds = async (sessionId: number) =>
    (await store.runsOfAssistantSession(sessionId)).map((run) => run.id);
  return {
    async runEvents(sessionId) {
      const rows = await Promise.all((await runIds(sessionId)).map((id) => store.events(id)));
      return rows.flat().sort((a, b) => a.id - b.id);
    },
    async runArtifacts(sessionId) {
      const rows = await Promise.all((await runIds(sessionId)).map((id) => store.artifacts(id)));
      return rows.flat().sort((a, b) => a.id - b.id);
    },
    artifact: (id) => store.artifact(id),
  };
}
