import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../kernel/json';
import { AnthropicProvider } from './anthropic';
import { ConfiguredLlmProvider } from './client';
import type { LlmSource } from './config';
import { ChatMessage, type ChatRequest } from './contracts';
import { GeminiProvider } from './gemini';
import { OpenAICompatibleProvider } from './openaiCompatible';
import type { HttpPort, LlmContext } from './transport';

const request = (
  model: string,
  reasoningEffort: string | null,
  extra: Partial<ChatRequest> = {},
): ChatRequest => ({
  model,
  messages: [new ChatMessage('system', '系统'), new ChatMessage('user', '写一段')],
  tools: [],
  temperature: 0.7,
  maxTokens: 2048,
  toolChoice: null,
  reasoningEffort,
  ...extra,
});

const anthropic = (req: ChatRequest) =>
  new AnthropicProvider({
    completeTransport: async () => ({ data: {}, startedAt: 0 }),
    clock: () => 0,
  }).buildPayload(req) as { [key: string]: unknown };

const gemini = (req: ChatRequest) =>
  (
    new GeminiProvider({
      completeTransport: async () => ({ data: {}, startedAt: 0 }),
      clock: () => 0,
    }).buildPayload(req) as { generationConfig?: { [key: string]: unknown } }
  ).generationConfig ?? {};

describe('Anthropic 思考参数按官方现行写法', () => {
  it.each([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-test',
  ])('%s：adaptive + output_config.effort，开思考不带 temperature', (model) => {
    const payload = anthropic(request(model, 'high'));
    expect(payload.thinking).toEqual({ type: 'adaptive' });
    expect(payload.output_config).toEqual({ effort: 'high' });
    expect(payload).not.toHaveProperty('temperature');
    expect(payload.max_tokens).toBe(2048);
  });

  it.each([
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5',
    'claude-opus-4-1-20250805',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-5@20250929',
  ])('%s（4.6 以前）：沿用 budget_tokens，不发 output_config 与 temperature', (model) => {
    const payload = anthropic(request(model, 'low', { maxTokens: 16000 }));
    expect(payload.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(payload).not.toHaveProperty('output_config');
    expect(payload).not.toHaveProperty('temperature');
    expect(payload.max_tokens).toBe(16000);
  });

  it('老模型 max_tokens 装不下预算时抬到 预算 + 原上限，而不是报错', () => {
    expect(anthropic(request('claude-sonnet-4-5', 'high')).max_tokens).toBe(8192 + 2048);
    expect(anthropic(request('claude-sonnet-4-5', 'medium', { maxTokens: 4096 })).max_tokens).toBe(
      4096 + 4096,
    );
    expect(anthropic(request('claude-sonnet-4-5', 'medium', { maxTokens: 4097 })).max_tokens).toBe(
      4097,
    );
  });

  it('关：不带任何思考参数，temperature 照常', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-4-5']) {
      const payload = anthropic(request(model, null));
      expect(payload).not.toHaveProperty('thinking');
      expect(payload).not.toHaveProperty('output_config');
      expect(payload.temperature).toBe(0.7);
    }
  });

  it('不认识的等级照旧拒绝', () => {
    expect(() => anthropic(request('claude-opus-5-5', 'max'))).toThrow(/low, medium, or high/);
  });
});

describe('Gemini 思考参数按模型代际二选一', () => {
  it.each([
    ['gemini-3-pro-preview', 'low', 'LOW'],
    ['gemini-3-flash-preview', 'medium', 'MEDIUM'],
    ['gemini-3.1-pro-preview', 'high', 'HIGH'],
  ])('%s：thinkingLevel，绝不同时带 thinkingBudget', (model, effort, level) => {
    expect(gemini(request(model, effort)).thinkingConfig).toEqual({ thinkingLevel: level });
  });

  it.each([
    ['gemini-2.5-flash', 'medium', 4096],
    ['gemini-2.5-pro', 'high', 8192],
    ['gemini-2.0-flash-thinking-exp', 'low', 1024],
    ['gemini-1.5-pro', 'low', 1024],
  ])('%s：沿用 thinkingBudget，绝不同时带 thinkingLevel', (model, effort, budget) => {
    expect(gemini(request(model, effort)).thinkingConfig).toEqual({ thinkingBudget: budget });
  });

  it('关：不带 thinkingConfig', () => {
    for (const model of ['gemini-3-pro-preview', 'gemini-2.5-flash'])
      expect(gemini(request(model, null))).not.toHaveProperty('thinkingConfig');
  });
});

describe('OpenAI 兼容：reasoning_effort 原样，关就不带', () => {
  it('low / 关', () => {
    expect(OpenAICompatibleProvider.buildPayload(request('m', 'low')).reasoning_effort).toBe('low');
    expect(OpenAICompatibleProvider.buildPayload(request('m', null))).not.toHaveProperty(
      'reasoning_effort',
    );
  });
});

describe('ConfiguredLlmProvider：未指定吃配置源，显式关压过配置源', () => {
  const SOURCE: LlmSource = {
    STORYFORGE_LLM_PROVIDER: 'openai-compatible',
    STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
    STORYFORGE_LLM_MODEL: 'm-1',
    STORYFORGE_LLM_API_KEY: '<key>',
    STORYFORGE_LLM_REASONING_EFFORT: 'high',
  };
  const sentBody = async (req: ChatRequest) => {
    const bodies: JsonObject[] = [];
    const http: HttpPort = {
      async send(outgoing) {
        bodies.push(JSON.parse(new TextDecoder().decode(outgoing.body!)) as JsonObject);
        const reply = JSON.stringify({
          choices: [{ message: { content: '好' }, finish_reason: 'stop' }],
        });
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: (async function* () {
            yield new TextEncoder().encode(reply);
          })(),
          close() {},
        };
      },
    };
    const ctx: LlmContext = {
      http,
      clock: () => 0,
      wait: async () => {},
      random: () => 0,
      appVersion: '0.0.0',
      secrets: { values: [] },
    };
    await new ConfiguredLlmProvider(SOURCE, ctx).complete(req);
    return bodies[0];
  };

  it('未指定：带上配置源的等级', async () => {
    expect((await sentBody(request('', null))).reasoning_effort).toBe('high');
  });

  it('显式关：请求体里没有 reasoning_effort', async () => {
    expect(await sentBody(request('', null, { reasoningOff: true }))).not.toHaveProperty(
      'reasoning_effort',
    );
  });
});
