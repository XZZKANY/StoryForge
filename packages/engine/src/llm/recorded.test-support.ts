import { expect } from 'vitest';
import { parseJson, type JsonObject } from '../kernel/json';
import {
  callLlm,
  callLlmMessages,
  callLlmStreamed,
  ConfiguredLlmProvider,
  errorUsageSummary,
  fetchProviderModels,
  ModelListHttpError,
  sdkChatRequest,
} from './client';
import { LlmConfigError, type LlmSource } from './config';
import {
  ChatMessage,
  messagesFromOpenai,
  ProviderError,
  TokenUsage,
  toolsFromOpenai,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
} from './contracts';
import { RunControl, RunInterrupted, type RunProgress } from './control';
import { LlmError } from './payload';
import { HttpTransportError, type HttpPort, type HttpRequest, type LlmContext } from './transport';

/** 录制回放的公共元数据：与 Python harness 同一虚拟时钟步长与随机数。 */
export type RecordedMeta = { step_seconds: number; random: number; app_version: string };

export type Reply = {
  raise?: string;
  reason?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  body_b64?: string;
  body_unreadable?: boolean;
  read_raise?: string;
  fail_after_lines?: number;
  fail_with?: string;
};
export type Scenario = {
  kind: string;
  name: string;
  source: LlmSource;
  args: { [key: string]: unknown };
  replies: Reply[];
  control: { deadline: number | null; stop_at: number | null } | null;
  result?: unknown;
  error?: {
    type: string;
    message: string;
    usage: unknown;
    reason?: string | null;
    usage_summary?: unknown;
    details?: {
      category: string;
      retryable: boolean;
      status_code: number | null;
      provider_code: string | null;
      request_id: string | null;
    };
  };
  requests: unknown[];
  waits: number[];
  progress: unknown[];
  clock: number;
  unused_replies: number;
  events?: unknown[];
};

const ENCODER = new TextEncoder();

function transportError(name: string, reason = 'timed out') {
  if (name === 'URLError') return new HttpTransportError('connect', reason);
  if (name === 'TimeoutError') return new HttpTransportError('timeout', reason);
  return new HttpTransportError('read', name);
}

/** 按行切块（HTTPResponse 的逐行读取）；chunkSize 给定时改成任意字节切块。 */
function splitBody(raw: Uint8Array, chunkSize: number | null): Uint8Array[] {
  if (chunkSize !== null) {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < raw.length; i += chunkSize) chunks.push(raw.slice(i, i + chunkSize));
    return chunks;
  }
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++)
    if (raw[i] === 0x0a) {
      lines.push(raw.slice(start, i + 1));
      start = i + 1;
    }
  if (start < raw.length) lines.push(raw.slice(start));
  return lines;
}

function harness(meta: RecordedMeta, scenario: Scenario, chunkSize: number | null = null) {
  const clock = { now: 100 };
  const replies = [...scenario.replies];
  const requests: unknown[] = [];
  const waits: number[] = [];
  const http: HttpPort = {
    async send(request: HttpRequest) {
      clock.now += meta.step_seconds;
      requests.push({
        url: request.url,
        method: request.method,
        timeout: request.timeoutSeconds,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]),
        ),
        body: request.body === null ? null : new TextDecoder().decode(request.body),
      });
      const reply = replies.shift()!;
      if (reply.raise) throw transportError(reply.raise, reply.reason);
      const raw = reply.body_b64
        ? Uint8Array.from(atob(reply.body_b64), (char) => char.charCodeAt(0))
        : ENCODER.encode(reply.body ?? '');
      async function* body() {
        if (reply.body_unreadable) throw new HttpTransportError('read', 'OSError');
        if (reply.read_raise) throw transportError(reply.read_raise);
        const lines = splitBody(raw, chunkSize);
        if (reply.fail_after_lines !== undefined) {
          yield* splitBody(raw, null).slice(0, reply.fail_after_lines);
          throw transportError(reply.fail_with!);
        }
        yield* lines;
      }
      return { status: reply.status!, headers: reply.headers ?? {}, body: body(), close() {} };
    },
  };
  const progress: RunProgress[] = [];
  let control: RunControl | null = null;
  if (scenario.control) {
    let reads = 0;
    const { deadline, stop_at: stopAt } = scenario.control;
    control = new RunControl({
      checkInterruption: (boundary) => {
        if (boundary === 'before_stream_read') reads += 1;
        return stopAt !== null && reads >= stopAt ? 'stopped' : null;
      },
      deadline: deadline === null ? null : 100 + deadline,
      onProgress: (item) => progress.push(item),
      clock: () => clock.now,
      wait: async (seconds) => {
        waits.push(seconds);
        clock.now += seconds;
      },
    });
  }
  const ctx: LlmContext = {
    http,
    clock: () => clock.now,
    wait: async (seconds) => {
      waits.push(seconds);
      clock.now += seconds;
    },
    random: () => meta.random,
    appVersion: meta.app_version,
    secrets: { values: [] },
    control,
  };
  return { ctx, clock, replies, requests, waits, progress };
}

function responseRecord(response: ChatResponse) {
  const record: { [key: string]: unknown } = {
    content: response.content,
    finish_reason: response.finishReason,
    tool_calls: response.toolCalls.map((call) => call.toOpenai()),
    response_id: response.responseId,
    metadata: response.metadata,
  };
  if (response.continuation !== null) record.continuation = response.continuation;
  return record;
}

function eventRecord(event: StreamEvent) {
  const record: { [key: string]: unknown } = { kind: event.kind };
  if (event.text !== undefined && event.text !== null) record.text = event.text;
  if (event.toolCall) record.tool_call = event.toolCall.toOpenai();
  if (event.usage) record.usage = event.usage.toLegacy();
  if (event.response) record.response = responseRecord(event.response);
  return record;
}

/** 直接构造的 ChatRequest（原生协议用），可把某条消息挂上 provider 续接状态。 */
function nativeRequest(args: JsonObject): ChatRequest {
  const messages = messagesFromOpenai(args.messages as JsonObject[]);
  const continuation = args.continuation as
    | [number, { provider: string; state: JsonObject }]
    | undefined;
  if (continuation) {
    const [index, state] = continuation;
    const message = messages[index];
    messages[index] = new ChatMessage(
      message.role,
      message.content,
      message.toolCalls,
      message.toolCallId,
      message.name,
      message.metadata,
      state,
    );
  }
  return {
    model: (args.model as string | undefined) ?? '',
    messages,
    tools: toolsFromOpenai(args.tools as JsonObject[] | undefined),
    temperature: (args.temperature as number | undefined) ?? null,
    maxTokens: (args.max_tokens as number | undefined) ?? null,
    toolChoice: args.tool_choice ?? null,
    reasoningEffort: (args.reasoning_effort as string | undefined) ?? null,
  };
}

async function execute(scenario: Scenario, ctx: LlmContext, events: unknown[]): Promise<unknown> {
  const { source } = scenario;
  const args = parseJson(JSON.stringify(scenario.args), 'args') as JsonObject;
  const plain = scenario.args as { [key: string]: never };
  switch (scenario.kind) {
    case 'call_llm':
      return callLlm(
        source,
        {
          systemPrompt: plain.system,
          userPrompt: plain.user,
          tools: (args.tools as JsonObject[] | undefined) ?? null,
          toolChoice: args.tool_choice ?? null,
        },
        ctx,
      );
    case 'call_llm_messages':
      return callLlmMessages(
        source,
        {
          messages: args.messages as JsonObject[],
          tools: (args.tools as JsonObject[] | undefined) ?? null,
          toolChoice: args.tool_choice ?? null,
          timeoutSeconds: plain.timeout_seconds ?? null,
          maxAttempts: plain.max_attempts ?? null,
        },
        ctx,
      );
    case 'call_llm_streamed':
      return callLlmStreamed(source, { systemPrompt: plain.system, userPrompt: plain.user }, ctx);
    case 'provider_stream': {
      const request = sdkChatRequest(source, {
        messages: args.messages as JsonObject[],
        tools: (args.tools as JsonObject[] | undefined) ?? null,
        toolChoice: args.tool_choice ?? null,
      });
      for await (const event of new ConfiguredLlmProvider(source, ctx).stream(request))
        events.push(eventRecord(event));
      return events;
    }
    case 'provider_complete': {
      const response = await new ConfiguredLlmProvider(source, ctx).complete({
        model: '',
        messages: messagesFromOpenai(args.messages as JsonObject[]),
        tools: [],
        temperature: null,
        maxTokens: (plain.max_tokens as number | undefined) ?? null,
        toolChoice: null,
        reasoningEffort: null,
      });
      return {
        content: response.content,
        usage: response.usage.toLegacy(),
        finish_reason: response.finishReason,
        metadata: response.metadata,
      };
    }
    case 'native_complete': {
      const response = await new ConfiguredLlmProvider(source, ctx).complete(nativeRequest(args));
      return { ...responseRecord(response), usage: response.usage.toLegacy() };
    }
    case 'native_stream':
      for await (const event of new ConfiguredLlmProvider(source, ctx).stream(nativeRequest(args)))
        events.push(eventRecord(event));
      return events;
    default:
      return fetchProviderModels(source, plain.timeout, ctx);
  }
}

const ERRORS: Record<string, new (...args: never[]) => Error> = {
  LLMError: LlmError,
  LLMConfigError: LlmConfigError,
  LLMRunInterrupted: RunInterrupted,
  ValueError: RangeError,
  HTTPError: ModelListHttpError,
  ProviderError,
};

export async function replay(
  meta: RecordedMeta,
  scenario: Scenario,
  chunkSize: number | null = null,
) {
  const { ctx, clock, replies, requests, waits, progress } = harness(meta, scenario, chunkSize);
  const events: unknown[] = [];
  const outcome = await execute(scenario, ctx, events).then(
    (result) => ({ result: JSON.parse(JSON.stringify(result)) as unknown }),
    (error: unknown) => ({ error }),
  );
  if (scenario.error) {
    expect('error' in outcome).toBe(true);
    const error = (outcome as { error: Error }).error;
    expect(error).toBeInstanceOf(ERRORS[scenario.error.type]);
    const message =
      error instanceof ModelListHttpError ? `HTTP ${error.status}` : (error as Error).message;
    expect(message).toBe(scenario.error.message);
    const usage = (error as { usage?: unknown }).usage;
    expect(usage instanceof TokenUsage ? usage.toLegacy() : null).toEqual(scenario.error.usage);
    if (scenario.error.reason) expect((error as RunInterrupted).reason).toBe(scenario.error.reason);
    if (scenario.error.usage_summary !== undefined && scenario.error.usage_summary !== null)
      expect(errorUsageSummary(error, scenario.source)).toEqual(scenario.error.usage_summary);
    if (scenario.error.details) {
      const details = (error as ProviderError).details;
      expect({
        category: details.category,
        retryable: details.retryable,
        status_code: details.statusCode,
        provider_code: details.providerCode,
        request_id: details.requestId,
      }).toEqual(scenario.error.details);
    }
  } else expect(outcome).toEqual({ result: scenario.result });
  expect(requests).toEqual(scenario.requests);
  expect(waits).toEqual(scenario.waits);
  expect(progress).toEqual(scenario.progress);
  expect(clock.now).toBe(scenario.clock);
  expect(replies.length).toBe(scenario.unused_replies);
  if (scenario.kind === 'provider_stream' || scenario.kind === 'native_stream')
    expect(events).toEqual(scenario.events);
}
