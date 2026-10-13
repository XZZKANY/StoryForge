import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-agent-run.windows.json';
import {
  AssistantSessionNotFoundError,
  type AssistantStore,
  type ToolCallPatch,
} from '../assistant/service';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { dumpJson, JsonFloat, parseJson } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { redactSensitive, redactSensitiveText, type PlainJson } from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import type { HttpPort } from '../llm/transport';
import { MemoryRunStore } from '../store/runs';
import {
  AgentRuntimeUserMessageError,
  runAgentUserMessage,
  type SessionTitlePort,
} from './agentRuntime';
import { LoopCheckpointStore } from './chatLoopCheckpoints';
import type { ConversationSources } from './conversationHistory';
import { framesForEvent } from './frames';
import type { TextFrame } from './textStream';
import { canonToolHandlers } from './tools/canonHandlers';
import { AGENT_RUNTIME_TOOL_SPECS } from './tools/catalog';
import { checkToolHandlers } from './tools/checkHandlers';
import { AgentToolRegistry, toolDefinitionFromSpec, type ToolHandler } from './tools/execution';
import { fsToolHandlers } from './tools/fsHandlers';
import type { ToolDeps } from './tools/handlerDeps';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const ROOT = golden.project_root;
const platform = golden.platform as 'windows' | 'posix';
const SECRETS = { values: [golden.secret] };

const ESCAPED_ROOTS = [ROOT, ROOT.replace(/\\/g, '/')].map((root) =>
  JSON.stringify(root).slice(1, -1),
);
/** 与预言机同一套规范化：项目根换占位、工具列表只留名字与摘要、长字符串只留摘要。 */
function normalize(value: unknown): unknown {
  let text = dumpJson(plain(value), { ensureAscii: false });
  for (const root of ESCAPED_ROOTS) text = text.split(root).join('$ROOT');
  return compact(parseJson(text, 'normalize'));
}
function plain(value: unknown): unknown {
  if (value instanceof JsonFloat) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}
function compact(value: unknown): unknown {
  if (value instanceof JsonFloat) return value.value;
  if (typeof value === 'string' && Array.from(value).length > 400)
    return { sha256: sha256Hex(value), length: Array.from(value).length };
  if (Array.isArray(value)) return value.map(compact);
  if (value !== null && typeof value === 'object') {
    const object = value as Obj;
    const tools = object.tools;
    const toolList =
      Array.isArray(tools) &&
      tools.length > 0 &&
      tools.every((tool) => tool !== null && typeof tool === 'object' && 'function' in tool);
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [
        key,
        key === 'tools' && toolList
          ? {
              names: (item as Obj[]).map((tool) => tool.function.name),
              sha256: sha256Hex(
                dumpJson(item, { ensureAscii: false, sortKeys: true, separators: [',', ':'] }),
              ),
            }
          : compact(item),
      ]),
    );
  }
  return value;
}
const expectSame = (actual: unknown, expected: unknown, label: string) =>
  expect(plain(normalize(actual)), label).toEqual(plain(expected));

const encoded = (text: string): EncodedFile => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});

/** Python 会话库的内存替身：建会话 / 写消息 / 工具调用证据，脱敏照 Python 存储层。 */
function assistantDb(initial: Obj[]) {
  const sessions = initial.map((row, index) => ({
    id: index + 1,
    title: row.title as string,
    task_type: 'ide_agent_orchestration',
    project_path: (row.project_path as string).replace('$ROOT', ROOT),
  }));
  const messages: Obj[] = [];
  const toolCalls: Obj[] = [];
  const find = (id: number) => {
    const session = sessions.find((row) => row.id === id);
    if (!session) throw new AssistantSessionNotFoundError(`Assistant 会话不存在：${id}。`);
    return session;
  };
  const redactSummary = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (redactSensitive(value as PlainJson, SECRETS) as Obj)
      : value;
  const store: AssistantStore = {
    async createSession(input) {
      const row = {
        id: sessions.length + 1,
        title: redactSensitiveText(input.title, SECRETS),
        task_type: input.task_type,
        project_path: input.project_path as string,
      };
      sessions.push(row);
      return { id: row.id, project_path: row.project_path };
    },
    async getSession(id) {
      const row = find(id);
      return { id: row.id, project_path: row.project_path };
    },
    async appendMessage(sessionId, message) {
      find(sessionId);
      messages.push({
        id: messages.length + 1,
        session_id: sessionId,
        role: message.role,
        content: redactSensitiveText(message.content, SECRETS),
      });
    },
    async createToolCall(sessionId, input) {
      find(sessionId);
      const row: Obj = {
        id: toolCalls.length + 1,
        session_id: sessionId,
        tool_name: input.tool_name,
        status: input.status,
        input_summary: redactSummary(input.input_summary),
        output_summary: redactSummary(input.output_summary ?? {}),
        error_message: null,
      };
      toolCalls.push(row);
      return { id: row.id, input_summary: row.input_summary };
    },
    async updateToolCall(id, patch: ToolCallPatch) {
      const row = toolCalls.find((item) => item.id === id)!;
      for (const [key, value] of Object.entries(patch))
        row[key] =
          key === 'error_message'
            ? redactSensitiveText(value as string, SECRETS)
            : key === 'status'
              ? value
              : redactSummary(value);
      return { id: row.id, input_summary: row.input_summary };
    },
  };
  const titles: SessionTitlePort = {
    title: async (id) => find(id).title,
    setTitle: async (id, title) => {
      find(id).title = title;
    },
  };
  return { sessions, messages, toolCalls, store, titles };
}

type Replay = { record: Obj; error: unknown };

/**
 * 真异步、且写入完成先后不一的存储（P4 的 sqlite 走 IPC）：每次调用先让出一拍，传输进度事件故意写得更慢。
 * 同步状态读与测试里的控制写仍走底层存储。
 */
function yieldingStore(base: MemoryRunStore): MemoryRunStore {
  const ticks = async (count: number) => {
    for (let i = 0; i < count; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  return new Proxy(base, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      if (key === 'peek' || key === 'rowsAfter') return value.bind(target);
      return async (...args: unknown[]) => {
        const slow =
          key === 'appendEvent' && (args[0] as Obj).event_type === 'agent_runtime_progress';
        await ticks(slow ? 40 : 1);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

async function replay(scenario: Obj, options: { yielding?: boolean } = {}): Promise<Replay> {
  const spec = parseJson(scenario.spec_json, 'spec') as Obj;
  const project = memoryProject(
    ROOT,
    Object.fromEntries(Object.entries(golden.files).map(([path, text]) => [path, encoded(text)])),
  );
  const runs = new MemoryRunStore();
  const db = assistantDb(spec.sessions as Obj[]);
  for (const [role, content] of (spec.history ?? []) as [string, string][])
    db.messages.push({ id: db.messages.length + 1, session_id: 1, role, content });
  if (spec.seed_review) {
    const earlier = await runs.insertRun({
      public_id: 'run-0',
      session_id: 'sess-0',
      assistant_session_id: 1,
      goal: '审稿',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'completed',
      root_plan: [],
      current_step: 'completed',
    });
    await runs.insertArtifact({
      run_id: earlier.id,
      kind: 'review_report',
      payload: spec.seed_review,
      requires_confirmation: false,
    });
  }
  // 本次作者消息建的 run 排在预置 run 之后。
  const RUN_ID = spec.seed_review ? 2 : 1;
  const conversation: ConversationSources = {
    messages: async (sessionId) =>
      db.messages
        .filter((row) => row.session_id === sessionId)
        .map(({ id, role, content }) => ({ id, role, content })),
    toolCalls: async (sessionId) =>
      db.toolCalls
        .filter((row) => row.session_id === sessionId)
        .map((row) => ({
          id: row.id,
          tool_name: row.tool_name,
          status: row.status,
          input_summary: row.input_summary,
          output_summary: row.output_summary,
          related_type: null,
          related_id: null,
        })),
    runEvents: async (sessionId) => {
      const ids = new Set((await runs.runsOfAssistantSession(sessionId)).map((run) => run.id));
      return runs
        .rowsAfter({ events: 0, artifacts: 0, subagents: 0 })
        .events.filter((row) => ids.has(row.run_id));
    },
    runArtifacts: async (sessionId) => {
      const ids = new Set((await runs.runsOfAssistantSession(sessionId)).map((run) => run.id));
      return runs
        .rowsAfter({ events: 0, artifacts: 0, subagents: 0 })
        .artifacts.filter((row) => ids.has(row.run_id));
    },
    artifact: async (id) =>
      runs
        .rowsAfter({ events: 0, artifacts: 0, subagents: 0 })
        .artifacts.find((row) => row.id === id) ?? null,
  };
  const clock = { now: 100 };
  const replies = [...(spec.replies as Obj[])];
  const requests: Obj[] = [];
  const checks: string[] = [];
  const counts = (spec.triggers as Obj[]).map(() => 0);
  const setStatus = ([status, step]: [string, string]) => {
    // MemoryRunStore 的写入在调用当下同步生效（等价 Python 预言机里的同步提交）。
    void runs.updateRun(RUN_ID, { status, current_step: step });
  };
  const http: HttpPort = {
    async send(request) {
      clock.now += golden.step_seconds;
      const body =
        request.body === null ? null : parseJson(new TextDecoder().decode(request.body), 'body');
      requests.push({
        url: request.url,
        method: request.method,
        timeout: request.timeoutSeconds,
        body,
      });
      let reply = replies.shift()!;
      if (reply.set_status) setStatus(reply.set_status);
      clock.now += reply.advance ?? 0;
      if (reply.compaction_quote) {
        const modelInput = parseJson((body as Obj).messages[1].content, 'input') as Obj;
        const entries = (modelInput.new_sources as Obj[]).map((source) => ({
          category: 'decision',
          text: `摘要 ${source.key}`,
          source_id: source.key,
          quote: Array.from(source.content as string)
            .slice(0, 10)
            .join(''),
        }));
        const content = dumpJson({ entries }, { ensureAscii: false });
        reply = {
          status: 200,
          body: dumpJson(
            {
              id: 'resp-1',
              choices: [
                { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
            },
            { ensureAscii: false },
          ),
        };
      }
      const raw = new TextEncoder().encode(reply.body ?? '');
      async function* lines() {
        let start = 0;
        for (let i = 0; i < raw.length; i++)
          if (raw[i] === 0x0a) {
            yield raw.slice(start, i + 1);
            start = i + 1;
          }
        if (start < raw.length) yield raw.slice(start);
      }
      return { status: reply.status, headers: {}, body: lines(), close() {} };
    },
  };
  const source = Object.fromEntries(
    Object.entries({ ...golden.source, ...spec.env }).filter(([, value]) => value !== null),
  ) as Record<string, string>;
  let uuid = 0;
  const toolDeps: ToolDeps = {
    reader: project.reader,
    writer: project.writer,
    platform,
    secrets: SECRETS,
    proposals: {
      newUuid: () => `00000000-0000-4000-8000-${(++uuid).toString(16).padStart(12, '0')}`,
      now: () => new Date(golden.fixed_now),
    },
    artifacts: {
      runHasArtifact: async () => false,
      artifactPayloads: async () => [],
    },
    crossChapter: {
      model: null,
      callLlm: async () => {
        throw new Error('unused');
      },
    },
  };
  const handlers: Record<string, ToolHandler> = {
    ...fsToolHandlers(toolDeps),
    ...checkToolHandlers(toolDeps),
    ...canonToolHandlers(toolDeps),
  };
  const tools = new AgentToolRegistry();
  for (const item of AGENT_RUNTIME_TOOL_SPECS)
    tools.register(
      toolDefinitionFromSpec(
        item,
        handlers[item.name] ??
          (async () => {
            throw new Error(`${item.name} 随 P3-6`);
          }),
      ),
    );
  let streams = 0;
  let attempts = 0;
  const frames: unknown[] = [];
  const textFrames: TextFrame[] = [];
  const message = parseJson(
    dumpJson(spec.message).split('$ROOT').join(JSON.stringify(ROOT).slice(1, -1)),
    'message',
  ) as Obj;
  if ('file_path' in (message.args as Obj))
    (message.args as Obj).file_path =
      `${ROOT}${platform === 'windows' ? '\\正文\\第001章.md' : '/正文/第001章.md'}`;
  let result: Obj | null = null;
  let error: unknown = null;
  try {
    result = (
      await runAgentUserMessage(
        {
          store: options.yielding ? yieldingStore(runs) : runs,
          secrets: SECRETS,
          assistant: db.store,
          titles: db.titles,
          conversation,
          reader: project.reader,
          platform,
          source,
          llm: {
            http,
            clock: () => clock.now,
            wait: async () => {},
            random: () => 0.375,
            appVersion: golden.app_version,
          },
          tools,
          checkpoints: new LoopCheckpointStore(),
          ids: { stream: () => `stream-${++streams}`, attempt: () => `attempt-${++attempts}` },
          onInterruptionCheck: (_runId, boundary) => {
            checks.push(boundary);
            (spec.triggers as Obj[]).forEach((trigger, index) => {
              if (trigger.boundary !== boundary) return;
              counts[index] += 1;
              if (counts[index] === trigger.nth) setStatus([trigger.status, trigger.current_step]);
            });
          },
        },
        {
          agentSessionId: 'sess-1',
          message,
          newRunId: () => 'unused',
          onEvent: (event, run) => frames.push(...framesForEvent(run, event, SECRETS)),
          onText: spec.stream ? (frame) => textFrames.push(frame) : null,
        },
      )
    ).result;
  } catch (caught) {
    error = caught;
  }
  const rows = runs.rowsAfter({ events: 0, artifacts: 0, subagents: 0 });
  return {
    error,
    record: {
      result,
      frames,
      text_frames: textFrames,
      checks,
      requests,
      unused_replies: replies.length,
      runs: [...(spec.seed_review ? [await runs.getRun(1)] : []), await runs.getRun(RUN_ID)],
      events: rows.events,
      artifacts: rows.artifacts,
      subagents: rows.subagents.map(({ id, run_id, role, input, output, status }) => ({
        id,
        run_id,
        role,
        input,
        output,
        status,
      })),
      sessions: db.sessions,
      messages: db.messages,
      tool_calls: db.toolCalls,
    },
  };
}

const KEYS = [
  'frames',
  'text_frames',
  'checks',
  'requests',
  'unused_replies',
  'runs',
  'events',
  'artifacts',
  'subagents',
  'sessions',
  'messages',
  'tool_calls',
];

describe('agent run replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(6);
    expect(golden.scenarios).toHaveLength(25);
  });

  it.each((golden.scenarios as Obj[]).map((item) => [item.id, item] as const))(
    '%s',
    async (_id, scenario) => {
      const { record, error } = await replay(scenario);
      if (scenario.error) {
        expect(error).toBeInstanceOf(AgentRuntimeUserMessageError);
        expect((error as Error).message).toBe(scenario.error.message);
      } else {
        if (error) throw error;
        expectSame(record.result, scenario.result, 'result');
      }
      for (const key of KEYS) expectSame(record[key], scenario[key], key);
    },
  );

  // 传输进度是同步回调、落库是异步：排队保证进度事件仍排在随后的计划 / 轨迹 / 结算之前。
  it.each([
    'read-then-answer',
    'tools-in-two-rounds',
    'long-history-compaction',
    'stop-after-compaction',
    'loop-provider-error',
  ])('keeps event and frame order on an asynchronous store: %s', async (id) => {
    const scenario = (golden.scenarios as Obj[]).find((item) => item.id === id)!;
    const { record, error } = await replay(scenario, { yielding: true });
    if (error) throw error;
    for (const key of ['frames', 'events', 'artifacts', 'tool_calls'])
      expectSame(record[key], scenario[key], key);
  });
});
