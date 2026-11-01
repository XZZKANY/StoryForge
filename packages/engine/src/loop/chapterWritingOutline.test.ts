import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRIFT = '章纲的来源在确认期间已变化，请重新生成章纲后再确认。';
const DRAFT_TAIL = '请输出该文件的完整初稿正文。';
const BRIEF_HEAD = '把作者的写章要求整理成 Chapter Brief。';

/** 拿写章 golden 的一个场景，改一改 spec 再回放（不和 golden 比，只看这里关心的行为）。 */
async function run(id: string, change: (spec: Obj) => void) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  change(spec);
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record;
}

function prompts(record: Obj): string[] {
  return (record.requests as Obj[]).map((request) => {
    const messages = request.body.messages as Obj[];
    return messages[messages.length - 1].content as string;
  });
}

function only(list: string[], test: (prompt: string) => boolean): string {
  const found = list.filter(test);
  expect(found).toHaveLength(1);
  return found[0];
}

// 场景写的是 正文/第003章.md：后半那句在 1200 字摘录之外。
const OUTLINE = `# 第3章细纲\n- 开场：先写城门守卫议论他。\n${'入城。'.repeat(450)}\n- 收尾：停在他走进客栈，不写夜里的事。`;

describe('写章读本章细纲全文', () => {
  it('gives the whole outline to the brief and to the draft instruction, not to the setting sources', async () => {
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = {
        '大纲/总纲.md': '主线：林舟入城寻亲。',
        '大纲/第3章细纲.md': OUTLINE,
        '大纲/第5章细纲.md': '第五章另有安排。',
      };
    });
    const all = prompts(record);
    const brief = only(all, (prompt) => prompt.includes(BRIEF_HEAD));
    const draft = only(all, (prompt) => prompt.endsWith(DRAFT_TAIL));

    expect(brief).toContain(`<<<OUTLINE\n${OUTLINE}\nOUTLINE>>>`);
    expect(brief).toContain('本章细纲（大纲/第3章细纲.md，作者为这一章写的安排）');
    expect(draft).toContain(`<<<OUTLINE\n${OUTLINE}\nOUTLINE>>>`);
    expect(draft.indexOf('章节目标：')).toBeLessThan(draft.indexOf('本章细纲（大纲/第3章细纲.md'));
    expect(draft).toContain('### 大纲/总纲.md');
    expect(draft).not.toContain('### 大纲/第3章细纲.md');
    for (const prompt of [brief, draft]) expect(prompt).not.toContain('第五章另有安排');
  });

  it('leaves the brief and the draft as before when the chapter has no outline', async () => {
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = { '大纲/第5章细纲.md': '第五章另有安排。' };
    });
    for (const prompt of prompts(record)) {
      expect(prompt).not.toContain('<<<OUTLINE');
      expect(prompt).not.toContain('第五章另有安排');
    }
  });

  it('refuses to draft when the chapter outline changed while the brief waited', async () => {
    const record = await run('write-source-drift', (spec) => {
      expect(spec.ops[0]).toMatchObject({ op: 'edit', path: '.storyforge/agent-instructions.md' });
      spec.extra_files = { '大纲/第3章细纲.md': OUTLINE };
      spec.ops[0] = { op: 'edit', path: '大纲/第3章细纲.md', content: `${OUTLINE}\n改过。` };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });
});
