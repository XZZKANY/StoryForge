import { describe, expect, it } from 'vitest';
import { buildSceneConstraintBlock } from './canonContext';
import type { JsonObject } from './json';
import { memoryProject } from './memoryProject.test-support';

const ROOT = '/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const CHAPTERS: Record<string, string> = {
  '正文/第001章.md': '第一章\n\n沈砚秋的父亲死在大火里，那年他七岁。\n老陈收留了他。\n',
  '正文/第002章.md': '第二章\n\n林舟在码头当搬运工。\n苏九娘带走了铜鼎。\n',
  '正文/第003章.md': '第三章\n\n陈默被束带捆住，由陆一鸣带走。\n沈砚秋拿到了那封信。\n',
};
const HEADING = '[已写事实 · 勿违背]（来自台账；本章若涉及须与之一致，回忆或提及除外）';

let nextId = 0;
const fact = (path: string, quote: string, overrides: JsonObject): JsonObject => ({
  id: `fact_${++nextId}`,
  kind: '处境',
  subject: '陈默',
  attribute: '',
  value: '',
  object: null,
  path,
  status: 'active',
  evidence: [{ path, quote, start_line: 3 }],
  ...overrides,
});

const LEDGER = [
  fact('正文/第001章.md', '那年他七岁。', {
    kind: '数值',
    subject: '沈砚秋',
    attribute: '父亲死时年龄',
    value: '七岁',
  }),
  fact('正文/第001章.md', '老陈收留了他。', {
    kind: '关系',
    subject: '陈默',
    attribute: '收养人',
    value: '收留沈砚秋',
  }),
  fact('正文/第002章.md', '林舟在码头当搬运工。', {
    kind: '身份',
    subject: '林舟',
    attribute: '职业',
    value: '码头搬运工',
  }),
  fact('正文/第002章.md', '苏九娘带走了铜鼎。', {
    kind: '持有',
    subject: '苏九娘',
    attribute: '物件',
    value: '铜鼎',
  }),
  fact('正文/第003章.md', '陈默被束带捆住，由陆一鸣带走。', {
    subject: '陈默',
    attribute: '下落',
    value: '被陆一鸣带走',
    object: '陆一鸣',
  }),
];

function setup(options: { ledger?: JsonObject[] | string | null; canon?: JsonObject } = {}) {
  const files: Record<string, ReturnType<typeof file>> = {};
  for (const [path, text] of Object.entries(CHAPTERS)) files[path] = file(text);
  const ledger = options.ledger === undefined ? LEDGER : options.ledger;
  if (ledger !== null)
    files['.storyforge/canon/facts.json'] = file(
      typeof ledger === 'string' ? ledger : JSON.stringify({ version: 1, facts: ledger }),
    );
  if (options.canon)
    files['.storyforge/canon/canon.json'] = file(JSON.stringify({ version: 1, ...options.canon }));
  const project = memoryProject(ROOT, files);
  return (currentFile: string, facts?: { mentionText: string; maxChars?: number }) =>
    buildSceneConstraintBlock(project.reader, ROOT, `${ROOT}/${currentFile}`, {
      platform: 'posix',
      ...(facts ? { facts } : {}),
    });
}

describe('written facts in the scene constraint block', () => {
  it('stays out unless the caller asks for it', async () => {
    expect(await setup()('正文/第004章.md')).toBeNull();
  });

  it('brings every fact from the previous chapter and mentioned older ones', async () => {
    const block = await setup()('正文/第004章.md', { mentionText: '写沈砚秋回城' });
    expect(block).toBe(
      [
        HEADING,
        '- 陈默 · 处境/下落：被陆一鸣带走 → 陆一鸣（第3章「陈默被束带捆住，由陆一鸣带走。」）',
        // 陈默出现在第 3 章正文里，他更早的事实也算相关。
        '- 陈默 · 关系/收养人：收留沈砚秋（第1章「老陈收留了他。」）',
        '- 沈砚秋 · 数值/父亲死时年龄：七岁（第1章「那年他七岁。」）',
      ].join('\n'),
    );
  });

  it('finds older subjects by alias and in the previous chapter text', async () => {
    const block = await setup({
      canon: { entities: [{ id: 'e1', canonical_name: '林舟', aliases: ['阿舟'] }] },
    })('正文/第004章.md', { mentionText: '阿舟回来了' });
    expect(block).toContain('- 林舟 · 身份/职业：码头搬运工（第2章「林舟在码头当搬运工。」）');
    // 第 3 章正文里出现了「沈砚秋」，所以他的旧事实也带上。
    expect(block).toContain('沈砚秋 · 数值/父亲死时年龄');
    expect(block).not.toContain('苏九娘');
  });

  it('puts the most damaging kinds first, newer before older within a kind', async () => {
    const block = (await setup()('正文/第004章.md', { mentionText: '沈砚秋 陈默 林舟 苏九娘' }))!;
    const order = [
      '陈默 · 处境/下落',
      '陈默 · 关系/收养人',
      '林舟 · 身份',
      '沈砚秋 · 数值',
      '苏九娘 · 持有',
    ];
    const positions = order.map((text) => block.indexOf(text));
    expect(positions.every((value) => value > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('only uses facts from chapters before the one being written', async () => {
    const block = (await setup()('正文/第003章.md', { mentionText: '陈默 苏九娘' }))!;
    expect(block).toContain('苏九娘 · 持有/物件：铜鼎（第2章');
    expect(block).not.toContain('被陆一鸣带走');
  });

  it('drops facts whose quote is gone from their chapter, and inactive ones', async () => {
    const ledger = [
      fact('正文/第003章.md', '陈默被铁链锁住。', { attribute: '下落', value: '被锁' }),
      fact('正文/第003章.md', '沈砚秋拿到了那封信。', {
        kind: '持有',
        subject: '沈砚秋',
        value: '信',
        status: 'superseded',
      }),
      fact('正文/第003章.md', '沈砚秋拿到了那封信。', {
        kind: '持有',
        subject: '沈砚秋',
        value: '那封信',
      }),
    ];
    const block = await setup({ ledger })('正文/第004章.md', { mentionText: '' });
    expect(block).toBe(`${HEADING}\n- 沈砚秋 · 持有：那封信（第3章「沈砚秋拿到了那封信。」）`);
  });

  it('stops at the character budget', async () => {
    const block = (await setup()('正文/第004章.md', {
      mentionText: '沈砚秋 陈默 林舟 苏九娘',
      maxChars: 60,
    }))!;
    expect(block.split('\n')).toHaveLength(2);
  });

  it('keeps canon constraints when the ledger is broken, and stays silent without a ledger', async () => {
    const canon = {
      entities: [{ id: 'e1', canonical_name: '陈默' }],
      invariants: { lifespan: [{ entity: 'e1', exits_after_chapter: 2 }] },
    };
    const broken = await setup({ ledger: '{"facts": [{"id": 1}]}', canon })('正文/第004章.md', {
      mentionText: '陈默',
    });
    expect(broken).toContain('「陈默」已于第 2 章退场');
    expect(broken).not.toContain(HEADING);
    const without = setup({ ledger: null, canon });
    expect(await without('正文/第004章.md', { mentionText: '陈默' })).toBe(
      await without('正文/第004章.md'),
    );
  });
});
