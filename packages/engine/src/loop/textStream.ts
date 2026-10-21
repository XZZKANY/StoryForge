import { pythonStrip } from '../kernel/pythonText';
import type { SecretContext } from '../kernel/redaction';
import {
  ProviderError,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
  type TokenUsage,
} from '../llm/contracts';
import { checkRunInterruption, type RunControl } from '../llm/control';
import { VisibleTextFilter } from '../llm/text';
import type { AgentTextDeltaFrame, AgentTextStreamStartedFrame } from './frames';

export type TextFrame = AgentTextStreamStartedFrame | AgentTextDeltaFrame;
export type TextObserver = (frame: TextFrame) => void;

export type TextStreamProvider = {
  complete(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  /** provider 能否逐块回传正文（Python 的 capabilities(model).streaming）。 */
  readonly streaming: boolean;
};

export type TextStreamContext = {
  readonly onText: TextObserver | null;
  readonly runId: string;
  /** 本轮序号，从 1 开始。 */
  readonly roundIndex: number;
  readonly secrets: SecretContext;
  readonly control: RunControl | null;
  readonly newStreamId: () => string;
  /** 本轮第几次因流中途断开而重发（0 = 首发）；作者端据此丢掉上一次的半截正文。 */
  readonly retryAttempt?: number;
  /** provider 吐出过任何流事件就置真：中途断开与建连失败要分开处理。 */
  readonly progress?: { received: boolean };
};

const FINISHED = new Set<string | null>([
  null,
  'stop',
  'tool_calls',
  'end_turn',
  'length',
  'content_filter',
]);
const DELTA_MAX = 4096;

/**
 * 有观察者且 provider 支持流式时，边收边推可见正文帧（think 块与密钥剥掉），收尾仍交回完整响应；
 * 截断 / 过滤的结算与用量归 SDK，不执行半截的工具调用。只是观察，不是写回凭据。
 */
export async function completeWithTextStream(
  provider: TextStreamProvider,
  request: ChatRequest,
  context: TextStreamContext,
): Promise<ChatResponse> {
  const observer = context.onText;
  if (observer === null || !provider.streaming) return provider.complete(request);
  const identity = {
    run_id: context.runId,
    stream_id: context.newStreamId(),
    round_index: context.roundIndex,
  };
  const visible = new VisibleTextFilter(context.secrets);
  let sequence = 0;
  observer({
    type: 'agent_text_stream_started',
    ...identity,
    chunk_sequence: 0,
    retry_attempt: context.retryAttempt ?? 0,
  });
  let response: ChatResponse | null = null;
  let usage: TokenUsage | null = null;
  let received = false;
  const publish = (text: string) => {
    const points = Array.from(text);
    for (let start = 0; start < points.length; start += DELTA_MAX) {
      checkRunInterruption(context.control, 'before_text_delta');
      sequence += 1;
      observer({
        type: 'agent_text_delta',
        ...identity,
        chunk_sequence: sequence,
        text_delta: points.slice(start, start + DELTA_MAX).join(''),
      });
    }
  };
  try {
    for await (const event of provider.stream(request)) {
      received = true;
      if (context.progress) context.progress.received = true;
      if (event.usage) usage = event.usage;
      checkRunInterruption(context.control, 'before_text_stream_event');
      if (event.kind === 'text_delta') publish(visible.feed(event.text ?? ''));
      else if (event.kind === 'completed') response = event.response ?? null;
    }
    if (response === null || !FINISHED.has(response.finishReason))
      throw new ProviderError(
        {
          category: 'response',
          safeMessage: 'Model text stream did not complete safely.',
          providerCode: 'incomplete_text_stream',
        },
        usage,
      );
    if (response.finishReason !== 'length' && response.finishReason !== 'content_filter')
      publish(visible.finish());
    const final = new VisibleTextFilter(context.secrets);
    const content = pythonStrip(final.feed(response.content) + final.finish());
    return { ...response, content };
  } catch (error) {
    // provider 已经产出过东西时，unsupported 不再是可安全重放的信号。
    if (received && error instanceof ProviderError && error.details.category === 'unsupported')
      throw new ProviderError({ ...error.details, category: 'response' }, error.usage ?? usage);
    if (usage !== null && typeof error === 'object' && error !== null) {
      const carrier = error as { usage?: unknown };
      if (carrier.usage === null || carrier.usage === undefined) carrier.usage = usage;
    }
    throw error;
  }
}
