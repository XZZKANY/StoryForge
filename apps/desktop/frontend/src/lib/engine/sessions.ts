import type { AssistantSessionRecord } from '../api/types';
import { engineSecrets, engineSessions } from './store';

async function store() {
  return engineSessions(await engineSecrets());
}

/** 左栏会话列表的 ts 档：与 Python 路由同样的缺省（20 条）与上下限（1–50）。 */
export async function listEngineSessions(options?: {
  projectPath?: string;
  limit?: number;
}): Promise<AssistantSessionRecord[]> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  return (await (
    await store()
  ).listRecentSessions({
    limit,
    projectPath: options?.projectPath || null,
  })) as AssistantSessionRecord[];
}

export async function getEngineSession(id: number): Promise<AssistantSessionRecord> {
  return (await (await store()).sessionDetail(id)) as AssistantSessionRecord;
}
