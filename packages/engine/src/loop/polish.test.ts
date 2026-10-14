import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-polish.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';
import { PolishLlmNotConfiguredError, resolvePolishLlm } from './tools/polishService';

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
