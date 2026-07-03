import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
import type { AgentRunEventRecord } from './agent-run-events';
import type { AgentRunSavePointProjection } from './types';

export async function getAgentRunSavePoints(runId: string): Promise<AgentRunSavePointProjection> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/agent-runs/${encodeURIComponent(runId)}/save-points`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'X-StoryForge-API-Key': apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return (await response.json()) as AgentRunSavePointProjection;
}

// 断线/超时后拉持久化事件表重放，配合 reconstructAgentResultFromEvents 重建终态（F10）。
export async function getAgentRunEvents(runId: string): Promise<AgentRunEventRecord[]> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/agent-runs/${encodeURIComponent(runId)}/events`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'X-StoryForge-API-Key': apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return (await response.json()) as AgentRunEventRecord[];
}
