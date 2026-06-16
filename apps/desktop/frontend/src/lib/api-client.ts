/**
 * 桌面端 StoryForge API client
 * renderer 侧直连本地 API（CSP 为 null，不拦截 fetch）。
 * 凭据与基址走 Vite env，默认对齐 web 端的 local-dev 约定。
 */

type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export function getApiConfig(): ApiConfig {
  const env = import.meta.env;
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'local-dev-key',
  };
}

export type ReviseRequest = {
  filePath: string;
  content: string;
  instruction: string;
  projectName?: string | null;
  assistantSessionId?: number | null;
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
  const { baseUrl, apiKey } = getApiConfig();
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
