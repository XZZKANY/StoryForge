import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRIFT = '章纲的来源在确认期间已变化，请重新生成章纲后再确认。';
const DRAFT_TAIL = '请输出该文件的完整初稿正文。';

/** 拿写章 golden 的一个场景，改一改 spec 再回放（不和 golden 比，只看这里关心的行为）。 */
async function run(id: string, change: (spec: Obj) => void) {
  const base = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
  const spec = JSON.parse(base.spec_json);
  change(spec);
  const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
  if (error) throw error;
  return record;
}

function draftPrompt(record: Obj): string {
  const prompts = (record.requests as Obj[]).map((request) => {
    const messages = request.body.messages as Obj[];
    return messages[messages.length - 1].content as string;
  });
  const drafts = prompts.filter((prompt) => prompt.endsWith(DRAFT_TAIL));
  expect(drafts).toHaveLength(1);
  return drafts[0];
}

describe('起草新章看到的立项资料与上一章', () => {
  it('drafts with every setting file whole, outline first, without repeating its excerpt', async () => {
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = {
        '大纲/总纲.md': '主线：林舟入城寻亲。',
        '设定/世界规则.md': '前文。'.repeat(600) + '城门三更关闭。',
      };
    });
    const prompt = draftPrompt(record);
    expect(prompt).toContain('城门三更关闭。');
    expect(prompt.indexOf('### 大纲/总纲.md')).toBeLessThan(prompt.indexOf('### 人物/主角.md'));
    expect(prompt.indexOf('### 人物/主角.md')).toBeLessThan(prompt.indexOf('### 设定/世界规则.md'));
    expect(prompt.split('### 人物/主角.md')).toHaveLength(2);
  });

  it('keeps full world rules and common character boundaries throughout brief, draft, check and repair', async () => {
    const world = '世界规则正文。'.repeat(1200) + '完整世界规则的末尾不可丢。';
    const record = await run('write-repair-then-pass', (spec) => {
      spec.extra_files = {
        '大纲/总纲.md': '大纲正文。'.repeat(1500),
        '人物/主要人物.md':
          '# 人物\n## 一、林舟\n林舟只凭证据行事。\n## 二、沈禾\n' +
          '沈禾经历。'.repeat(1400) +
          '\n## 三、统一写作边界\n公共人物边界必须始终在场。',
        '设定/世界规则.md': world,
      };
    });
    const all = (record.requests as Obj[]).map((request) =>
      (request.body.messages as Obj[]).map((message) => message.content as string).join('\n'),
    );
    // 拟章纲、起草、检查、修复、复查，每一步拿到同一份完整世界规则。
    expect(all).toHaveLength(5);
    for (const prompt of all) {
      expect(prompt).toContain(world);
      expect(prompt).toContain('公共人物边界必须始终在场。');
      expect(prompt).not.toContain('没放进来：设定/世界规则.md');
    }
  });

  it('guards the end of world rules beyond the old 6000-character cutoff', async () => {
    const world = '规则。'.repeat(2400) + '末尾原规则。';
    const record = await run('write-source-drift', (spec) => {
      spec.extra_files = { '设定/世界规则.md': world };
      spec.ops[0] = {
        op: 'edit',
        path: '设定/世界规则.md',
        content: world.replace('末尾原规则。', '末尾已变化。'),
      };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });

  it('drafts with the whole previous chapter, not only its last 1200 characters', async () => {
    const opening = '沈禾在城外渡口付了二十文船钱。';
    const body = `第二章 夜行\n\n${opening}\n\n${'沈禾问路。'.repeat(400)}`;
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = { '正文/第002章.md': body };
    });
    const prompt = draftPrompt(record);
    expect(prompt).toContain(`上一章（正文/第002章.md）全文：\n<<<PREVIOUS\n${body}\nPREVIOUS>>>`);
  });

  it('refuses to draft when a setting file changed while the brief waited', async () => {
    const record = await run('write-source-drift', (spec) => {
      expect(spec.ops[0]).toMatchObject({ op: 'edit', path: '.storyforge/agent-instructions.md' });
      spec.extra_files = { '设定/世界规则.md': '城门三更关闭。' };
      spec.ops[0] = { op: 'edit', path: '设定/世界规则.md', content: '城门五更关闭。' };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });

  it('refuses to draft when the opening of a long previous chapter changed', async () => {
    const tail = '沈禾问路。'.repeat(400);
    const record = await run('write-previous-chapter-drift', (spec) => {
      expect(spec.ops[0]).toMatchObject({ op: 'edit', path: '正文/第002章.md' });
      spec.extra_files = { '正文/第002章.md': `第二章 夜行\n\n开头一句。\n\n${tail}` };
      spec.ops[0] = {
        op: 'edit',
        path: '正文/第002章.md',
        content: `第二章 夜行\n\n开头改过。\n\n${tail}`,
      };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
  });
});
