import { describe, expect, it } from 'vitest';
import { InputDomainError } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { checkPrompt } from './chapterCheckProtocol';
import {
  MAX_BACKFILL_CHAPTERS,
  prepareFactBackfill,
  unrecordedChapters,
  type FactModel,
} from './factBackfill';

const ROOT = '/book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const CH1 = '第一章\n\n陈默是家里的独子。\n他住在山里。\n';
const CH2 = '第二章\n\n陈默想起了姐姐。\n他搬进了城。\n';

function book(extra: Record<string, string> = {}) {
  const files: Record<string, ReturnType<typeof file>> = {
    '正文/第001章.md': file(CH1),
    '正文/第002章.md': file(CH2),
    '正文/第003章.md': file('  \n'),
  };
  for (const [path, text] of Object.entries(extra)) files[path] = file(text);
  return memoryProject(ROOT, files);
}

const reply = (facts: unknown[]) => JSON.stringify({ new_facts: facts });
const FACTS: Record<string, unknown[]> = {
  [CH1]: [
    {
      kind: '关系',
      subject: '陈默',
      attribute: '兄弟姐妹',
      value: '独子',
      object: null,
      quote: '陈默是家里的独子。',
    },
    {
      kind: '处境',
      subject: '陈默',
      attribute: '下落',
      value: '在山里',
      object: null,
      quote: '他住在山里。',
    },
  ],
  [CH2]: [
    {
      kind: '关系',
      subject: '陈默',
      attribute: '兄弟姐妹',
      value: '有个姐姐',
      object: null,
      quote: '陈默想起了姐姐。',
    },
    {
      kind: '处境',
      subject: '陈默',
      attribute: '下落',
      value: '在城里',
      object: null,
      quote: '他搬进了城。',
    },
    {
      kind: '持有',
      subject: '陈默',
      attribute: '',
      value: '钥匙',
      object: null,
      quote: '编出来的原句。',
    },
  ],
};

function scripted(answer: (content: string) => string | Error) {
  const prompts: string[] = [];
  const callModel: FactModel = async ({ userPrompt }) => {
    prompts.push(userPrompt);
    const content = userPrompt.slice(userPrompt.indexOf('正文：\n') + '正文：\n'.length);
    const result = answer(content);
    if (result instanceof Error) throw result;
    return { content: result };
  };
  return { prompts, callModel };
}

function deps(project: ReturnType<typeof book>, callModel: FactModel) {
  let next = 0;
  return {
    reader: project.reader,
    platform: 'posix' as const,
    now: () => new Date('2026-10-18T09:00:00.000Z'),
    newHex: () => `${String(++next).padStart(4, '0')}${'cd'.repeat(14)}`,
    callModel,
  };
}

describe('chapters still missing from the ledger', () => {
  it('lists every chapter with text when there is no ledger, in reading order', async () => {
    expect(await unrecordedChapters(book().reader, ROOT, 'posix')).toEqual([
      { path: '正文/第001章.md', ordinal: 1 },
      { path: '正文/第002章.md', ordinal: 2 },
    ]);
  });

  it('drops chapters that already have any fact recorded', async () => {
    const ledger = JSON.stringify({
      version: 1,
      facts: [
        {
          id: 'f',
          kind: '处境',
          subject: '陈默',
          value: 'x',
          path: '正文/第001章.md',
          status: 'retired',
        },
      ],
    });
    const project = book({ '.storyforge/canon/facts.json': ledger });
    expect(await unrecordedChapters(project.reader, ROOT, 'posix')).toEqual([
      { path: '正文/第002章.md', ordinal: 2 },
    ]);
  });
});

describe('backfilling old chapters', () => {
  it('extracts each chapter once, checks quotes, and records them in reading order', async () => {
    const { prompts, callModel } = scripted((content) => reply(FACTS[content] ?? []));
    const progress: [number, number, string][] = [];
    const result = await prepareFactBackfill(
      deps(book(), callModel),
      { project_root: ROOT, ledger_text: null, paths: ['正文/第002章.md', '正文/第001章.md'] },
      (done, total, path) => progress.push([done, total, path]),
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(CH1);
    expect(progress).toEqual([
      [0, 2, '正文/第001章.md'],
      [1, 2, '正文/第002章.md'],
      [2, 2, ''],
    ]);
    expect(result).toMatchObject({
      status: 'ready',
      added: 3,
      before: null,
      chapters: [
        {
          path: '正文/第001章.md',
          ordinal: 1,
          status: 'done',
          added: 2,
          unverified: 0,
          conflicts: [],
        },
        {
          path: '正文/第002章.md',
          ordinal: 2,
          status: 'done',
          added: 1,
          unverified: 1,
          conflicts: [
            expect.objectContaining({
              value: '有个姐姐',
              existing_value: '独子',
              existing_ordinal: 1,
            }),
          ],
        },
      ],
    });
    const ledger = JSON.parse(result.after as string);
    expect(
      ledger.facts.map((fact: { value: string; status: string }) => [fact.value, fact.status]),
    ).toEqual([
      ['独子', 'active'],
      ['在山里', 'superseded'],
      ['有个姐姐', 'disputed'],
      ['在城里', 'active'],
    ]);
    expect(ledger.facts[0]).toMatchObject({
      path: '正文/第001章.md',
      recorded_by: 'auto',
      evidence: [{ path: '正文/第001章.md', quote: '陈默是家里的独子。', start_line: 3 }],
      recorded_at: '2026-10-18T09:00:00Z',
    });
  });

  it('uses the same extraction instruction as the chapter check', async () => {
    const { prompts, callModel } = scripted(() => reply([]));
    await prepareFactBackfill(deps(book(), callModel), {
      project_root: ROOT,
      ledger_text: null,
      paths: ['正文/第001章.md'],
    });
    const check = checkPrompt({}, '正文');
    const spec = check.slice(
      check.indexOf('另输出 ') + '另输出 '.length,
      check.indexOf('\n检查源：'),
    );
    expect(prompts[0]).toContain(`输出 ${spec}\n正文：\n${CH1}`);
  });

  it('keeps going when one chapter fails, and changes nothing when nothing new was found', async () => {
    const { callModel } = scripted((content) =>
      content === CH1 ? new Error('额度用完了') : '这不是 JSON',
    );
    const result = await prepareFactBackfill(deps(book(), callModel), {
      project_root: ROOT,
      ledger_text: null,
      paths: ['正文/第001章.md', '正文/第002章.md', '正文/不存在.md'],
    });
    expect(result).toEqual({
      status: 'unchanged',
      added: 0,
      chapters: [
        { path: '正文/第001章.md', ordinal: 1, status: 'failed', message: '额度用完了' },
        {
          path: '正文/第002章.md',
          ordinal: 2,
          status: 'failed',
          message: '模型的回复不是有效 JSON。',
        },
      ],
    });
  });

  it(`does at most ${MAX_BACKFILL_CHAPTERS} chapters per run`, async () => {
    const extra: Record<string, string> = {};
    for (let index = 4; index <= MAX_BACKFILL_CHAPTERS + 5; index++)
      extra[`正文/第${String(index).padStart(3, '0')}章.md`] = `第${index}章\n\n正文。\n`;
    const project = book(extra);
    const { prompts, callModel } = scripted(() => reply([]));
    const paths = (await unrecordedChapters(project.reader, ROOT, 'posix')).map(
      (chapter) => chapter.path as string,
    );
    const result = await prepareFactBackfill(deps(project, callModel), {
      project_root: ROOT,
      ledger_text: null,
      paths,
    });
    expect(prompts).toHaveLength(MAX_BACKFILL_CHAPTERS);
    expect((result.chapters as unknown[]).length).toBe(MAX_BACKFILL_CHAPTERS);
  });

  it('refuses to plan over a broken ledger', async () => {
    const { callModel } = scripted(() => reply([]));
    await expect(
      prepareFactBackfill(deps(book(), callModel), {
        project_root: ROOT,
        ledger_text: '{"facts": [1]}',
        paths: ['正文/第001章.md'],
      }),
    ).rejects.toThrow(InputDomainError);
  });
});

describe('backfilling into an existing ledger', () => {
  it('writes a chapter whose only news is a disputed fact', async () => {
    const ledger = JSON.stringify({
      version: 1,
      facts: [
        {
          id: 'fact_old',
          kind: '关系',
          subject: '陈默',
          attribute: '兄弟姐妹',
          value: '独子',
          path: '正文/第001章.md',
          status: 'active',
        },
      ],
    });
    const { callModel } = scripted(() => reply([FACTS[CH2][0]]));
    const result = await prepareFactBackfill(deps(book(), callModel), {
      project_root: ROOT,
      ledger_text: ledger,
      paths: ['正文/第002章.md'],
    });
    expect(result).toMatchObject({ status: 'ready', added: 0, before: ledger });
    const facts = JSON.parse(result.after as string).facts;
    expect(facts[1]).toMatchObject({ value: '有个姐姐', status: 'disputed', disputes: 'fact_old' });
  });
});
