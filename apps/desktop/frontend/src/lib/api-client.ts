/**
 * 桌面端 StoryForge API client
 * Tauri 运行时优先从 Rust 主进程读取本地 API 配置；浏览器预览退回 Vite env。
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-env';

type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

type TauriApiConfig = {
  baseUrl: string;
  apiKey: string;
};

function getPreviewApiConfig(): ApiConfig {
  const env = import.meta.env;
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'local-dev-key',
  };
}

export async function getApiConfig(): Promise<ApiConfig> {
  if (!isTauriRuntime()) {
    return getPreviewApiConfig();
  }

  const config = await invoke<TauriApiConfig>('get_api_config');
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  };
}

export type ReviseRequest = {
  filePath: string;
  content: string;
  instruction: string;
  projectName?: string | null;
  assistantSessionId?: number | null;
  contextBundle?: {
    projectRoot: string;
    currentFile: string;
    files: Array<{
      path: string;
      relativePath: string;
      kind: string;
      title: string;
      excerpt: string;
    }>;
    summary: {
      hasStoryStructure: boolean;
      counts: Record<string, number>;
    };
  } | null;
};

type AssistantContextBundlePayload = {
  project_root: string;
  current_file: string;
  files: Array<{
    path: string;
    relative_path: string;
    kind: string;
    title: string;
    excerpt: string;
  }>;
  summary: {
    hasStoryStructure: boolean;
    counts: Record<string, number>;
  };
};

export type ReviseResult = {
  before: string;
  after: string;
  summary: string;
  model: string;
  latencyMs: number;
  completionTokens: number | null;
  assistantSessionId: number;
};

export type AgentPlanStep = {
  step: string;
  detail: string;
  status: string;
};

export type AgentToolTrace = {
  tool_name: string;
  status: string;
  input_summary: Record<string, unknown>;
  output_summary?: Record<string, unknown>;
  audit_event_id?: string;
  assistant_tool_call_id?: number;
  error_message?: string;
};

export type AgentProposedPatch =
  | {
      kind: 'file_revision';
      file_path: string;
      before: string;
      after: string;
      requires_confirmation: boolean;
      approval_action: string;
    }
  | {
      kind: 'repair_patch';
      repair_patch: Record<string, unknown>;
      requires_confirmation: boolean;
      approval_command?: {
        command_id: string;
        args: Record<string, unknown>;
      } | null;
    }
  | Record<string, unknown>;

export type AgentResultMessage = {
  type: 'agent_result';
  session_id: string;
  assistant_session_id: number;
  intent: string;
  user_message: string;
  plan: AgentPlanStep[];
  agent_result: {
    summary?: string;
    requires_user_confirmation?: boolean;
    [key: string]: unknown;
  };
  tool_trace: AgentToolTrace[];
  proposed_patch?: AgentProposedPatch | null;
};

export type AgentErrorMessage = {
  type: 'error';
  session_id: string;
  detail: string;
};

export type AgentSocketMessage = AgentResultMessage | AgentErrorMessage | {
  type: string;
  [key: string]: unknown;
};

export type AgentUserMessageRequest = {
  sessionId: string;
  userMessage: string;
  assistantSessionId?: number | null;
  intent?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
};

export type AssistantMessageRecord = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  updated_at: string;
};

export type AssistantSessionRecord = {
  id: number;
  title: string;
  task_type: string;
  blueprint_id: number | null;
  book_run_id: number | null;
  artifact_id: number | null;
  messages: AssistantMessageRecord[];
  created_at: string;
  updated_at: string;
};

export function toAssistantContextBundlePayload(
  contextBundle: ReviseRequest['contextBundle'],
): AssistantContextBundlePayload | null {
  if (!contextBundle) return null;
  return {
    project_root: contextBundle.projectRoot,
    current_file: contextBundle.currentFile,
    files: contextBundle.files.map((file) => ({
      path: file.path,
      relative_path: file.relativePath,
      kind: file.kind,
      title: file.title,
      excerpt: file.excerpt,
    })),
    summary: contextBundle.summary,
  };
}

function websocketUrlFromBaseUrl(baseUrl: string, path: string, apiKey: string): string {
  const url = new URL(path, baseUrl.replace(/\/+$/, ''));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('api_key', apiKey);
  return url.toString();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    // 响应体不是 JSON 时落到下方通用信息
  }
  return `API 返回 ${response.status}`;
}

export async function requestRevision(request: ReviseRequest): Promise<ReviseResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/assistant/revise`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify({
      file_path: request.filePath,
      content: request.content,
      instruction: request.instruction,
      project_name: request.projectName ?? null,
      assistant_session_id: request.assistantSessionId ?? null,
      context_bundle: toAssistantContextBundlePayload(request.contextBundle),
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const data = (await response.json()) as {
    before: string;
    after: string;
    summary: string;
    model: string;
    latency_ms: number;
    completion_tokens: number | null;
    assistant_session_id: number;
  };

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

export async function getAssistantSession(assistantSessionId: number): Promise<AssistantSessionRecord> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/api/assistant/sessions/${assistantSessionId}`,
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

  return await response.json() as AssistantSessionRecord;
}

export async function sendAgentUserMessage(request: AgentUserMessageRequest): Promise<AgentSocketMessage> {
  const { baseUrl, apiKey } = await getApiConfig();
  const socketUrl = websocketUrlFromBaseUrl(
    baseUrl,
    `/api/ide/agent/sessions/${encodeURIComponent(request.sessionId)}`,
    apiKey,
  );

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('Agent WebSocket 响应超时。')));
    }, request.timeoutMs ?? 120000);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close errors after the response is received.
      }
      callback();
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'user_message',
        user_message: request.userMessage,
        assistant_session_id: request.assistantSessionId ?? undefined,
        intent: request.intent,
        args: request.args ?? {},
      }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as AgentSocketMessage;
        finish(() => resolve(message));
      } catch (error) {
        finish(() => reject(error));
      }
    };

    socket.onerror = () => {
      finish(() => reject(new Error('Agent WebSocket 连接失败。')));
    };

    socket.onclose = (event) => {
      if (!settled) {
        const detail = event.reason || (event.code === 1000 ? '返回结果前关闭' : String(event.code));
        finish(() => reject(new Error(`Agent WebSocket 已关闭：${detail}`)));
      }
    };
  });
}

export function isAgentErrorMessage(message: AgentSocketMessage): message is AgentErrorMessage {
  return message.type === 'error' && typeof (message as AgentErrorMessage).detail === 'string';
}

export function isAgentResultMessage(message: AgentSocketMessage): message is AgentResultMessage {
  return message.type === 'agent_result'
    && typeof (message as AgentResultMessage).assistant_session_id === 'number'
    && Array.isArray((message as AgentResultMessage).plan)
    && Array.isArray((message as AgentResultMessage).tool_trace);
}
