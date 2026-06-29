import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
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
