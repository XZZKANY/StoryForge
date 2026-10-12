import {
  dumpJson,
  isJsonObject,
  JsonFloat,
  pythonStr,
  pythonTruthy,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import type { LegacyUsage } from './usage';

const strOr = (value: JsonValue | undefined, fallback: string) =>
  pythonTruthy(value) ? pythonStr(value) : fallback;
const toInt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/** 一次模型调用的用量；source=unavailable 表示不知道，不等于 0。 */
export class TokenUsage {
  constructor(
    readonly inputTokens = 0,
    readonly outputTokens = 0,
    readonly totalTokens = 0,
    readonly cachedInputTokens: number | null = null,
    readonly reasoningTokens: number | null = null,
    readonly source = 'unavailable',
  ) {}

  static fromLegacy(payload: { readonly [key: string]: unknown }): TokenUsage {
    const hit = payload.cache_hit_tokens;
    const source = payload.token_usage_source;
    return new TokenUsage(
      Math.max(0, toInt(payload.prompt_tokens)),
      Math.max(0, toInt(payload.completion_tokens)),
      Math.max(0, toInt(payload.token_usage)),
      isInt(hit) ? Math.max(0, hit) : null,
      null,
      typeof source === 'string' && source ? source : 'unavailable',
    );
  }

  toLegacy(): LegacyUsage {
    return {
      token_usage: this.totalTokens,
      prompt_tokens: this.inputTokens,
      completion_tokens: this.outputTokens,
      cache_hit_tokens: this.cachedInputTokens,
      token_usage_source: this.source,
    };
  }
}

export class ToolCall {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly argumentsJson: string,
    readonly type = 'function',
  ) {}

  static fromOpenai(payload: JsonObject): ToolCall | null {
    const fn = payload.function;
    if (!isJsonObject(fn)) return null;
    const args = fn.arguments;
    const argumentsJson =
      Array.isArray(args) || isJsonObject(args)
        ? dumpJson(args, { ensureAscii: false })
        : strOr(args, '');
    return new ToolCall(
      strOr(payload.id, ''),
      strOr(fn.name, ''),
      argumentsJson,
      strOr(payload.type, 'function'),
    );
  }

  toOpenai() {
    return {
      id: this.id,
      type: this.type,
      function: { name: this.name, arguments: this.argumentsJson },
    };
  }
}

/** 工具定义；from/to 往返保留未知字段，请求体字节与 Python 相同。 */
export class ToolSpec {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly inputSchema: JsonObject,
    readonly metadata: {
      type: string;
      hasDescription: boolean;
      topLevel: JsonObject;
      function: JsonObject;
    } = { type: 'function', hasDescription: true, topLevel: {}, function: {} },
  ) {}

  static fromOpenai(payload: JsonObject): ToolSpec | null {
    const fn = payload.function;
    if (!isJsonObject(fn)) return null;
    const parameters = isJsonObject(fn.parameters) ? fn.parameters : {};
    const without = (object: JsonObject, keys: string[]) =>
      Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
    return new ToolSpec(strOr(fn.name, ''), strOr(fn.description, ''), parameters, {
      type: strOr(payload.type, 'function'),
      hasDescription: Object.prototype.hasOwnProperty.call(fn, 'description'),
      topLevel: without(payload, ['type', 'function']),
      function: without(fn, ['name', 'description', 'parameters']),
    });
  }

  toOpenai(): JsonObject {
    const fn: JsonObject = { name: this.name, parameters: { ...this.inputSchema } };
    if (this.description || this.metadata.hasDescription) fn.description = this.description;
    Object.assign(fn, this.metadata.function);
    const payload: JsonObject = { type: this.metadata.type || 'function', function: fn };
    return Object.assign(payload, this.metadata.topLevel);
  }
}

/** provider 自己的续接状态（思维块、函数调用签名）：运行时原样回传，不解读。 */
export type ProviderContinuation = { provider: string; state: { readonly [key: string]: unknown } };

export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export class ChatMessage {
  constructor(
    readonly role: MessageRole,
    readonly content: string | null = null,
    readonly toolCalls: readonly ToolCall[] = [],
    readonly toolCallId: string | null = null,
    readonly name: string | null = null,
    readonly metadata: JsonObject = {},
    readonly continuation: ProviderContinuation | null = null,
  ) {}

  static fromOpenai(payload: JsonObject): ChatMessage {
    const role = strOr(payload.role, 'user');
    if (!(MESSAGE_ROLES as readonly string[]).includes(role))
      throw new RangeError(`'${role}' is not a valid MessageRole`);
    const raw = payload.tool_calls;
    const toolCalls = Array.isArray(raw)
      ? raw.filter(isJsonObject).flatMap((item) => ToolCall.fromOpenai(item) ?? [])
      : [];
    const known = ['role', 'content', 'tool_calls', 'tool_call_id', 'name'];
    const present = (key: string) =>
      Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== null;
    return new ChatMessage(
      role as MessageRole,
      typeof payload.content === 'string' ? payload.content : null,
      toolCalls,
      present('tool_call_id') ? pythonStr(payload.tool_call_id) : null,
      present('name') ? pythonStr(payload.name) : null,
      Object.fromEntries(Object.entries(payload).filter(([key]) => !known.includes(key))),
    );
  }

  toOpenai(): JsonObject {
    const payload: JsonObject = { role: this.role, content: this.content };
    if (this.toolCalls.length) payload.tool_calls = this.toolCalls.map((call) => call.toOpenai());
    if (this.toolCallId !== null) payload.tool_call_id = this.toolCallId;
    if (this.name !== null) payload.name = this.name;
    return Object.assign(payload, this.metadata);
  }
}

export const messagesFromOpenai = (items: readonly JsonObject[]) =>
  items.map(ChatMessage.fromOpenai);
export const toolsFromOpenai = (items: readonly JsonObject[] | null | undefined) =>
  items && items.length ? items.flatMap((item) => ToolSpec.fromOpenai(item) ?? []) : [];

export type ChatRequest = {
  model: string;
  messages: readonly ChatMessage[];
  tools: readonly ToolSpec[];
  /** int 与 float 分开（JsonFloat），请求体字节与 Python 相同。 */
  temperature: number | JsonFloat | null;
  maxTokens: number | null;
  toolChoice: JsonValue | null;
  reasoningEffort: string | null;
};

export type ChatResponse = {
  content: string;
  toolCalls: readonly ToolCall[];
  usage: TokenUsage;
  finishReason: string | null;
  responseId: string | null;
  metadata: { readonly [key: string]: unknown };
  continuation: ProviderContinuation | null;
};

export const chatResponse = (
  fields: Partial<ChatResponse> & { content: string },
): ChatResponse => ({
  toolCalls: [],
  usage: new TokenUsage(),
  finishReason: null,
  responseId: null,
  metadata: {},
  continuation: null,
  ...fields,
});

export const toAssistantMessage = (response: ChatResponse) =>
  new ChatMessage(
    'assistant',
    response.content || null,
    response.toolCalls,
    null,
    null,
    {},
    response.continuation,
  );

export type StreamEventKind =
  | 'text_delta'
  | 'reasoning_delta'
  | 'tool_call_delta'
  | 'tool_call_completed'
  | 'usage'
  | 'completed'
  | 'error';

export type StreamEvent = {
  kind: StreamEventKind;
  text?: string | null;
  toolCall?: ToolCall | null;
  usage?: TokenUsage | null;
  response?: ChatResponse | null;
  finishReason?: string | null;
  metadata?: { readonly [key: string]: unknown };
};

export type ProviderErrorCategory =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'invalid_request'
  | 'content_filter'
  | 'unsupported'
  | 'timeout'
  | 'connection'
  | 'response'
  | 'internal';

const NEVER_RETRYABLE: readonly ProviderErrorCategory[] = [
  'configuration',
  'authentication',
  'invalid_request',
  'content_filter',
  'unsupported',
];

export type ProviderErrorDetails = {
  category: ProviderErrorCategory;
  safeMessage: string;
  retryable: boolean;
  statusCode: number | null;
  providerCode: string | null;
  requestId: string | null;
};

/** provider 层的失败：只带固定安全摘要，不带上游原文。 */
export class ProviderError extends Error {
  readonly details: ProviderErrorDetails;
  constructor(
    details: Partial<ProviderErrorDetails> & Pick<ProviderErrorDetails, 'category' | 'safeMessage'>,
    public usage: TokenUsage | null = null,
  ) {
    super(details.safeMessage);
    this.name = 'ProviderError';
    this.details = {
      retryable: false,
      statusCode: null,
      providerCode: null,
      requestId: null,
      ...details,
    };
    if (NEVER_RETRYABLE.includes(this.details.category)) this.details.retryable = false;
  }
}

/** 内层传输可能已经带了更新的用量快照：只在没有时补上，从不相加。 */
export function retainErrorUsage(error: unknown, usage: TokenUsage | null) {
  if (usage === null || usage.source === 'unavailable' || !error || typeof error !== 'object')
    return;
  const existing = (error as { usage?: unknown }).usage;
  if (!(existing instanceof TokenUsage) || existing.source === 'unavailable')
    (error as { usage?: unknown }).usage = usage;
}

/** 保留最近一次累计用量（不保留部分正文）；出错时把它挂到错误上。 */
export async function* retainingStreamUsage(
  events: AsyncIterable<StreamEvent>,
  hooks: { beforeNext?: () => void; beforeYield?: () => void } = {},
): AsyncGenerator<StreamEvent> {
  const iterator = events[Symbol.asyncIterator]();
  let usage: TokenUsage | null = null;
  try {
    for (;;) {
      hooks.beforeNext?.();
      const step = await iterator.next();
      if (step.done) {
        hooks.beforeYield?.();
        return;
      }
      const event = step.value;
      const observed = event.usage ?? event.response?.usage ?? null;
      if (observed !== null && observed.source !== 'unavailable') usage = observed;
      // 协作式取消拒绝交付之前，先记下已经读到的用量。
      hooks.beforeYield?.();
      yield event;
    }
  } catch (error) {
    retainErrorUsage(error, usage);
    throw error;
  } finally {
    await iterator.return?.(undefined);
  }
}
