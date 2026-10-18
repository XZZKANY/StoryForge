import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import patchGolden from '../../golden/p3-patch-tools.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const patchReplay = agentRunReplay(patchGolden).replay;
const DRIFT = 'Chapter Brief 的来源在确认期间已变化，请重新生成 Brief 后再确认。';
const HEADING = '[已写事实 · 勿违背]';
const LEDGER = JSON.stringify({
  version: 1,
  facts: [
    {
      id: 'fact_1',
      kind: '处境',
      subject: '沈禾',
      attribute: '下落',
      value: '在问路',
      object: null,
      path: '正文/第002章.md',
      status: 'active',
      evidence: [{ path: '正文/第002章.md', quote: '沈禾问路。' }],
    },
  ],
});

/** 拿写章 golden 的一个场景，改一改 spec 再回放（不和 golden 比，只看这里关心的行为）。 */
async function run(id: string, change: (spec: Obj) => void) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  change(spec);
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record;
}

const userPrompts = (record: Obj) =>
  (record.requests as Obj[]).map((request) => {
    const messages = request.body.messages as Obj[];
    return messages[messages.length - 1].content as string;
  });

describe('chapter writing and the fact ledger', () => {
  it('drafts and repairs with the written facts, checks without them', async () => {
    const record = await run('write-repair-then-pass', (spec) => {
      spec.extra_files = { '.storyforge/canon/facts.json': LEDGER };
    });
    const prompts = userPrompts(record);
    const carrying = prompts.filter((prompt) => prompt.includes(HEADING));
    expect(carrying).toHaveLength(2);
    expect(carrying[0]).toContain('请输出该文件的完整初稿正文');
    expect(carrying[1]).not.toContain('请输出该文件的完整初稿正文');
    for (const prompt of carrying)
      expect(prompt).toContain('- 沈禾 · 处境/下落：在问路（第2章「沈禾问路。」）');
    expect(
      prompts.filter((prompt) => prompt.includes('检查完整正文是否满足已确认 brief')),
    ).not.toHaveLength(0);
    expect(
      prompts.filter(
        (prompt) => prompt.includes('检查完整正文是否满足已确认 brief') && prompt.includes(HEADING),
      ),
    ).toEqual([]);
  });

  it('refuses to draft when facts.json changed while the brief waited', async () => {
    const record = await run('write-source-drift', (spec) => {
      expect(spec.ops[0]).toMatchObject({ op: 'edit', path: '.storyforge/agent-instructions.md' });
      spec.ops[0] = { op: 'edit', path: '.storyforge/canon/facts.json', content: LEDGER };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });

  it('is not tripped by an unrelated note', async () => {
    const record = await run('write-source-drift', (spec) => {
      spec.ops[0] = { op: 'edit', path: '笔记/杂记.md', content: '随手记一笔' };
    });
    expect(JSON.stringify(record.controls)).not.toContain(DRIFT);
  });

  it('whole-file revision from the conversation carries them too', async () => {
    const base = (patchGolden.scenarios as Obj[]).find((item) => item.id === 'revise-ask')!;
    // 原场景修第 1 章；改成修第 2 章，第 1 章就是它的上一章。
    const spec = JSON.parse(base.spec_json.split('正文/第001章.md').join('正文/第002章.md'));
    spec.extra_files = {
      '.storyforge/canon/facts.json': LEDGER.split('正文/第002章.md')
        .join('正文/第001章.md')
        .replace('沈禾问路。', '林舟推开门。')
        .replace('"沈禾"', '"林舟"'),
    };
    const { record } = await patchReplay({ ...base, spec_json: JSON.stringify(spec) });
    const revise = userPrompts(record).filter((prompt) => prompt.includes(HEADING));
    expect(revise).toHaveLength(1);
    expect(revise[0]).toContain('- 林舟 · 处境/下落：在问路（第1章「林舟推开门。」）');
  });
});
