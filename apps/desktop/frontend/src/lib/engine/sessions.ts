import type { AssistantFailedTurnRecord, AssistantSessionRecord } from '../api/types';
import { engineSecrets, engineSessions } from './store';

async function store() {
  return engineSessions(await engineSecrets());
}

/** 会话列表：缺省 20 条；上限放到 500，会话多了也能在列表里搜到早先的。 */
export async function listEngineSessions(options?: {
  projectPath?: string;
  limit?: number;
}): Promise<AssistantSessionRecord[]> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 500);
  return (await (
    await store()
  ).listRecentSessions({
    limit,
    projectPath: options?.projectPath || null,
  })) as AssistantSessionRecord[];
}

export async function renameEngineSession(id: number, title: string): Promise<void> {
  await (await store()).setTitle(id, title);
}

export async function getEngineSession(id: number): Promise<AssistantSessionRecord> {
  return (await (await store()).sessionDetail(id)) as AssistantSessionRecord;
}

export async function getEngineSessionFailedTurns(
  id: number,
): Promise<AssistantFailedTurnRecord[]> {
  return (await (await store()).failedTurns(id)) as AssistantFailedTurnRecord[];
}
