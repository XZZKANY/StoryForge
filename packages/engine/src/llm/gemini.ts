import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  parseJson,
  pythonStr,
  pythonTruthy,
  strOr,
  strOrNull,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  chatResponse,
  ProviderError,
  retainErrorUsage,
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

export type GeminiCompleteTransport = (
  model: string,
  payload: JsonObject,
) => Promise<{ data: JsonValue; startedAt: number }>;
export type GeminiStreamTransport = (
  model: string,
  payload: JsonObject,
) => AsyncIterable<JsonObject>;

const THINKING_BUDGETS: Record<string, number> = { low: 1024, medium: 4096, high: 8192 };
/**
 * Gemini 3 起用 thinkingLevel（取值 LOW / MEDIUM / HIGH，见 v1beta discovery 的 ThinkingConfig）；
 * 2.5 及以前只认 thinkingBudget。两个同发回 400，只能二选一。
 */
const BUDGET_THINKING_MODEL = /^gemini-[12](?!\d)/i;
const FINISH_REASONS: Record<string, string> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  MALFORMED_FUNCTION_CALL: 'invalid_request',
};
const ERROR_CATEGORIES: Record<string, ProviderErrorCategory> = {
  UNAUTHENTICATED: 'authentication',
  PERMISSION_DENIED: 'authentication',
  INVALID_ARGUMENT: 'invalid_request',
  FAILED_PRECONDITION: 'invalid_request',
  RESOURCE_EXHAUSTED: 'rate_limit',
  DEADLINE_EXCEEDED: 'timeout',
  UNAVAILABLE: 'connection',
};

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const positiveInt = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;

function jsonObject(value: string, label: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = parseJson(value || '{}', 'gemini json');
  } catch (error) {
    if (!(error instanceof InputDomainError)) throw error;
    throw new ProviderError({
      category: 'invalid_request',
      safeMessage: `${label} must contain valid JSON.`,
      providerCode: 'invalid_json',
    });
  }
  if (!isJsonObject(parsed))
    throw new ProviderError({
      category: 'invalid_request',
      safeMessage: `${label} must contain a JSON object.`,
      providerCode: 'invalid_json_object',
    });
  return parsed;
}

function geminiUsage(payload: JsonValue | undefined, prior: TokenUsage | null = null): TokenUsage {
  const data = isJsonObject(payload) ? payload : {};
  const counted = ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'].some((key) => {
    const value = data[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  });
  if (!counted) return prior ?? new TokenUsage();
  const input = positiveInt(data.promptTokenCount) || (prior ? prior.inputTokens : 0);
  const output = positiveInt(data.candidatesTokenCount) || (prior ? prior.outputTokens : 0);
  const total = positiveInt(data.totalTokenCount) || input + output;
  const cached = positiveInt(data.cachedContentTokenCount);
  const reasoning = positiveInt(data.thoughtsTokenCount);
  return new TokenUsage(
    input,
    output,
    total,
    cached || (prior ? prior.cachedInputTokens : null),
    reasoning || (prior ? prior.reasoningTokens : null),
    'provider_usage',
  );
}

function finishReasonOf(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  const raw = pythonStr(value).toUpperCase();
  return own(FINISH_REASONS, raw) ? FINISH_REASONS[raw] : raw.toLowerCase();
}

/** Gemini generateContent 适配器：原生 parts 只在这里出现。 */
export class GeminiProvider implements LlmProvider {
  constructor(
    private readonly options: {
      completeTransport: GeminiCompleteTransport;
      streamTransport?: GeminiStreamTransport | null;
      clock: () => number;
    },
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const { data, startedAt } = await this.options.completeTransport(
      request.model,
      this.buildPayload(request),
    );
    const record = isJsonObject(data) ? data : {};
    GeminiProvider.raiseForError(record);
    const candidate = GeminiProvider.firstCandidate(record);
    const [content, toolCalls, continuation] = GeminiProvider.parseCandidate(candidate);
    const finishReason = finishReasonOf(candidate.finishReason);
    try {
      GeminiProvider.raiseForBlockedFinish(finishReason, candidate.finishReason);
    } catch (error) {
      retainErrorUsage(error, geminiUsage(record.usageMetadata));
      throw error;
    }
    const metadata: { [key: string]: unknown } = {
      latency_ms: Math.max(0, Math.trunc((this.options.clock() - startedAt) * 1000)),
    };
    if (continuation !== null) metadata.reasoning_present = true;
    return chatResponse({
      content,
      toolCalls,
      usage: geminiUsage(record.usageMetadata),
      finishReason,
      responseId: strOrNull(record.responseId),
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
        safeMessage: 'Gemini provider does not have a streaming transport.',
      });
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    let usage = new TokenUsage();
    let finishReason: string | null = null;
    let responseId: string | null = null;
    let reasoningPresent = false;
    const signatures: { [id: string]: string } = {};
    for await (const frame of transport(request.model, this.buildPayload(request))) {
      GeminiProvider.raiseForError(frame);
      if (isJsonObject(frame.usageMetadata)) {
        usage = geminiUsage(frame.usageMetadata, usage);
        yield { kind: 'usage', usage };
      }
      if (frame.responseId !== undefined && frame.responseId !== null)
        responseId = pythonStr(frame.responseId);
      const candidates = frame.candidates;
      if (!Array.isArray(candidates) || !candidates.length || !isJsonObject(candidates[0]))
        continue;
      const candidate = candidates[0];
      const content = candidate.content;
      const parts = isJsonObject(content) ? content.parts : undefined;
      if (Array.isArray(parts))
        for (const [index, part] of parts.entries()) {
          if (!isJsonObject(part)) continue;
          if (part.thought === true && typeof part.text === 'string') {
            reasoningPresent = true;
            yield { kind: 'reasoning_delta', text: part.text };
          } else if (typeof part.text === 'string') {
            textParts.push(part.text);
            yield { kind: 'text_delta', text: part.text };
          }
          const functionCall = part.functionCall;
          if (isJsonObject(functionCall)) {
            const call = GeminiProvider.toolCall(functionCall, index);
            toolCalls.push(call);
            const signature = part.thoughtSignature;
            if (typeof signature === 'string' && signature) signatures[call.id] = signature;
            yield { kind: 'tool_call_completed', toolCall: call };
          }
        }
      const current = finishReasonOf(candidate.finishReason);
      if (current !== null) {
        finishReason = current;
        GeminiProvider.raiseForBlockedFinish(finishReason, candidate.finishReason);
      }
    }
    if (finishReason === null)
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Gemini stream ended without a finish reason.',
        providerCode: 'missing_stream_terminal',
      });
    const metadata = reasoningPresent ? { reasoning_present: true } : {};
    const response = chatResponse({
      content: textParts.join(''),
      toolCalls,
      usage,
      finishReason,
      responseId,
      metadata,
      continuation: Object.keys(signatures).length
        ? { provider: 'gemini', state: { function_call_signatures: signatures } }
        : null,
    });
    yield { kind: 'completed', response, usage, finishReason, metadata };
  }

  buildPayload(request: ChatRequest): JsonObject {
    const system = pythonStrip(
      request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content || '')
        .join('\n\n'),
    );
    const callNames: { [id: string]: string } = {};
    for (const message of request.messages)
      for (const call of message.toolCalls)
        if (call.id && call.name) callNames[call.id] = call.name;
    const payload: { [key: string]: unknown } = {
      contents: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => GeminiProvider.nativeContent(message, callNames)),
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const config: { [key: string]: unknown } = {};
    if (request.temperature !== null) config.temperature = request.temperature;
    if (request.maxTokens !== null && request.maxTokens > 0)
      config.maxOutputTokens = request.maxTokens;
    const effort = request.reasoningEffort;
    if (effort) {
      if (!own(THINKING_BUDGETS, effort))
        throw new ProviderError({
          category: 'invalid_request',
          safeMessage: 'Gemini reasoning effort must be low, medium, or high.',
          providerCode: 'invalid_reasoning_effort',
        });
      config.thinkingConfig = BUDGET_THINKING_MODEL.test(request.model)
        ? { thinkingBudget: THINKING_BUDGETS[effort] }
        : { thinkingLevel: effort.toUpperCase() };
    }
    if (Object.keys(config).length) payload.generationConfig = config;
    if (request.tools.length) {
      payload.tools = [
        { functionDeclarations: request.tools.map((tool) => GeminiProvider.declaration(tool)) },
      ];
      const toolConfig = GeminiProvider.toolConfig(request.toolChoice);
      if (toolConfig !== null) payload.toolConfig = { functionCallingConfig: toolConfig };
    }
    return payload as JsonObject;
  }

  static nativeContent(message: ChatMessage, callNames: { [id: string]: string }): JsonObject {
    if (message.role === 'tool') {
      const id = message.toolCallId || '';
      const name = message.name || (own(callNames, id) ? callNames[id] : '');
      if (!name)
        throw new ProviderError({
          category: 'invalid_request',
          safeMessage: 'Gemini tool results require a tool name or a correlated tool call id.',
          providerCode: 'missing_tool_name',
        });
      const response = jsonObject(message.content || '{}', `Tool result ${pythonStrRepr(name)}`);
      return { role: 'user', parts: [{ functionResponse: { name, response } }] };
    }
    const parts: JsonObject[] = [];
    if (message.content) parts.push({ text: message.content });
    if (message.role === 'assistant') {
      let signatures: { [key: string]: unknown } = {};
      const continuation = message.continuation;
      if (continuation !== null && continuation.provider === 'gemini') {
        const raw = continuation.state.function_call_signatures;
        if (isJsonObject(raw as JsonValue)) signatures = raw as JsonObject;
      }
      for (const call of message.toolCalls) {
        const part: JsonObject = {
          functionCall: {
            id: call.id,
            name: call.name,
            args: jsonObject(call.argumentsJson, `Tool call ${pythonStrRepr(call.name)}`),
          },
        };
        const signature = own(signatures, call.id) ? signatures[call.id] : undefined;
        if (typeof signature === 'string' && signature) part.thoughtSignature = signature;
        parts.push(part);
      }
    }
    return { role: message.role === 'assistant' ? 'model' : 'user', parts };
  }

  static declaration(tool: ToolSpec): JsonObject {
    const declaration: JsonObject = { name: tool.name, parameters: { ...tool.inputSchema } };
    if (tool.description || tool.metadata.hasDescription)
      declaration.description = tool.description;
    return declaration;
  }

  static toolConfig(value: JsonValue | null): JsonObject | null {
    if (value === null) return null;
    if (typeof value === 'string') {
      const modes: Record<string, string> = { auto: 'AUTO', required: 'ANY', none: 'NONE' };
      return { mode: own(modes, value) ? modes[value] : value.toUpperCase() };
    }
    if (!isJsonObject(value)) return null;
    const fn = value.function;
    if (isJsonObject(fn) && pythonTruthy(fn.name))
      return { mode: 'ANY', allowedFunctionNames: [pythonStr(fn.name)] };
    return { ...value };
  }

  static firstCandidate(data: JsonObject): JsonObject {
    const candidates = data.candidates;
    if (!Array.isArray(candidates) || !candidates.length || !isJsonObject(candidates[0]))
      throw new ProviderError({
        category: 'response',
        safeMessage: 'Gemini response is missing candidates.',
        providerCode: 'missing_candidates',
      });
    return candidates[0];
  }

  static parseCandidate(candidate: JsonObject): [string, ToolCall[], ProviderContinuation | null] {
    const content = candidate.content;
    const parts = isJsonObject(content) ? content.parts : undefined;
    if (!Array.isArray(parts)) return ['', [], null];
    const text: string[] = [];
    const calls: ToolCall[] = [];
    let reasoning = false;
    const signatures: { [id: string]: string } = {};
    for (const [index, part] of parts.entries()) {
      if (!isJsonObject(part)) continue;
      if (part.thought === true) reasoning = true;
      else if (typeof part.text === 'string') text.push(part.text);
      const functionCall = part.functionCall;
      if (isJsonObject(functionCall)) {
        const call = GeminiProvider.toolCall(functionCall, index);
        calls.push(call);
        const signature = part.thoughtSignature;
        if (typeof signature === 'string' && signature) signatures[call.id] = signature;
      }
    }
    let continuation: ProviderContinuation | null = Object.keys(signatures).length
      ? { provider: 'gemini', state: { function_call_signatures: signatures } }
      : null;
    if (reasoning && continuation === null) continuation = { provider: 'gemini', state: {} };
    return [text.join(''), calls, continuation];
  }

  static toolCall(payload: JsonObject, index: number): ToolCall {
    const args = payload.args;
    return new ToolCall(
      strOr(payload.id, `gemini-call-${index}`),
      strOr(payload.name, ''),
      dumpJson(isJsonObject(args) ? args : {}, { ensureAscii: false }),
    );
  }

  static raiseForBlockedFinish(
    finishReason: string | null,
    providerReason: JsonValue | undefined,
  ): void {
    if (finishReason === 'content_filter')
      throw new ProviderError({
        category: 'content_filter',
        safeMessage: 'Gemini blocked the response for safety reasons.',
        providerCode: strOrNull(providerReason),
      });
    if (finishReason === 'invalid_request')
      throw new ProviderError({
        category: 'invalid_request',
        safeMessage: 'Gemini returned a malformed function call.',
        providerCode: strOrNull(providerReason),
      });
  }

  static raiseForError(data: JsonObject): void {
    const error = data.error;
    if (!isJsonObject(error)) return;
    const status = strOr(error.status, '');
    const category = own(ERROR_CATEGORIES, status) ? ERROR_CATEGORIES[status] : 'response';
    throw new ProviderError({
      category,
      safeMessage: `Gemini request failed (${status || 'unknown_error'}).`,
      retryable: category === 'rate_limit' || category === 'timeout' || category === 'connection',
      statusCode: positiveInt(error.code) || null,
      providerCode: status || null,
    });
  }
}
