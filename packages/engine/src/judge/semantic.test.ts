import { describe, expect, it } from 'vitest';
import type { LlmSource } from '../llm/config';
import { JUDGE_FEW_SHOT, JUDGE_SYSTEM_PROMPT } from './prompts';
import { semanticJudgeWithStatus } from './semantic';

describe('semantic judge prompt examples', () => {
  it('every example the model is told to imitate is valid JSON', () => {
    const fenced = /```json\n([\s\S]*?)\n```/.exec(JUDGE_SYSTEM_PROMPT)?.[1];
    const shots = JUDGE_FEW_SHOT.split('\n')
      .filter((line) => line.startsWith('输出：'))
      .map((line) => line.slice('输出：'.length));
    expect(fenced).toBeDefined();
    expect(shots.length).toBeGreaterThan(0);
    for (const example of [fenced!, ...shots]) expect(() => JSON.parse(example)).not.toThrow();
  });
});

describe('semantic judge routing', () => {
  const judge = async (source: LlmSource) => {
    const seen: LlmSource[] = [];
    await semanticJudgeWithStatus(
      { content: '正文。', required_facts: [], style_rules: [], evidence_links: [] },
      {
        source,
        call: async (requestSource) => {
          seen.push(requestSource);
          return { content: '[]' };
        },
      },
    );
    return seen[0];
  };
  const main = (provider: string): LlmSource => ({
    STORYFORGE_LLM_PROVIDER: provider,
    STORYFORGE_LLM_API_KEY: '<key>',
    STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
    STORYFORGE_LLM_MODEL: 'm-1',
  });

  it.each(['anthropic', 'gemini'])(
    'a native %s main model keeps its own protocol and auth',
    async (provider) => {
      const sent = await judge(main(provider));
      expect(sent.STORYFORGE_LLM_PROVIDER).toBe(provider);
      expect(sent.STORYFORGE_LLM_AUTH_HEADER).toBeUndefined();
    },
  );

  it('an OpenAI-style main model and a separate judge endpoint both use the OpenAI wire format', async () => {
    for (const source of [
      main('openai'),
      { ...main('anthropic'), STORYFORGE_JUDGE_LLM_BASE_URL: 'https://judge.example/v1' },
    ]) {
      const sent = await judge(source);
      expect(sent.STORYFORGE_LLM_PROVIDER).toBe('openai-compatible');
      expect(sent.STORYFORGE_LLM_AUTH_HEADER).toBe('bearer');
    }
  });

  it('评审不吃作者给产字选的思考等级，只认评审自己的覆盖', async () => {
    const authored = { ...main('anthropic'), STORYFORGE_LLM_REASONING_EFFORT: 'high' };
    expect((await judge(authored)).STORYFORGE_LLM_REASONING_EFFORT).toBe('');
    const overridden = { ...authored, STORYFORGE_JUDGE_LLM_REASONING_EFFORT: 'low' };
    expect((await judge(overridden)).STORYFORGE_LLM_REASONING_EFFORT).toBe('low');
  });
});
