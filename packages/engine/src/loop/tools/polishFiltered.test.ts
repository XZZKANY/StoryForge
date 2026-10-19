import { describe, expect, it } from 'vitest';
import { ConfiguredLlmProvider } from '../../llm/client';
import type { LlmContext } from '../../llm/transport';
import { runControlledPolish } from './polishService';

const ORIGINAL = '夜雨打湿了青石路。小舟停在桥边，灯火映着水面。';
const REWRITTEN = '细雨打湿了青石路。小舟停在桥边，灯火映着水面。';
const source = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_MODEL: 'm-1',
  STORYFORGE_LLM_API_KEY: '<key>',
};

async function polishWith(finishReason: string) {
  const ctx: LlmContext = {
    clock: () => 0,
    wait: async () => {},
    random: () => 0,
    appVersion: 'test',
    secrets: { values: [] },
    http: {
      async send() {
        const reply = {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ segments: [{ index: 0, text: REWRITTEN }] }),
              },
              finish_reason: finishReason,
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        };
        return {
          status: 200,
          headers: {},
          close() {},
          body: (async function* () {
            yield new TextEncoder().encode(JSON.stringify(reply));
          })(),
        };
      },
    },
  };
  return await runControlledPolish(ORIGINAL, {
    models: {
      main: source,
      dedicated: source,
      provider: (_slot, config) => new ConfiguredLlmProvider(config, ctx),
    },
  });
}

describe('online polish that the provider refused', () => {
  it('is not used even when the JSON came back whole', async () => {
    const filtered = await polishWith('content_filter');
    expect(filtered.decision.selected_source).not.toBe('online');
    expect(filtered.decision.evaluations.online.reasons).toContain('response_filtered');
    const normal = await polishWith('stop');
    expect(normal.decision).toMatchObject({ status: 'accepted', selected_source: 'online' });
  });
});
