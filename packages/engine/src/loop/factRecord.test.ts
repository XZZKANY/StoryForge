import { describe, expect, it } from 'vitest';
import { InputDomainError, type JsonObject } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { MemoryRunStore } from '../store/runs';
import { prepareChapterFactRecord } from './factRecord';

const ROOT = '/book';
const CHAPTER_2 = '第二章\n\n陈默进了城。\n林舟把铜钥匙交给了陈默。\n';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const CANON = JSON.stringify({
  version: 1,
  entities: [{ id: 'e1', canonical_name: '陈默', aliases: ['老陈'] }],
  invariants: {},
});

const fact = (overrides: JsonObject = {}): JsonObject => ({
  kind: '持有',
  subject: '老陈',
  attribute: '物件',
  value: '铜钥匙',
  object: null,
  quote: '林舟把铜钥匙交给了陈默。',
  ...overrides,
});

async function setup(options: { newFacts?: unknown; target?: string; chapter?: string } = {}) {
  const project = memoryProject(ROOT, {
    '正文/第001章.md': file('第一章\n\n陈默在山里。\n'),
    '正文/第002章.md': file(options.chapter ?? CHAPTER_2),
    '.storyforge/canon/canon.json': file(CANON),
  });
  const store = new MemoryRunStore();
  const run = await store.insertRun({
    public_id: 'run-1',
    session_id: 's',
    assistant_session_id: 1,
    goal: '',
    scope: {},
    permission_profile: 'ask',
    budget: {},
    status: 'completed',
    root_plan: [],
    current_step: 'completed',
  });
  await store.insertArtifact({
    run_id: run.id,
    kind: 'chapter_brief',
    payload: { target_path: options.target ?? '正文/第002章.md' },
    requires_confirmation: false,
  });
  if (options.newFacts !== null)
    await store.insertArtifact({
      run_id: run.id,
      kind: 'chapter_check',
      payload: {
        status: 'pass',
        ...(options.newFacts === undefined ? {} : { new_facts: options.newFacts }),
      },
      requires_confirmation: false,
    });
  let next = 0;
  const deps = {
    reader: project.reader,
    store,
    platform: 'posix' as const,
    now: () => new Date('2026-10-18T09:00:00.123Z'),
    newHex: () => `${String(++next).padStart(4, '0')}${'ab'.repeat(14)}`,
  };
  const record = (ledgerText: string | null = null, runId = 'run-1') =>
    prepareChapterFactRecord(deps, {
      project_root: ROOT,
      file_path: `${ROOT}/正文/第002章.md`,
      run_id: runId,
      ledger_text: ledgerText,
    });
  return { record };
}

describe('recording an accepted chapter into the fact ledger', () => {
  it('turns the check facts into a new ledger the desktop can write', async () => {
    const { record } = await setup({ newFacts: [fact()] });
    const result = await record();
    expect(result).toMatchObject({
      status: 'ready',
      chapter_path: '正文/第002章.md',
      chapter_ordinal: 2,
      added: 1,
      superseded: 0,
      duplicates: 0,
      unverified: 0,
      conflicts: [],
      before: null,
    });
    const ledger = JSON.parse(result.after as string);
    expect(ledger.facts).toEqual([
      {
        id: 'fact_0001abababab',
        kind: '持有',
        subject: '陈默',
        attribute: '物件',
        value: '铜钥匙',
        object: null,
        path: '正文/第002章.md',
        status: 'active',
        supersedes: null,
        assertion_type: 'text_observation',
        recorded_by: 'auto',
        evidence: [{ path: '正文/第002章.md', quote: '林舟把铜钥匙交给了陈默。', start_line: 4 }],
        recorded_at: '2026-10-18T09:00:00Z',
      },
    ]);
  });

  it('drops facts whose quote the author edited away before accepting', async () => {
    const { record } = await setup({
      newFacts: [
        fact(),
        fact({ kind: '处境', attribute: '下落', value: '在城里', quote: '陈默进了城门。' }),
      ],
    });
    const result = await record();
    expect(result).toMatchObject({ added: 1, unverified: 1 });
  });

  it('records a conflicting fixed fact as disputed and reports it', async () => {
    const ledger = JSON.stringify({
      version: 1,
      facts: [
        {
          id: 'fact_x',
          kind: '关系',
          subject: '陈默',
          attribute: '兄弟姐妹',
          value: '独子',
          object: null,
          path: '正文/第001章.md',
          status: 'active',
        },
      ],
    });
    const { record } = await setup({
      newFacts: [
        fact({ kind: '关系', attribute: '兄弟姐妹', value: '有个姐姐', quote: '陈默进了城。' }),
      ],
    });
    const result = await record(ledger);
    expect(result).toMatchObject({
      status: 'ready',
      added: 0,
      conflicts: [
        {
          kind: '关系',
          subject: '老陈',
          attribute: '兄弟姐妹',
          value: '有个姐姐',
          quote: '陈默进了城。',
          existing_id: 'fact_x',
          existing_value: '独子',
          existing_path: '正文/第001章.md',
          existing_ordinal: 1,
        },
      ],
    });
    const facts = JSON.parse(result.after as string).facts;
    expect(facts.map((item: { id: string; status: string }) => item.status)).toEqual([
      'active',
      'disputed',
    ]);
    expect(facts[1]).toMatchObject({ value: '有个姐姐', disputes: 'fact_x', subject: '陈默' });
  });

  it('changes nothing when every fact is already known', async () => {
    const { record } = await setup({ newFacts: [fact()] });
    const first = await record();
    const second = await record(first.after as string);
    expect(second).toMatchObject({ status: 'unchanged', duplicates: 1, added: 0 });
  });

  it('re-records a reworded chapter by refreshing the quote, so drafting can still use the fact', async () => {
    const first = await (await setup({ newFacts: [fact()] })).record();
    const reworded = '第二章\n\n陈默进了城。\n林舟将铜钥匙递给了陈默。\n';
    const { record } = await setup({
      chapter: reworded,
      newFacts: [fact({ quote: '林舟将铜钥匙递给了陈默。' })],
    });
    const second = await record(first.after as string);
    expect(second).toMatchObject({ status: 'ready', duplicates: 1, added: 0 });
    const [kept] = JSON.parse(second.after as string).facts as JsonObject[];
    expect(kept.evidence).toEqual([
      { path: '正文/第002章.md', quote: '林舟将铜钥匙递给了陈默。', start_line: 4 },
    ]);
  });

  it.each([
    ['no_run', { runId: 'run-x' }],
    ['no_facts', { newFacts: undefined }],
    ['no_facts', { newFacts: null }],
    ['other_file', { target: '正文/第003章.md', newFacts: [] }],
  ])('skips with %s', async (reason, options) => {
    const { record } = await setup(options as never);
    expect(await record(null, (options as { runId?: string }).runId)).toEqual({
      status: 'skipped',
      reason,
    });
  });

  it('refuses to plan over a broken ledger', async () => {
    const { record } = await setup({ newFacts: [fact()] });
    await expect(record('{"facts": [{"id": 1}]}')).rejects.toThrow(InputDomainError);
  });
});
