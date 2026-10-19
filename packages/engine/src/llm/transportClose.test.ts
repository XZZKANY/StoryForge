import { describe, expect, it } from 'vitest';
import { RunControl, RunInterrupted } from './control';
import { rawStreamChatCompletions, requestChatCompletions, type LlmContext } from './transport';

const source = {
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: '<key>',
  STORYFORGE_LLM_MODEL: 'm-1',
};

function setup(cancelOnReply: boolean) {
  let replied = false;
  let closes = 0;
  const control = new RunControl({
    checkInterruption: () => (cancelOnReply && replied ? 'stopped' : null),
    clock: () => 0,
    wait: async () => {},
  });
  const ctx: LlmContext = {
    http: {
      send: async () => {
        replied = true;
        return {
          status: 429,
          headers: {},
          body: (async function* () {
            yield new TextEncoder().encode('rate limited');
          })(),
          close() {
            closes += 1;
          },
        };
      },
    },
    clock: () => 0,
    wait: async () => {},
    random: () => 0,
    appVersion: 'test',
    secrets: { values: [] },
    control,
  };
  return { ctx, closes: () => closes };
}

describe('an error reply that arrives while the run is being stopped', () => {
  const runs: [string, (ctx: LlmContext) => Promise<unknown>][] = [
    ['json', (ctx) => requestChatCompletions(source, { messages: [] }, { maxAttempts: 1 }, ctx)],
    [
      'stream',
      async (ctx) => {
        for await (const _ of rawStreamChatCompletions(
          source,
          { messages: [] },
          { maxAttempts: 1 },
          ctx,
        ));
      },
    ],
  ];

  it.each(runs)('%s: is still released once', async (_, run) => {
    const stopped = setup(true);
    await expect(run(stopped.ctx)).rejects.toBeInstanceOf(RunInterrupted);
    expect(stopped.closes()).toBe(1);
    const normal = setup(false);
    await expect(run(normal.ctx)).rejects.toThrow('HTTP 429');
    expect(normal.closes()).toBe(1);
  });
});
