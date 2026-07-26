import type { AgentRoleRead } from '../agent-roles';
import { parseContinueSseFrame } from '../inline-continue';
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
  signal?: AbortSignal;
}): Promise<AssistantReviseResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/revise`, {
    method: 'POST',
    cache: 'no-store',
    signal: payload.signal,
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

export type ContinueProseResult = {
  /** 权威结果：已由后端做过确定性后处理，不是 delta 的拼接。 */
  text: string;
  model: string;
  assistantSessionId: number;
};

/**
 * 流式 /assistant/continue：在光标处续写一段，逐块回调 onDelta 供即时观感。
 *
 * onDelta 只用于「让作者看到笔在动」；最终写回一律用 resolve 出来的 text。
 */
export async function streamContinueProse(payload: {
  filePath: string;
  content: string;
  cursorLine: number;
  instruction?: string | null;
  projectRoot?: string | null;
  assistantSessionId?: number | null;
  targetChars?: number | null;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<ContinueProseResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/continue`, {
    method: 'POST',
    cache: 'no-store',
    signal: payload.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify({
      file_path: payload.filePath,
      content: payload.content,
      cursor_line: payload.cursorLine,
      instruction: payload.instruction ?? null,
      project_root: payload.projectRoot ?? null,
      assistant_session_id: payload.assistantSessionId ?? null,
      target_chars: payload.targetChars ?? null,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorDetail(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ContinueProseResult | null = null;
  let failure: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.search(/\r?\n\r?\n/);
      while (separator !== -1) {
        const match = buffer.slice(separator).match(/^\r?\n\r?\n/);
        const rawFrame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + (match ? match[0].length : 2));
        const frame = parseContinueSseFrame(rawFrame);
        if (frame?.kind === 'delta') payload.onDelta?.(frame.text);
        else if (frame?.kind === 'done') {
          result = {
            text: frame.text,
            model: frame.model,
            assistantSessionId: frame.assistantSessionId,
          };
        } else if (frame?.kind === 'error') failure = frame.message;
        separator = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) throw new Error(failure);
  if (!result) throw new Error('续写流在返回结果前结束。');
  return result;
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
    models: data.models ?? [],
    detail: data.detail ?? null,
    missingEnv: data.missing_env ?? [],
  };
}
