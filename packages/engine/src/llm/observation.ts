import type { LlmSource } from './config';
import {
  ProviderError,
  retainErrorUsage,
  TokenUsage,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
} from './contracts';
import type { LlmProvider } from './openaiCompatible';

type Obj = { [key: string]: unknown };

/** 一次模型派发的本地证据：开始时落库，结束（或进度）时更新。 */
export interface ModelAttempt {
  finish(
    status: string,
    fields: { usage: TokenUsage; finishReason?: string | null; errorCode?: string | null },
  ): Promise<void>;
  progress(values: { readonly [key: string]: unknown }): void;
}

export interface ModelObserver {
  begin(
    request: ChatRequest,
    fields: { source: LlmSource; streaming: boolean; operation: string; provenance: Obj },
  ): Promise<ModelAttempt>;
}

/**
 * 一次 agent 运行的模型观察范围（Python 用三个 ContextVar：观察者、当前操作与来源、当前派发）。
 * 同一 run 里模型调用串行，操作与派发按进入 / 退出成对恢复。
 */
export class ModelObservation {
  private operation: [string, Obj] = ['agent.model', {}];
  private attempt: ModelAttempt | null = null;

  constructor(readonly observer: ModelObserver) {}

  async withOperation<T>(name: string, provenance: Obj | null, run: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    this.operation = [name, provenance ?? {}];
    try {
      return await run();
    } finally {
      this.operation = previous;
    }
  }

  begin(request: ChatRequest, source: LlmSource, streaming: boolean): Promise<ModelAttempt> {
    const [operation, provenance] = this.operation;
    return this.observer.begin(request, { source, streaming, operation, provenance });
  }

  /** 传输层的阶段进度（请求开始 / 重试等待 / 重试开始）只记到当前这次派发上。 */
  progress(values: { readonly [key: string]: unknown }): void {
    this.attempt?.progress(values);
  }

  enter(attempt: ModelAttempt): ModelAttempt | null {
    const previous = this.attempt;
    this.attempt = attempt;
    return previous;
  }

  leave(previous: ModelAttempt | null): void {
    this.attempt = previous;
  }
}

const INTERRUPT_REASONS = new Set(['paused', 'stopped', 'deadline_exceeded']);

/** 失败归类：控制面退出记原因，provider 错误记类别，其余一律 provider_error。 */
export function attemptErrorCode(error: unknown): string {
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (typeof reason === 'string' && INTERRUPT_REASONS.has(reason)) return reason;
  if (error instanceof ProviderError) return error.details.category;
  return 'provider_error';
}

const settledStatus = (finishReason: string | null) =>
  finishReason === 'length' || finishReason === 'content_filter'
    ? 'response_rejected'
    : 'response_completed';

/** 证据没写上就失败关闭，但已收到的用量要随错误带走。 */
async function finishAttempt(
  attempt: ModelAttempt,
  status: string,
  fields: { usage: TokenUsage; finishReason?: string | null; errorCode?: string | null },
): Promise<void> {
  try {
    await attempt.finish(status, fields);
  } catch (error) {
    retainErrorUsage(error, fields.usage);
    throw error;
  }
}

const errorUsage = (error: unknown): TokenUsage | null => {
  const usage = (error as { usage?: unknown } | null)?.usage;
  return usage instanceof TokenUsage ? usage : null;
};

async function* observedStream(
  provider: LlmProvider,
  request: ChatRequest,
  source: LlmSource,
  observation: ModelObservation,
): AsyncGenerator<StreamEvent> {
  const attempt = await observation.begin(request, source, true);
  const previous = observation.enter(attempt);
  let usage = new TokenUsage();
  let settling = false;
  let ended = false;
  try {
    for await (const event of provider.stream(request)) {
      if (event.usage) usage = event.usage;
      if (event.response) {
        usage = event.response.usage;
        settling = true;
        await finishAttempt(attempt, settledStatus(event.response.finishReason), {
          usage,
          finishReason: event.response.finishReason,
        });
      }
      yield event;
    }
    ended = true;
    if (!settling) await finishAttempt(attempt, 'stream_incomplete', { usage });
  } catch (error) {
    ended = true;
    retainErrorUsage(error, usage);
    if (!settling)
      await finishAttempt(
        attempt,
        INTERRUPT_REASONS.has(attemptErrorCode(error)) ? 'interrupted' : 'request_failed',
        { usage: errorUsage(error) ?? usage, errorCode: attemptErrorCode(error) },
      );
    throw error;
  } finally {
    try {
      // 消费方提前关流（Python 的 GeneratorExit）：派发结果未知，照实记下。
      if (!ended && !settling)
        await finishAttempt(attempt, 'stream_closed', { usage, errorCode: 'provider_error' });
    } finally {
      observation.leave(previous);
    }
  }
}

/** 在 provider 外面套一层本地请求证据；没有观察范围时原样返回。 */
export function observeProvider(
  provider: LlmProvider,
  source: LlmSource,
  observation: ModelObservation | null | undefined,
): LlmProvider {
  if (!observation) return provider;
  return {
    async complete(request: ChatRequest): Promise<ChatResponse> {
      const attempt = await observation.begin(request, source, false);
      const previous = observation.enter(attempt);
      try {
        let response: ChatResponse;
        try {
          response = await provider.complete(request);
        } catch (error) {
          const code = attemptErrorCode(error);
          await finishAttempt(
            attempt,
            INTERRUPT_REASONS.has(code) ? 'interrupted' : 'request_failed',
            {
              usage: errorUsage(error) ?? new TokenUsage(),
              errorCode: code,
            },
          );
          throw error;
        }
        await finishAttempt(attempt, settledStatus(response.finishReason), {
          usage: response.usage,
          finishReason: response.finishReason,
        });
        return response;
      } finally {
        observation.leave(previous);
      }
    },
    stream: (request: ChatRequest) => observedStream(provider, request, source, observation),
  };
}
