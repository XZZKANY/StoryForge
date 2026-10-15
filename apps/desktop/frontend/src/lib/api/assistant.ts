import { parseContinueSseFrame } from '../inline-continue';
import type { ProviderHealth } from '../provider-config';
import { getApiConfig, trimApiBaseUrl } from './config';
import type { ApiProviderHealthResponse } from './contracts';
import { readErrorDetail } from './errors';
import { readEngineMode, sessionsInEngine } from '../engine/flags';
import { toAssistantContextBundlePayload } from './codecs';
import type { AssistantSessionRecord, ReviseRequest } from './types';

export async function listAssistantSessions(options?: {
  projectPath?: string;
  limit?: number;
}): Promise<AssistantSessionRecord[]> {
  // 会话放哪个库跟着 agent 循环的开关走；Python 档不初始化引擎。
  if (sessionsInEngine()) return (await import('../engine/sessions')).listEngineSessions(options);
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
  if (sessionsInEngine())
    return (await import('../engine/sessions')).getEngineSession(assistantSessionId);
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
  projectRoot?: string | null;
  assistantSessionId?: number | null;
  qualityGate?: 'polish';
  signal?: AbortSignal;
}): Promise<AssistantReviseResult> {
  // 开发档默认走引擎（设成 python 可切回）；发行版与 Python 档不初始化引擎。
  const mode = readEngineMode('engine.assistant');
  if (mode === 'ts') return (await import('../engine/assistant')).reviseWithEngine(payload);
  if (mode === 'shadow') {
    const shadow = await loadShadow();
    if (shadow) return shadow.shadowRevise(payload, () => pythonRevise(payload, true));
  }
  return (await pythonRevise(payload, false)).result;
}

/**
 * 影子模块加载失败（比如发行版分包缺失）也不能挡住作者：照走 Python，这一次不比，
 * checks 文件缺行即说明影子没跑上。
 */
const loadShadow = () => import('../engine/shadow').catch(() => null);

/** 影子档带上请求头，Python 把这次派发给模型的请求快照一并交回（迁移计划 §4.2）。 */
const SHADOW_HEADERS = { 'X-StoryForge-Shadow': 'prompts' };

async function pythonRevise(
  payload: Parameters<typeof reviseFileContent>[0],
  shadow: boolean,
): Promise<{ result: AssistantReviseResult; captures: unknown }> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/revise`, {
    method: 'POST',
    cache: 'no-store',
    signal: payload.signal,
    headers: {
      'Content-Type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
      ...(shadow ? SHADOW_HEADERS : {}),
    },
    body: JSON.stringify({
      file_path: payload.filePath,
      content: payload.content,
      instruction: payload.instruction,
      project_name: payload.projectName ?? null,
      project_root: payload.projectRoot ?? null,
      assistant_session_id: payload.assistantSessionId ?? null,
      quality_gate: payload.qualityGate ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const data = (await response.json()) as ApiAssistantReviseResponse & {
    shadow_requests?: unknown;
  };
  return {
    result: {
      before: data.before,
      after: data.after,
      summary: data.summary,
      model: data.model,
      latencyMs: data.latency_ms,
      completionTokens: data.completion_tokens,
      assistantSessionId: data.assistant_session_id,
    },
    captures: data.shadow_requests,
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
type ContinuePayload = {
  filePath: string;
  content: string;
  cursorLine: number;
  instruction?: string | null;
  projectRoot?: string | null;
  assistantSessionId?: number | null;
  targetChars?: number | null;
  contextBundle?: ReviseRequest['contextBundle'];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
};

export async function streamContinueProse(payload: ContinuePayload): Promise<ContinueProseResult> {
  const mode = readEngineMode('engine.assistant');
  if (mode === 'ts') return (await import('../engine/assistant')).continueWithEngine(payload);
  if (mode === 'shadow') {
    const shadow = await loadShadow();
    if (shadow) return shadow.shadowContinue(payload, () => pythonContinue(payload, true));
  }
  return (await pythonContinue(payload, false)).result;
}

async function pythonContinue(
  payload: ContinuePayload,
  shadow: boolean,
): Promise<{ result: ContinueProseResult; captures: unknown }> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/assistant/continue`, {
    method: 'POST',
    cache: 'no-store',
    signal: payload.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-StoryForge-API-Key': apiKey,
      ...(shadow ? SHADOW_HEADERS : {}),
    },
    body: JSON.stringify({
      file_path: payload.filePath,
      content: payload.content,
      cursor_line: payload.cursorLine,
      instruction: payload.instruction ?? null,
      project_root: payload.projectRoot ?? null,
      assistant_session_id: payload.assistantSessionId ?? null,
      target_chars: payload.targetChars ?? null,
      context_bundle: toAssistantContextBundlePayload(payload.contextBundle),
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
  let captures: unknown;

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
        else if (frame?.kind === 'shadow') captures = frame.requests;
        separator = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) throw new Error(failure);
  if (!result) throw new Error('续写流在返回结果前结束。');
  return { result, captures };
}

export async function probeProviderHealth(): Promise<ProviderHealth> {
  // 测连接不组 prompt，影子档照走 Python。
  if (readEngineMode('engine.assistant') === 'ts')
    return (await import('../engine/assistant')).probeWithEngine();
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
