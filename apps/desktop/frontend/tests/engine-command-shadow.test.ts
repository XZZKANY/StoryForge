import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectReader } from '@storyforge/engine';
import golden from '../../../../packages/engine/golden/p1-commands.windows.json';
import type { EncodedFile } from '../../../../packages/engine/src/kernel/contextFixture.test-support';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';

const ROOT = golden.synthetic_root;

const fixture = vi.hoisted(() => ({
  reader: null as unknown as ProjectReader,
  appended: [] as { log: string; record: Record<string, unknown> }[],
  reads: 0,
  hangReads: false,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.16' }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { log: string; record: Record<string, unknown> }) => {
    if (command !== 'engine_shadow_append') throw new Error(`unexpected command ${command}`);
    fixture.appended.push(args);
    return true;
  }),
}));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => ({ source: {}, secrets: { values: golden.secrets } }),
  nativeHttpPort: () => ({
    send: async () => {
      throw new Error('the shadow must not reach the network');
    },
  }),
}));
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: {
    resolveProjectPath: (...args: Parameters<ProjectReader['resolveProjectPath']>) =>
      fixture.reader.resolveProjectPath(...args),
    async inspectProjectPath(...args: Parameters<ProjectReader['inspectProjectPath']>) {
      fixture.reads += 1;
      if (fixture.hangReads) await new Promise(() => {});
      return fixture.reader.inspectProjectPath(...args);
    },
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.reader.readProjectBytes(...args),
  },
}));
vi.mock('../src/lib/api/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));
vi.mock('../src/lib/engine/writer', () => ({
  nativeProjectWriter: {
    writeProjectFile: async () => {
      throw new Error('the shadow must not write the project');
    },
  },
}));

type Call = {
  fn: string;
  args: { command_id: string; args: Record<string, unknown> | null };
  output_json?: string;
  writes: Record<string, EncodedFile | null>;
};
const projects = golden.projects as unknown as {
  id: string;
  files: Record<string, EncodedFile>;
  calls: Call[];
}[];

/** `$ROOT` ↔ 合成根。 */
function withRoot(value: unknown): unknown {
  if (typeof value === 'string') return value.split('$ROOT').join(ROOT);
  if (Array.isArray(value)) return value.map(withRoot);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRoot(item)]));
  return value;
}

const checks = () => fixture.appended.filter((item) => item.log === 'checks');
const diffs = () => fixture.appended.filter((item) => item.log === 'diffs');
const load = async () => (await import('../src/lib/engine/commandShadow')).shadowIdeCommand;

/** Python 那一侧：照预言机录下的字节改项目（它写完才回），再交回录下的响应或错误。 */
function python(project: ReturnType<typeof memoryProject>, call: Call) {
  const expected = withRoot(JSON.parse(call.output_json!)) as {
    result?: Record<string, unknown>;
    error?: { status: number; message: string };
  };
  return async () => {
    project.apply(call.writes);
    if (expected.error)
      // HTTP 层：detail 是字符串才原样给作者；422（校验明细）与 500 是「API 返回 N」。
      throw new Error(
        expected.error.status === 500 || expected.error.status === 422
          ? `API 返回 ${expected.error.status}`
          : expected.error.message,
      );
    return expected.result!;
  };
}

beforeAll(async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0.0.0',
  );
  await load();
}, 60_000);
beforeEach(() => {
  fixture.appended = [];
  fixture.reads = 0;
  fixture.hangReads = false;
});
afterEach(() => vi.useRealTimers());

it('replays every recorded Python command through the shadow without a difference', async () => {
  const shadowIdeCommand = await load();
  const outcomes: string[] = [];
  for (const record of projects) {
    const project = memoryProject(ROOT, record.files);
    fixture.reader = project.reader;
    for (const call of record.calls) {
      if (call.fn === 'author_write') {
        project.apply(call.writes);
        continue;
      }
      if (call.fn !== 'command') continue;
      const { command_id: commandId, args } = call.args;
      const before = checks().length;
      const result = await shadowIdeCommand(
        commandId,
        (withRoot(args ?? {}) ?? {}) as Record<string, unknown>,
        python(project, call),
      ).then(
        (value) => value,
        (error: Error) => error,
      );
      expect(result).toBeDefined();
      if (
        call.args.command_id.startsWith('book.breakdown') &&
        commandId !== 'book.breakdown.status'
      )
        continue;
      if (commandId === 'nope') continue;
      await vi.waitFor(() => expect(checks().length).toBe(before + 1), { timeout: 20_000 });
      const check = checks().at(-1)!.record;
      outcomes.push(`${commandId}:${check.outcome}`);
    }
  }
  expect(diffs().map((item) => item.record)).toEqual([]);
  // 每个比对的命令都至少有一次真比上了（不是全落到 unavailable）。
  for (const id of [
    'audit.open',
    'book.context',
    'book.breakdown.status',
    'canon.refresh',
    'observatory.scan',
    'plan.mark_written',
    'plan.unmark_written',
  ])
    expect(outcomes).toContain(`${id}:match`);
}, 120_000);

it('records where the response and the files part ways, without their content', async () => {
  const shadowIdeCommand = await load();
  const record = projects[0];
  const project = memoryProject(ROOT, record.files);
  fixture.reader = project.reader;
  const refresh = record.calls.find(
    (call) =>
      call.fn === 'command' &&
      call.args.command_id === 'canon.refresh' &&
      Object.keys(call.writes).length > 0,
  )!;
  const real = python(project, refresh);
  await shadowIdeCommand('canon.refresh', withRoot(refresh.args.args) as never, async () => {
    const result = await real();
    // 「Python」多报一个实体，并把派生 dossier 写成另一份。
    project.apply({
      '.storyforge/canon/derived/dossier.md': {
        chunks: [{ base64: btoa('changed'), repeat: 1 }],
      },
    });
    const payload = result.payload as { canon: { entity_count: number } };
    return { ...result, payload: { ...payload, canon: { ...payload.canon, entity_count: 99 } } };
  });
  await vi.waitFor(() => expect(diffs()).toHaveLength(1), { timeout: 20_000 });
  const found = diffs()[0].record;
  expect(found).toMatchObject({ surface: 'ide.command', step: 'canon.refresh', outcome: 'diff' });
  expect(found.differences).toEqual([
    { path: 'response', kind: 'value', at: 'payload.canon.entity_count' },
    expect.objectContaining({
      path: '.storyforge/canon/derived/dossier.md',
      kind: 'file',
      python_bytes: 7,
      offset: 0,
    }),
  ]);
  expect(JSON.stringify(found)).not.toContain('changed');
}, 60_000);

it('a Python failure reaches the author unchanged; an unreachable Python is not a difference', async () => {
  const shadowIdeCommand = await load();
  fixture.reader = memoryProject(ROOT, projects[0].files).reader;
  const unreachable = new TypeError('Failed to fetch');
  await expect(
    shadowIdeCommand('book.context', { project_root: ROOT }, async () => {
      throw unreachable;
    }),
  ).rejects.toBe(unreachable);
  await vi.waitFor(() => expect(checks()).toHaveLength(1));
  expect(checks()[0].record).toMatchObject({
    outcome: 'unavailable',
    reason: 'python_unreachable',
  });

  await expect(
    shadowIdeCommand('canon.refresh', {}, async () => {
      throw new Error('canon.refresh 需要 project_root。');
    }),
  ).rejects.toThrow('canon.refresh 需要 project_root。');
  await vi.waitFor(() => expect(checks()).toHaveLength(2));
  expect(checks()[1].record).toMatchObject({ outcome: 'match', python_ok: false, ts_ok: false });

  await expect(
    shadowIdeCommand('canon.refresh', {}, async () => {
      throw new Error('别的文案');
    }),
  ).rejects.toThrow('别的文案');
  await vi.waitFor(() => expect(diffs()).toHaveLength(1));
  expect(diffs()[0].record.differences).toEqual([{ path: 'response', kind: 'error_text' }]);
}, 60_000);

it('commands that call the model or hold Python process state are not compared', async () => {
  const shadowIdeCommand = await load();
  fixture.reader = memoryProject(ROOT, projects[0].files).reader;
  for (const id of ['book.breakdown', 'book.breakdown.cancel']) {
    const answer = { command_id: id, status: 'accepted' };
    expect(await shadowIdeCommand(id, { project_root: ROOT }, async () => answer)).toBe(answer);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fixture.appended).toEqual([]);
  expect(fixture.reads).toBe(0);
});

it('a snapshot that does not come back delays the command by at most the timeout', async () => {
  const { shadowIdeCommand, PREIMAGE_TIMEOUT_MS } = await import('../src/lib/engine/commandShadow');
  fixture.reader = memoryProject(ROOT, projects[0].files).reader;
  fixture.hangReads = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const answer = { command_id: 'book.context', status: 'accepted' };
  let sent = 0;
  const pending = shadowIdeCommand('book.context', { project_root: ROOT }, async () => {
    sent += 1;
    return answer;
  });
  await vi.advanceTimersByTimeAsync(PREIMAGE_TIMEOUT_MS - 1);
  expect(sent).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toBe(answer);
  vi.useRealTimers();
  await vi.waitFor(() => expect(checks()).toHaveLength(1));
  expect(checks()[0].record).toMatchObject({ outcome: 'unavailable', reason: 'preimage_failed' });
});

it('a release build sends IDE commands through the shadow by default, with one Python request', async () => {
  vi.stubEnv('DEV', false);
  const project = memoryProject(ROOT, projects[0].files);
  fixture.reader = project.reader;
  const body = { command_id: 'audit.open', status: 'accepted', audit_event_id: null, payload: {} };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const { executeIdeCommand } = await import('../src/lib/api/ide-commands');
    expect(await executeIdeCommand('audit.open', {})).toEqual(body);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(checks()).toHaveLength(1));
    expect(checks()[0].record).toMatchObject({ surface: 'ide.command', step: 'audit.open' });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
