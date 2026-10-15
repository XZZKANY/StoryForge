import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { scanRegexLines, type ProjectReader } from '@storyforge/engine';
import golden from '../../../../packages/engine/golden/p5-agent-shadow.windows.json';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import {
  nodeLegacySource,
  nodeSqliteDb,
} from '../../../../packages/engine/src/store/nodeSqlite.test-support';
import type { AgentSocketMessage, AgentUserMessageRequest } from '../src/lib/api/types';

type Scenario = (typeof golden.scenarios)[number];

const fixture = vi.hoisted(() => ({
  reader: null as unknown as ProjectReader,
  python: null as unknown as ReturnType<typeof nodeLegacySource>,
  appended: [] as { log: string; record: Record<string, unknown> }[],
  opened: 0,
  closed: 0,
  scratchFails: false,
  scratchHangs: null as null | ((value: unknown) => void),
  sent: 0,
  untouched: [] as string[],
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { log: string; record: Record<string, unknown> }) => {
    if (command !== 'engine_shadow_append') throw new Error(`unexpected command ${command}`);
    fixture.appended.push(args);
    return true;
  }),
}));
// Python 的库是预言机导出的「发送前」那一刻；临时库是 node:sqlite 内存库；引擎库一碰就记下。
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: async () => {
      fixture.untouched.push('engine db');
      throw new Error('the shadow must not touch the engine database');
    },
    transaction: async () => {
      fixture.untouched.push('engine db');
      throw new Error('the shadow must not touch the engine database');
    },
  },
  nativePythonDb: { snapshot: (queries: readonly string[]) => fixture.python.snapshot(queries) },
  nativeScratchDb: async () => {
    if (fixture.scratchFails) throw new Error('临时库已开到上限 4 个');
    if (fixture.scratchHangs)
      await new Promise((resolve) => {
        fixture.scratchHangs = resolve;
      });
    fixture.opened += 1;
    const db = nodeSqliteDb();
    return {
      select: (...args: Parameters<typeof db.select>) => db.select(...args),
      transaction: (...args: Parameters<typeof db.transaction>) => db.transaction(...args),
      close: async () => {
        db.close();
        fixture.closed += 1;
      },
    };
  },
}));
vi.mock('../src/lib/engine/llm', () => ({
  nativeLlmSource: async (slot: string) =>
    slot === 'main'
      ? { source: golden.source, secrets: { values: [golden.source.STORYFORGE_LLM_API_KEY] } }
      : { source: {}, secrets: { values: [] } },
  nativeHttpPort: () => ({
    send: async () => {
      fixture.sent += 1;
      throw new Error('the shadow must not reach the network');
    },
  }),
}));
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: {
    resolveProjectPath: (...args: Parameters<ProjectReader['resolveProjectPath']>) =>
      fixture.reader.resolveProjectPath(...args),
    inspectProjectPath: (...args: Parameters<ProjectReader['inspectProjectPath']>) =>
      fixture.reader.inspectProjectPath(...args),
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.reader.readProjectBytes(...args),
  },
}));
vi.mock('../src/lib/engine/writer', () => ({
  nativeProjectWriter: {
    writeProjectFile: async () => {
      fixture.untouched.push('project file');
    },
  },
}));
vi.mock('../src/lib/engine/regex', () => ({
  workerRegexCompiler: () => (query: string) => {
    const pattern = new RegExp(query, 'u');
    return {
      scan: async (lines: readonly string[], limit: number, remaining: number) =>
        scanRegexLines(
          (line) => pattern.test(line),
          lines,
          limit,
          remaining,
          () => 0,
        ),
    };
  },
}));

const checks = () => fixture.appended.filter((item) => item.log === 'checks');
const diffs = () => fixture.appended.filter((item) => item.log === 'diffs');

function request(scenario: Scenario, userMessage?: string): AgentUserMessageRequest {
  const body = scenario.target.body as {
    user_message: string;
    run_id: string;
    intent?: AgentUserMessageRequest['intent'];
    assistant_session_id?: number;
    permission_profile: AgentUserMessageRequest['permissionProfile'];
    args: Record<string, unknown>;
  };
  // 桌面端的 sessionId 就是 runId，与预言机走的 SSE 路由同一个会话名。
  return {
    sessionId: body.run_id,
    runId: body.run_id,
    userMessage: userMessage ?? body.user_message,
    intent: body.intent,
    assistantSessionId: body.assistant_session_id ?? null,
    permissionProfile: body.permission_profile,
    args: body.args,
  } as AgentUserMessageRequest;
}

const terminal = (scenario: Scenario) =>
  ({ type: 'agent_result', run_id: scenario.target.body.run_id }) as unknown as AgentSocketMessage;

/** Python 那一侧：收到消息时（发送前的快照已经读完）才把它这一轮写的两行落进库。 */
function python(scenario: Scenario, seen: { snapshots: number[] }) {
  return async () => {
    seen.snapshots.push(fixture.python.snapshots);
    for (const row of scenario.python_rows) fixture.python.exec(row);
    return terminal(scenario);
  };
}

async function settled() {
  await vi.waitFor(() => expect(checks()).toHaveLength(1), { timeout: 30_000 });
  await vi.waitFor(() => expect(fixture.closed).toBe(fixture.opened));
  return { check: checks()[0].record, diffs: diffs() };
}

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  // 预言机录在 Windows 上：宿主平台照真实 WebView2 判成 windows（happy-dom 的 userAgent 会判成 posix）。
  if (golden.platform === 'windows')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0.0.0',
    );
  await import('../src/lib/engine/agentShadow');
}, 60_000);

beforeEach(() => {
  Object.assign(fixture, {
    appended: [],
    opened: 0,
    closed: 0,
    scratchFails: false,
    scratchHangs: null,
    sent: 0,
    untouched: [],
  });
});
afterEach(() => localStorage.clear());

const load = async () => (await import('../src/lib/engine/agentShadow')).shadowAgentMessage;

for (const scenario of golden.scenarios) {
  it(`judges the engine's first request equal to Python's: ${scenario.id}`, async () => {
    fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
    fixture.python = nodeLegacySource(scenario.before_sql);
    const seen = { snapshots: [] as number[] };
    const shadowAgentMessage = await load();
    const result = await shadowAgentMessage(request(scenario), python(scenario, seen));

    expect(result).toEqual(terminal(scenario));
    // 发送前已经读完快照：Python 写的行进不了临时库。
    expect(seen.snapshots).toEqual([1]);
    const { check, diffs: found } = await settled();
    expect(check).toMatchObject({
      surface: 'agent.loop',
      outcome: 'match',
      step: scenario.python_step,
      python_digest: scenario.python_digest,
      ts_digest: scenario.python_digest,
    });
    expect(found).toEqual([]);
    expect(fixture.sent).toBe(0);
    expect(fixture.untouched).toEqual([]);
    expect(fixture.opened).toBe(1);
  }, 60_000);
}

it('records where the prompts part ways, without the text', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  fixture.python = nodeLegacySource(scenario.before_sql);
  const shadowAgentMessage = await load();
  // 引擎拿到的作者消息差一个字：差异要落在最后那条用户消息上。
  await shadowAgentMessage(request(scenario, '接着说说伏线'), python(scenario, { snapshots: [] }));
  const { check, diffs: found } = await settled();
  expect(check.outcome).toBe('diff');
  const differences = found[0].record.differences as Record<string, unknown>[];
  expect(differences.length).toBeGreaterThan(0);
  for (const item of differences) {
    expect(item.kind).toBe('text');
    expect(item.path).toMatch(/^messages\[\d+\]\.content$/);
  }
  expect(differences).toContainEqual(expect.objectContaining({ python_span: 1, ts_span: 1 }));
  expect(JSON.stringify(found[0].record)).not.toContain('伏');
}, 60_000);

it('an engine run that fails before its first request records why (the host returns it as an error frame)', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  fixture.python = nodeLegacySource(scenario.before_sql);
  const shadowAgentMessage = await load();
  // 只有引擎看到的那份 args 指向另一个会话：引擎在派发前就判归属冲突。
  const conflicting = request(scenario);
  conflicting.args = { ...conflicting.args, assistant_session_id: 2 };
  const result = await shadowAgentMessage(conflicting, python(scenario, { snapshots: [] }));
  expect(result).toEqual(terminal(scenario));
  const { check, diffs: found } = await settled();
  expect(check).toMatchObject({
    outcome: 'diff',
    python_digest: scenario.python_digest,
    ts_digest: null,
    ts_error: 'AgentErrorFrame',
    ts_detail: 'Agent 会话归属冲突：assistant_session_id 外层=1 args=2。',
  });
  expect(found[0].record.differences).toEqual([{ path: 'request', kind: 'missing_in_ts' }]);
}, 60_000);

it('a scratch database that does not open still sends, and is recorded as missing on the engine side', async () => {
  const scenario = golden.scenarios[0];
  fixture.python = nodeLegacySource(scenario.before_sql);
  fixture.scratchFails = true;
  const shadowAgentMessage = await load();
  const result = await shadowAgentMessage(request(scenario), python(scenario, { snapshots: [] }));
  expect(result).toEqual(terminal(scenario));
  const { check, diffs: found } = await settled();
  expect(check).toMatchObject({ outcome: 'diff', ts_digest: null, ts_error: 'Error' });
  expect(found[0].record.differences).toEqual([{ path: 'request', kind: 'missing_in_ts' }]);
});

it('no Python database on this machine is unavailable, not a difference', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  fixture.python = Object.assign(nodeLegacySource([]), { snapshot: async () => null });
  const shadowAgentMessage = await load();
  await shadowAgentMessage(request(scenario), async () => terminal(scenario));
  const { check, diffs: found } = await settled();
  expect(check).toMatchObject({ outcome: 'unavailable', reason: 'python_db_missing' });
  expect(found).toEqual([]);
});

it('a Python failure reaches the author unchanged, closes the scratch database and compares nothing', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  fixture.python = nodeLegacySource(scenario.before_sql);
  const shadowAgentMessage = await load();
  await expect(
    shadowAgentMessage(request(scenario), async () => {
      throw new Error('Agent 流不属于本次会话');
    }),
  ).rejects.toThrow('Agent 流不属于本次会话');
  await vi.waitFor(() => expect(fixture.closed).toBe(1), { timeout: 30_000 });
  expect(fixture.appended).toEqual([]);
});

it('the Python database going away before the comparison is unavailable, not a difference', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  const legacy = nodeLegacySource(scenario.before_sql);
  const read = legacy.snapshot.bind(legacy);
  let calls = 0;
  fixture.python = Object.assign(legacy, {
    snapshot: async (queries: readonly string[]) => (calls++ === 0 ? read(queries) : null),
  });
  const shadowAgentMessage = await load();
  await shadowAgentMessage(request(scenario), python(scenario, { snapshots: [] }));
  const { check, diffs: found } = await settled();
  expect(check).toMatchObject({ outcome: 'unavailable', reason: 'python_db_missing' });
  expect(found).toEqual([]);
}, 60_000);

it('a hanging scratch database delays the message by at most the preparation timeout', async () => {
  const scenario = golden.scenarios[0];
  fixture.reader = memoryProject(scenario.project_root, scenario.files).reader;
  fixture.python = nodeLegacySource(scenario.before_sql);
  fixture.scratchHangs = () => undefined;
  const { shadowAgentMessage, PREPARE_TIMEOUT_MS } = await import('../src/lib/engine/agentShadow');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const seen = { snapshots: [] as number[] };
    const pending = shadowAgentMessage(request(scenario), python(scenario, seen));
    await vi.advanceTimersByTimeAsync(PREPARE_TIMEOUT_MS - 1);
    expect(seen.snapshots).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual(terminal(scenario));
    const { check } = await settled();
    expect(check).toMatchObject({ outcome: 'diff', ts_error: 'ShadowSetupTimeout' });
    // 临时库后来开起来了，也要关掉。
    (fixture.scratchHangs as unknown as (value: unknown) => void)(undefined);
    await vi.waitFor(() => expect(fixture.opened).toBe(1));
    await vi.waitFor(() => expect(fixture.closed).toBe(1));
  } finally {
    vi.useRealTimers();
  }
}, 60_000);

it('keeps at most 160 characters of an error frame, counted by code point', async () => {
  const { errorDetail } = await import('../src/lib/engine/shadow');
  const long = '𠀀'.repeat(170);
  expect(Array.from(errorDetail(long))).toHaveLength(160);
  expect(errorDetail('短')).toBe('短');
  expect(errorDetail(undefined)).toBe('undefined');
});
