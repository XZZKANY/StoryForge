import { describe, expect, it } from 'vitest';
import { InputDomainError, type JsonObject } from './json';
import { memoryProject } from './memoryProject.test-support';
import { retireFact } from './factLedger';
import { buildFactLedgerView } from './factLedgerView';
import { runObservatoryScan } from './observatory';

const ROOT = '/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const CHAPTERS = {
  '正文/第001章.md': '第一章\n\n陈默在山里。\n他七岁那年父亲死了。\n',
  '正文/第002章.md': '第二章\n\n陈默进了城。\n',
};
const fact = (id: string, path: string, quote: string, overrides: JsonObject = {}): JsonObject => ({
  id,
  kind: '处境',
  subject: '陈默',
  attribute: '下落',
  value: '在山里',
  object: null,
  path,
  status: 'active',
  supersedes: null,
  recorded_by: 'auto',
  evidence: [{ path, quote, start_line: 3 }],
  ...overrides,
});
const LEDGER = [
  fact('a', '正文/第001章.md', '陈默在山里。', { status: 'superseded' }),
  fact('b', '正文/第001章.md', '他七岁那年父亲死了。', {
    kind: '数值',
    attribute: '父亲死时年龄',
    value: '七岁',
  }),
  fact('c', '正文/第002章.md', '陈默进了城。', { value: '在城里', supersedes: 'a' }),
  fact('d', '正文/第002章.md', '陈默进了城门。', { kind: '持有', attribute: '', value: '钥匙' }),
  fact('e', '正文/第001章.md', '陈默在山里。', { status: 'retired' }),
];

function project(ledger: JsonObject[] | string | null) {
  const files: Record<string, ReturnType<typeof file>> = {};
  for (const [path, text] of Object.entries(CHAPTERS)) files[path] = file(text);
  if (ledger !== null)
    files['.storyforge/canon/facts.json'] = file(
      typeof ledger === 'string' ? ledger : JSON.stringify({ version: 1, facts: ledger }),
    );
  return memoryProject(ROOT, files);
}

describe('fact ledger view for the observatory', () => {
  it('is absent without a ledger', async () => {
    expect(await buildFactLedgerView(project(null).reader, ROOT, 'posix')).toBeNull();
  });

  it('reports a broken ledger instead of hiding it', async () => {
    const view = await buildFactLedgerView(project('{"facts": [{}]}').reader, ROOT, 'posix');
    expect(view).toEqual({ error: expect.stringContaining('facts[0].id') });
  });

  it('lists active facts by chapter, latest first, and flags lost evidence', async () => {
    const view = await buildFactLedgerView(project(LEDGER).reader, ROOT, 'posix');
    expect(view).toEqual({
      active: 3,
      stale: 1,
      superseded: 1,
      retired: 1,
      chapters: [
        {
          path: '正文/第002章.md',
          ordinal: 2,
          facts: [
            expect.objectContaining({ id: 'c', value: '在城里', valid: true, line: 3 }),
            expect.objectContaining({ id: 'd', value: '钥匙', valid: false, line: 3 }),
          ],
        },
        {
          path: '正文/第001章.md',
          ordinal: 1,
          facts: [
            {
              id: 'b',
              kind: '数值',
              subject: '陈默',
              attribute: '父亲死时年龄',
              value: '七岁',
              object: null,
              quote: '他七岁那年父亲死了。',
              line: 4,
              valid: true,
              recorded_by: 'auto',
            },
          ],
        },
      ],
      disputed: [],
    });
  });

  it('puts disputed facts beside what was recorded', async () => {
    const ledger = [
      fact('b', '正文/第001章.md', '他七岁那年父亲死了。', { kind: '数值', value: '七岁' }),
      fact('x', '正文/第002章.md', '陈默进了城。', {
        kind: '数值',
        value: '八岁',
        status: 'disputed',
        disputes: 'b',
      }),
    ];
    const view = await buildFactLedgerView(project(ledger).reader, ROOT, 'posix');
    expect(view).toMatchObject({ active: 1 });
    expect(view?.disputed).toEqual([
      {
        id: 'x',
        kind: '数值',
        subject: '陈默',
        attribute: '下落',
        value: '八岁',
        quote: '陈默进了城。',
        line: 3,
        path: '正文/第002章.md',
        ordinal: 2,
        existing: {
          value: '七岁',
          path: '正文/第001章.md',
          ordinal: 1,
          quote: '他七岁那年父亲死了。',
        },
      },
    ]);
  });

  it('keeps facts whose chapter file is gone, without an ordinal', async () => {
    const view = await buildFactLedgerView(
      project([fact('z', '正文/第009章.md', '不在了')]).reader,
      ROOT,
      'posix',
    );
    expect(view?.chapters).toEqual([
      {
        path: '正文/第009章.md',
        ordinal: null,
        facts: [expect.objectContaining({ valid: false })],
      },
    ]);
  });

  it('rides along in the observatory scan only when a ledger exists', async () => {
    const scan = async (ledger: JsonObject[] | null) => {
      const book = project(ledger);
      return runObservatoryScan(book.reader, book.writer, ROOT, {
        platform: 'posix',
        now: () => new Date('2026-10-18T00:00:00Z'),
      });
    };
    expect('facts' in (await scan(null))).toBe(false);
    expect((await scan(LEDGER)).facts).toMatchObject({ active: 3, stale: 1 });
  });
});

describe('retiring a fact', () => {
  const text = JSON.stringify({ version: 1, facts: LEDGER, note: '作者的备注' });

  it('retires it and brings back the state it had replaced', () => {
    const next = JSON.parse(retireFact(text, 'c', 'posix'));
    expect(next.note).toBe('作者的备注');
    expect(next.facts.map((item: JsonObject) => [item.id, item.status])).toEqual([
      ['a', 'active'],
      ['b', 'active'],
      ['c', 'retired'],
      ['d', 'active'],
      ['e', 'retired'],
    ]);
  });

  it('leaves the replaced state alone when it was not superseded', () => {
    const ledger = JSON.stringify({
      version: 1,
      facts: [fact('a', 'x', 'q', { status: 'retired' }), fact('c', 'y', 'q', { supersedes: 'a' })],
    });
    const next = JSON.parse(retireFact(ledger, 'c', 'posix'));
    expect(next.facts.map((item: JsonObject) => item.status)).toEqual(['retired', 'retired']);
  });

  it('refuses unknown or inactive facts', () => {
    expect(() => retireFact(text, 'nope', 'posix')).toThrow(InputDomainError);
    expect(() => retireFact(text, 'a', 'posix')).toThrow('没有这条有效事实');
    expect(() => retireFact(null, 'a', 'posix')).toThrow(InputDomainError);
  });

  it('writes CRLF on windows', () => {
    expect(retireFact(text, 'b', 'windows')).toContain('\r\n  "version": 1,');
  });
});
