import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  parseJson,
  pythonStr,
  pythonTruthy,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  chatResponse,
  ProviderError,
  retainingStreamUsage,
  TokenUsage,
  ToolCall,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderContinuation,
  type ProviderErrorCategory,
  type StreamEvent,
  type ToolSpec,
} from './contracts';
import type { LlmProvider } from './openaiCompatible';
import { pythonStrRepr } from './pythonRepr';

export type AnthropicCompleteTransport = (
  payload: JsonObject,
) => Promise<{ data: JsonValue; startedAt: number }>;
export type AnthropicStreamTransport = (payload: JsonObject) => AsyncIterable<JsonObject>;

const THINKING_BUDGETS: Record<string, number> = { low: 1024, medium: 4096, high: 8192 };
/**
 * 4.6 以前的模型（claude-3*、4 / 4.1 / 4.5 各档及其日期快照）只认 `thinking.budget_tokens`；
 * 4.6 起官方写法是 adaptive + output_config.effort，Opus 4.7+ / Sonnet 5+ / Fable 5 对 budget_tokens 回 400。
 * 认不出的名字一律按新写法。
 */
const LEGACY_THINKING_MODEL =
  /claude-3|claude-(?:opus|sonnet|haiku)-4(?:[-.][015])?(?:-\d{8})?(?![-.]?\d)/i;
const STOP_REASONS: Record<string, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  tool_use: 'tool_calls',
  max_tokens: 'length',
  refusal: 'content_filter',
};
const ERROR_CATEGORIES: Record<string, ProviderErrorCategory> = {
  authentication_error: 'authentication',
  permission_error: 'authentication',
  invalid_request_error: 'invalid_request',
  rate_limit_error: 'rate_limit',
  content_filter_error: 'content_filter',
  overloaded_error: 'connection',
};

const positiveInt = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
const strOr = (value: JsonValue | undefined, fallback: string) =>
  pythonTruthy(value) ? pythonStr(value) : fallback;
const strOrNull = (value: JsonValue | undefined) =>
  value === undefined || value === null ? null : pythonStr(value);
const own = (object: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function argumentsObject(call: ToolCall): JsonObject {
  let value: JsonValue;
  try {
    value = parseJson(call.argumentsJson || '{}', 'tool arguments');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    throw new ProviderError({
      category: 'invalid_request',
      safeMessage: `Tool call ${pythonStrRepr(call.name)} has invalid JSON arguments.`,
      providerCode: 'invalid_tool_arguments',
    });
  }
  if (!isJsonObject(value))
    throw new ProviderError({
      category: 'invalid_request',
      safeMessage: `Tool call ${pythonStrRepr(call.name)} arguments must be a JSON object.`,
      providerCode: 'invalid_tool_arguments',
    });
  return value;
}

function anthropicUsage(
  payload: JsonValue | undefined,
  prior: TokenUsage | null = null,
): TokenUsage {
  const data = isJsonObject(payload) ? payload : {};
  const counted = ['input_tokens', 'output_tokens'].some((key) => {
    const value = data[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  });
  if (!counted) return prior ?? new TokenUsage();
  const input = positiveInt(data.input_tokens) || (prior ? prior.inputTokens : 0);
  const output = positiveInt(data.output_tokens) || (prior ? prior.outputTokens : 0);
  const cached = positiveInt(data.cache_read_input_tokens);
  return new TokenUsage(
    input,
    output,
    input + output,
    cached || (prior ? prior.cachedInputTokens : null),
    null,
    'provider_usage',
  );
}

function normalizedStopReason(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  const raw = pythonStr(value);
  return Object.prototype.hasOwnProperty.call(STOP_REASONS, raw)
    ? STOP_REASONS[raw]
    : raw.toLowerCase();
}

/** Anthropic Messages 适配器：原生 block 只在这里出现。 */
export class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly options: {
      completeTransport: AnthropicCompleteTransport;
      streamTransport?: AnthropicStreamTransport | null;
      defaultMaxTokens?: number;
      clock: () => number;
    },
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const { data, startedAt } = await this.options.completeTransport(this.buildPayload(request));
    const record = isJsonObject(data) ? data : {};
    AnthropicProvider.raiseForError(record);
    const blocks = record.content;
    if (!Array.isArray(blocks))
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Anthropic response is missing content blocks.',
        providerCode: 'missing_content',
      });
    const [content, toolCalls, continuation] = AnthropicProvider.parseBlocks(blocks);
    const stopReason = normalizedStopReason(record.stop_reason);
    if (stopReason === 'content_filter')
      throw new ProviderError(
        {
          category: 'content_filter',
          safeMessage: 'Anthropic blocked the response for safety reasons.',
          providerCode: strOrNull(record.stop_reason) ?? 'None',
        },
        anthropicUsage(record.usage),
      );
    const metadata: { [key: string]: unknown } = {
      latency_ms: Math.max(0, Math.trunc((this.options.clock() - startedAt) * 1000)),
    };
    if (continuation !== null) metadata.reasoning_present = true;
    return chatResponse({
      content,
      toolCalls,
      usage: anthropicUsage(record.usage),
      finishReason: stopReason,
      responseId: strOrNull(record.id),
      metadata,
      continuation,
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
        safeMessage: 'Anthropic provider does not have a streaming transport.',
      });
    const textParts: string[] = [];
    const toolState = new Map<number, { id: string; name: string; arguments: string }>();
    const completed: ToolCall[] = [];
    let usage = new TokenUsage();
    let finishReason: string | null = null;
    let responseId: string | null = null;
    let reasoningPresent = false;
    const thinkingState = new Map<number, JsonObject>();
    const thinkingBlocks: JsonObject[] = [];
    for await (const frame of transport(this.buildPayload(request, true))) {
      AnthropicProvider.raiseForError(frame);
      const type = frame.type;
      if (type === 'message_start') {
        const message = frame.message;
        if (isJsonObject(message)) {
          responseId = strOrNull(message.id);
          usage = anthropicUsage(message.usage, usage);
          yield { kind: 'usage', usage };
        }
        continue;
      }
      if (type === 'content_block_start') {
        const index = positiveInt(frame.index);
        const block = frame.content_block;
        if (isJsonObject(block) && block.type === 'tool_use') {
          const input = block.input;
          toolState.set(index, {
            id: strOr(block.id, ''),
            name: strOr(block.name, ''),
            arguments:
              isJsonObject(input) && Object.keys(input).length
                ? dumpJson(input, { ensureAscii: false })
                : '',
          });
        } else if (
          isJsonObject(block) &&
          (block.type === 'thinking' || block.type === 'redacted_thinking')
        ) {
          reasoningPresent = true;
          thinkingState.set(index, { ...block });
        }
        continue;
      }
      if (type === 'content_block_delta') {
        const index = positiveInt(frame.index);
        const delta = frame.delta;
        if (!isJsonObject(delta)) continue;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          textParts.push(delta.text);
          yield { kind: 'text_delta', text: delta.text };
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          reasoningPresent = true;
          const state = thinkingState.get(index) ?? { type: 'thinking', thinking: '' };
          thinkingState.set(index, state);
          state.thinking = strOr(state.thinking, '') + delta.thinking;
          yield { kind: 'reasoning_delta', text: delta.thinking };
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          const state = thinkingState.get(index) ?? { type: 'thinking', thinking: '' };
          thinkingState.set(index, state);
          state.signature = strOr(state.signature, '') + delta.signature;
        } else if (delta.type === 'input_json_delta' && toolState.has(index)) {
          const partial = strOr(delta.partial_json, '');
          const state = toolState.get(index)!;
          state.arguments += partial;
          yield { kind: 'tool_call_delta', toolCall: new ToolCall(state.id, state.name, partial) };
        }
        continue;
      }
      if (type === 'content_block_stop') {
        const index = positiveInt(frame.index);
        const state = toolState.get(index);
        toolState.delete(index);
        if (state !== undefined) {
          const call = new ToolCall(state.id, state.name, state.arguments || '{}');
          completed.push(call);
          yield { kind: 'tool_call_completed', toolCall: call };
        }
        const thinking = thinkingState.get(index);
        thinkingState.delete(index);
        if (thinking !== undefined) thinkingBlocks.push(thinking);
        continue;
      }
      if (type === 'message_delta') {
        const delta = frame.delta;
        if (isJsonObject(delta))
          finishReason = normalizedStopReason(delta.stop_reason) || finishReason;
        usage = anthropicUsage(frame.usage, usage);
        yield { kind: 'usage', usage };
        continue;
      }
      if (type !== 'message_stop') continue;
      if (finishReason === 'content_filter')
        throw new ProviderError({
          category: 'content_filter',
          safeMessage: 'Anthropic blocked the streamed response for safety reasons.',
          providerCode: 'refusal',
        });
      const metadata = reasoningPresent ? { reasoning_present: true } : {};
      const response = chatResponse({
        content: textParts.join(''),
        toolCalls: [...completed],
        usage,
        finishReason,
        responseId,
        metadata,
        continuation: thinkingBlocks.length
          ? { provider: 'anthropic', state: { thinking_blocks: thinkingBlocks } }
          : null,
      });
      yield { kind: 'completed', response, usage, finishReason, metadata };
      return;
    }
    throw new ProviderError({
      category: 'response',
      safeMessage: 'Anthropic stream ended before message_stop.',
      providerCode: 'missing_stream_terminal',
    });
  }

  buildPayload(request: ChatRequest, stream = false): JsonObject {
    const system = pythonStrip(
      request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content || '')
        .join('\n\n'),
    );
    const maxTokens = request.maxTokens || (this.options.defaultMaxTokens ?? 4096);
    const payload: { [key: string]: unknown } = {
      model: request.model,
      messages: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => AnthropicProvider.nativeMessage(message)),
      max_tokens: maxTokens,
    };
    if (system) payload.system = system;
    const effort = request.reasoningEffort;
    if (effort) {
      const budget = Object.prototype.hasOwnProperty.call(THINKING_BUDGETS, effort)
        ? THINKING_BUDGETS[effort]
        : undefined;
      if (budget === undefined)
        throw new ProviderError({
          category: 'invalid_request',
          safeMessage: 'Anthropic reasoning effort must be low, medium, or high.',
          providerCode: 'invalid_reasoning_effort',
        });
      // 开思考不发 temperature：新模型对非默认采样值回 400，老模型开思考时也不许改 temperature。
      if (LEGACY_THINKING_MODEL.test(request.model)) {
        // budget_tokens 必须小于 max_tokens；装不下就把上限抬高，正文额度不被思考吃掉。
        if (maxTokens <= budget) payload.max_tokens = budget + maxTokens;
        payload.thinking = { type: 'enabled', budget_tokens: budget };
      } else {
        payload.thinking = { type: 'adaptive' };
        payload.output_config = { effort };
      }
    } else if (request.temperature !== null) payload.temperature = request.temperature;
    if (request.tools.length) {
      payload.tools = request.tools.map((tool) => AnthropicProvider.nativeTool(tool));
      const choice = AnthropicProvider.toolChoice(request.toolChoice);
      if (choice !== null) payload.tool_choice = choice;
    }
    if (stream) payload.stream = true;
    return payload as JsonObject;
  }

  static nativeMessage(message: ChatMessage): JsonObject {
    if (message.role === 'tool')
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId || '',
            content: message.content || '',
          },
        ],
      };
    const blocks: JsonObject[] = [];
    const continuation = message.continuation;
    if (
      message.role === 'assistant' &&
      continuation !== null &&
      continuation.provider === 'anthropic'
    ) {
      const thinking = continuation.state.thinking_blocks;
      if (Array.isArray(thinking))
        for (const block of thinking)
          if (isJsonObject(block as JsonValue)) blocks.push({ ...(block as JsonObject) });
    }
    if (message.content) blocks.push({ type: 'text', text: message.content });
    if (message.role === 'assistant')
      for (const call of message.toolCalls)
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: argumentsObject(call),
        });
    return { role: message.role, content: blocks };
  }

  static nativeTool(tool: ToolSpec): JsonObject {
    const payload: JsonObject = { name: tool.name, input_schema: { ...tool.inputSchema } };
    if (tool.description || tool.metadata.hasDescription) payload.description = tool.description;
    return payload;
  }

  static toolChoice(value: JsonValue | null): JsonObject | null {
    if (value === null) return null;
    if (typeof value === 'string') {
      const mapping: Record<string, string> = { auto: 'auto', required: 'any', none: 'none' };
      return {
        type: Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value,
      };
    }
    if (!isJsonObject(value)) return null;
    const fn = value.function;
    if (isJsonObject(fn) && pythonTruthy(fn.name))
      return { type: 'tool', name: pythonStr(fn.name) };
    return { ...value };
  }

  static parseBlocks(blocks: JsonValue[]): [string, ToolCall[], ProviderContinuation | null] {
    const text: string[] = [];
    const calls: ToolCall[] = [];
    const thinking: JsonObject[] = [];
    for (const block of blocks) {
      if (!isJsonObject(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
      else if (block.type === 'thinking' || block.type === 'redacted_thinking')
        thinking.push({ ...block });
      else if (block.type === 'tool_use') {
        const input = block.input;
        calls.push(
          new ToolCall(
            strOr(block.id, ''),
            strOr(block.name, ''),
            dumpJson(isJsonObject(input) ? input : {}, { ensureAscii: false }),
          ),
        );
      }
    }
    return [
      text.join(''),
      calls,
      thinking.length ? { provider: 'anthropic', state: { thinking_blocks: thinking } } : null,
    ];
  }

  static raiseForError(data: JsonObject): void {
    if (data.type !== 'error') return;
    const error = data.error;
    const type = isJsonObject(error) ? strOr(error.type, '') : '';
    const category = own(ERROR_CATEGORIES, type) ? ERROR_CATEGORIES[type] : 'response';
    throw new ProviderError({
      category,
      safeMessage: `Anthropic request failed (${type || 'unknown_error'}).`,
      retryable: category === 'rate_limit' || category === 'connection',
      providerCode: type || null,
      requestId: strOrNull(data.request_id),
    });
  }
}
