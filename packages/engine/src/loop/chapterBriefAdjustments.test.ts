import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chapter-writing.windows.json';
import type { WrittenFact } from '../kernel/canonContext';
import { agentRunReplay } from './agentRunReplay.test-support';
import { checkPrompt } from './chapterCheckProtocol';
import {
  briefPrompt,
  confirmBrief,
  draftInstruction,
  parseBrief,
  repairInstruction,
  type BriefWritten,
} from './chapterWritingContracts';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 照预言机场景的 JSON 形状改
const SEED = {
  target_path: '正文/第206章.md',
  chapter_ordinal: 206,
  chapter_title: '围捕',
  goal: '刑警在化工铺门前追捕跛脚男杨小满',
  target_chars_min: 3000,
  target_chars_max: 4000,
};
const MESSAGE = '写下一章';
const TAIL = '陆一鸣把束带勒紧，杨小满被押上了车。';
const fact = (overrides: Partial<WrittenFact>): WrittenFact => ({
  line: '- 周树声 · 生死：已死（第180章「周树声倒在血泊里，已经死了。」）',
  kind: '生死',
  subject: '周树声',
  value: '已死',
  quote: '周树声倒在血泊里，已经死了。',
  ordinal: 180,
  ...overrides,
});
const WRITTEN: BriefWritten = { previous: ['正文/第205章.md', TAIL], facts: [] };
const ADJUSTMENT = {
  plan_quote: '追捕跛脚男杨小满',
  fact_quote: '杨小满被押上了车。',
  adjustment: '杨小满上一章已落网，本章追的是另一名尚未落网的跛脚男。',
};
const parse = (adjustments: unknown, written: BriefWritten | null = WRITTEN) =>
  parseBrief(JSON.stringify({ goal: SEED.goal, fact_adjustments: adjustments }), {
    seed: SEED,
    provenance: {},
    newHex: () => '0'.repeat(32),
    userMessage: MESSAGE,
    written,
  });

describe('chapter brief compares the plan with what is already written', () => {
  it('leaves the prompt untouched when there is nothing to compare', () => {
    const plain = briefPrompt(SEED, MESSAGE);
    expect(briefPrompt(SEED, MESSAGE, { previous: null, facts: [] })).toBe(plain);
    expect(plain).not.toContain('fact_adjustments');
  });

  it('hands over the previous chapter ending and the written facts before the request', () => {
    const prompt = briefPrompt(SEED, MESSAGE, { ...WRITTEN, facts: [fact({})] });
    expect(prompt).toContain('另输出 fact_adjustments 数组');
    const order = [
      '另输出 fact_adjustments',
      '后端确定种子：',
      '上一章（正文/第205章.md）结尾：',
      TAIL,
      '已写事实（来自台账）：',
      fact({}).line,
      '作者要求：写下一章',
    ];
    const positions = order.map((text) => prompt.indexOf(text));
    expect(positions.every((value) => value >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('keeps adjustments whose quotes are really in the plan and in what was written', () => {
    const brief = parse([
      ADJUSTMENT,
      { ...ADJUSTMENT, plan_quote: '计划里没有这句', adjustment: '甲' },
      { ...ADJUSTMENT, fact_quote: '上一章没有这句', adjustment: '乙' },
      { ...ADJUSTMENT, adjustment: '' },
      { ...ADJUSTMENT, plan_quote: '追捕跛脚男' },
      '不是对象',
    ]);
    expect(brief.fact_adjustments).toEqual([{ ...ADJUSTMENT, source: 'model' }]);
    expect(brief.goal).toBe(SEED.goal);
  });

  it('adds no key when nothing survives, and ignores adjustments without material', () => {
    expect('fact_adjustments' in parse([{ ...ADJUSTMENT, fact_quote: '编的' }])).toBe(false);
    expect('fact_adjustments' in parse([ADJUSTMENT], null)).toBe(false);
  });

  it('caps the number of adjustments', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...ADJUSTMENT,
      adjustment: `第 ${index} 条调整`,
    }));
    expect(parse(many).fact_adjustments).toHaveLength(8);
  });

  it('adds a recall-only adjustment when the plan brings back someone the ledger has dead', () => {
    const seed = { ...SEED, goal: '周树声在码头接货；杨小满逃走' };
    const written = { ...WRITTEN, facts: [fact({}), fact({ subject: '林舟', value: '假死脱身' })] };
    const brief = parseBrief(JSON.stringify({ goal: seed.goal, fact_adjustments: [] }), {
      seed,
      provenance: {},
      newHex: () => '0'.repeat(32),
      userMessage: '林舟也要出场',
      written,
    });
    expect(brief.fact_adjustments).toEqual([
      {
        plan_quote: '周树声在码头接货',
        fact_quote: '周树声倒在血泊里，已经死了。',
        adjustment: '「周树声」已在第 180 章已死，本章若出现只能是回忆或提及。',
        source: 'program',
      },
    ]);
  });

  it('does not repeat what the model already said about the dead', () => {
    const seed = { ...SEED, goal: '周树声在码头接货' };
    const brief = parseBrief(
      JSON.stringify({
        fact_adjustments: [
          {
            plan_quote: '周树声在码头接货',
            fact_quote: '周树声倒在血泊里，已经死了。',
            adjustment: '改成手下替周树声接货。',
          },
        ],
      }),
      {
        seed,
        provenance: {},
        newHex: () => '0'.repeat(32),
        userMessage: MESSAGE,
        written: { previous: null, facts: [fact({})] },
      },
    );
    expect((brief.fact_adjustments as Obj[]).map((item) => item.source)).toEqual(['model']);
  });

  it('lets the author drop adjustments but not add new ones', () => {
    const second = { ...ADJUSTMENT, adjustment: '另一条', source: 'model' };
    const pending: Obj = { ...parse([ADJUSTMENT]), revision: 1 };
    pending.fact_adjustments = [...pending.fact_adjustments, second];
    const confirm = (adjustments?: unknown) => {
      const edited: Obj = { ...pending };
      if (adjustments === undefined) delete edited.fact_adjustments;
      else edited.fact_adjustments = adjustments;
      return confirmBrief(edited, pending);
    };
    expect(confirm().fact_adjustments).toHaveLength(2);
    expect(confirm([second]).fact_adjustments).toEqual([second]);
    expect('fact_adjustments' in confirm([])).toBe(false);
    expect(
      confirm([{ plan_quote: 'x', fact_quote: 'y', adjustment: '作者塞进来的' }]).fact_adjustments,
    ).toBeUndefined();
  });

  it('puts the adjustments last in the drafting and repair instructions', () => {
    const brief = parse([ADJUSTMENT]);
    const block =
      '按已写内容的调整（优先于上面的章节目标与节拍）：\n' +
      '- 杨小满上一章已落网，本章追的是另一名尚未落网的跛脚男。（已写：「杨小满被押上了车。」）';
    expect(draftInstruction(brief).endsWith(block)).toBe(true);
    expect(repairInstruction({ findings: [] }, brief)).toContain(block);
    expect(draftInstruction({ ...brief, fact_adjustments: undefined })).not.toContain('按已写内容');
  });

  it('tells the checker that following an adjustment is not a violation', () => {
    const brief = parse([ADJUSTMENT]);
    const prompt = checkPrompt(brief, '正文');
    expect(prompt).toContain('正文照调整写的不算违反');
    expect(prompt).toContain('"fact_adjustments": [{"plan_quote": "追捕跛脚男杨小满"');
    const { fact_adjustments: _dropped, ...plain } = brief;
    const without = checkPrompt(plain, '正文');
    expect(without).not.toContain('fact_adjustments');
  });
});

describe('the chapter writing pipeline carries the adjustments through', () => {
  const { replay } = agentRunReplay(golden);

  it('from brief to draft and check, and keeps them through confirmation', async () => {
    const base = (golden.scenarios as Obj[]).find((item) => item.id === 'write-brief-then-pass')!;
    const spec = JSON.parse(base.spec_json);
    const body = JSON.parse(spec.replies[0].body);
    const brief = JSON.parse(body.choices[0].message.content);
    brief.fact_adjustments = [
      {
        plan_quote: '沈禾带林舟入城',
        fact_quote: '沈禾问路。',
        adjustment: '沈禾上一章已经问过路，本章直接领林舟进城。',
      },
    ];
    body.choices[0].message.content = JSON.stringify(brief);
    spec.replies[0].body = JSON.stringify(body);
    const { record, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    const prompts = (record.requests as Obj[]).map((request) => {
      const messages = request.body.messages as Obj[];
      return messages[messages.length - 1].content as string;
    });
    const briefRequest = prompts.find((prompt) => prompt.includes('把作者的写章要求整理成'))!;
    expect(briefRequest).toContain(
      '上一章（正文/第002章.md）结尾：\n<<<PREVIOUS\n第二章 夜行\n\n沈禾问路。\nPREVIOUS>>>',
    );
    const draft = prompts.find((prompt) => prompt.includes('请输出该文件的完整初稿正文'))!;
    expect(draft).toContain(
      '按已写内容的调整（优先于上面的章节目标与节拍）：\n- 沈禾上一章已经问过路，本章直接领林舟进城。（已写：「沈禾问路。」）',
    );
    const check = prompts.find((prompt) => prompt.includes('检查完整正文是否满足已确认 brief'))!;
    expect(check).toContain('正文照调整写的不算违反');
  });
});

describe('chapter brief replies that put fact_adjustments after the object', () => {
  const options = {
    seed: SEED,
    provenance: {},
    newHex: () => '0'.repeat(32),
    userMessage: MESSAGE,
    written: WRITTEN,
  };
  // 真实 glm-5.3-flash 回复的形状：字段列表里没有 fact_adjustments，它就另起一行写在对象外面。
  const object = JSON.stringify(
    { target_path: SEED.target_path, goal: '刑警追捕另一名跛脚男', target_chars_min: 3200 },
    null,
    2,
  );

  it('merges a trailing fact_adjustments line back into the brief', () => {
    const empty = parseBrief(`${object}\n\nfact_adjustments: []`, options);
    expect(empty.goal).toBe('刑警追捕另一名跛脚男');
    expect(empty.target_chars_min).toBe(3200);
    expect('fact_adjustments' in empty).toBe(false);
    const kept = parseBrief(
      `${object}\n"fact_adjustments"：${JSON.stringify([ADJUSTMENT])}\n`,
      options,
    );
    expect(kept.fact_adjustments).toEqual([{ ...ADJUSTMENT, source: 'model' }]);
    const tricky = parseBrief('{"goal": "他说\\"}别走\\"{"}\nfact_adjustments: []', options);
    expect(tricky.goal).toBe('他说"}别走"{');
  });

  it.each([
    ['prose instead of JSON', '好的，我来写。'],
    ['prose after the object', `${object}\n以上是章纲。`],
    ['more text after the trailing array', `${object}\nfact_adjustments: []\n以上。`],
    ['a trailing value that is not an array', `${object}\nfact_adjustments: {}`],
    [
      'adjustments both inside and after the object',
      `${JSON.stringify({ goal: 'g', fact_adjustments: [] })}\nfact_adjustments: []`,
    ],
    ['an unbalanced object', '{"goal": "g"\nfact_adjustments: []'],
  ])('still rejects %s', (_label, reply) => {
    expect(() => parseBrief(reply, options)).toThrow('模型返回的结构化结果不是有效 JSON。');
  });
});
