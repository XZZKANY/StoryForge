import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-patch-tools.windows.json';
import { llmReviewReasoner } from '../kernel/reviewReasoning';
import { RunInterrupted } from '../llm/control';
import { RequestEvidenceError } from './requestEvidence';
import { AgentRuntimeUserMessageError } from './agentRuntime';
import { agentRunReplay, REPLAY_KEYS } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const { replay, expectSame } = agentRunReplay(golden);

describe('loop patch tools replay the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(14);
    expect(golden.scenarios).toHaveLength(47);
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

describe('显式修订失败时作者看到归类说明，响应体只进证据（#505）', () => {
  it('file.revise 的轨迹与反馈不带服务端响应体', async () => {
    const MARK = 'MARK-505-upstream-text';
    const scenario = (golden.scenarios as Obj[]).find((item) => item.id === 'revise-llm-error')!;
    const spec = JSON.parse(scenario.spec_json);
    const failing = spec.replies.filter((reply: Obj) => reply.status === 500);
    expect(failing).toHaveLength(1);
    failing[0].body = JSON.stringify({ error: { message: `${MARK} key=${golden.secret}` } });
    const { record, error } = await replay({ ...scenario, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    const classified = '模型调用失败：模型服务端出错（HTTP 500），可以稍后重试。';
    expect(record.result.tool_trace[0].error_message).toBe(classified);
    const calls = record.tool_calls as Obj[];
    const revise = calls.filter((row) => row.tool_name === 'assistant.revise');
    expect(revise).toHaveLength(1);
    expect(revise[0].error_message).toContain(MARK);
    expect(revise[0].error_message).not.toContain(golden.secret);
    const authorFacing = JSON.stringify([
      record.result,
      record.frames,
      calls.filter((row) => row.tool_name !== 'assistant.revise'),
    ]);
    expect(authorFacing).not.toContain(MARK);
    expect(authorFacing).toContain(classified);
  });
});

// Python 的审稿推理只在 LLMError / ValueError（含 JSON 解析错误）/ TypeError / KeyError 时降级为启发式；
// 运行中断与证据落库失败必须照常抛出。
describe('review reasoner degrades only on model and output failures', () => {
  const review = (callLlm: Parameters<typeof llmReviewReasoner>[0]['callLlm']) =>
    llmReviewReasoner({ callLlm, model: 'm-1' }).reviewAll({
      content: '林舟推开门。',
      paragraphs: ['林舟推开门。'],
      contextBundle: null,
    });

  it('degrades a role whose reply is not JSON', async () => {
    const results = await review(async () => ({ content: '这不是 JSON' }));
    expect(results.map((item) => item.mode)).toEqual(['heuristic', 'heuristic', 'heuristic']);
    expect(results[0].degraded_reason).toMatch(/^LLM 子代理降级：/);
  });

  it('propagates a run interruption raised during a role request', async () => {
    await expect(
      review(async () => {
        throw new RunInterrupted('stopped');
      }),
    ).rejects.toBeInstanceOf(RunInterrupted);
  });

  it('propagates a request evidence failure', async () => {
    await expect(
      review(async () => {
        throw new RequestEvidenceError('证据未能落库');
      }),
    ).rejects.toBeInstanceOf(RequestEvidenceError);
  });
});
