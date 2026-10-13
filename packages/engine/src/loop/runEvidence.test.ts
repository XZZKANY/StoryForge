import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-run-evidence.json';
import type { AssistantStore } from '../assistant/service';
import { JsonFloat, parseJson, type JsonObject } from '../kernel/json';
import {
  ChatMessage,
  chatResponse,
  messagesFromOpenai,
  ProviderError,
  TokenUsage,
  toolsFromOpenai,
  type ChatRequest,
  type ProviderErrorCategory,
  type StreamEvent,
} from '../llm/contracts';
import { RunControl, RunInterrupted } from '../llm/control';
import { ModelObservation, observeProvider } from '../llm/observation';
import { sdkProvider } from '../llm/client';
import type { LlmProvider } from '../llm/openaiCompatible';
import { LlmError } from '../llm/payload';
import { MemoryRunStore, type ArtifactRecord, type RunStore } from '../store/runs';
import type { ConversationSources, MessageRow, ToolCallRow } from './conversationHistory';
import {
  AgentRequestObserver,
  RequestEvidenceError,
  requestSnapshot,
  routeOrigin,
} from './requestEvidence';
import { AgentOrchestrationError } from './runPayloads';
import {
  buildConversationSystemJobs,
  deriveTitle,
  prepareConversationCompaction,
} from './systemJobs';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const SOURCE = golden.source as Record<string, string>;
const SECRETS = { values: [golden.secret] };

const plain = (value: unknown): unknown => {
  if (value instanceof JsonFloat) return value.value;
  if (value instanceof TokenUsage) return plain(value.toLegacy());
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
};
const expectSame = (actual: unknown, expected: unknown) =>
  expect(plain(actual)).toEqual(plain(expected));

/** 预言机里用「重复」写法表示的超大字段，在这里展开。 */
const expand = (item: unknown): unknown => {
  if (Array.isArray(item)) return item.map(expand);
  if (item === null || typeof item !== 'object') return item;
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) =>
      key.endsWith('_repeat')
        ? [
            key.slice(0, -'_repeat'.length),
            (value as [string, number])[0].repeat((value as [string, number])[1]),
          ]
        : [key, expand(value)],
    ),
  );
};

function buildRequest(spec: Obj): ChatRequest {
  const messages = messagesFromOpenai(
    (spec.messages as Obj[]).map((item) => expand(item) as JsonObject),
  );
  if (spec.continuation_at !== null) {
    const at = spec.continuation_at as number;
    const m = messages[at];
    messages[at] = new ChatMessage(
      m.role,
      m.content,
      m.toolCalls,
      m.toolCallId,
      m.name,
      m.metadata,
      {
        provider: 'p',
        state: { sig: 's' },
      },
    );
  }
  return {
    model: spec.model,
    messages,
    tools: toolsFromOpenai(spec.tools),
    temperature: spec.temperature,
    maxTokens: spec.max_tokens,
    toolChoice: spec.tool_choice,
    reasoningEffort: spec.reasoning_effort,
    metadata: spec.metadata,
  };
}

const usage = (spec: [number, number, number, string]) =>
  new TokenUsage(spec[0], spec[1], spec[2], null, null, spec[3]);

function failure(spec: Obj): Error {
  if (spec.type === 'ProviderError')
    return new ProviderError(
      { category: spec.category as ProviderErrorCategory, safeMessage: spec.message },
      spec.usage ? usage(spec.usage) : null,
    );
  if (spec.type === 'LLMError') return new LlmError(spec.message);
  if (spec.type === 'LLMRunInterrupted') return new RunInterrupted(spec.message);
  return new Error(spec.message);
}

const response = (spec: Obj) =>
  chatResponse({ content: spec.content, usage: usage(spec.usage), finishReason: spec.finish });

/** Python 异常名到这里的类：只认引擎自己的错误类型，其余都是普通 Error。 */
function errorRecord(error: unknown): Obj {
  const type =
    error instanceof RequestEvidenceError
      ? 'RequestEvidenceError'
      : error instanceof AgentOrchestrationError
        ? 'AgentOrchestrationError'
        : error instanceof ProviderError
          ? 'ProviderError'
          : error instanceof RunInterrupted
            ? 'LLMRunInterrupted'
            : error instanceof LlmError
              ? 'LLMError'
              : 'RuntimeError';
  const carried = (error as { usage?: unknown }).usage;
  return {
    error: {
      type,
      message: (error as Error).message,
      usage: carried instanceof TokenUsage ? carried.toLegacy() : null,
    },
  };
}

/** 第 N 次写 artifact 时失败（对应预言机里第 N 次提交失败）。 */
function failingStore(base: MemoryRunStore, fail: { at: number | null; count: number }): RunStore {
  const guard = () => {
    fail.count += 1;
    if (fail.at === fail.count) throw new Error('disk full');
  };
  return new Proxy(base, {
    get(target, key, receiver) {
      if (key === 'insertArtifact' || key === 'updateArtifact')
        return async (...args: unknown[]) => {
          guard();
          return (target[key] as (...a: unknown[]) => Promise<ArtifactRecord>).apply(target, args);
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('request evidence replays the Python oracle', () => {
  it('pins the oracle sources', () => {
    expect(Object.keys(golden.sources)).toHaveLength(4);
  });

  it('builds the same request snapshots', () => {
    const specs = [
      {
        model: 'm-1',
        messages: (parseJson(golden.observer_steps[0].step_json, 'step') as Obj).request.messages,
        tools: (parseJson(golden.observer_steps[0].step_json, 'step') as Obj).request.tools,
        temperature: new JsonFloat(0.7),
        max_tokens: null,
        tool_choice: null,
        reasoning_effort: null,
        metadata: {},
        continuation_at: null,
      },
      {
        model: 'm-1',
        messages: [
          { role: 'system', content: '你是写作助手。' },
          { role: 'user', content: '看看第一章😀' },
        ],
        tools: [],
        temperature: new JsonFloat(0.7),
        max_tokens: null,
        tool_choice: null,
        reasoning_effort: null,
        metadata: { operation: 'o' },
        continuation_at: null,
      },
    ];
    specs.forEach((spec, index) =>
      expectSame(
        { output: requestSnapshot(buildRequest(spec), SOURCE, SECRETS) },
        golden.snapshots[index],
      ),
    );
  });

  it('keeps only the route origin', () => {
    for (const { url, origin } of golden.routes)
      expect(
        routeOrigin(
          url === 'api-base'
            ? { STORYFORGE_LLM_API_BASE_URL: 'https://fallback.example/x' }
            : { STORYFORGE_LLM_BASE_URL: url },
        ),
        url,
      ).toBe(origin);
  });

  it('records each model dispatch through the observed provider', async () => {
    const base = new MemoryRunStore();
    await base.insertRun({
      public_id: 'run-e',
      session_id: 'sess-e',
      assistant_session_id: 1,
      goal: 'g',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'running',
      root_plan: [],
      current_step: 'started',
    });
    const fail = { at: null as number | null, count: 0 };
    const store = failingStore(base, fail);
    let attempts = 0;
    let seen = 0;
    for (const recorded of golden.observer_steps as Obj[]) {
      const step = parseJson(recorded.step_json, 'step') as Obj;
      if (step.op === 'set_run') {
        await base.updateRun(1, {
          current_step: step.current_step,
          assistant_session_id: step.assistant_session_id,
        });
        continue;
      }
      const observation = new ModelObservation(
        new AgentRequestObserver({
          store,
          runId: 1,
          secrets: SECRETS,
          newAttemptId: () => `attempt-${++attempts}`,
        }),
      );
      const scripted: LlmProvider = {
        async complete() {
          for (const values of step.progress ?? []) observation.progress(values);
          if (step.raise) throw failure(step.raise);
          return response(step.reply);
        },
        async *stream(): AsyncIterable<StreamEvent> {
          for (const values of step.progress ?? []) observation.progress(values);
          for (const event of step.events) {
            if (event.raise) throw failure(event.raise);
            if ('text' in event) yield { kind: 'text_delta', text: event.text };
            else if ('usage' in event) yield { kind: 'usage', usage: usage(event.usage) };
            else {
              const final = response(event.completed);
              yield {
                kind: 'completed',
                response: final,
                usage: event.no_event_usage ? null : final.usage,
              };
            }
          }
        },
      };
      const provider = observeProvider(scripted, SOURCE, step.scope === false ? null : observation);
      const request = buildRequest(step.request);
      fail.count = 0;
      fail.at = step.fail_commit === 'begin' ? 1 : step.fail_commit === 'finish' ? 2 : null;
      const call = async (): Promise<unknown> => {
        if (step.op === 'complete') return (await provider.complete(request)).content;
        const received: string[] = [];
        for await (const event of provider.stream(request)) {
          received.push(event.kind);
          if (step.consumer_breaks === received.length) break;
        }
        return received;
      };
      let result: Obj;
      try {
        result = {
          output: step.operation
            ? await observation.withOperation(step.operation, expand(step.provenance) as Obj, call)
            : await call(),
        };
      } catch (error) {
        result = errorRecord(error);
      }
      fail.at = null;
      const created = (await base.artifacts(1)).filter((row) => row.id > seen);
      if (created.length) seen = created[created.length - 1].id;
      expectSame(result, recorded.result);
      expectSame(
        created.map((row) => ({ id: row.id, kind: row.kind, payload: row.payload })),
        recorded.artifacts,
      );
    }
  });
});

describe('hidden system jobs replay the Python oracle', () => {
  it('derives the same titles', () => {
    for (const { text, title } of golden.titles) expect(deriveTitle(text), text).toBe(title);
  });

  it('builds the same job plans', () => {
    for (const recorded of golden.system_jobs as Obj[]) {
      const input = parseJson(recorded.case_json, 'case') as Obj;
      const plans = buildConversationSystemJobs({
        assistantSessionId: 5,
        currentTitle: input.title,
        messages: input.messages as MessageRow[],
        result: input.result,
        compactionPayload: input.compaction,
      });
      expectSame(
        plans.map((plan) => ({
          key: plan.key,
          event_payload: plan.eventPayload,
          result_payload: plan.resultPayload,
          artifact_kind: plan.artifactKind,
          artifact_payload: plan.artifactPayload,
        })),
        recorded.plans,
      );
    }
  });

  it.each((golden.compactions as Obj[]).map((item) => [item.id, item] as const))(
    'compaction job: %s',
    async (_id, recorded) => {
      const input = parseJson(recorded.case_json, 'case') as Obj;
      const messages: MessageRow[] = (input.messages as [string, unknown][]).map(
        ([role, content], index) => ({
          id: index + 1,
          role,
          content: Array.isArray(content)
            ? (content[0] as string).repeat(content[1] as number)
            : (content as string),
        }),
      );
      const toolCalls: ToolCallRow[] = ((input.tool_calls ?? []) as [string, Obj][]).map(
        ([name, summary], index) => ({
          id: index + 1,
          tool_name: name,
          status: 'completed',
          input_summary: summary,
          output_summary: {},
          related_type: null,
          related_id: null,
        }),
      );
      const store = new MemoryRunStore();
      const allArtifacts = () =>
        store.rowsAfter({ events: 0, artifacts: 0, subagents: 0 }).artifacts;
      const sessionArtifacts = async () => {
        const runs = new Set((await store.runsOfAssistantSession(1)).map((run) => run.id));
        return allArtifacts().filter((row) => runs.has(row.run_id));
      };
      const conversation: ConversationSources = {
        messages: async () => messages,
        toolCalls: async () => toolCalls,
        runEvents: async () => [],
        runArtifacts: sessionArtifacts,
        artifact: async (id) => (await sessionArtifacts()).find((row) => row.id === id) ?? null,
      };
      const assistant = {
        async createToolCall(_sessionId, call) {
          const row = {
            id: toolCalls.length + 1,
            related_type: null,
            related_id: null,
            output_summary: {},
            ...call,
          };
          toolCalls.push(row);
          return { id: row.id, input_summary: row.input_summary };
        },
      } as AssistantStore;
      await store.insertRun({
        public_id: 'run-c',
        session_id: 'sess-c',
        assistant_session_id: null,
        goal: 'g',
        scope: {},
        permission_profile: 'ask',
        budget: {},
        status: 'running',
        root_plan: [],
        current_step: 'agent.loop',
      });
      let attempts = 0;
      const observation = new ModelObservation(
        new AgentRequestObserver({
          store,
          runId: 1,
          secrets: SECRETS,
          newAttemptId: () => `attempt-${++attempts}`,
        }),
      );
      const mode = input.mode as string;
      const scripted: LlmProvider = {
        async complete(request) {
          if (mode === 'LLMError' || mode === 'ProviderError' || mode === 'LLMRunInterrupted')
            throw failure({
              type: mode,
              message: mode === 'LLMRunInterrupted' ? 'paused' : '压缩失败',
              category: 'timeout',
              usage: [12, 5, 17, 'provider_usage'],
            });
          if (mode === 'bad_json')
            return chatResponse({
              content: '不是 JSON',
              usage: usage([12, 5, 17, 'provider_usage']),
              finishReason: 'stop',
            });
          const modelInput = parseJson(request.messages[1].content!, 'input') as Obj;
          const entries = (modelInput.new_sources as Obj[]).map((source) => ({
            category: 'decision',
            text: `摘要 ${source.key}`,
            source_id: source.key,
            quote: Array.from(source.content as string)
              .slice(0, 10)
              .join(''),
          }));
          return chatResponse({
            content: JSON.stringify({ entries }),
            usage: usage([12, 5, 17, 'provider_usage']),
            finishReason: mode === 'length' ? 'length' : 'stop',
          });
        },
        stream: () => {
          throw new Error('unused');
        },
      };
      const source = Object.fromEntries(
        Object.entries({ ...SOURCE, ...(input.source ?? {}) }).filter(
          ([, value]) => value !== null,
        ),
      ) as Record<string, string>;
      const control = new RunControl({
        checkInterruption: (boundary) => (boundary === input.interrupt_at ? 'paused' : null),
        clock: () => 0,
        wait: async () => {},
      });
      const compact = () =>
        prepareConversationCompaction(
          {
            conversation,
            assistant,
            source,
            secrets: SECRETS,
            buildProvider: (resolved) => observeProvider(scripted, resolved, observation),
            control,
            observation,
          },
          1,
        );
      if (input.more) {
        // 父检查点挂在本会话的一个 run 上，之后又来了新消息。
        const sessionRun = await store.insertRun({
          public_id: 'run-s',
          session_id: 'sess-s',
          assistant_session_id: 1,
          goal: 'g',
          scope: {},
          permission_profile: 'ask',
          budget: {},
          status: 'completed',
          root_plan: [],
          current_step: null,
        });
        const parent = (await compact()) as JsonObject;
        await store.insertArtifact({
          run_id: sessionRun.id,
          kind: 'system_compaction',
          payload: parent,
          requires_confirmation: false,
        });
        for (const [role, content] of input.more as [string, string][])
          messages.push({ id: messages.length + 1, role, content });
      }
      let result: Obj;
      try {
        result = { output: await compact() };
      } catch (error) {
        result = errorRecord(error);
      }
      expectSame(result, recorded.result);
      expectSame(
        toolCalls.map(({ id, tool_name, status, input_summary, output_summary }) => ({
          id,
          tool_name,
          status,
          input_summary,
          output_summary,
        })),
        recorded.tool_calls,
      );
      expectSame(
        allArtifacts().map((row) => ({
          id: row.id,
          kind: row.kind,
          payload: row.payload,
        })),
        recorded.artifacts,
      );
    },
  );
});

describe('model observation wiring', () => {
  async function evidenceRun() {
    const store = new MemoryRunStore();
    await store.insertRun({
      public_id: 'run-w',
      session_id: 'sess-w',
      assistant_session_id: 1,
      goal: 'g',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'running',
      root_plan: [],
      current_step: null,
    });
    return store;
  }
  const request: ChatRequest = {
    model: 'm-1',
    messages: [new ChatMessage('user', '你好')],
    tools: [],
    temperature: null,
    maxTokens: null,
    toolChoice: null,
    reasoningEffort: null,
  };
  const reply = chatResponse({
    content: '好',
    usage: usage([1, 1, 2, 'provider_usage']),
    finishReason: 'stop',
  });
  const observer = (store: RunStore) =>
    new AgentRequestObserver({ store, runId: 1, secrets: SECRETS, newAttemptId: () => 'a' });

  it('restores the operation and leaves the attempt after each dispatch', async () => {
    const store = await evidenceRun();
    const observation = new ModelObservation(observer(store));
    const provider = observeProvider(
      {
        complete: async () => reply,
        async *stream() {
          yield { kind: 'completed', response: reply, usage: reply.usage };
        },
      },
      SOURCE,
      observation,
    );
    await observation.withOperation('outer', { n: 1 }, async () => {
      await observation.withOperation('inner', null, () => provider.complete(request));
      await provider.complete(request);
    });
    for await (const _event of provider.stream(request));
    // 派发结束后当前派发已退出：迟到的传输进度不会写到已结算的证据上。
    observation.progress({ phase: 'request_started', request_number: 9 });
    await provider.complete(request);
    const rows = await store.artifacts(1);
    expect(rows.map((row) => [row.payload.step, row.payload.context_provenance])).toEqual([
      ['inner', {}],
      ['outer', { n: 1 }],
      ['agent.model', {}],
      ['agent.model', {}],
    ]);
    expect(rows.map((row) => row.payload.transport_progress)).toEqual([[], [], [], []]);
  });

  it('fails the settlement when a progress write was lost', async () => {
    const base = await evidenceRun();
    const store = failingStore(base, { at: 2, count: 0 });
    const observation = new ModelObservation(observer(store));
    const provider = observeProvider(
      {
        complete: async () => {
          observation.progress({ phase: 'request_started', request_number: 1 });
          return reply;
        },
        stream: () => {
          throw new Error('unused');
        },
      },
      SOURCE,
      observation,
    );
    const error = await provider.complete(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestEvidenceError);
    expect((error as { usage?: TokenUsage }).usage?.totalTokens).toBe(2);
    expect((await base.artifacts(1)).map((row) => row.payload.status)).toEqual(['prepared']);
  });

  it('wraps every SDK provider built inside an observed run', async () => {
    const store = await evidenceRun();
    const body = new TextEncoder().encode(
      JSON.stringify({
        choices: [{ message: { content: '好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    );
    const provider = sdkProvider(
      SOURCE,
      {},
      {
        http: {
          send: async () => ({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: (async function* () {
              yield body;
            })(),
            close: () => {},
          }),
        },
        clock: () => 0,
        wait: async () => {},
        random: () => 0,
        appVersion: 't',
        secrets: SECRETS,
        observation: new ModelObservation(observer(store)),
      },
    );
    await provider.complete(request);
    const rows = await store.artifacts(1);
    expect(rows.map((row) => [row.kind, row.payload.status])).toEqual([
      ['model_request_evidence', 'response_completed'],
    ]);
  });
});
