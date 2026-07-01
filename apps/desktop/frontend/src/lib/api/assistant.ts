import type { AgentRoleRead } from '../agent-roles';
import type { ProviderHealth } from '../provider-config';
import { toAssistantContextBundlePayload } from './codecs';
import { getApiConfig, trimApiBaseUrl } from './config';
import type {
  ApiAssistantReviseRequest,
  ApiAssistantReviseResponse,
  ApiProviderHealthResponse,
} from './contracts';
import { readErrorDetail } from './errors';
import type { AssistantSessionRecord, ReviseRequest, ReviseResult } from './types';

export async function requestRevision(request: ReviseRequest): Promise<ReviseResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const body: ApiAssistantReviseRequest = {
    file_path: request.filePath,
    content: request.content,
    instruction: request.instruction,
    project_name: request.projectName ?? null,
    assistant_session_id: request.assistantSessionId ?? null,
    context_bundle: toAssistantContextBundlePayload(
      request.contextBundle
        ? {
            ...request.contextBundle,
            currentFile: request.contextBundle.currentFile ?? request.filePath,
          }
        : null,
    ) as ApiAssistantReviseRequest['context_bundle'],
  };
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/revise`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const data = (await response.json()) as ApiAssistantReviseResponse;

  return {
    before: data.before,
    after: data.after,
    summary: data.summary,
    model: data.model,
    latencyMs: data.latency_ms,
    completionTokens: data.completion_tokens,
    assistantSessionId: data.assistant_session_id,
  };
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
