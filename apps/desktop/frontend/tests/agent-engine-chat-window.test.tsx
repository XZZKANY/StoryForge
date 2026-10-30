import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  migrateEngineDb,
  scanRegexLines,
  type Db,
  type HttpPort,
  type ProjectReader,
  type ProjectWriter,
} from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { getAgentRunEvents, getAgentRunSavePoints } from '../src/lib/api/agent-runs';
import { sendAgentControlMessage } from '../src/lib/api/agent-socket';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 帧与回包按 JSON 形状读

/**
 * ChatWindow 的作者路径走 ts 档：真实的 hooks → agent-socket 分流 → 进程内宿主 → 引擎循环。
 * 只替身原生端口（读写口、模型出网）与 Python 会话库的 HTTP 接口；其余全是真代码。
 */
const fixture = vi.hoisted(() => ({
  reader: null as unknown as ProjectReader,
  writer: null as unknown as ProjectWriter,
  replies: [] as { reply: Reply | ((body: Obj) => Reply); before?: () => Promise<void> }[],
  requests: [] as Obj[],
  /** 下一次读文件字节之前执行一次（工具正在跑时发控制）。 */
  beforeRead: null as null | (() => Promise<void>),
  /** 只拦这个项目相对路径的读取；发请求前比对补丁写盘状态的读取不算。 */
  beforeReadPath: null as string | null,
  /** 引擎库：模块重置（模拟重启）后仍是同一个库。 */
  db: null as Db | null,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (...args: Parameters<Db['select']>) => fixture.db!.select(...args),
    transaction: (...args: Parameters<Db['transaction']>) => fixture.db!.transaction(...args),
  },
}));
vi.mock('./support/http-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./support/http-config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(async () => ({
    projectRoot: 'D:/book',
    currentFile: null,
    files: [],
    summary: { hasStoryStructure: true, counts: {} },
    budget: {
      fileCount: 0,
      charCount: 0,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  })),
}));
vi.mock('../src/lib/engine/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/assistant')>()),
  platform: () => 'windows' as const,
}));
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: new Proxy({} as ProjectReader, {
    get: (_target, key) =>
      key === 'readProjectBytes'
        ? async (...args: Parameters<ProjectReader['readProjectBytes']>) => {
            const watched = fixture.beforeReadPath;
            if (watched === null || args[1].replace(/\\/g, '/').endsWith(watched)) {
              const hook = fixture.beforeRead;
              fixture.beforeRead = null;
              await hook?.();
            }
            return fixture.reader.readProjectBytes(...args);
          }
        : (fixture.reader as unknown as Obj)[key as string],
  }),
}));
vi.mock('../src/lib/engine/writer', () => ({
  nativeProjectWriter: {
    writeProjectFile: (...args: Parameters<ProjectWriter['writeProjectFile']>) =>
      fixture.writer.writeProjectFile(...args),
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
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async (slot: string) => ({
    source:
      slot === 'main'
        ? {
            STORYFORGE_LLM_PROVIDER: 'openai',
            STORYFORGE_LLM_BASE_URL: 'https://llm.test/v1',
            STORYFORGE_LLM_API_BASE_URL: 'https://llm.test/v1',
            STORYFORGE_LLM_MODEL: 'm-1',
            STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
            STORYFORGE_LLM_TIMEOUT_SECONDS: '60',
            STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
          }
        : {
            STORYFORGE_LLM_PROVIDER: '',
            STORYFORGE_LLM_BASE_URL: '',
            STORYFORGE_LLM_API_BASE_URL: '',
            STORYFORGE_LLM_MODEL: '',
            STORYFORGE_LLM_API_KEY: '',
          },
    secrets: { values: ['[已隐藏的密钥]'] },
  }),
  nativeHttpPort: (): HttpPort => ({
    async send(request) {
      const body = JSON.parse(new TextDecoder().decode(request.body!));
      fixture.requests.push(body);
      const next = fixture.replies.shift();
      if (!next) throw new Error('模型脚本已用完');
      await next.before?.();
      // 流式请求回 SSE，非流式（例如续跑没有文本观察者）回整包 JSON。
      const reply = typeof next.reply === 'function' ? next.reply(body) : next.reply;
      const raw = new TextEncoder().encode(body.stream === true ? sse(reply) : completion(reply));
      return {
        status: 200,
        headers: {},
        body: (async function* () {
          yield raw;
        })(),
        close() {},
      };
    },
  }),
}));

type Reply = { chunks: string[]; calls: [string, string, Obj][] };
/** 一次模型回复：正文分段与工具调用；按请求要不要流式编码成 SSE 或整包 JSON。 */
function streamed(chunks: string[], calls: [string, string, Obj][] = []): Reply {
  return { chunks, calls };
}
const USAGE = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 };
const finish = (calls: Reply['calls']) => (calls.length ? 'tool_calls' : 'stop');
const toolCall = ([id, name, args]: Reply['calls'][number]) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
function completion({ chunks, calls }: Reply) {
  const message: Obj = { role: 'assistant', content: chunks.join('') };
  if (calls.length) message.tool_calls = calls.map(toolCall);
  return JSON.stringify({
    id: 'resp-1',
    choices: [{ index: 0, message, finish_reason: finish(calls) }],
    usage: USAGE,
  });
}
function sse({ chunks, calls }: Reply) {
  const events: Obj[] = chunks.map((content) => ({ choices: [{ index: 0, delta: { content } }] }));
  calls.forEach((call, index) =>
    events.push({
      choices: [{ index: 0, delta: { tool_calls: [{ index, ...toolCall(call) }] } }],
    }),
  );
  events.push({ choices: [{ index: 0, delta: {}, finish_reason: finish(calls) }] });
  events.push({ choices: [], usage: USAGE });
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}

const FILES = {
  '正文/第001章.md': '第一章 风起\n\n林舟推开门。\n',
  '人物/主角.md': '# 林舟\n\n左臂有旧伤。\n',
};
const NL = String.fromCharCode(10);
const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
/** ts 档的会话也在引擎库：任何发给 Python 的请求都是错的。 */
const pythonGuard = vi.fn(async (url: string, init: RequestInit = {}) => {
  throw new Error(`ts 档不该打到 Python：${init.method ?? 'GET'} ${new URL(url).pathname}`);
});
const engineRows = async (sql: string) =>
  (await fixture.db!.select(sql)).map((row) => ({ ...row }));
let current: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
  recovery: ReturnType<typeof useAgentRunRecovery>;
  controls: ReturnType<typeof useAgentRunControls>;
};

function Harness({ profile }: { profile: AgentPermissionProfile }) {
  const state = useChatWindowState({
    projectPath: 'D:/book',
    currentFile: null,
    assistantSessionId: 7,
  });
  const recovery = useAgentRunRecovery(state, undefined);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const run = useRunAuthorAgent(
    state,
    onEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    undefined,
    profile,
  );
  const controls = useAgentRunControls(state, run, onEvent, recovery);
  current = { state, run, recovery, controls };
  return null;
}

async function mount(profile: AgentPermissionProfile = 'ask') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness profile={profile} />));
}

beforeEach(async () => {
  // 引擎库在整个文件里共用（run 存储有镜像，不能清 run 表）；会话三表每条用例重来，放回会话 7。
  fixture.db ??= nodeSqliteDb();
  await migrateEngineDb(fixture.db);
  await fixture.db.transaction([
    { sql: 'DELETE FROM assistant_tool_calls' },
    { sql: 'DELETE FROM assistant_messages' },
    { sql: 'DELETE FROM assistant_sessions' },
    {
      sql:
        'INSERT INTO assistant_sessions (id, title, task_type, project_path, created_at, updated_at) ' +
        "VALUES (7, '新的创作会话', 'ide_agent_orchestration', 'D:/book', '2026-10-14 00:00:00', '2026-10-14 00:00:00')",
    },
  ]);
  const project = memoryProject(
    'D:/book',
    Object.fromEntries(Object.entries(FILES).map(([path, text]) => [path, encoded(text)])),
  );
  fixture.reader = project.reader;
  fixture.writer = project.writer;
  fixture.replies = [];
  fixture.requests = [];
  fixture.beforeRead = null;
  fixture.beforeReadPath = null;
  vi.stubGlobal('fetch', pythonGuard);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const revise = () =>
  fixture.replies.push(
    {
      reply: streamed(
        [],
        [['c1', 'file_revise', { path: '正文/第001章.md', instruction: '把开门写得更有力' }]],
      ),
    },
    { reply: streamed(['第一章 风起\n\n林舟一脚踹开了门。\n']) },
    { reply: streamed(['改好了，等你确认。']) },
  );

describe('ChatWindow author path on the TS engine', () => {
  it('streams an answer, settles the run and leaves replayable events', async () => {
    fixture.replies.push({ reply: streamed(['第一章', '节奏很紧。']) });
    await mount();
    await act(async () => current.run('第一章怎么样', 'agent'));
    const run = current.state.agentRun!;
    expect(run.status).toBe('completed');
    expect(current.state.agentBusy).toBe(false);
    expect(current.state.messages.at(-1)).toMatchObject({ role: 'assistant' });
    expect(JSON.stringify(current.state.messages.at(-1))).toContain('第一章节奏很紧。');
    expect(fixture.requests).toHaveLength(1);
    expect(
      await engineRows('SELECT role FROM assistant_messages WHERE session_id = 7 ORDER BY id'),
    ).toEqual([{ role: 'user' }, { role: 'assistant' }]);
    // 断线重建读的是引擎自己的事件表（按 run 归属分流），重建出同一个终态。
    const events = await getAgentRunEvents(run.id);
    const replay = reconstructAgentResultFromEvents(events, {
      sessionId: run.sessionId,
      runId: run.id,
    });
    expect(replay).toMatchObject({ type: 'agent_result', run_id: run.id });
    expect((await getAgentRunSavePoints(run.id)).status).toBe('completed');
  });

  it('runs tools in the loop and shows their traces', async () => {
    fixture.replies.push(
      { reply: streamed([], [['c1', 'fs_read', { path: '人物/主角.md' }]]) },
      { reply: streamed(['看过人物了。']) },
    );
    await mount();
    await act(async () => current.run('先读人物再答', 'agent'));
    expect(current.state.agentRun?.status).toBe('completed');
    expect(fixture.requests).toHaveLength(2);
    // 第二轮请求里带着工具结果（读到的正文）。
    expect(JSON.stringify(fixture.requests[1].messages)).toContain('左臂有旧伤');
    expect(JSON.stringify(current.state.agentRun?.steps)).toContain('fs.read');
    expect(
      await engineRows('SELECT tool_name FROM assistant_tool_calls WHERE session_id = 7'),
    ).toContainEqual({ tool_name: 'fs.read' });
  });

  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  /**
   * 请求进行中发控制：act 作用域里 React 推迟重渲染，界面按钮此刻还捏着首帧的状态（没有 run），
   * 所以直接走同一个分流入口；run id 取钩子同步写好的 ref（桌面端 sessionId 即 runId）。
   */
  const controlInFlight = async (type: 'pause_run' | 'stop_run') => {
    const runId = current.state.agentRunIdRef.current!;
    const ack = await sendAgentControlMessage({
      sessionId: runId,
      runId,
      type,
      payload: { source: 'desktop.timeline' },
    });
    expect(ack).toMatchObject({ type, control_effect: 'requested', runtime_state: 'in_flight' });
  };

  it('pauses while a tool runs and resumes from the in-memory checkpoint', async () => {
    fixture.replies.push(
      { reply: streamed([], [['c1', 'fs_read', { path: '人物/主角.md' }]]) },
      { reply: streamed(['读完了。']) },
    );
    fixture.beforeReadPath = '人物/主角.md';
    fixture.beforeRead = () => controlInFlight('pause_run');
    await mount();
    await act(async () => current.run('读人物再答', 'agent'));
    expect(current.state.agentRun?.status).toBe('paused');
    expect(fixture.requests).toHaveLength(1);
    const runId = current.state.agentRun!.id;
    expect((await getAgentRunSavePoints(runId)).recoverability).toMatchObject({
      resume_strategy: 'continue_checkpoint',
      can_resume: true,
    });
    await act(async () => current.recovery.refreshAgentRunRecovery(runId));
    await act(async () => {
      current.controls.agentRunControls.onResumeRun?.();
      await settle();
    });
    expect(fixture.requests).toHaveLength(2);
    expect(current.state.agentRun?.status).toBe('completed');
    expect(JSON.stringify(current.state.messages)).toContain('读完了。');
  });

  it('cannot resume a pause that cut a model stream (outcome unknown)', async () => {
    fixture.replies.push({
      reply: streamed([], [['c1', 'fs_list', {}]]),
      before: () => controlInFlight('pause_run'),
    });
    await mount();
    await act(async () => current.run('先列目录再答', 'agent'));
    expect(current.state.agentRun?.status).toBe('paused');
    const projection = await getAgentRunSavePoints(current.state.agentRun!.id);
    expect(projection.recoverability).toMatchObject({
      resume_strategy: 'reconciliation_required',
      can_resume: false,
    });
    expect(projection.runtime_recovery.checkpoint_resume.reason).toBe('model_outcome_unknown');
  });

  it('stops in flight from the control', async () => {
    fixture.replies.push({
      reply: streamed(['答到一半']),
      before: () => controlInFlight('stop_run'),
    });
    await mount();
    await act(async () => current.run('停下', 'agent'));
    expect(current.state.agentRun?.status).toBe('stopped');
    expect(current.state.agentBusy).toBe(false);
    expect((await getAgentRunSavePoints(current.state.agentRun!.id)).status).toBe('stopped');
  });

  it.each([
    ['onApprovePermission', 'completed'],
    ['onDenyPermission', 'failed'],
  ] as const)('waits for the author on a patch and settles on %s', async (method, status) => {
    revise();
    await mount('ask');
    await act(async () => current.run('改一下第一章开门那句', 'agent'));
    expect(fixture.requests).toHaveLength(3);
    expect(current.state.agentRun?.status).toBe('waiting');
    const runId = current.state.agentRun!.id;
    expect((await getAgentRunSavePoints(runId)).pending).toMatchObject({
      permission_required: true,
    });
    await act(async () => {
      current.controls.agentRunControls[method]?.();
      await settle();
    });
    expect((await getAgentRunSavePoints(runId)).status).toBe(status);
  });

  it('reports a missing assistant session as the run error', async () => {
    await fixture.db!.transaction([{ sql: 'DELETE FROM assistant_sessions WHERE id = 7' }]);
    await mount();
    await act(async () => current.run('会话没了', 'agent'));
    expect(current.state.agentRun?.status).toBe('failed');
    expect(JSON.stringify(current.state.messages)).toContain('AI 会话不存在：7。');
    expect(fixture.requests).toHaveLength(0);
  });

  it('drafts a chapter right after the brief, in the same run', async () => {
    const brief = {
      target_path: '正文/第003章.md',
      chapter_ordinal: null,
      chapter_title: '入城',
      goal: '沈禾带林舟入城',
      pov: '林舟',
      setting: '城门',
      required_beats: ['入城', '夜宿'],
      forbidden_items: ['回忆'],
      continuity_constraints: ['林舟左臂有旧伤'],
      target_chars_min: 10,
      target_chars_max: 400,
    };
    const draft = '第三章 入城' + NL + NL + '沈禾带林舟穿过城门，夜宿客栈。' + NL;
    fixture.replies.push(
      { reply: streamed([JSON.stringify(brief)]) },
      { reply: streamed([draft]) },
      {
        // 检查模型照自己提示里的检查源回显摘要（与预言机同一套构造）。
        reply: (body) => {
          const prompt = body.messages.at(-1).content as string;
          const start = prompt.indexOf('检查源：') + '检查源：'.length;
          const source = JSON.parse(prompt.slice(start, prompt.indexOf(NL, start)));
          return streamed([JSON.stringify({ ...source, findings: [] })]);
        },
      },
    );
    await mount('ask');
    await act(async () =>
      current.run('写第三章：沈禾带林舟入城', 'agent', 'chapter.write', [], {
        targetFilePath: 'D:/book/正文/第003章.md',
      }),
    );
    // 章纲不再停下等确认：同一轮里拟章纲、起草、检查，最后只在补丁上等作者。
    expect(fixture.requests).toHaveLength(3);
    expect(current.state.chapterBrief).toBeNull();
    expect(current.state.agentRun?.status).toBe('waiting');
    const tools = current.state.agentRun!.steps.map((step) => step.tool);
    expect(tools.filter((tool) => tool.startsWith('chapter.'))).toEqual(
      expect.arrayContaining(['chapter.brief', 'chapter.draft', 'chapter.check']),
    );
    expect(tools).not.toContain('chapter.brief.confirm');
    const runId = current.state.agentRun!.id;
    const projection = await getAgentRunSavePoints(runId);
    expect(projection.pending).toMatchObject({ permission_required: true });
    expect(projection.pending.proposed_patch_artifact_id).not.toBeNull();
    // 引擎永不写书稿：起草的正文只在补丁里，等作者确认后由前端写回。
    await expect(
      fixture.reader.inspectProjectPath('D:/book', '正文/第003章.md'),
    ).resolves.toMatchObject({ entryKind: 'missing' });
  });

  it('drafts with the brief adjustments as the brief made them', async () => {
    const adjustment = {
      plan_quote: '沈禾带林舟入城',
      fact_quote: '林舟推开门。',
      adjustment: '林舟上一章已经推门出来，本章从城外写起。',
    };
    const brief = {
      target_path: '正文/第003章.md',
      goal: '沈禾带林舟入城',
      target_chars_min: 10,
      target_chars_max: 400,
      fact_adjustments: [adjustment, { ...adjustment, fact_quote: '上一章没有这句' }],
    };
    fixture.replies.push(
      { reply: streamed([JSON.stringify(brief)]) },
      { reply: streamed(['第三章 入城' + NL + NL + '城外起了风。' + NL]) },
      {
        reply: (body) => {
          const prompt = body.messages.at(-1).content as string;
          const start = prompt.indexOf('检查源：') + '检查源：'.length;
          const source = JSON.parse(prompt.slice(start, prompt.indexOf(NL, start)));
          return streamed([JSON.stringify({ ...source, findings: [] })]);
        },
      },
    );
    await mount('ask');
    await act(async () =>
      current.run('写第三章：沈禾带林舟入城', 'agent', 'chapter.write', [], {
        targetFilePath: 'D:/book/正文/第003章.md',
      }),
    );
    // 章纲调用拿到了上一章结尾；对不上原句的那条调整被丢掉，对得上的照原样带进起草。
    expect(JSON.stringify(fixture.requests[0])).toContain('PREVIOUS');
    expect(fixture.requests).toHaveLength(3);
    const draftPrompt = (fixture.requests[1].messages as Obj[]).at(-1)!.content as string;
    expect(draftPrompt).toContain('按已写内容的调整（优先于上面的章节目标与节拍）');
    expect(draftPrompt).toContain(`- ${adjustment.adjustment}（已写：「林舟推开门。」）`);
    expect(draftPrompt).not.toContain('上一章没有这句');
  });
});

// 放在最后：重启会重置模块，静态导入的 hooks 仍握着重启前的引擎实例（它的 run 镜像与 id 已过期）。
describe('ChatWindow on the TS engine across a restart', () => {
  /** 关掉再打开：模块全部重新加载，引擎库还是同一个，内存里的续跑检查点没了。 */
  async function restart() {
    await act(async () => root?.unmount());
    root = undefined;
    vi.resetModules();
    return {
      socket: await import('../src/lib/api/agent-socket'),
      runs: await import('../src/lib/api/agent-runs'),
    };
  }
  const runRow = async (where: string, params: (string | number)[] = []) =>
    (
      await fixture.db!.select(
        `SELECT public_id, session_id, status FROM agent_runs WHERE ${where}`,
        params,
      )
    )[0];

  it('keeps a patch waiting for the author across a restart', async () => {
    revise();
    await mount('ask');
    await act(async () => current.run('改一下第一章开门那句', 'agent'));
    const runId = current.state.agentRun!.id;
    const { session_id: sessionId } = await runRow('public_id = $1', [runId]);
    const { socket, runs } = await restart();
    expect((await runs.getAgentRunSavePoints(runId)).pending).toMatchObject({
      permission_required: true,
    });
    const ack = await socket.sendAgentControlMessage({
      sessionId: String(sessionId),
      runId,
      type: 'approve_permission',
      payload: { source: 'desktop.timeline' },
    });
    expect(ack).toMatchObject({ type: 'permission_approved', run_id: runId });
    expect((await runs.getAgentRunSavePoints(runId)).status).toBe('completed');
    expect(fixture.requests).toHaveLength(3);
  });

  it('reaps a run cut off mid-tool and cannot resume it after a restart', async () => {
    // 这一条只用重启后重新加载的模块：先「打开」一次，跑到工具执行中再「关掉」。
    const before = await restart();
    fixture.replies.push({ reply: streamed([], [['c1', 'fs_read', { path: '人物/主角.md' }]]) });
    let reading = false;
    fixture.beforeReadPath = '人物/主角.md';
    fixture.beforeRead = () => {
      reading = true;
      return new Promise<void>(() => undefined);
    };
    void before.socket
      .sendAgentUserMessage({
        sessionId: 'cut-session',
        runId: 'cut-run',
        userMessage: '读人物再答',
        permissionProfile: 'ask',
        assistantSessionId: 7,
        args: { project_path: 'D:/book' },
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(reading).toBe(true));
    expect(await runRow('public_id = $1', ['cut-run'])).toMatchObject({ status: 'running' });
    const { socket, runs } = await restart();
    const events = await runs.getAgentRunEvents('cut-run');
    expect(events.at(-2)).toMatchObject({
      event_type: 'agent_run_failed',
      payload: { reason: 'process_restart', run_id: 'cut-run' },
    });
    // 上次进程里开始了没结束的那次执行也补了结算，不再一直算「在跑」。
    expect(events.at(-1)).toMatchObject({
      event_type: 'agent_execution_settled',
      payload: { reason: 'process_restart', run_status: 'failed' },
    });
    expect((await runs.getAgentRunSavePoints('cut-run')).status).toBe('failed');
    const ack = await socket.sendAgentControlMessage({
      sessionId: 'cut-session',
      runId: 'cut-run',
      type: 'resume_run',
      payload: { source: 'desktop.timeline' },
    });
    expect(ack).toMatchObject({ run_id: 'cut-run' });
    expect((await runs.getAgentRunSavePoints('cut-run')).status).toBe('failed');
    expect(fixture.requests).toHaveLength(1);
  });
});
