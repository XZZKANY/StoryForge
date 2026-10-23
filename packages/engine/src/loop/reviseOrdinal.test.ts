import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-patch-tools.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改

const { replay } = agentRunReplay(golden);
const scenario = (id: string, userMessage: string) => {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  spec.message.user_message = userMessage;
  return { ...base, spec_json: JSON.stringify(spec) };
};
const reviseTraces = (record: Obj) =>
  (record.events as Obj[])
    .filter((event) => event.event_type === 'tool_trace')
    .map((event) => event.payload.trace)
    .filter((trace) => trace.tool_name === 'file.revise');

describe('作者话里的「第 N 条」不一定指审稿问题', () => {
  it('会话里没有审稿报告时，只说「第2条」照作者原话改写，不卡在「请先审稿」', async () => {
    const { record, error } = await replay(
      scenario('revise-ask', '只改第2条：把开门那句写得更有力，其余不动'),
    );
    if (error) throw error;
    const traces = reviseTraces(record);
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('completed');
    expect((record.result as Obj).proposed_patch).toBeTruthy();
  });

  it('明说按审稿意见改第几条时，没有审稿报告仍然拒绝', async () => {
    const { record } = await replay(
      scenario('revise-directed-without-review', '按审稿意见改第2条'),
    );
    const traces = reviseTraces(record);
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('failed');
    expect(JSON.stringify(traces[0])).toContain('当前会话没有已绑定的审稿报告');
  });
});
