import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-agent-run.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改

const { replay } = agentRunReplay(golden);
const COMPACTION_PROMPT = '你只生成对话检查点';
const reply = (content: string) => ({
  status: 200,
  body: JSON.stringify({
    id: 'resp-1',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  }),
});

/** 收尾压缩一直没成、历史已超预算的会话：20 条各约 8 KB 的往来消息。 */
function overBudgetScenario(replies: Obj[]) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === 'stop-after-compaction')!;
  const spec = JSON.parse(base.spec_json);
  spec.history = Array.from({ length: 20 }, (_, i) => [
    i % 2 ? 'assistant' : 'user',
    `第${i}轮：${'周梨不能提前知道借阅者。'.repeat(220)}`,
  ]);
  spec.triggers = [];
  spec.replies = replies;
  return { ...base, spec_json: JSON.stringify(spec) };
}
const systemPrompt = (request: Obj) => String(request.body.messages[0].content);

describe('会话已超历史预算时先补压缩', () => {
  it('补压成功后同一轮照常进模型，并发布检查点', async () => {
    const { record, error } = await replay(
      overBudgetScenario([{ compaction_quote: true }, reply('好的。'), { compaction_quote: true }]),
    );
    if (error) throw error;
    const requests = record.requests as Obj[];
    expect(requests.map((request) => systemPrompt(request).startsWith(COMPACTION_PROMPT))).toEqual([
      true,
      false,
      true,
    ]);
    expect(record.unused_replies).toBe(0);
    expect((record.result as Obj).agent_result.summary).toBe('好的。');
    expect(
      (record.artifacts as Obj[]).filter((item) => item.kind === 'system_compaction'),
    ).toHaveLength(2);
  });

  it('默认时序：开头压缩没成就照原样报超预算，同一轮不再补压第二次', async () => {
    const { record, error } = await replay(
      overBudgetScenario([reply('不是 JSON'), { compaction_quote: true }]),
      { defaultCompaction: true },
    );
    const requests = record.requests as Obj[];
    expect(requests).toHaveLength(1);
    expect(systemPrompt(requests[0]).startsWith(COMPACTION_PROMPT)).toBe(true);
    const message = error ? (error as Error).message : JSON.stringify(record.result);
    expect(message).toContain('上下文超出保真预算');
  });

  it('补压没成就照原样报超预算，不调用对话模型', async () => {
    const { record, error } = await replay(overBudgetScenario([reply('不是 JSON')]));
    const requests = record.requests as Obj[];
    expect(requests).toHaveLength(1);
    expect(systemPrompt(requests[0]).startsWith(COMPACTION_PROMPT)).toBe(true);
    const message = error ? (error as Error).message : JSON.stringify(record.result);
    expect(message).toContain('上下文超出保真预算');
    expect((record.artifacts as Obj[]).some((item) => item.kind === 'system_compaction')).toBe(
      false,
    );
  });
});

/** 14 条往来消息的会话，每条约 units × 36 字节；由引擎默认门槛决定这一轮开头压不压。 */
async function runTurnIn(units: number, replies?: Obj[]) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === 'long-history-compaction')!;
  const spec = JSON.parse(base.spec_json);
  spec.history = Array.from({ length: 14 }, (_, i) => [
    i % 2 ? 'assistant' : 'user',
    `第${i}轮：${'周梨不能提前知道借阅者。'.repeat(units)}`,
  ]);
  if (replies) spec.replies = replies;
  const { record, error } = await replay(
    { ...base, spec_json: JSON.stringify(spec) },
    { defaultCompaction: true },
  );
  if (error) throw error;
  return {
    record,
    compactions: (record.requests as Obj[]).map((request) =>
      systemPrompt(request).startsWith(COMPACTION_PROMPT),
    ),
    jobs: (record.result as Obj).system_jobs as Obj,
    checkpoints: (record.artifacts as Obj[]).filter((item) => item.kind === 'system_compaction'),
  };
}

describe('会话快满时在这一轮开头压，收尾不压', () => {
  it('约 50 KB 的会话（作者 10-20 那段的大小）不压，标题和摘要照常', async () => {
    const { record, compactions, jobs } = await runTurnIn(100);
    expect(compactions).toEqual([false]);
    expect(record.unused_replies).toBe(1);
    expect((record.tool_calls as Obj[]).map((call) => call.tool_name)).toEqual([
      'assistant.chat_loop',
    ]);
    expect(Object.keys(jobs)).toEqual(['title', 'summary']);
  });

  it('约 100 KB、快到上限的会话在开头压一次，回答之后不再等压缩', async () => {
    const { record, compactions, jobs, checkpoints } = await runTurnIn(200, [
      { compaction_quote: true },
      reply('好的。'),
    ]);
    expect(compactions).toEqual([true, false]);
    expect(record.unused_replies).toBe(0);
    expect((record.result as Obj).agent_result.summary).toBe('好的。');
    expect(Object.keys(jobs)).toEqual(['title', 'summary']);
    expect(checkpoints).toHaveLength(1);
  });

  it('开头压缩没成：这一轮照常作答，也不补压第二次', async () => {
    const { record, compactions, checkpoints } = await runTurnIn(200, [
      reply('不是 JSON'),
      reply('好的。'),
    ]);
    expect(compactions).toEqual([true, false]);
    expect(record.unused_replies).toBe(0);
    expect((record.result as Obj).agent_result.summary).toBe('好的。');
    expect(checkpoints).toHaveLength(0);
  });
});
