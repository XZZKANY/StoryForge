import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-agent-run.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS as KEYS } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('agent run replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(6);
    expect(golden.scenarios).toHaveLength(25);
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
      for (const key of KEYS) expectSame(record[key], scenario[key], key);
    },
  );

  // 传输进度是同步回调、落库是异步：排队保证进度事件仍排在随后的计划 / 轨迹 / 结算之前。
  it.each([
    'read-then-answer',
    'tools-in-two-rounds',
    'long-history-compaction',
    'stop-after-compaction',
    'loop-provider-error',
  ])('keeps event and frame order on an asynchronous store: %s', async (id) => {
    const scenario = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
    const { record, error } = await replay(scenario, { yielding: true });
    if (error) throw error;
    for (const key of ['frames', 'events', 'artifacts', 'tool_calls'])
      expectSame(record[key], scenario[key], key);
  });
});
