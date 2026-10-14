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
