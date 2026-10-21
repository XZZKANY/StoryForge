import { describe, expect, it } from 'vitest';
import { chatResponse, ProviderError, TokenUsage, type StreamEvent } from '../llm/contracts';
import { RunControl, RunInterrupted } from '../llm/control';
import { LlmError } from '../llm/payload';
import type { StoryForgeCheckpointStore } from './chatLoopCheckpoints';
import type { StoryForgeRuntimeContext } from './chatLoopContext';
import { STREAM_RETRY_LIMIT, StoryForgeProviderAdapter } from './chatLoopAdapters';
import type { TextFrame } from './textStream';

const REQUEST = {
  model: 'm',
  messages: [],
  tools: [],
  temperature: null,
  maxTokens: null,
  toolChoice: null,
  reasoningEffort: null,
};

type Attempt = 'midway' | 'before' | 'interrupt' | 'ok';

/** 每次 stream() 按脚本走一次：midway = 吐一段后断开，before = 一个事件都没吐就失败。 */
function scriptedProvider(script: Attempt[]) {
  let calls = 0;
  return {
    streaming: true,
    get calls() {
      return calls;
    },
    complete: async () => {
      throw new Error('unused');
    },
    async *stream(): AsyncGenerator<StreamEvent> {
      const step = script[calls++];
      if (step === 'before') throw new LlmError('真实 LLM 流式建连失败');
      yield { kind: 'text_delta', text: `第${calls}次的半截` };
      if (step === 'midway')
        throw new LlmError('真实 LLM 流式读取中断（已输出 5 字）：TimeoutError');
      if (step === 'interrupt') throw new RunInterrupted('stopped');
      const response = chatResponse({
        content: `第${calls}次的完整回答`,
        toolCalls: [],
        usage: new TokenUsage(),
        finishReason: 'stop',
        responseId: null,
        metadata: {},
      });
      yield {
        kind: 'completed',
        response,
        usage: response.usage,
        finishReason: 'stop',
        metadata: {},
      };
    },
  };
}

function harness(script: Attempt[]) {
  const frames: TextFrame[] = [];
  let now = 0;
  let streamId = 0;
  const control = new RunControl({
    checkInterruption: () => null,
    clock: () => now,
    wait: async (seconds) => {
      now += seconds;
    },
  });
  const context = {
    providerAttempts: 0,
    streamRetries: 0,
    completedModelRounds: 0,
    modelOutcomeUnknown: false,
    pendingCosts: [],
    source: {},
    secrets: { values: [] },
    run: { public_id: 'run-1' },
    onText: (frame: TextFrame) => frames.push(frame),
    callControl: control,
    newStreamId: () => `stream-${++streamId}`,
    rememberResponse(response: ReturnType<typeof chatResponse>) {
      this.completedModelRounds += 1;
      return response;
    },
  };
  const checkpoints = { modelStarted: async () => {} };
  const provider = scriptedProvider(script);
  const adapter = new StoryForgeProviderAdapter(
    provider,
    context as unknown as StoryForgeRuntimeContext,
    checkpoints as unknown as StoryForgeCheckpointStore,
  );
  return { adapter, provider, context, frames };
}

const starts = (frames: TextFrame[]) =>
  frames.filter((frame) => frame.type === 'agent_text_stream_started');

describe('输出途中断开自动重发', () => {
  it('吐到一半断了整轮重发，重发的流带上第几次重试，轮次不多算', async () => {
    const { adapter, provider, context, frames } = harness(['midway', 'ok']);
    const response = await adapter.complete(REQUEST);
    expect(response.content).toBe('第2次的完整回答');
    expect(provider.calls).toBe(2);
    expect(context.providerAttempts).toBe(1);
    expect(context.streamRetries).toBe(1);
    expect(starts(frames).map((frame) => frame.retry_attempt)).toEqual([0, 1]);
    expect(starts(frames).map((frame) => frame.round_index)).toEqual([1, 1]);
  });

  it(`最多重发 ${STREAM_RETRY_LIMIT} 次，仍断就把错误交上去`, async () => {
    const { adapter, provider, context } = harness(['midway', 'midway', 'midway', 'ok']);
    await expect(adapter.complete(REQUEST)).rejects.toBeInstanceOf(LlmError);
    expect(provider.calls).toBe(STREAM_RETRY_LIMIT + 1);
    expect(context.streamRetries).toBe(STREAM_RETRY_LIMIT);
  });

  it('一个事件都没吐就失败不重发（建连阶段传输层已经重试过）', async () => {
    const { adapter, provider } = harness(['before', 'ok']);
    await expect(adapter.complete(REQUEST)).rejects.toBeInstanceOf(LlmError);
    expect(provider.calls).toBe(1);
  });

  it('作者停下（RunInterrupted）不重发', async () => {
    const { adapter, provider } = harness(['interrupt', 'ok']);
    await expect(adapter.complete(REQUEST)).rejects.toBeInstanceOf(RunInterrupted);
    expect(provider.calls).toBe(1);
  });

  it('配置 / 鉴权类 provider 错误不重发，连接类才重发', async () => {
    const auth = new ProviderError({ category: 'authentication', safeMessage: 'no' });
    const reset = new ProviderError({ category: 'connection', safeMessage: 'reset' });
    for (const [error, calls] of [
      [auth, 1],
      [reset, 2],
    ] as const) {
      let count = 0;
      const provider = {
        streaming: true,
        complete: async () => {
          throw new Error('unused');
        },
        async *stream(): AsyncGenerator<StreamEvent> {
          count += 1;
          yield { kind: 'text_delta', text: '半截' };
          if (count === 1) throw error;
          const response = chatResponse({
            content: '完整',
            toolCalls: [],
            usage: new TokenUsage(),
            finishReason: 'stop',
            responseId: null,
            metadata: {},
          });
          yield {
            kind: 'completed',
            response,
            usage: response.usage,
            finishReason: 'stop',
            metadata: {},
          };
        },
      };
      const { context } = harness([]);
      const adapter = new StoryForgeProviderAdapter(
        provider,
        context as unknown as StoryForgeRuntimeContext,
        { modelStarted: async () => {} } as unknown as StoryForgeCheckpointStore,
      );
      if (calls === 1) await expect(adapter.complete(REQUEST)).rejects.toBe(error);
      else await expect(adapter.complete(REQUEST)).resolves.toMatchObject({ content: '完整' });
      expect(count).toBe(calls);
    }
  });
});
