import { describe, expect, it } from 'vitest';
import {
  factKey,
  parseFactLedger,
  planFactRecord,
  resolveDisputedFact,
  retireFact,
  serializeFactLedger,
  type FactCandidate,
} from './factLedger';
import { InputDomainError, type JsonObject } from './json';

const ORDER: Record<string, number> = {
  '正文/第001章.md': 1,
  '正文/第002章.md': 2,
  '正文/第003章.md': 3,
  '正文/第004章.md': 4,
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

  it('rejects a checked chapter list that is not all strings', () => {
    expect(() => parseFactLedger('{"version": 1, "facts": [], "checked_chapters": [1]}')).toThrow(
      InputDomainError,
    );
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
    expect(result.refreshed).toEqual([]);
    expect(result.added[0].evidence).toEqual([
      { path: '正文/第002章.md', quote: '陈默进了城。', start_line: 3 },
    ]);
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

  it('keeps a second version of a fixed fact from another chapter as disputed', () => {
    const old = existing({ kind: '关系', attribute: '兄弟姐妹', value: '独子' });
    const result = plan([old], '正文/第002章.md', [
      { kind: '关系', attribute: '兄弟姐妹', value: '有个姐姐', quote: '他想起姐姐。' },
    ]);
    expect(result.added).toEqual([]);
    expect(result.conflicts).toEqual([
      { candidate: expect.objectContaining({ value: '有个姐姐' }), existing: old },
    ]);
    expect(result.disputed).toEqual([
      expect.objectContaining({
        value: '有个姐姐',
        status: 'disputed',
        disputes: 'fact_old',
        supersedes: null,
      }),
    ]);
    expect(result.ledger.facts).toEqual([old, result.disputed[0]]);
  });

  it('does not dispute the same thing twice', () => {
    const old = existing({ kind: '关系', attribute: '兄弟姐妹', value: '独子' });
    const first = plan([old], '正文/第002章.md', [
      { kind: '关系', attribute: '兄弟姐妹', value: '有个姐姐' },
    ]);
    const again = plan(first.ledger.facts as JsonObject[], '正文/第003章.md', [
      { kind: '关系', attribute: '兄弟姐妹', value: '有个姐姐' },
    ]);
    expect(again.duplicates).toBe(1);
    expect(again.disputed).toEqual([]);
  });

  it('marks the chapter as checked once, even when nothing new was found', () => {
    const first = plan([], '正文/第002章.md', []);
    expect(first.newlyChecked).toBe(true);
    expect(first.ledger.checked_chapters).toEqual(['正文/第002章.md']);
    const again = planFactRecord({
      ledger: first.ledger,
      path: '正文/第002章.md',
      candidates: [],
      ordinal: (value) => ORDER[value] ?? null,
      canonical: (name) => name,
      now: '2026-10-18T09:00:00Z',
      newId: () => 'ffffabcdef0123456789',
    });
    expect(again.newlyChecked).toBe(false);
    expect(again.ledger.checked_chapters).toEqual(['正文/第002章.md']);
  });

  it('refreshes the quote when the same chapter says the same thing in new words', () => {
    const old = existing({
      value: '在城里',
      path: '正文/第002章.md',
      evidence: [{ path: '正文/第002章.md', quote: '陈默住在城里。', start_line: 2 }],
    });
    const result = plan([old], '正文/第002章.md', [{ quote: '陈默的住处在城里。', startLine: 5 }]);
    expect(result.duplicates).toBe(1);
    expect(result.added).toEqual([]);
    expect(result.refreshed.map((fact) => fact.id)).toEqual(['fact_old']);
    expect((result.ledger.facts as JsonObject[])[0].evidence).toEqual([
      { path: '正文/第002章.md', quote: '陈默的住处在城里。', start_line: 5 },
    ]);
  });

  it('leaves the quote alone when another chapter repeats the fact or the quote is unchanged', () => {
    const evidence = [{ path: '正文/第001章.md', quote: '陈默住在城里。', start_line: 2 }];
    const other = plan([existing({ value: '在城里', evidence })], '正文/第002章.md', [{}]);
    expect(other.refreshed).toEqual([]);
    expect((other.ledger.facts as JsonObject[])[0].evidence).toEqual(evidence);
    const same = plan([existing({ value: '在城里', evidence })], '正文/第001章.md', [
      { quote: '陈默住在城里。' },
    ]);
    expect(same.refreshed).toEqual([]);
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

describe('resolving a disputed fact', () => {
  const ledger = JSON.stringify({
    version: 1,
    facts: [
      existing({ kind: '关系', attribute: '兄弟姐妹', value: '独子' }),
      existing({
        id: 'fact_new',
        kind: '关系',
        attribute: '兄弟姐妹',
        value: '有个姐姐',
        path: '正文/第002章.md',
        status: 'disputed',
        disputes: 'fact_old',
      }),
    ],
  });
  const statuses = (text: string) =>
    (JSON.parse(text).facts as JsonObject[]).map((fact) => [
      fact.id,
      fact.status,
      fact.supersedes ?? null,
    ]);

  it('accepting the chapter makes it count and retires the old version into history', () => {
    expect(statuses(resolveDisputedFact(ledger, 'fact_new', 'accept', 'posix'))).toEqual([
      ['fact_old', 'superseded', null],
      ['fact_new', 'active', 'fact_old'],
    ]);
  });

  it('keeping what was recorded retires the new version', () => {
    expect(statuses(resolveDisputedFact(ledger, 'fact_new', 'reject', 'posix'))).toEqual([
      ['fact_old', 'active', null],
      ['fact_new', 'retired', null],
    ]);
  });

  it('refuses anything that is not waiting for a decision', () => {
    expect(() => resolveDisputedFact(ledger, 'fact_old', 'accept', 'posix')).toThrow(
      '没有这条待定事实',
    );
    expect(() => resolveDisputedFact(ledger, 'nope', 'reject', 'posix')).toThrow(InputDomainError);
  });

  it('accepts the disputed status in a hand-written ledger', () => {
    expect(parseFactLedger(ledger).facts).toHaveLength(2);
  });
});

describe('keeping one current value per fact', () => {
  const active = (text: string) =>
    (JSON.parse(text).facts as JsonObject[])
      .filter((fact) => (fact.status ?? 'active') === 'active')
      .map((fact) => fact.value);
  const birthplace = (overrides: JsonObject): JsonObject =>
    existing({ kind: '来历', attribute: '出生地', ...overrides });

  it('numbers keep their decimal point and sign when compared', () => {
    expect(factKey('1.5米')).not.toBe(factKey('15米'));
    expect(factKey('-10点')).not.toBe(factKey('10点'));
    expect(factKey('１．５米')).toBe(factKey('1.5米'));
    expect(factKey('在城里。')).toBe(factKey('在城里'));
    const taller = plan(
      [existing({ kind: '数值', attribute: '身高', value: '1.5米' })],
      '正文/第002章.md',
      [{ kind: '数值', attribute: '身高', value: '15米' }],
    );
    expect(taller.duplicates).toBe(0);
    expect(taller.added).toHaveLength(1);
  });

  it('accepting a second disputed version replaces whichever value is current now', () => {
    let ledger = JSON.stringify({
      version: 1,
      facts: [
        birthplace({ id: 'north', value: '北城' }),
        birthplace({
          id: 'south',
          value: '南城',
          path: '正文/第002章.md',
          status: 'disputed',
          disputes: 'north',
        }),
        birthplace({
          id: 'east',
          value: '东城',
          path: '正文/第003章.md',
          status: 'disputed',
          disputes: 'north',
        }),
      ],
    });
    ledger = resolveDisputedFact(ledger, 'south', 'accept', 'posix');
    ledger = resolveDisputedFact(ledger, 'east', 'accept', 'posix');
    expect(active(ledger)).toEqual(['东城']);
    expect(active(retireFact(ledger, 'east', 'posix'))).toEqual(['南城']);
  });

  it('a backfilled chapter in the middle joins the chain, so retiring the latest goes back to it', () => {
    const facts = [
      existing({ id: 'ch1', value: '在山里', status: 'superseded' }),
      existing({ id: 'ch3', value: '在海边', path: '正文/第003章.md', supersedes: 'ch1' }),
    ];
    const result = plan(facts, '正文/第002章.md', [{ value: '在城里' }]);
    const [middle] = result.added;
    expect(middle).toMatchObject({ status: 'superseded', supersedes: 'ch1' });
    const ledger = serializeFactLedger(result.ledger, 'posix');
    expect(active(ledger)).toEqual(['在海边']);
    expect(active(retireFact(ledger, 'ch3', 'posix'))).toEqual(['在城里']);
  });

  it('a backfilled chapter lands in the chain at its reading position, below later superseded versions', () => {
    const facts = [
      existing({ id: 'ch1', value: '在山里', status: 'superseded' }),
      existing({
        id: 'ch3',
        value: '在海边',
        path: '正文/第003章.md',
        status: 'superseded',
        supersedes: 'ch1',
      }),
      existing({ id: 'ch4', value: '在船上', path: '正文/第004章.md', supersedes: 'ch3' }),
    ];
    const result = plan(facts, '正文/第002章.md', [{ value: '在城里' }]);
    expect(result.added[0]).toMatchObject({ supersedes: 'ch1' });
    let ledger = serializeFactLedger(result.ledger, 'posix');
    ledger = retireFact(ledger, 'ch4', 'posix');
    expect(active(ledger)).toEqual(['在海边']);
    expect(active(retireFact(ledger, 'ch3', 'posix'))).toEqual(['在城里']);
  });
});
