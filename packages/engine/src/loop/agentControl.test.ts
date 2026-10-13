import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-agent-control.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('agent control channel replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(11);
    expect(golden.scenarios).toHaveLength(27);
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
      expectSame(record.controls, scenario.controls, 'controls');
      for (const key of REPLAY_KEYS) expectSame(record[key], scenario[key], key);
    },
  );

  // 续跑也要在真异步存储上保持事件顺序（认领 → 执行开始 → 轨迹 → 结算）。请求进行中发出的控制
  // 与传输进度是两条连接的并发写，先后本就不定，这里只挑控制在 run 停下之后才发的场景。
  it.each([
    'pause-after-tool-then-resume',
    'pause-after-tool-edit-read-file-then-resume',
    'resume-tool-outcome-unknown',
    'approve-with-outcome',
    'pause-permission-wait-then-resume',
  ])('keeps the control outcome on an asynchronous store: %s', async (id) => {
    const scenario = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
    const { record, error } = await replay(scenario, { yielding: true });
    if (error) throw error;
    for (const key of ['controls', 'runs', 'events', 'artifacts'])
      expectSame(record[key], scenario[key], key);
  });

  // 两条控制连接同时恢复同一个暂停的 run：都读到已结算的 paused，只有赢得比较交换的一条认领并续跑。
  it('two concurrent resumes claim once and run the resumed execution once', async () => {
    const scenario = (golden.scenarios as Obj[]).find(
      (item) => item.id === 'pause-resume-then-resume-again',
    )!;
    const { record, error } = await replay(scenario, { yielding: true, parallelControls: true });
    if (error) throw error;
    const resumes = (record.controls as Obj[]).slice(1);
    expect(resumes.map((item) => item.event.payload.control_effect).sort()).toEqual([
      'applied',
      'ignored',
    ]);
    expect(resumes.filter((item) => item.resumed_result !== null)).toHaveLength(1);
    const types = (record.events as Obj[]).map((event) => event.event_type);
    expect(types.filter((type) => type === 'agent_execution_claimed')).toHaveLength(1);
    expect(types.filter((type) => type === 'agent_execution_started')).toHaveLength(2);
    expect([record.runs[0].status, record.runs[0].current_step]).toEqual([
      'completed',
      'completed',
    ]);
    expectSame(record.requests, scenario.requests, 'requests');
  });
});
