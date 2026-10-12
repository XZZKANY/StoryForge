import { describe, expect, it } from 'vitest';
import golden from '../../golden/p2-llm-client.json';
import { retainErrorUsage, TokenUsage } from './contracts';
import { replay, type Scenario } from './recorded.test-support';

const scenarios = golden.scenarios as unknown as Scenario[];

describe('real Python LLM client replay (recorded transport, virtual clock)', () => {
  for (const scenario of scenarios)
    it(`${scenario.kind} ${scenario.name}`, () => replay(golden, scenario));
});

describe('stream bodies arrive in arbitrary byte chunks', () => {
  for (const scenario of scenarios.filter(
    (item) =>
      ['call_llm_streamed', 'provider_stream'].includes(item.kind) &&
      item.replies.every((reply) => reply.fail_after_lines === undefined),
  ))
    for (const size of [1, 3, 7])
      it(`${scenario.name} / ${size}-byte chunks`, () => replay(golden, scenario, size));
});

type UsageFields = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  source?: string;
};
const usageOf = (fields: UsageFields) =>
  new TokenUsage(
    fields.input_tokens,
    fields.output_tokens,
    fields.total_tokens,
    null,
    null,
    fields.source,
  );

describe('retain_error_usage: fill only when the error has no known usage, never sum', () => {
  for (const item of golden.retain as {
    existing: UsageFields | null;
    new: UsageFields | null;
    result: unknown;
  }[])
    it(JSON.stringify([item.existing, item.new]), () => {
      const error: { usage?: unknown } = {};
      if (item.existing) error.usage = usageOf(item.existing);
      retainErrorUsage(error, item.new ? usageOf(item.new) : null);
      expect(error.usage instanceof TokenUsage ? error.usage.toLegacy() : null).toEqual(
        item.result,
      );
    });
});
