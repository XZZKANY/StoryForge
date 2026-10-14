import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-deep-consistency.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('project.deep_consistency replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(10);
    expect(golden.scenarios).toHaveLength(28);
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
