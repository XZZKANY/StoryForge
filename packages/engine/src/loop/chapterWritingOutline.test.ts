import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import { agentRunReplay } from './agentRunReplay.test-support';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const { replay } = agentRunReplay(golden);
const DRIFT = '章纲的来源在确认期间已变化，请重新生成章纲后再确认。';
const DRAFT_TAIL = '请输出该文件的完整初稿正文。';
const BRIEF_HEAD = '把作者的写章要求整理成 Chapter Brief。';
const CHECK_HEAD = '检查完整正文是否满足已确认 brief。';

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

  it('gives the brief the book outline without pinning, and both steps the node of this chapter from a long one', async () => {
    const nodes = Array.from(
      { length: 6 },
      (_, index) => `### 第${index + 1}章：节点${index + 1}\n\n节点${index + 1}安排。`,
    ).join('\n\n');
    // 人物写得长：只取开头时第 3 章节点落在 6000 字之后。
    const book = `# 总纲\n\n## 人物\n\n${'人物小传。'.repeat(1300)}\n\n## 开篇节点\n\n${nodes}`;
    const record = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = { '大纲/总纲.md': book };
    });
    const all = prompts(record);
    const brief = only(all, (prompt) => prompt.includes(BRIEF_HEAD));
    const draft = only(all, (prompt) => prompt.endsWith(DRAFT_TAIL));

    expect(brief).toContain('全书总纲里与本章相关的部分');
    expect(brief).toContain('<<<BOOK_OUTLINE\n【大纲/总纲.md】\n（这份共');
    for (const prompt of [brief, draft]) {
      expect(prompt).toContain('按第 3 章挑');
      for (const node of [3, 4, 5]) expect(prompt).toContain(`节点${node}安排`);
    }
    expect(brief.indexOf('<<<BOOK_OUTLINE')).toBeLessThan(brief.indexOf('作者要求：'));
  });

  it('gives the check the node of this chapter from the book outline, and nothing when there is none', async () => {
    const nodes = Array.from(
      { length: 6 },
      (_, index) => `### 第${index + 1}章：节点${index + 1}\n\n节点${index + 1}安排。`,
    ).join('\n\n');
    const withNode = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = { '大纲/总纲.md': `# 总纲\n\n## 开篇节点\n\n${nodes}` };
    });
    const check = only(prompts(withNode), (prompt) => prompt.includes(CHECK_HEAD));
    expect(check).toContain(
      '总纲本章那段（大纲/总纲.md）：\n<<<BOOK_OUTLINE_CHAPTER\n### 第3章：节点3\n节点3安排。\nBOOK_OUTLINE_CHAPTER>>>',
    );
    expect(check).not.toContain('节点4安排');

    const without = await run('write-brief-then-pass', (spec) => {
      spec.extra_files = { '大纲/总纲.md': '主线：林舟入城寻亲。' };
    });
    const plain = only(prompts(without), (prompt) => prompt.includes(CHECK_HEAD));
    expect(plain).not.toContain('BOOK_OUTLINE_CHAPTER');
    expect(plain).not.toContain('outline_violation');
  });

  it('repairs a chapter the checker finds off the book outline node', async () => {
    const record = await run('write-repair-then-pass', (spec) => {
      spec.extra_files = { '大纲/总纲.md': '# 总纲\n\n### 第3章：入城\n\n守卫盘查林舟。' };
      const finding = spec.replies[2].chapter_check.findings[0];
      expect(finding.rule).toBe('missing_required_beat');
      finding.rule = 'outline_violation';
      finding.message = '总纲安排守卫盘查林舟，正文没写。';
    });
    const all = prompts(record);
    const repair = only(all, (prompt) => prompt.includes('按已确认 Chapter Brief 修复以下硬失败'));
    expect(repair).toContain('- outline_violation: 总纲安排守卫盘查林舟，正文没写。');
    expect(all.filter((prompt) => prompt.includes(CHECK_HEAD))).toHaveLength(2);
  });

  // 作者 11-17：修过一次仍偏离总纲本章那段的，照出修订但要作者确认，自动档也不直接写进文件。
  const stillOff = (extra: Obj[] = []) =>
    run('write-repair-then-pass', (spec) => {
      spec.message.permission_profile = 'auto';
      spec.extra_files = { '大纲/总纲.md': '# 总纲\n\n### 第3章：入城\n\n守卫盘查林舟。' };
      const off = (evidence: string, line: number) => ({
        rule: 'outline_violation',
        severity: 'hard',
        message: '总纲安排守卫盘查林舟，正文没写',
        line,
        evidence,
      });
      spec.replies[2].chapter_check.findings = [off('沈禾带林舟穿过城门。', 3)];
      spec.replies[4].chapter_check.findings = [off('守卫看了他们一眼。', 4), ...extra];
    });

  it('hands in a revision the author must accept when the repaired chapter is still off the outline', async () => {
    const record = await stillOff();
    expect(record.result.proposed_patch.requires_confirmation).toBe(true);
    // 批量写章读的是落库的检查记录：靠它写「修过一次仍有 N 处和总纲本章那段对不上」。
    expect(JSON.stringify(record.artifacts)).toContain('"outline_deviation":true');
    expect(record.result.agent_result.summary).toBe(
      '章节草稿修过一次，仍有 1 处和总纲本章那段对不上：总纲安排守卫盘查林舟，正文没写。' +
        '生成了 正文/第003章.md 的修订，没有直接写进文件，请看过对比再决定是否接受。',
    );
  });

  it('still holds the chapter back when another hard problem is left beside the outline one', async () => {
    const record = await stillOff([
      {
        rule: 'missing_required_beat',
        severity: 'hard',
        message: '缺少夜宿情节',
        line: 3,
        evidence: '沈禾带林舟穿过城门，夜宿客栈。',
      },
    ]);
    expect(record.result.proposed_patch).toBeNull();
    expect(record.result.agent_result.summary).toContain('候选稿已保留在运行证据中，未生成修订。');
  });

  it('refuses to draft when the book outline node of this chapter changed while the brief waited', async () => {
    const nodes = Array.from(
      { length: 6 },
      (_, index) =>
        `### 第${index + 1}章：节点${index + 1}\n\n${'细节。'.repeat(130)}节点${index + 1}结尾。`,
    ).join('\n\n');
    // 不按章挑时额度在第 3 章节点之前用完：守卫只有按同一个章号签名，才盯得住这一段。
    const book = `# 总纲\n\n## 人物\n\n${'人物小传。'.repeat(1000)}\n\n## 开篇节点\n\n${nodes}`;
    const record = await run('write-source-drift', (spec) => {
      expect(spec.ops[0]).toMatchObject({ op: 'edit', path: '.storyforge/agent-instructions.md' });
      spec.extra_files = { '大纲/总纲.md': book };
      spec.ops[0] = {
        op: 'edit',
        path: '大纲/总纲.md',
        content: book.replace('节点3结尾。', '节点3改了。'),
      };
    });
    expect(JSON.stringify(record.controls)).toContain(DRIFT);
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
