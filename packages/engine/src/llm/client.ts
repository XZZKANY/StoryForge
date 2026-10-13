import {
  isJsonObject,
  JsonFloat,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  envValue,
  optionalFloat,
  optionalInt,
  providerFamily,
  providerRequestHeaders,
  requiredEnv,
  type LlmSource,
} from './config';
import {
  messagesFromOpenai,
  ProviderError,
  retainingStreamUsage,
  TokenUsage,
  toolsFromOpenai,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
} from './contracts';
import { AnthropicProvider } from './anthropic';
import { checkRunInterruption, requestTimeout } from './control';
import { GeminiProvider } from './gemini';
import { OpenAICompatibleProvider, type LlmProvider } from './openaiCompatible';
import { observeProvider } from './observation';
import { buildChatPayload, LlmError } from './payload';
import { modelsUrl } from './protocol';
import {
  providerCompleteJson,
  providerSseJson,
  providerUrl,
  pythonQuote,
} from './providerTransport';
import { stripReasoningLeak } from './text';
import {
  HttpTransportError,
  rawStreamChatCompletions,
  requestChatCompletions,
  type LlmContext,
  type StreamFrame,
  type TransportOptions,
} from './transport';
import { costBreakdown, tokenUsage } from './usage';

export type ChatRequestOptions = {
  messages: readonly JsonObject[];
  tools?: readonly JsonObject[] | null;
  toolChoice?: JsonValue | null;
  temperature?: number | JsonFloat | null;
  maxCompletionTokens?: number | null;
};

export function sdkChatRequest(source: LlmSource, options: ChatRequestOptions): ChatRequest {
  const maxTokens =
    options.maxCompletionTokens ?? optionalInt(source, 'STORYFORGE_LLM_MAX_COMPLETION_TOKENS', 0);
  return {
    model: requiredEnv(source, 'STORYFORGE_LLM_MODEL'),
    messages: messagesFromOpenai(options.messages),
    tools: toolsFromOpenai(options.tools),
    temperature:
      options.temperature ??
      new JsonFloat(optionalFloat(source, 'STORYFORGE_LLM_TEMPERATURE', 0.7)),
    maxTokens: maxTokens > 0 ? maxTokens : null,
    toolChoice: options.toolChoice ?? null,
    reasoningEffort: envValue(source, 'STORYFORGE_LLM_REASONING_EFFORT') || null,
  };
}

/** 按 provider 家族装配；在 agent 运行里还套一层本地请求证据（Python 的 _sdk_provider）。 */
export function sdkProvider(
  source: LlmSource,
  options: TransportOptions & { streamPayload?: { [key: string]: unknown } | null },
  ctx: LlmContext,
): LlmProvider {
  return observeProvider(baseSdkProvider(source, options, ctx), source, ctx.observation);
}

/** 按 provider 家族装配：OpenAI 兼容、Anthropic Messages、Gemini generateContent。 */
function baseSdkProvider(
  source: LlmSource,
  options: TransportOptions & { streamPayload?: { [key: string]: unknown } | null },
  ctx: LlmContext,
): LlmProvider {
  const family = providerFamily(envValue(source, 'STORYFORGE_LLM_PROVIDER'));
  const transportOptions = {
    timeoutSeconds: options.timeoutSeconds,
    maxAttempts: options.maxAttempts,
  };
  if (family === 'anthropic') {
    const url = providerUrl(source, 'messages');
    const headers = providerRequestHeaders(source, ctx.appVersion);
    const request = (payload: JsonObject) => ({ url, headers, payload, serviceLabel: 'Anthropic' });
    return new AnthropicProvider({
      completeTransport: (payload) =>
        providerCompleteJson(source, request(payload), transportOptions, ctx),
      streamTransport: (payload) =>
        providerSseJson(source, request(payload), transportOptions, ctx),
      clock: ctx.clock,
    });
  }
  if (family === 'gemini') {
    const headers = providerRequestHeaders(source, ctx.appVersion);
    const request = (model: string, action: string, payload: JsonObject) => ({
      url: providerUrl(source, `models/${pythonQuote(model, '-._')}:${action}`),
      headers,
      payload,
      serviceLabel: 'Gemini',
    });
    return new GeminiProvider({
      completeTransport: (model, payload) =>
        providerCompleteJson(
          source,
          request(model, 'generateContent', payload),
          transportOptions,
          ctx,
        ),
      streamTransport: (model, payload) =>
        providerSseJson(
          source,
          request(model, 'streamGenerateContent?alt=sse', payload),
          transportOptions,
          ctx,
        ),
      clock: ctx.clock,
    });
  }
  return new OpenAICompatibleProvider({
    completeTransport: (payload) => requestChatCompletions(source, payload, transportOptions, ctx),
    streamTransport: (payload) =>
      rawStreamChatCompletions(
        source,
        options.streamPayload ?? payload,
        { ...transportOptions, toolStream: !options.streamPayload },
        ctx,
      ),
    contentFilter: stripReasoningLeak,
    usageParser: tokenUsage,
    clock: ctx.clock,
  });
}

const LEGACY_MESSAGES: Record<string, string> = {
  missing_choices: '真实 LLM 响应缺少 choices，不能继续 BookRun 生成。',
  invalid_choice: '真实 LLM 响应 choices[0] 格式异常。',
  missing_message: '真实 LLM 响应缺少 message，不能继续 BookRun 生成。',
};

export function legacyProviderError(error: ProviderError): LlmError {
  const code = error.details.providerCode;
  return new LlmError(
    code !== null && code in LEGACY_MESSAGES ? LEGACY_MESSAGES[code] : error.message,
    error.usage,
  );
}

/** 截断 / 被过滤的输出不能当成稿。 */
export function rejectIncompleteResponse(response: ChatResponse): void {
  if (['length', 'content_filter', 'invalid_request'].includes(response.finishReason ?? ''))
    throw new LlmError('真实 LLM 输出被截断或过滤，不能把未完成正文当成稿。', response.usage);
}

/** 失败证据里只放已保留的记账；没有就不放。 */
export function errorUsageSummary(
  error: unknown,
  source?: LlmSource | null,
): { [key: string]: unknown } {
  const usage =
    error && typeof error === 'object' ? (error as { usage?: unknown }).usage : undefined;
  const summary: { [key: string]: unknown } =
    usage instanceof TokenUsage && usage.source !== 'unavailable' ? { ...usage.toLegacy() } : {};
  if (source === undefined || source === null) return summary;
  const cost = costBreakdown(source, summary);
  return {
    ...summary,
    cost_cny_estimated: 'total_cny' in cost ? cost.total_cny : null,
    cost_breakdown: cost,
  };
}

const latency = (response: ChatResponse) => {
  const value = response.metadata.latency_ms;
  return typeof value === 'number' && value ? Math.trunc(value) : 0;
};

async function completeOrLegacy(
  provider: LlmProvider,
  request: ChatRequest,
): Promise<ChatResponse> {
  try {
    return await provider.complete(request);
  } catch (error) {
    if (error instanceof ProviderError) throw legacyProviderError(error);
    throw error;
  }
}

/** 一次 chat/completions：返回正文、记账与成本；空正文 / 只有思维链 / 被截断都显式报错。 */
export async function callLlm(
  source: LlmSource,
  options: {
    systemPrompt: string;
    userPrompt: string;
    tools?: readonly JsonObject[] | null;
    toolChoice?: JsonValue | null;
  },
  ctx: LlmContext,
): Promise<{ [key: string]: unknown }> {
  const request = sdkChatRequest(source, {
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    tools: options.tools,
    toolChoice: options.toolChoice,
  });
  const response = await completeOrLegacy(sdkProvider(source, {}, ctx), request);
  rejectIncompleteResponse(response);
  if (!response.content) {
    if (response.metadata.reasoning_leak_stripped === true)
      throw new LlmError(
        '真实 LLM 返回仅含思维链、无正文，不能继续 BookRun 生成。',
        response.usage,
      );
    throw new LlmError('真实 LLM 返回内容为空，不能继续 BookRun 生成。', response.usage);
  }
  const usage = response.usage.toLegacy();
  const cost = costBreakdown(source, usage);
  const result: { [key: string]: unknown } = {
    content: response.content,
    ...usage,
    cost_cny_estimated: 'total_cny' in cost ? cost.total_cny : null,
    cost_breakdown: cost,
    latency_ms: latency(response),
  };
  if (response.metadata.reasoning_leak_stripped === true) result.reasoning_leak_stripped = true;
  if (response.toolCalls.length)
    result.tool_calls = response.toolCalls.map((call) => call.toOpenai());
  return result;
}

/** 多轮 messages 版：工具循环里只回 tool_calls、正文为空是合法中间态。 */
export async function callLlmMessages(
  source: LlmSource,
  options: {
    messages: readonly JsonObject[];
    tools?: readonly JsonObject[] | null;
    toolChoice?: JsonValue | null;
  } & TransportOptions,
  ctx: LlmContext,
): Promise<{ [key: string]: unknown }> {
  const request = sdkChatRequest(source, {
    messages: options.messages,
    tools: options.tools,
    toolChoice: options.toolChoice,
  });
  const provider = sdkProvider(
    source,
    { timeoutSeconds: options.timeoutSeconds, maxAttempts: options.maxAttempts },
    ctx,
  );
  const response = await completeOrLegacy(provider, request);
  rejectIncompleteResponse(response);
  const toolCalls = response.toolCalls.map((call) => call.toOpenai());
  if (!response.content && !toolCalls.length)
    throw new LlmError('真实 LLM 返回既无正文也无工具调用，无法继续。', response.usage);
  const usage = response.usage.toLegacy();
  const cost = costBreakdown(source, usage);
  const result: { [key: string]: unknown } = {
    content: response.content,
    tool_calls: toolCalls,
    ...usage,
    cost_cny_estimated: 'total_cny' in cost ? cost.total_cny : null,
    cost_breakdown: cost,
    latency_ms: latency(response),
  };
  if (response.metadata.reasoning_leak_stripped === true) result.reasoning_leak_stripped = true;
  return result;
}

const controlled = (events: AsyncIterable<StreamEvent>, ctx: LlmContext) =>
  retainingStreamUsage(events, {
    beforeNext: () => checkRunInterruption(ctx.control, 'before_stream_read'),
    beforeYield: () => checkRunInterruption(ctx.control, 'before_stream_yield'),
  });

/** 旧帧形状（delta / done）的流式调用；线上请求体就是传进来的 payload。 */
export async function* streamChatCompletions(
  source: LlmSource,
  payload: { [key: string]: unknown },
  options: TransportOptions,
  ctx: LlmContext,
): AsyncGenerator<StreamFrame> {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as JsonValue[]).filter(isJsonObject)
    : [];
  const tools = Array.isArray(payload.tools)
    ? (payload.tools as JsonValue[]).filter(isJsonObject)
    : null;
  const choice = payload.tool_choice;
  const temperature = payload.temperature;
  const maxTokens = payload.max_completion_tokens;
  const request = sdkChatRequest(source, {
    messages,
    tools,
    toolChoice:
      typeof choice === 'string' || isJsonObject(choice as JsonValue)
        ? (choice as JsonValue)
        : null,
    temperature:
      typeof temperature === 'number' || temperature instanceof JsonFloat ? temperature : null,
    maxCompletionTokens:
      typeof maxTokens === 'number' && Number.isInteger(maxTokens) ? maxTokens : null,
  });
  try {
    const provider = sdkProvider(source, { ...options, streamPayload: payload }, ctx);
    for await (const event of controlled(provider.stream(request), ctx)) {
      if (event.kind === 'text_delta' && event.text) {
        yield { type: 'delta', text: event.text };
        continue;
      }
      if (event.kind !== 'completed' || !event.response) continue;
      rejectIncompleteResponse(event.response);
      const usage = event.response.usage.toLegacy();
      const cost = costBreakdown(source, usage);
      yield {
        type: 'done',
        content: event.response.content,
        ...usage,
        ...event.response.metadata,
        cost_cny_estimated: 'total_cny' in cost ? cost.total_cny : null,
        cost_breakdown: cost,
      };
    }
  } catch (error) {
    if (error instanceof ProviderError) throw legacyProviderError(error);
    throw error;
  }
}

/**
 * 与 callLlm 同返回，只是传输走流式、由本端聚合：长正文在 CDN / 中转站前置下走非流式会被当空闲连接掐掉。
 * 不收工具：工具调用走 callLlmMessages。
 */
export async function callLlmStreamed(
  source: LlmSource,
  options: { systemPrompt: string; userPrompt: string },
  ctx: LlmContext,
): Promise<{ [key: string]: unknown }> {
  const messages: JsonObject[] = [];
  // 空 system 段不进 messages：部分端点对空 system 消息行为不一致。
  if (pythonStrip(options.systemPrompt))
    messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: options.userPrompt });
  const payload = buildChatPayload(source, { messages, stream: true });
  let final: StreamFrame | null = null;
  for await (const frame of streamChatCompletions(source, payload, {}, ctx))
    if (frame.type === 'done') final = frame;
  // 流正常读完却没有终帧 = 上游提前关流；静默返回空正文会让缺文当成功写进补丁。
  if (final === null) throw new LlmError('真实 LLM 流式结束但未返回终帧，无法取得完整正文。');
  const result: { [key: string]: unknown } = { ...final };
  delete result.type;
  return result;
}

/** 补上 STORYFORGE 环境默认值的 provider（Agent 循环、润色、压缩用）。 */
export class ConfiguredLlmProvider implements LlmProvider {
  private readonly provider: LlmProvider;
  constructor(
    private readonly source: LlmSource,
    private readonly ctx: LlmContext,
    options: TransportOptions & { streamPayload?: { [key: string]: unknown } | null } = {},
  ) {
    this.provider = sdkProvider(source, options, ctx);
  }

  private configured(request: ChatRequest): ChatRequest {
    const configuredMax = optionalInt(this.source, 'STORYFORGE_LLM_MAX_COMPLETION_TOKENS', 0);
    return {
      ...request,
      model: request.model || requiredEnv(this.source, 'STORYFORGE_LLM_MODEL'),
      temperature:
        request.temperature ??
        new JsonFloat(optionalFloat(this.source, 'STORYFORGE_LLM_TEMPERATURE', 0.7)),
      maxTokens: request.maxTokens ?? (configuredMax > 0 ? configuredMax : null),
      reasoningEffort:
        request.reasoningEffort || envValue(this.source, 'STORYFORGE_LLM_REASONING_EFFORT') || null,
    };
  }

  complete(request: ChatRequest): Promise<ChatResponse> {
    return this.provider.complete(this.configured(request));
  }

  stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    return controlled(this.provider.stream(this.configured(request)), this.ctx);
  }
}

/** 只读模型列表探测：统一出网口，不重试、不翻页。HTTP 失败原样抛出状态码，由诊断层归类。 */
export class ModelListHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'ModelListHttpError';
  }
}

export async function fetchProviderModels(
  source: LlmSource,
  timeout: number,
  ctx: LlmContext,
): Promise<JsonValue> {
  const url = modelsUrl(
    requiredEnv(source, 'STORYFORGE_LLM_BASE_URL'),
    requiredEnv(source, 'STORYFORGE_LLM_API_KEY'),
  );
  const response = await ctx.http.send({
    url,
    method: 'GET',
    headers: providerRequestHeaders(source, ctx.appVersion),
    body: null,
    timeoutSeconds: requestTimeout(ctx.control, timeout),
  });
  try {
    if (response.status < 200 || response.status >= 300)
      throw new ModelListHttpError(response.status);
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) chunks.push(chunk);
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return parseJsonBytes(bytes, 'models response');
  } finally {
    response.close();
  }
}

export { HttpTransportError };
