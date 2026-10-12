import { isJsonObject, pythonStr, type JsonObject, type JsonValue } from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  chatResponse,
  ProviderError,
  retainErrorUsage,
  retainingStreamUsage,
  TokenUsage,
  ToolCall,
  type ChatRequest,
  type ChatResponse,
  type ProviderErrorCategory,
  type StreamEvent,
} from './contracts';
import type { StreamFrame } from './transport';

export type CompleteTransport = (
  payload: JsonObject,
) => Promise<{ data: JsonValue; startedAt: number }>;
export type StreamTransport = (payload: JsonObject) => AsyncIterable<StreamFrame>;
export type UsageParser = (
  data: unknown,
  prompt: string,
  content: string,
) => { [key: string]: unknown };

export interface LlmProvider {
  complete(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
}

const CATEGORIES: readonly ProviderErrorCategory[] = [
  'configuration',
  'authentication',
  'rate_limit',
  'invalid_request',
  'content_filter',
  'unsupported',
  'timeout',
  'connection',
  'response',
  'internal',
];
const FRAME_FIELDS = new Set([
  'type',
  'content',
  'token_usage',
  'prompt_tokens',
  'completion_tokens',
  'cache_hit_tokens',
  'token_usage_source',
  'tool_calls',
  'finish_reason',
  'response_id',
]);
const strOrNull = (value: unknown) =>
  value === undefined || value === null ? null : pythonStr(value as JsonValue);

/** OpenAI 兼容线协议之上的类型化适配器。 */
export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private readonly options: {
      completeTransport: CompleteTransport;
      streamTransport?: StreamTransport | null;
      contentFilter?: (content: string) => string;
      usageParser: UsageParser;
      /** 单调时钟（秒），用于延迟。 */
      clock: () => number;
    },
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const payload = OpenAICompatibleProvider.buildPayload(request);
    const { data, startedAt } = await this.options.completeTransport(payload);
    const record = isJsonObject(data) ? data : {};
    const prompt = request.messages.map((message) => message.content || '').join('\n');
    let message: JsonObject;
    try {
      message = OpenAICompatibleProvider.assistantMessage(data);
    } catch (error) {
      // 被拒的信封里仍可能带计费用量。
      if (error instanceof ProviderError && isJsonObject(record.usage))
        retainErrorUsage(error, TokenUsage.fromLegacy(this.options.usageParser(data, prompt, '')));
      throw error;
    }
    const raw = message.content;
    const before = typeof raw === 'string' ? pythonStrip(raw) : '';
    const filter = this.options.contentFilter ?? pythonStrip;
    const content = before ? filter(before) : '';
    const choices = record.choices;
    const first = Array.isArray(choices) && choices.length ? choices[0] : undefined;
    const metadata: { [key: string]: unknown } = {
      latency_ms: Math.max(0, Math.trunc((this.options.clock() - startedAt) * 1000)),
    };
    if (content !== before) metadata.reasoning_leak_stripped = true;
    return chatResponse({
      content,
      toolCalls: OpenAICompatibleProvider.toolCalls(message),
      usage: TokenUsage.fromLegacy(this.options.usageParser(data, prompt, content)),
      finishReason: isJsonObject(first) ? strOrNull(first.finish_reason) : null,
      responseId: strOrNull(record.id),
      metadata,
    });
  }

  stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    return retainingStreamUsage(this.streamEvents(request));
  }

  private async *streamEvents(request: ChatRequest): AsyncGenerator<StreamEvent> {
    const transport = this.options.streamTransport;
    if (!transport)
      throw new ProviderError({
        category: 'unsupported',
        safeMessage: 'OpenAI-compatible provider does not have a streaming transport.',
      });
    let completed: ToolCall[] = [];
    for await (const frame of transport(OpenAICompatibleProvider.buildPayload(request, true))) {
      const type = frame.type;
      if (type === 'delta') {
        if (typeof frame.text === 'string' && frame.text)
          yield { kind: 'text_delta', text: frame.text };
        continue;
      }
      if (type === 'tool_call_delta' || type === 'tool_call_completed') {
        const call = isJsonObject(frame.tool_call as JsonValue)
          ? ToolCall.fromOpenai(frame.tool_call as JsonObject)
          : null;
        if (call !== null) {
          if (type === 'tool_call_completed') completed.push(call);
          yield { kind: type, toolCall: call };
        }
        continue;
      }
      if (type === 'usage') {
        yield { kind: 'usage', usage: TokenUsage.fromLegacy(frame) };
        continue;
      }
      if (type === 'error') {
        const value =
          typeof frame.category === 'string' && frame.category ? frame.category : 'response';
        const category = (CATEGORIES as readonly string[]).includes(value)
          ? (value as ProviderErrorCategory)
          : 'response';
        throw new ProviderError({
          category,
          safeMessage: 'OpenAI-compatible streaming request failed.',
          retryable: Boolean(frame.retryable),
          providerCode: strOrNull(frame.code),
        });
      }
      if (type !== 'done') continue;
      const usage = TokenUsage.fromLegacy(frame);
      if (Array.isArray(frame.tool_calls))
        completed = (frame.tool_calls as JsonValue[])
          .filter(isJsonObject)
          .flatMap((raw) => ToolCall.fromOpenai(raw) ?? []);
      const metadata = Object.fromEntries(
        Object.entries(frame).filter(([key]) => !FRAME_FIELDS.has(key)),
      );
      const finishReason = strOrNull(frame.finish_reason);
      const response = chatResponse({
        content: frame.content ? pythonStr(frame.content as JsonValue) : '',
        toolCalls: [...completed],
        usage,
        finishReason,
        responseId: strOrNull(frame.response_id),
        metadata,
      });
      yield { kind: 'completed', response, usage, finishReason, metadata };
    }
  }

  static buildPayload(request: ChatRequest, stream = false): JsonObject {
    const payload: { [key: string]: unknown } = {
      model: request.model,
      messages: request.messages.map((message) => message.toOpenai()),
    };
    if (request.temperature !== null) payload.temperature = request.temperature;
    if (request.maxTokens !== null && request.maxTokens > 0)
      payload.max_completion_tokens = request.maxTokens;
    if (request.reasoningEffort) payload.reasoning_effort = request.reasoningEffort;
    if (request.tools.length) {
      payload.tools = request.tools.map((tool) => tool.toOpenai());
      if (request.toolChoice !== null) payload.tool_choice = request.toolChoice;
    }
    if (stream) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }
    return payload as JsonObject;
  }

  static assistantMessage(data: JsonValue): JsonObject {
    const choices = isJsonObject(data) ? data.choices : undefined;
    if (!Array.isArray(choices) || !choices.length)
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Provider response is missing choices.',
        providerCode: 'missing_choices',
      });
    const first = choices[0];
    if (!isJsonObject(first))
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Provider choice has an invalid shape.',
        providerCode: 'invalid_choice',
      });
    const message = first.message;
    if (!isJsonObject(message))
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Provider response is missing message.',
        providerCode: 'missing_message',
      });
    return message;
  }

  static toolCalls(message: JsonObject): ToolCall[] {
    const raw = message.tool_calls;
    return Array.isArray(raw)
      ? raw.filter(isJsonObject).flatMap((item) => ToolCall.fromOpenai(item) ?? [])
      : [];
  }
}
