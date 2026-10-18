import { describe, expect, it } from 'vitest';
import {
  buildCheck,
  checkPrompt,
  checkSource,
  FACT_KINDS,
  MAX_NEW_FACTS,
} from './chapterCheckProtocol';

type Obj = { [key: string]: unknown };
const brief: Obj = { brief_id: 'b-1', goal: '进城', target_chars_min: 1, target_chars_max: 5000 };
const content =
  '第三章\n\n沈禾带林舟穿过城门。\n守卫说：“今晚宵禁。”\n林舟把父亲留下的铜钥匙交给了沈禾。\n';
const reply = (extra: Obj, findings: unknown[] = []) =>
  JSON.stringify({ ...checkSource(content, brief), findings, ...extra });
const fact = (overrides: Obj = {}): Obj => ({
  kind: '持有',
  subject: '沈禾',
  attribute: '物件',
  value: '拿到铜钥匙',
  object: '林舟',
  quote: '林舟把父亲留下的铜钥匙交给了沈禾。',
  ...overrides,
});

describe('chapter check new_facts', () => {
  it('asks for new facts in the same checker call', () => {
    const prompt = checkPrompt(brief, content);
    expect(prompt).toContain(`另输出 new_facts 数组`);
    expect(prompt).toContain(FACT_KINDS.join('、'));
    expect(prompt).toContain(`最多 ${MAX_NEW_FACTS} 条，没有就返回 []`);
    expect(prompt.indexOf('new_facts')).toBeLessThan(prompt.indexOf('\n检查源：'));
  });

  it('adds nothing when the checker did not return new_facts', () => {
    const result = buildCheck(content, brief, reply({}));
    expect(result.status).toBe('pass');
    expect('new_facts' in result).toBe(false);
    expect('new_facts_received' in result).toBe(false);
  });

  it('keeps facts whose quote is really in the draft and locates them', () => {
    const halfWidth = fact({
      kind: '处境',
      subject: ' 守卫 ',
      value: '宣布宵禁',
      object: '',
      attribute: null,
      quote: '守卫说:"今晚宵禁。"',
    });
    const result = buildCheck(content, brief, reply({ new_facts: [fact(), halfWidth] }));
    expect(result.status).toBe('pass');
    expect(result.new_facts_received).toBe(2);
    expect(result.new_facts).toEqual([
      {
        kind: '持有',
        subject: '沈禾',
        attribute: '物件',
        value: '拿到铜钥匙',
        object: '林舟',
        quote: '林舟把父亲留下的铜钥匙交给了沈禾。',
        char_start: 28,
        char_end: 45,
        line_start: 5,
        line_end: 5,
      },
      {
        kind: '处境',
        subject: '守卫',
        attribute: '',
        value: '宣布宵禁',
        object: null,
        quote: '守卫说:"今晚宵禁。"',
        char_start: 16,
        char_end: 27,
        line_start: 4,
        line_end: 4,
      },
    ]);
  });

  it('drops only the bad facts and never touches the verdict', () => {
    const bad = [
      fact({ kind: '心情' }),
      fact({ quote: '沈禾把钥匙扔进了河里。' }),
      fact({ subject: '' }),
      fact({ value: 3 }),
      fact({ object: ['林舟'] }),
      fact({ quote: '林'.repeat(401) }),
      '沈禾拿到钥匙',
      null,
    ];
    const result = buildCheck(content, brief, reply({ new_facts: [...bad, fact()] }));
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.new_facts_received).toBe(9);
    expect((result.new_facts as Obj[]).map((item) => item.value)).toEqual(['拿到铜钥匙']);
  });

  it('reads at most MAX_NEW_FACTS items', () => {
    const many = Array.from({ length: MAX_NEW_FACTS + 3 }, (_, index) =>
      fact({ value: `第${index}条` }),
    );
    const result = buildCheck(content, brief, reply({ new_facts: many }));
    expect(result.new_facts_received).toBe(MAX_NEW_FACTS + 3);
    expect(result.new_facts).toHaveLength(MAX_NEW_FACTS);
  });

  it('records a malformed new_facts field as received null', () => {
    const result = buildCheck(content, brief, reply({ new_facts: { kind: '持有' } }));
    expect(result.status).toBe('pass');
    expect(result.new_facts).toEqual([]);
    expect(result.new_facts_received).toBeNull();
  });

  it('keeps facts alongside hard findings on the same draft', () => {
    const finding = {
      rule: 'goal_violation',
      severity: 'hard',
      message: '没进城',
      line: 3,
      evidence: '沈禾带林舟穿过城门。',
    };
    const result = buildCheck(content, brief, reply({ new_facts: [fact()] }, [finding]));
    expect(result.status).toBe('repairable');
    expect(result.new_facts).toHaveLength(1);
  });

  it('trusts no facts from a check that is not bound to this draft', () => {
    const forged = JSON.stringify({
      ...checkSource(content, brief),
      content_sha256: '0'.repeat(64),
      findings: [],
      new_facts: [fact()],
    });
    const result = buildCheck(content, brief, forged);
    expect(result.execution_status).toBe('failed');
    expect('new_facts' in result).toBe(false);
  });

  it('trusts no facts when any finding is invalid', () => {
    const invalid = {
      rule: 'goal_violation',
      severity: 'hard',
      message: '编的',
      line: 1,
      evidence: '没有这句',
    };
    const result = buildCheck(content, brief, reply({ new_facts: [fact()] }, [invalid]));
    expect(result.execution_status).toBe('failed');
    expect('new_facts' in result).toBe(false);
  });
});
