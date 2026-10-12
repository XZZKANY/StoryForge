import { describe, it } from 'vitest';
import golden from '../../golden/p2-llm-native.json';
import { replay, type Scenario } from './recorded.test-support';

const scenarios = golden.scenarios as unknown as Scenario[];

describe('real Python native providers replay (Anthropic Messages / Gemini generateContent)', () => {
  for (const scenario of scenarios)
    it(`${scenario.kind} ${scenario.name}`, () => replay(golden, scenario));
});

describe('native SSE bodies arrive in arbitrary byte chunks', () => {
  for (const scenario of scenarios.filter(
    (item) =>
      ['call_llm_streamed', 'native_stream'].includes(item.kind) &&
      item.replies.every((reply) => reply.fail_after_lines === undefined),
  ))
    for (const size of [1, 5])
      it(`${scenario.name} / ${size}-byte chunks`, () => replay(golden, scenario, size));
});
