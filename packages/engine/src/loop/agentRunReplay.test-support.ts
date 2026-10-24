import { expect } from 'vitest';
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
import { migratedMemoryDb } from '../store/nodeSqlite.test-support';
import { MemoryRunStore, type RunEventRecord, type RunRecord } from '../store/runs';
import { decodeJsonColumn, type Db } from '../store/db';
import { SqlAssistantStore } from '../store/sqlAssistant';
import { SqlRunStore } from '../store/sqlRuns';
import { runAgentUserMessage, type AgentRuntimeDeps, type SessionTitlePort } from './agentRuntime';
import { LoopCheckpointStore } from './chatLoopCheckpoints';
import type { ConversationSources } from './conversationHistory';
import { AgentHostRejection, postAgentControl, streamAgentUserMessage } from './agentHost';
import { framesForEvent } from './frames';
import { agentRunSavePoints, listAgentRunEvents } from './savePoints';
import { handleAgentControlMessage } from './runControlChannel';
import {
  AgentRunEventSink,
  finishAgentExecution,
  startAgentExecution,
  startAgentUserMessageRun,
  type RunServices,
} from './runEvents';
import type { TextFrame } from './textStream';
import type { ToolDeps } from './tools/handlerDeps';
import { createAgentToolRegistry } from './tools/registry';
import { storeRunSources, storeToolArtifactQuery } from './storeSources';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读

export type Replay = { record: Obj; error: unknown };

function encoded(text: string): EncodedFile {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // 分块展开：大文件一次展开会撑爆调用栈。
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { chunks: [{ base64: btoa(binary), repeat: 1 }] };
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

/**
 * 真异步、且写入完成先后不一的存储（P4 的 sqlite 走 IPC）：每次调用先让出一拍，传输进度事件故意写得更慢。
 * 同步状态读与测试里的控制写仍走底层存储。
 */
function yieldingStore<T extends object>(base: T): T {
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

/**
 * Python `golden_agent_run.py` 预言机的回放台：同一个合成项目、HTTP 层脚本化的模型、虚拟时钟、
 * 中断边界触发的状态写，以及在请求进行中或 run 结束后经控制通道发出的作者控制。
 */
/** 普通回包遇上流式请求（SSE 路由总是流式）：同一条消息改成 SSE（与预言机的 as_stream 同构）。 */
function asStream(text: string): string {
  const data = parseJson(text, 'reply') as Obj;
  const choice = data.choices[0];
  const message = choice.message as Obj;
  const events: Obj[] = message.content
    ? [{ choices: [{ index: 0, delta: { content: message.content } }] }]
    : [];
  ((message.tool_calls ?? []) as Obj[]).forEach((call, index) =>
    events.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: call.id,
                type: 'function',
                function: { name: call.function.name, arguments: call.function.arguments },
              },
            ],
          },
        },
      ],
    }),
  );
  events.push({ choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] });
  events.push({ choices: [], usage: data.usage });
  return (
    events.map((event) => `data: ${dumpJson(event, { ensureAscii: false })}\n\n`).join('') +
    'data: [DONE]\n\n'
  );
}

const HOST_BODY_KEYS = [
  'user_message',
  'run_id',
  'assistant_session_id',
  'intent',
  'permission_profile',
  'args',
];

/** 合并窗口跟着墙钟走：同一流同一轮的连续增量拼成一段（先核 chunk_sequence 按轮从 1 连续），只比文本与帧序。 */
export function mergeTextDeltas(payloads: Obj[]): Obj[] {
  const merged: Obj[] = [];
  const sequences = new Map<string, number>();
  for (const payload of payloads) {
    if (payload.type !== 'agent_text_delta') {
      merged.push(payload);
      continue;
    }
    const key = JSON.stringify([payload.run_id, payload.stream_id, payload.round_index]);
    const expected = (sequences.get(key) ?? 0) + 1;
    expect(payload.chunk_sequence, 'chunk_sequence').toBe(expected);
    sequences.set(key, expected);
    const last = merged[merged.length - 1];
    if (
      last?.type === 'agent_text_delta' &&
      JSON.stringify([last.run_id, last.stream_id, last.round_index]) === key
    )
      last.text_delta += payload.text_delta;
    else {
      const { chunk_sequence: _sequence, ...rest } = payload;
      merged.push(rest);
    }
  }
  return merged;
}

/** 永不触发的合并窗口：增量只在遇到非增量帧或终态时冲出（墙钟窗口由合并规范化抹平）。 */
const IDLE_SCHEDULER = { setTimer: () => ({}), clearTimer: () => undefined };

export function agentRunReplay(golden: Obj) {
  const ROOT = golden.project_root as string;
  const platform = golden.platform as 'windows' | 'posix';
  const SECRETS = {
    values: [
      golden.secret as string,
      ...(golden.polish_secret ? [golden.polish_secret as string] : []),
    ],
  };
  const ESCAPED_ROOTS = [ROOT, ROOT.replace(/\\/g, '/')].map((root) =>
    JSON.stringify(root).slice(1, -1),
  );

  /** 与预言机同一套规范化：项目根换占位、工具列表只留名字与摘要、长字符串只留摘要。 */
  function normalize(value: unknown): unknown {
    let text = dumpJson(plain(value), { ensureAscii: false });
    for (const root of ESCAPED_ROOTS) text = text.split(root).join('$ROOT');
    return compact(parseJson(text, 'normalize'));
  }
  const expectSame = (actual: unknown, expected: unknown, label: string) =>
    expect(plain(normalize(actual)), label).toEqual(plain(expected));

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
          error_message:
            typeof input.error_message === 'string'
              ? redactSensitiveText(input.error_message, SECRETS)
              : null,
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
    const conversation: Pick<ConversationSources, 'messages' | 'toolCalls'> = {
      messages: async (sessionId) =>
        messages
          .filter((row) => row.session_id === sessionId)
          .map(({ id, role, content }) => ({ id, role, content })),
      toolCalls: async (sessionId) =>
        toolCalls
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
    };
    const rows = async () => ({ sessions, messages, tool_calls: toolCalls });
    return { sessions, messages, toolCalls, store, titles, conversation, rows };
  }

  /** 同一份会话事实放进 sqlite 会话存储（P4-1b），与 run 存储共用一个引擎库。 */
  async function sqlAssistantDb(engineDb: Db, initial: Obj[], history: [string, string][]) {
    const at = '2026-10-14T00:00:00Z';
    for (const row of initial)
      await engineDb.transaction([
        {
          sql:
            'INSERT INTO assistant_sessions (title, task_type, project_path, created_at, updated_at) ' +
            "VALUES ($1, 'ide_agent_orchestration', $2, $3, $3)",
          params: [row.title as string, (row.project_path as string).replace('$ROOT', ROOT), at],
        },
      ]);
    for (const [role, content] of history)
      await engineDb.transaction([
        {
          sql:
            'INSERT INTO assistant_messages (session_id, role, content, created_at, updated_at) ' +
            'VALUES (1, $1, $2, $3, $3)',
          params: [role, content, at],
        },
      ]);
    const store = new SqlAssistantStore(engineDb, SECRETS, () => at);
    const rows = async () => ({
      sessions: (
        await engineDb.select(
          'SELECT id, title, task_type, project_path FROM assistant_sessions ORDER BY id',
        )
      ).map((row) => ({ ...row })),
      messages: (
        await engineDb.select(
          'SELECT id, session_id, role, content FROM assistant_messages ORDER BY id',
        )
      ).map((row) => ({ ...row })),
      tool_calls: (
        await engineDb.select(
          'SELECT id, session_id, tool_name, status, input_summary, output_summary, error_message FROM assistant_tool_calls ORDER BY id',
        )
      ).map((row) => ({
        ...row,
        input_summary: decodeJsonColumn(row.input_summary),
        output_summary: decodeJsonColumn(row.output_summary),
      })),
    });
    return {
      store: store as AssistantStore,
      titles: store as SessionTitlePort,
      conversation: {
        messages: store.messages.bind(store),
        toolCalls: store.toolCalls.bind(store),
      },
      rows,
      messages: [] as Obj[],
    };
  }

  type ReplayOptions = {
    yielding?: boolean;
    parallelControls?: boolean;
    /** 用引擎默认的收尾压缩门槛；不设时门槛为 0——预言机录样本时超过 12 条消息每轮都压。 */
    defaultCompaction?: boolean;
  };

  /**
   * 每个场景跑两遍：内存存储与 sqlite 存储（P4-1）。两遍的行、帧、结果与错误必须逐项相同，
   * 回放比对的是内存那一遍——sqlite 存储因此被全部 agent-run 预言机套件覆盖。
   */
  async function replay(scenario: Obj, options: ReplayOptions = {}): Promise<Replay> {
    const memory = await replayWith(scenario, options, 'memory');
    const sql = await replayWith(scenario, options, 'sql');
    expect(plain(normalize(sql.record)), 'sqlite store record').toEqual(
      plain(normalize(memory.record)),
    );
    const failure = (error: unknown) =>
      error ? { name: (error as Error).name, message: (error as Error).message } : null;
    expect(failure(sql.error), 'sqlite store error').toEqual(failure(memory.error));
    return memory;
  }

  async function replayWith(
    scenario: Obj,
    options: ReplayOptions,
    storeKind: 'memory' | 'sql',
  ): Promise<Replay> {
    const spec = parseJson(scenario.spec_json, 'spec') as Obj;
    const project = memoryProject(
      ROOT,
      Object.fromEntries(
        Object.entries(golden.files as Record<string, string>).map(([path, text]) => [
          path,
          encoded(text),
        ]),
      ),
    );
    for (const [path, text] of Object.entries((spec.extra_files ?? {}) as Record<string, string>))
      project.apply({ [path]: encoded(text) });
    for (const path of (spec.removed_files ?? []) as string[]) project.apply({ [path]: null });
    const big = (spec.big_files ?? {}) as Record<string, [string, number]>;
    for (const [path, [unit, count]] of Object.entries(big))
      project.apply({ [path]: encoded(unit.repeat(count)) });
    const engineDb = storeKind === 'sql' ? await migratedMemoryDb() : null;
    const runs = engineDb
      ? await SqlRunStore.open(engineDb, () => '2026-10-14T00:00:00Z')
      : new MemoryRunStore();
    const db = engineDb
      ? await sqlAssistantDb(
          engineDb,
          spec.sessions as Obj[],
          (spec.history ?? []) as [string, string][],
        )
      : assistantDb(spec.sessions as Obj[]);
    if (!engineDb)
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
      messages: db.conversation.messages,
      toolCalls: db.conversation.toolCalls,
      ...storeRunSources(runs),
    };
    const clock = { now: 100 };
    const replies = [...(spec.replies as Obj[])];
    const requests: Obj[] = [];
    const checks: string[] = [];
    const controls: Obj[] = [];
    const counts = (spec.triggers as Obj[]).map(() => 0);
    const setStatus = ([status, step]: [string, string]) => {
      // MemoryRunStore 的写入在调用当下同步生效（等价 Python 预言机里的同步提交）。
      void runs.updateRun(RUN_ID, { status, current_step: step });
    };
    // 控制通道在生产里是另一条连接：结果照预言机的形状记下，领域错误记类型与消息。
    const runControl = async (control: Obj): Promise<Obj> => {
      try {
        const result = await handleAgentControlMessage(deps, {
          publicId: 'run-1',
          sessionId: control.session ?? 'sess-1',
          controlType: control.type,
          payload: control.payload ?? null,
        });
        const { event_type, sequence, payload } = result.event;
        return {
          event: { event_type, sequence, payload },
          resumed_result: result.resumedResult,
          resume_diagnostic: result.resumeDiagnostic,
        };
      } catch (caught) {
        return { error: { type: (caught as Error).name, message: (caught as Error).message } };
      }
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
        for (const [path, content] of Object.entries((reply.edits ?? {}) as Record<string, string>))
          project.apply({ [path]: encoded(content) });
        for (const control of (reply.controls ?? []) as Obj[])
          controls.push(await runControl(control));
        clock.now += reply.advance ?? 0;
        if (reply.polish) {
          // 润色模型按请求里的片段原样回显，再做脚本给的替换（与预言机同一套构造）。
          const rule = reply.polish as Obj;
          let segments = (parseJson((body as Obj).messages[1].content, 'polish input') as Obj)
            .segments as Obj[];
          segments = segments.map((segment) => {
            let text = segment.text as string;
            for (const [old, replacement] of rule.replace as [string, string][])
              text = text.split(old).join(replacement);
            return { index: segment.index, text };
          });
          if (rule.drop_last) segments = segments.slice(0, -1);
          const content = dumpJson({ segments }, { ensureAscii: false });
          reply = {
            status: 200,
            body: dumpJson(
              {
                id: 'resp-1',
                choices: [
                  { index: 0, message: { role: 'assistant', content }, finish_reason: rule.finish },
                ],
                usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
              },
              { ensureAscii: false },
            ),
          };
        }
        if (reply.chapter_check) {
          // 检查模型按自己提示里的检查源回显摘要，再附上脚本给的 findings（与预言机同一套构造）。
          const rule = reply.chapter_check as Obj;
          const messages = (body as Obj).messages as Obj[];
          const prompt = messages[messages.length - 1].content as string;
          const start = prompt.indexOf('检查源：') + '检查源：'.length;
          const source = parseJson(
            prompt.slice(start, prompt.indexOf('\n', start)),
            'check source',
          ) as Obj;
          if (rule.corrupt) source.content_sha256 = '0'.repeat(64);
          const content = dumpJson({ ...source, findings: rule.findings }, { ensureAscii: false });
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
        if (
          (body as Obj | null)?.stream === true &&
          reply.status < 400 &&
          !String(reply.body ?? '').startsWith('data:')
        )
          reply = { ...reply, body: asStream(reply.body as string) };
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
    // Rust 按槽只放行该槽 baseUrl 同源的请求：润色槽的请求走错槽就是回归。
    const slotHttp = (slot: 'main' | 'polish'): HttpPort => ({
      send(request) {
        const polishBase = source.STORYFORGE_POLISH_LLM_BASE_URL;
        const toPolish = Boolean(polishBase) && request.url.startsWith(polishBase);
        if (toPolish !== (slot === 'polish')) throw new Error(`${slot} 槽不应发往 ${request.url}`);
        return http.send(request);
      },
    });
    let uuid = 0;
    let hex = 0;
    const toolDeps: ToolDeps = {
      reader: project.reader,
      writer: project.writer,
      platform,
      secrets: SECRETS,
      proposals: {
        newUuid: () => `00000000-0000-4000-8000-${(++uuid).toString(16).padStart(12, '0')}`,
        now: () => new Date(golden.fixed_now),
      },
      artifacts: storeToolArtifactQuery(runs),
      // 补丁与审稿报告共用一个计数（预言机把四处 uuid4().hex 换成同一个计数器）。
      newHex: () => (++hex).toString(16).padStart(32, '0'),
    };
    const tools = createAgentToolRegistry(toolDeps);
    let streams = 0;
    let attempts = 0;
    const store = options.yielding ? yieldingStore(runs) : runs;
    const deps: AgentRuntimeDeps = {
      store,
      secrets: SECRETS,
      assistant: db.store,
      titles: db.titles,
      conversation,
      reader: project.reader,
      platform,
      source,
      // 专用润色槽只有身份四项（Python 从 STORYFORGE_POLISH_LLM_* 映射），与主模型共用脚本化的出网。
      polish: {
        source: Object.fromEntries(
          ['PROVIDER', 'BASE_URL', 'MODEL', 'API_KEY'].flatMap((key) =>
            `STORYFORGE_POLISH_LLM_${key}` in source
              ? [[`STORYFORGE_LLM_${key}`, source[`STORYFORGE_POLISH_LLM_${key}`]]]
              : [],
          ),
        ),
        http: slotHttp('polish'),
      },
      llm: {
        http: slotHttp('main'),
        clock: () => clock.now,
        // 等待推进虚拟时钟：重试退避按时钟轮询，直到等满。
        wait: async (seconds) => {
          clock.now += seconds;
        },
        random: () => 0.375,
        appVersion: golden.app_version,
      },
      tools,
      checkpoints: new LoopCheckpointStore(),
      ...(options.defaultCompaction ? {} : { compactAtHistoryBytes: 0 }),
      ids: {
        stream: () => `stream-${++streams}`,
        attempt: () => `attempt-${++attempts}`,
        hex: () => toolDeps.newHex(),
      },
      onInterruptionCheck: (_runId, boundary) => {
        checks.push(boundary);
        (spec.triggers as Obj[]).forEach((trigger, index) => {
          if (trigger.boundary !== boundary) return;
          counts[index] += 1;
          if (counts[index] === trigger.nth) setStatus([trigger.status, trigger.current_step]);
        });
      },
    };
    const frames: unknown[] = [];
    const textFrames: TextFrame[] = [];
    const onEvent = (event: RunEventRecord, run: RunRecord) =>
      frames.push(...framesForEvent(run, event, SECRETS));
    let result: Obj | null = null;
    let error: unknown = null;
    const host: Obj = {};
    if (spec.setup) {
      // 经真实的建 run / 执行开始 / sink / 收尾得来：刚建好还没执行的 run，或停在 permission.confirm 的 run。
      const services: RunServices = { store, secrets: SECRETS };
      const start = await startAgentUserMessageRun(services, {
        agentSessionId: 'sess-1',
        message: { user_message: '改第一章', run_id: 'run-1' },
        newRunId: () => 'unused',
      });
      onEvent(start.startedEvent, start.run);
      if (spec.setup === 'permission_wait') {
        const started = await startAgentExecution(services, start.run);
        const sink = new AgentRunEventSink(services, onEvent);
        sink.bindExecution(started);
        const wait = parseJson(dumpJson(spec.wait_result), 'wait') as Obj;
        await sink.recordPermissionRequired(start.run, wait, 'requires_user_confirmation');
        const [output, settled, current] = await finishAgentExecution(
          services,
          start.run.id,
          started,
          wait,
        );
        onEvent(settled, current);
        result = output;
      }
    } else if (spec.host) {
      const message = parseJson(
        dumpJson(spec.message).split('$ROOT').join(JSON.stringify(ROOT).slice(1, -1)),
        'message',
      ) as Obj;
      if ((message.args as Obj).file_path === `${ROOT}/正文/第001章.md`)
        (message.args as Obj).file_path =
          `${ROOT}${platform === 'windows' ? '\\正文\\第001章.md' : '/正文/第001章.md'}`;
      const body: Obj = Object.fromEntries(
        HOST_BODY_KEYS.filter((key) => key in message).map((key) => [key, message[key]]),
      );
      Object.assign(body, spec.body_override ?? {});
      const payloads: Obj[] = [];
      try {
        await streamAgentUserMessage(
          { ...deps, newRunId: () => 'unused', scheduler: IDLE_SCHEDULER },
          'sess-1',
          body,
          (frame) => payloads.push(frame),
        );
        host.payloads = mergeTextDeltas(payloads);
      } catch (caught) {
        if (!(caught instanceof AgentHostRejection)) throw caught;
        expect(payloads).toEqual([]);
        host.payloads = { rejected: caught.status };
      }
      host.body = body;
    } else {
      const message = parseJson(
        dumpJson(spec.message).split('$ROOT').join(JSON.stringify(ROOT).slice(1, -1)),
        'message',
      ) as Obj;
      // 固定管线自带 file_path；只改写对话消息里的缺省占位（与预言机一致）。
      if ((message.args as Obj).file_path === `${ROOT}/正文/第001章.md`)
        (message.args as Obj).file_path =
          `${ROOT}${platform === 'windows' ? '\\正文\\第001章.md' : '/正文/第001章.md'}`;
      try {
        result = (
          await runAgentUserMessage(deps, {
            agentSessionId: 'sess-1',
            message,
            newRunId: () => 'unused',
            onEvent,
            onText: spec.stream ? (frame) => textFrames.push(frame) : null,
          })
        ).result;
      } catch (caught) {
        error = caught;
      }
    }
    const ops = (spec.ops ?? []) as Obj[];
    if (spec.host) {
      const reads = async (): Promise<Obj> => {
        try {
          return {
            events: await listAgentRunEvents(deps, 'run-1'),
            save_points: await agentRunSavePoints(deps, 'run-1'),
          };
        } catch (caught) {
          return { error: { type: (caught as Error).name, message: (caught as Error).message } };
        }
      };
      host.reads = [await reads()];
      host.host_controls = [];
      for (const op of ops) {
        if (op.op === 'edit') project.apply({ [op.path]: encoded(op.content) });
        else {
          const body: Obj = {
            type: op.type,
            run_id: op.run_id ?? 'run-1',
            payload: op.payload ?? {},
            ...(op.body_override ?? {}),
          };
          try {
            const ack = await postAgentControl(deps, op.session ?? 'sess-1', body);
            (host.host_controls as Obj[]).push({ body, ack });
          } catch (caught) {
            if (!(caught instanceof AgentHostRejection)) throw caught;
            (host.host_controls as Obj[]).push({ body, rejected: caught.status });
          }
        }
        (host.reads as Obj[]).push(await reads());
      }
    } else if (options.parallelControls) {
      // 每条控制各走一条连接、同时发出（只用于没有改文件步骤的场景）。
      expect(ops.every((op) => op.op === 'control')).toBe(true);
      controls.push(...(await Promise.all(ops.map(runControl))));
    } else
      for (const op of ops) {
        if (op.op === 'edit') project.apply({ [op.path]: encoded(op.content) });
        else controls.push(await runControl(op));
      }
    const rows = await runs.rowsAfter({ events: 0, artifacts: 0, subagents: 0 });
    return {
      error,
      record: {
        ...host,
        result,
        ...('ops' in spec ? { controls } : {}),
        frames,
        text_frames: textFrames,
        checks,
        requests,
        unused_replies: replies.length,
        runs: [
          ...(spec.seed_review ? [await runs.getRun(1)] : []),
          ...((await runs.findRun('run-1')) ? [await runs.getRun(RUN_ID)] : []),
        ],
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
        ...(await db.rows()),
      },
    };
  }

  return { replay, expectSame, normalize: (value: unknown) => plain(normalize(value)) };
}

export const REPLAY_KEYS = [
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
