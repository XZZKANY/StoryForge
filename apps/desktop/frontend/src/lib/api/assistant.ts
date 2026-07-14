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

export type AssistantReviseResult = {
  before: string;
  after: string;
  summary: string;
  model: string;
  latencyMs: number;
  completionTokens: number | null;
  assistantSessionId: number;
};

type ApiAssistantReviseResponse = {
  before: string;
  after: string;
  summary: string;
  model: string;
  latency_ms: number;
  completion_tokens: number | null;
  assistant_session_id: number;
};

/**
 * 单发 /assistant/revise：整文件全文 + 指令进，真实 LLM 修订后全文出（同步、非流式）。
 * 行间对话（Ctrl+K）走这条通道换取「跟手」，不经 agent WS 循环。LLM 未配置 422、调用失败 502，
 * 错误明细原样透出，绝不伪造兜底。
 */
export async function reviseFileContent(payload: {
  filePath: string;
  content: string;
  instruction: string;
  projectName?: string | null;
  assistantSessionId?: number | null;
}): Promise<AssistantReviseResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/revise`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify({
      file_path: payload.filePath,
      content: payload.content,
      instruction: payload.instruction,
      project_name: payload.projectName ?? null,
      assistant_session_id: payload.assistantSessionId ?? null,
    }),
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
