import type { AgentRoleRead } from '../agent-roles';
import type { ProviderHealth } from '../provider-config';
import { getApiConfig, trimApiBaseUrl } from './config';
import type { ApiProviderHealthResponse } from './contracts';
import { readErrorDetail } from './errors';
import type { AssistantSessionRecord } from './types';

export async function listAssistantSessions(options?: {
  projectPath?: string;
  limit?: number;
}): Promise<AssistantSessionRecord[]> {
  const { baseUrl, apiKey } = await getApiConfig();
  const params = new URLSearchParams();
  if (options?.projectPath) params.set('project_path', options.projectPath);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/assistant/sessions${query ? `?${query}` : ''}`,
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

  return (await response.json()) as AssistantSessionRecord[];
}

export async function getAssistantSession(
  assistantSessionId: number,
): Promise<AssistantSessionRecord> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/assistant/sessions/${assistantSessionId}`,
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

  return (await response.json()) as AssistantSessionRecord;
}

export async function listAgentRoles(): Promise<AgentRoleRead[]> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/agent-runs/roles`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'X-StoryForge-API-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return (await response.json()) as AgentRoleRead[];
}

export async function probeProviderHealth(): Promise<ProviderHealth> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/provider-health`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'X-StoryForge-API-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const data = (await response.json()) as ApiProviderHealthResponse;

  return {
    status: data.status,
    reachable: data.reachable,
    baseUrl: data.base_url ?? null,
    model: data.model ?? null,
    latencyMs: data.latency_ms ?? null,
    modelCount: data.model_count ?? null,
    detail: data.detail ?? null,
    missingEnv: data.missing_env ?? [],
  };
}
