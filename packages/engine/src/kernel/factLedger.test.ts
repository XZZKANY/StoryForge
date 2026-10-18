import { describe, expect, it } from 'vitest';
import {
  factKey,
  parseFactLedger,
  planFactRecord,
  serializeFactLedger,
  type FactCandidate,
} from './factLedger';
import { InputDomainError, type JsonObject } from './json';

const ORDER: Record<string, number> = {
  '正文/第001章.md': 1,
  '正文/第002章.md': 2,
  '正文/第003章.md': 3,
};
const ALIASES: Record<string, string> = { 老陈: '陈默' };

function plan(facts: JsonObject[], path: string, candidates: Partial<FactCandidate>[]) {
  let next = 0;
  return planFactRecord({
    ledger: { version: 1, facts },
    path,
    candidates: candidates.map((item) => ({
      kind: '处境',
      subject: '陈默',
      attribute: '下落',
      value: '在城里',
      object: null,
      quote: '陈默进了城。',
      startLine: 3,
      ...item,
    })),
    ordinal: (value) => ORDER[value] ?? null,
    canonical: (name) => ALIASES[name] ?? name,
    now: '2026-10-18T09:00:00Z',
    newId: () => `${String(++next).padStart(4, '0')}abcdef0123456789`,
  });
}

const existing = (overrides: JsonObject): JsonObject => ({
  id: 'fact_old',
  kind: '处境',
  subject: '陈默',
  attribute: '下落',
  value: '在山里',
  object: null,
  path: '正文/第001章.md',
  status: 'active',
  ...overrides,
});

describe('fact ledger format', () => {
  it('treats a missing file as an empty ledger', () => {
    expect(parseFactLedger(null)).toEqual({ version: 1, facts: [] });
  });

  it('keeps unknown fields and defaults the version', () => {
    const ledger = parseFactLedger(
      JSON.stringify({ facts: [existing({ note: '作者备注' })], extra: true }),
    );
    expect(ledger.version).toBe(1);
    expect(ledger.extra).toBe(true);
    expect((ledger.facts as JsonObject[])[0].note).toBe('作者备注');
  });

  it.each([
    [{ facts: [existing({ kind: '心情' })] }, 'facts[0].kind 应为'],
    [{ facts: [existing({}), existing({})] }, 'facts[1].id 和前面重复'],
    [{ facts: [existing({ status: 'done' })] }, 'facts[0].status 应为'],
    [{ facts: [existing({ value: 7 })] }, 'facts[0].value 应为字符串'],
    [
      { facts: [existing({ evidence: [{ quote: null }] })] },
      'facts[0].evidence[0].quote 应为字符串',
    ],
    [{ facts: {} }, 'facts 应为数组'],
  ])('points at the broken field %#', (ledger, message) => {
    expect(() => parseFactLedger(JSON.stringify(ledger))).toThrow(InputDomainError);
    expect(() => parseFactLedger(JSON.stringify(ledger))).toThrow(message);
  });

  it('writes CRLF on windows and LF elsewhere', () => {
    const ledger = { version: 1, facts: [] };
    expect(serializeFactLedger(ledger, 'posix')).toBe('{\n  "version": 1,\n  "facts": []\n}\n');
    expect(serializeFactLedger(ledger, 'windows')).toBe(
      '{\r\n  "version": 1,\r\n  "facts": []\r\n}\r\n',
    );
  });
});

describe('fact comparison key', () => {
  it.each([
    ['七岁', '7岁'],
    ['二十岁', '20岁'],
    ['十七', '17'],
    ['一百零五', '105'],
    ['７岁', '7岁'],
    ['「铜钥匙」', '铜钥匙'],
    ['在 城里。', '在城里'],
  ])('%s equals %s', (left, right) => {
    expect(factKey(left)).toBe(factKey(right));
  });

  it('leaves digit-by-digit years alone', () => {
    expect(factKey('二〇二六年')).toBe('二〇二六年');
  });
});

describe('planning a chapter record', () => {
  it('records new facts with evidence', () => {
    const result = plan([], '正文/第002章.md', [{}]);
    expect(result.added).toEqual([
      {
        id: 'fact_0001abcdef01',
        kind: '处境',
        subject: '陈默',
        attribute: '下落',
        value: '在城里',
        object: null,
        path: '正文/第002章.md',
        status: 'active',
        supersedes: null,
        assertion_type: 'text_observation',
        recorded_by: 'auto',
        evidence: [{ path: '正文/第002章.md', quote: '陈默进了城。', start_line: 3 }],
        recorded_at: '2026-10-18T09:00:00Z',
      },
    ]);
    expect(result.ledger.facts).toEqual(result.added);
  });

  it('skips facts the ledger already has, under an alias or another spelling', () => {
    const result = plan(
      [existing({ value: '七岁', kind: '数值', attribute: '年龄' })],
      '正文/第002章.md',
      [{ subject: '老陈', kind: '数值', attribute: '年龄', value: '7岁' }],
    );
    expect(result.duplicates).toBe(1);
    expect(result.added).toEqual([]);
  });

  it('skips repeats inside the same chapter', () => {
    const result = plan([], '正文/第002章.md', [{}, { quote: '他进城了。' }]);
    expect(result.added).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it('lets a later state replace an earlier one', () => {
    const result = plan([existing({})], '正文/第002章.md', [{}]);
    expect(result.superseded.map((fact) => fact.id)).toEqual(['fact_old']);
    expect(result.added[0]).toMatchObject({ status: 'active', supersedes: 'fact_old' });
    expect((result.ledger.facts as JsonObject[])[0].status).toBe('superseded');
  });

  it('keeps a later chapter state when an earlier chapter is recorded afterwards', () => {
    const result = plan([existing({ path: '正文/第003章.md' })], '正文/第002章.md', [{}]);
    expect(result.superseded).toEqual([]);
    expect(result.added[0]).toMatchObject({ status: 'superseded', supersedes: null });
    expect((result.ledger.facts as JsonObject[])[0].status).toBe('active');
  });

  it('treats identity as a state, because ranks and titles keep changing', () => {
    const result = plan(
      [existing({ kind: '身份', attribute: '职位', value: '杂役' })],
      '正文/第003章.md',
      [{ kind: '身份', attribute: '职位', value: '内门弟子' }],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.superseded).toHaveLength(1);
  });

  it('refuses a second version of a fixed fact from another chapter', () => {
    const old = existing({ kind: '关系', attribute: '兄弟姐妹', value: '独子' });
    const result = plan([old], '正文/第002章.md', [
      { kind: '关系', attribute: '兄弟姐妹', value: '有个姐姐', quote: '他想起姐姐。' },
    ]);
    expect(result.added).toEqual([]);
    expect(result.conflicts).toEqual([
      { candidate: expect.objectContaining({ value: '有个姐姐' }), existing: old },
    ]);
    expect(result.ledger.facts).toEqual([old]);
  });

  it('replaces a fixed fact when the same chapter was rewritten', () => {
    const old = existing({
      kind: '来历',
      attribute: '出生地',
      value: '北城',
      path: '正文/第002章.md',
    });
    const result = plan([old], '正文/第002章.md', [
      { kind: '来历', attribute: '出生地', value: '南城' },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.added[0]).toMatchObject({ supersedes: 'fact_old' });
  });

  it('ignores retired and superseded facts', () => {
    const result = plan(
      [
        existing({ id: 'a', status: 'retired', kind: '关系', value: '独子' }),
        existing({ id: 'b', status: 'superseded', value: '在城里' }),
      ],
      '正文/第002章.md',
      [{ kind: '关系', value: '有个姐姐' }, {}],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.duplicates).toBe(0);
    expect(result.added).toHaveLength(2);
  });

  it('never reuses an id', () => {
    const ids = ['0001abcdef01', '0001abcdef01', '0002abcdef01'];
    const result = planFactRecord({
      ledger: { version: 1, facts: [existing({ id: 'fact_0001abcdef01', subject: '林舟' })] },
      path: '正文/第002章.md',
      candidates: [
        {
          kind: '持有',
          subject: '陈默',
          attribute: '物件',
          value: '铜钥匙',
          object: null,
          quote: '钥匙',
          startLine: 1,
        },
      ],
      ordinal: () => null,
      canonical: (name) => name,
      now: 't',
      newId: () => ids.shift()!,
    });
    expect(result.added[0].id).toBe('fact_0002abcdef01');
  });
});
