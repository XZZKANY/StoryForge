import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-agent-run.windows.json';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS as KEYS } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);
// 每个场景在内存与 sqlite 两种存储上各跑一遍，异步存储每次写都要让出若干拍。
const YIELDING_TIMEOUT_MS = 30_000;

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

  it('单轮回退失败时作者看到归类说明，响应体只进证据（#505）', async () => {
    const MARK = 'MARK-505-upstream-text';
    const scenario = (golden.scenarios as Obj[]).find((item) => item.id === 'fallback-llm-error')!;
    const spec = JSON.parse(scenario.spec_json);
    expect(spec.replies).toHaveLength(1);
    spec.replies[0].body = JSON.stringify({ error: { message: `${MARK} key=${golden.secret}` } });
    const { record, error } = await replay({ ...scenario, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    const answer = '这轮没答上来：模型调用失败：模型服务端出错（HTTP 500），可以稍后重试。';
    expect(record.result.agent_result.summary).toBe(answer);
    const calls = record.tool_calls as Obj[];
    expect(calls.map((row) => row.tool_name)).toEqual(['assistant.chat']);
    expect(calls[0].error_message).toContain(MARK);
    expect(calls[0].error_message).not.toContain(golden.secret);
    const authorFacing = JSON.stringify([record.result, record.frames, record.messages]);
    expect(authorFacing).not.toContain(MARK);
    expect(authorFacing).toContain(answer);
  });

  // 传输进度是同步回调、落库是异步：排队保证进度事件仍排在随后的计划 / 轨迹 / 结算之前。
  it.each([
    'read-then-answer',
    'tools-in-two-rounds',
    'long-history-compaction',
    'stop-after-compaction',
    'loop-provider-error',
  ])(
    'keeps event and frame order on an asynchronous store: %s',
    async (id) => {
      const scenario = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
      const { record, error } = await replay(scenario, { yielding: true });
      if (error) throw error;
      for (const key of ['frames', 'events', 'artifacts', 'tool_calls'])
        expectSame(record[key], scenario[key], key);
    },
    YIELDING_TIMEOUT_MS,
  );
});
