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
