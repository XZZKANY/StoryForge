import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-polish.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import {
  PolishLlmNotConfiguredError,
  polishSummary,
  resolvePolishLlm,
  type ControlledPolishResult,
} from './tools/polishService';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('chapter.polish replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(13);
    expect(golden.scenarios).toHaveLength(22);
  });

  it.each((golden.scenarios as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, scenario) => {
      const { record, error } = await replay(scenario);
      if (scenario.error) {
        expect(error).toBeInstanceOf(AgentRuntimeUserMessageError);
        expect((error as Error).message).toBe(scenario.error.message);
      } else {
        if (error) throw error;
        expectSame(record.result, scenario.result, 'result');
      }
      if ('controls' in scenario) expectSame(record.controls, scenario.controls, 'controls');
      for (const key of REPLAY_KEYS) expectSame(record[key], scenario[key], key);
    },
  );
});

// 借用主模型只在作者显式要求时发生（循环里模型给不了这个参数，固定管线才会传）。
describe('polish model resolution', () => {
  const identity = (prefix: string) => ({
    STORYFORGE_LLM_PROVIDER: 'OpenAI',
    STORYFORGE_LLM_BASE_URL: `https://${prefix}.example/v1`,
    STORYFORGE_LLM_MODEL: `${prefix}-1`,
    STORYFORGE_LLM_API_KEY: 'k',
  });
  const models = (dedicated: Record<string, string>) => ({
    main: identity('main'),
    dedicated,
    provider: () => {
      throw new Error('unused');
    },
  });

  it('borrows the main model only when asked', () => {
    expect(resolvePolishLlm(models({}), true)).toMatchObject({
      resolutionSource: 'explicit_main_model_override',
      provider: 'openai',
      model: 'main-1',
      slot: 'main',
    });
    expect(resolvePolishLlm(models(identity('polish')), false)).toMatchObject({
      resolutionSource: 'dedicated',
      provider: 'openai',
      model: 'polish-1',
      slot: 'polish',
    });
  });

  it('reports a missing dedicated slot without naming its keys', () => {
    expect(() => resolvePolishLlm(models({ STORYFORGE_LLM_MODEL: 'p' }), false)).toThrow(
      new PolishLlmNotConfiguredError(
        '尚未配置专用润色模型；请先在设置中配置，或明确选择本次使用主模型。',
      ),
    );
    expect(() =>
      resolvePolishLlm({ ...models({}), main: { STORYFORGE_LLM_MODEL: 'm' } }, true),
    ).toThrow(
      '主模型配置不完整：缺少 STORYFORGE_LLM_PROVIDER, STORYFORGE_LLM_BASE_URL, STORYFORGE_LLM_API_KEY。',
    );
  });
});

describe('润色没改动时说清在线模型有没有调通', () => {
  const noop = (onlineFailure: string | null): ControlledPolishResult => ({
    decision: {
      status: 'noop',
      selected_source: 'original',
      text: '原文',
      degraded: false,
      evaluations: {},
      rule_version: 'test',
    } as never,
    provider: null,
    model: null,
    resolutionSource: null,
    onlineFailure,
    onlineAttempted: onlineFailure !== null,
    usage: {},
    editPolicySummary: {},
  });

  it.each([
    ['provider_failed', '润色模型这次调用失败'],
    ['invalid_model_response', '润色模型返回的结果格式不对'],
    ['polish_model_not_configured', '专用润色模型尚未配置'],
  ])('在线失败（%s）时不说成「候选一致」', (failure, text) => {
    const summary = polishSummary(noop(failure));
    expect(summary).toContain(text);
    expect(summary).toContain('原文保持不变');
    expect(summary).not.toContain('候选与原文一致');
  });

  it('在线候选本身与原文一致时照旧说明', () => {
    expect(polishSummary(noop(null))).toBe('润色候选与原文一致，没有生成空补丁。');
  });
});
