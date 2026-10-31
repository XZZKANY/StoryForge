import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-chat-loop.windows.json';
import type { AssistantStore } from '../assistant/service';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { FsToolError } from '../kernel/fsTools';
import { dumpJson, JsonFloat, parseJson, type JsonValue } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { sha256Hex } from '../kernel/sha256';
import { LlmConfigError } from '../llm/config';
import {
  chatResponse,
  ProviderError,
  TokenUsage,
  ToolCall,
  type ChatMessage,
  type ChatRequest,
  type ProviderErrorCategory,
  type StreamEvent,
} from '../llm/contracts';
import { RunInterrupted } from '../llm/control';
import { LlmError } from '../llm/payload';
import { ChatLoopUnavailableError, runChatLoop } from './chatLoop';
import {
  buildStoryforgeToolRegistry,
  StoryForgeRuntimePolicy,
  type LoopProvider,
} from './chatLoopAdapters';
import {
  LoopCheckpointStore,
  StoryForgeCheckpointStore,
  type SavedLoopCheckpoint,
} from './chatLoopCheckpoints';
import { StoryForgeRuntimeContext, type RuntimeContextFields } from './chatLoopContext';
import { ChatLoopOutcome } from './chatLoopTypes';
import type { ConversationSources } from './conversationHistory';
import { RunControlScope } from './runControl';
import { pendingToolCall, RuntimeCheckpoint } from './sdkState';
import type { TextFrame } from './textStream';
import { listLoopToolSpecs, llmToolName } from './tools/catalog';
import {
  toolDefinitionFromSpec,
  type ToolExecutionContext,
  type ToolResult,
} from './tools/execution';
import { buildRuntimeInterruptionPayload, traceAsDict } from './traces';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 脚本按 Python 预言机的 JSON 形状读
const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const SECRET = golden.secret;

/** 与预言机的 stable() 相同：项目根换成占位串（含 JSON 转义后的写法）。 */
const ESCAPED_ROOTS = [ROOT, ROOT.replace(/\\/g, '/')].map((root) =>
  JSON.stringify(root).slice(1, -1),
);
const stable = (value: unknown): JsonValue => {
  let text = dumpJson(value, { ensureAscii: false });
  for (const root of ESCAPED_ROOTS) text = text.split(root).join('$ROOT');
  return parseJson(text, 'stable');
};
/** 数值比较不看 Python 的 int / float 之分（2 与 2.0 同值）。 */
const plain = (value: unknown): unknown => {
  if (value instanceof JsonFloat) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
};
const canonical = (value: unknown) =>
  dumpJson(plain(value), { ensureAscii: false, sortKeys: true });
const cpLen = (text: string) => Array.from(text).length;
const compactContent = (message: Obj): Obj =>
  typeof message.content === 'string' && cpLen(message.content) > 300
    ? {
        ...message,
        content: { sha256: sha256Hex(message.content), length: cpLen(message.content) },
      }
    : message;

const encoded = (text: string): EncodedFile => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const FILES = Object.fromEntries(
  Object.entries(golden.files).map(([path, text]) => [path, encoded(text)]),
);
const emptyConversation: ConversationSources = {
  messages: async () => [],
  toolCalls: async () => [],
  runEvents: async () => [],
  runArtifacts: async () => [],
  artifact: async () => null,
};

function usage(spec: unknown[] | null | undefined): TokenUsage {
  if (!spec) return new TokenUsage();
  const [input, output, total, source] = spec as [number, number, number, string];
  return new TokenUsage(input, output, total, null, null, source);
}

function failure(spec: Obj): Error {
  switch (spec.type) {
    case 'ProviderError':
      return new ProviderError(
        {
          category: spec.category as ProviderErrorCategory,
          safeMessage: spec.message,
          statusCode: spec.status_code ?? null,
          providerCode: spec.provider_code ?? null,
          requestId: spec.request_id ?? null,
        },
        spec.usage ? usage(spec.usage) : null,
      );
    case 'LLMError':
      return new LlmError(spec.message);
    case 'LLMRunInterrupted':
      return new RunInterrupted(spec.message);
    case 'FsToolError':
      return new FsToolError(spec.message);
    default:
      return new Error(spec.message);
  }
}

/** 与 Python 预言机同一套内存证据存储：只记显式操作，id 从 1 起。 */
function evidenceStore(ops: Obj[]): AssistantStore {
  let next = 1;
  return {
    createSession: async () => {
      throw new Error('unused');
    },
    getSession: async () => {
      throw new Error('unused');
    },
    appendMessage: async () => {
      throw new Error('unused');
    },
    async createToolCall(sessionId, input) {
      ops.push({ op: 'create_tool_call', session_id: sessionId, ...input });
      return { id: next++, input_summary: input.input_summary };
    },
    async updateToolCall(id, patch) {
      ops.push({ op: 'update_tool_call', id, ...patch });
      return { id, input_summary: patch.input_summary ?? {} };
    },
  };
}

function checkpointDigest(saved: SavedLoopCheckpoint): Obj {
  const checkpoint = saved.checkpoint.toDict();
  return {
    phase: checkpoint.phase,
    round_count: checkpoint.round_count,
    sequence: checkpoint.sequence,
    dispatch_state: saved.dispatchState,
    checkpoint_sha256: sha256Hex(canonical(stable(checkpoint))),
    outcome_sha256: sha256Hex(canonical(stable(saved.outcome))),
  };
}

function checkpointView(saved: SavedLoopCheckpoint): Obj {
  const checkpoint = stable(saved.checkpoint.toDict()) as Obj;
  checkpoint.messages = checkpoint.messages.map(compactContent);
  return {
    checkpoint,
    outcome: stable(saved.outcome),
    dispatch_state: saved.dispatchState,
    permission_profile: saved.permissionProfile,
    assistant_session_id: saved.assistantSessionId,
    resume_message: stable(saved.resumeMessage),
  };
}

function outcomeRecord(outcome: ChatLoopOutcome): Obj {
  return {
    answer: outcome.answer,
    rounds: outcome.rounds,
    tool_call_count: outcome.toolCallCount,
    completion_tokens: outcome.completionTokens,
    prompt_tokens: outcome.promptTokens,
    token_usage: outcome.tokenUsage,
    token_usage_source: outcome.tokenUsageSource,
    cost_cny_estimated: outcome.costCnyEstimated,
    cost_breakdown: outcome.costBreakdown,
    exhausted: outcome.exhausted,
    execution_outcome: outcome.executionOutcome,
    review_report: outcome.reviewReport,
    proposed_patch: outcome.proposedPatch,
    interrupted: outcome.interrupted,
    interruption: outcome.interruption,
    artifacts: outcome.artifacts,
    traces: outcome.traces.map(traceAsDict),
  };
}

type Replay = { record: Obj; outcome: ChatLoopOutcome | null; error: unknown };

async function replay(scenario: Obj): Promise<Replay> {
  const spec = parseJson(scenario.spec_json, 'spec') as Obj;
  const project = memoryProject(ROOT, FILES);
  const run = { public_id: 'run-1', permission_profile: spec.profile as string };
  const state = { status: 'running', current_step: null as string | null };
  const clock = { now: 1000 };
  const requests: Obj[] = [];
  const checks: string[] = [];
  const ops: Obj[] = [];
  const traces: Obj[] = [];
  const frames: TextFrame[] = [];
  const toolCalls: Obj[] = [];
  const modelSteps: Obj[] = [...spec.model];
  const toolSteps = new Map<string, Obj[]>(
    Object.entries(spec.tools as Obj).map(([name, items]) => [name, [...(items as Obj[])]]),
  );
  const triggerCounts = (spec.triggers as Obj[]).map(() => 0);
  let streams = 0;

  const effects = (step: Obj) => {
    if (step.set_status) [state.status, state.current_step] = step.set_status;
    clock.now += step.advance instanceof JsonFloat ? step.advance.value : (step.advance ?? 0);
  };
  const shouldInterrupt = (boundary: string) => {
    checks.push(boundary);
    (spec.triggers as Obj[]).forEach((trigger, index) => {
      if (trigger.boundary !== boundary) return;
      triggerCounts[index] += 1;
      if (triggerCounts[index] === trigger.nth)
        [state.status, state.current_step] = [trigger.status, trigger.current_step];
    });
    return buildRuntimeInterruptionPayload(state, boundary);
  };
  const take = (request: ChatRequest, streaming: boolean): Obj => {
    requests.push({
      streaming,
      model: request.model,
      messages: request.messages.map((message: ChatMessage) =>
        compactContent(stable(message.toOpenai()) as Obj),
      ),
      tools: request.tools.map((tool) => tool.name),
      tools_sha256: sha256Hex(
        dumpJson(
          request.tools.map((tool) => tool.toOpenai()),
          { ensureAscii: false, sortKeys: true, separators: [',', ':'] },
        ),
      ),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tool_choice: request.toolChoice,
      reasoning_effort: request.reasoningEffort,
    });
    const step = modelSteps.shift()!;
    effects(step);
    return step;
  };
  const response = (step: Obj) =>
    chatResponse({
      content: step.content,
      toolCalls: (step.calls as string[][]).map(([id, name, args]) => new ToolCall(id, name, args)),
      usage: usage(step.usage),
      finishReason: step.finish,
      metadata: step.metadata ?? {},
    });
  const provider: LoopProvider = {
    streaming: spec.streaming,
    async complete(request) {
      const step = take(request, false);
      if (step.raise) throw failure(step.raise);
      return response(step);
    },
    async *stream(request): AsyncIterable<StreamEvent> {
      const step = take(request, true);
      for (const chunk of step.chunks ?? []) yield { kind: 'text_delta', text: chunk };
      if (step.raise) throw failure(step.raise);
      const final = response(step);
      yield { kind: 'completed', response: final, usage: final.usage };
    },
  };
  const scope = new RunControlScope(shouldInterrupt, {
    clock: () => clock.now,
    wait: async () => {},
  });
  const checkpoints = new LoopCheckpointStore();
  const definitions = listLoopToolSpecs().map((item) =>
    toolDefinitionFromSpec(item, async () => {
      throw new Error('handlers are scripted');
    }),
  );
  const source = Object.fromEntries(
    Object.entries({ ...golden.source, ...spec.source }).filter(([, value]) => value !== null),
  ) as Record<string, string>;
  let outcome: ChatLoopOutcome | null = null;
  let error: unknown = null;
  try {
    outcome = await runChatLoop(
      {
        reader: project.reader,
        conversation: emptyConversation,
        platform,
        assistant: evidenceStore(ops),
        secrets: { values: [SECRET] },
        buildProvider: () => {
          if (spec.builder_error) throw new LlmConfigError(spec.builder_error);
          return provider;
        },
        checkpoints,
        scope,
        newStreamId: () => `stream-${++streams}`,
      },
      {
        run,
        definitions,
        source,
        assistantSessionId: 1,
        userMessage: spec.user_message,
        projectPath: ROOT,
        currentFile: spec.current_file
          ? `${ROOT}${platform === 'windows' ? '\\' : '/'}${spec.current_file.replace(/\//g, platform === 'windows' ? '\\' : '/')}`
          : null,
        async executeTool(registryName, args, deliveries) {
          toolCalls.push({ registry_name: registryName, arguments: args });
          const step = toolSteps.get(registryName)!.shift()!;
          effects(step);
          for (const [toolCallId, manifest] of step.deliver ?? [])
            deliveries.record(toolCallId, manifest);
          if (step.raise) throw failure(step.raise);
          const result = step.result;
          return {
            status: result.status,
            output: result.big
              ? { ...result.output, content: '长'.repeat(result.big) }
              : result.output,
            trace: {
              tool_name: registryName,
              status: 'completed',
              input_summary: result.trace.input_summary ?? {},
              output_summary: result.trace.output_summary ?? null,
              audit_event_id: result.trace.audit_event_id ?? null,
            },
            artifacts: (result.artifacts as [string, Obj, boolean][]).map(
              ([kind, payload, flag]) => ({ kind, payload, requires_confirmation: flag }),
            ),
          } satisfies ToolResult;
        },
        onTrace: (trace) => {
          traces.push(traceAsDict(trace));
        },
        onText: spec.streaming ? (frame) => frames.push(frame) : null,
        shouldInterrupt,
      },
    );
  } catch (caught) {
    error = caught;
  }
  const history = checkpoints.history('run-1');
  return {
    outcome,
    error,
    record: {
      requests,
      checks,
      assistant_ops: ops,
      traces,
      text_frames: frames,
      tool_calls: toolCalls,
      unused_model_steps: modelSteps.length,
      unused_tool_steps: Object.fromEntries(
        [...toolSteps]
          .filter(([, items]) => items.length)
          .map(([name, items]) => [name, items.length]),
      ),
      checkpoints: history.map(checkpointDigest),
      final_checkpoint: history.length ? checkpointView(history[history.length - 1]) : null,
      run: { ...state },
      owner_interruption: scope.interruption,
    },
  };
}

const expectSame = (actual: unknown, expected: unknown) =>
  expect(plain(stable(actual))).toEqual(plain(expected));

const scenarios = (golden.scenarios as Obj[]).map((scenario) => [scenario.id, scenario] as const);

describe('chat loop replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(8);
    expect(scenarios).toHaveLength(36);
  });

  it.each(scenarios)('%s', async (_id, scenario) => {
    const { record, outcome, error } = await replay(scenario);
    if (scenario.error) {
      expect(outcome).toBeNull();
      const expected = scenario.error as Obj;
      expect((error as Error).message).toBe(expected.message);
      if (expected.type === 'ChatLoopUnavailableError')
        expect(error).toBeInstanceOf(ChatLoopUnavailableError);
      else expect(error).not.toBeInstanceOf(ChatLoopUnavailableError);
    } else {
      if (error) throw error;
      expectSame(outcomeRecord(outcome!), scenario.outcome);
    }
    for (const key of [
      'requests',
      'checks',
      'assistant_ops',
      'traces',
      'text_frames',
      'tool_calls',
      'unused_model_steps',
      'unused_tool_steps',
      'checkpoints',
      'final_checkpoint',
      'run',
      'owner_interruption',
    ])
      expectSame({ [key]: record[key] }, { [key]: scenario[key] });
  });
});

describe('provider 失败：作者看中文归类，安全摘要进证据（#505）', () => {
  const scenario = (id: string) => (golden.scenarios as Obj[]).find((item) => item.id === id)!;

  it('records the safe summary as the failure detail', async () => {
    const { outcome, error } = await replay(scenario('provider-error-with-usage'));
    if (error) throw error;
    expect(outcome!.answer).toBe(
      '本轮未完成：模型调用失败：请求太频繁或额度用完，可以稍后重试。 已完成的结果已保留。',
    );
    expect(outcome!.failureDetail).toBe('provider_rate_limit: Provider rate limited.');
  });

  it('classifies by the captured error and keeps its status, code and request id', async () => {
    const base = scenario('streaming-error');
    const spec = JSON.parse(base.spec_json);
    spec.model[0].raise = {
      type: 'ProviderError',
      category: 'response',
      message: 'Anthropic request failed (request_too_large).',
      provider_code: 'request_too_large',
      request_id: 'req_505',
      status_code: 413,
    };
    const { outcome, error } = await replay({ ...base, spec_json: JSON.stringify(spec) });
    if (error) throw error;
    expect(outcome!.answer).toBe(
      '本轮未完成：模型调用失败：发给模型的内容超出了它能处理的长度（HTTP 413），请新开会话，或减少附带的参考后再试。',
    );
    expect(outcome!.failureDetail).toBe(
      'provider_response: Anthropic request failed (request_too_large). status=413 provider_code=request_too_large request_id=req_505',
    );
  });
});

function bareContext(overrides: Partial<RuntimeContextFields> = {}): StoryForgeRuntimeContext {
  return new StoryForgeRuntimeContext({
    assistant: evidenceStore([]),
    assistantSessionId: 1,
    run: { public_id: 'run-1', permission_profile: 'ask' },
    source: {},
    secrets: { values: [] },
    definitions: new Map(),
    executeTool: async () => {
      throw new Error('unused');
    },
    onTrace: () => {},
    outcome: new ChatLoopOutcome(),
    onText: null,
    shouldInterrupt: null,
    recoveryMessage: {},
    newStreamId: () => 's',
    ...overrides,
  });
}

describe('chat loop guards', () => {
  it('rejects a checkpoint for another run', async () => {
    const context = bareContext();
    const store = new StoryForgeCheckpointStore(context, new LoopCheckpointStore(), {
      reader: memoryProject(ROOT, {}).reader,
    });
    context.recoveryMessage.args = { project_path: ROOT };
    await store.modelStarted({ model: 'm', messages: [], tools: [] } as unknown as ChatRequest);
    const other = new RuntimeCheckpoint({ ...context.latestCheckpoint!, runId: 'run-2' });
    await expect(store.save(other)).rejects.toThrow('checkpoint_identity_mismatch');
  });

  it('hands an allowed call id to the handler that claims it (续跑据此判定已处理)', async () => {
    const definitions = new Map(
      listLoopToolSpecs().map((item) => [
        item.name,
        toolDefinitionFromSpec(item, async () => {
          throw new Error('unused');
        }),
      ]),
    );
    const context = bareContext({
      definitions,
      executeTool: async (name) => ({
        status: 'completed',
        output: { entries: [], truncated: false },
        trace: { tool_name: name, status: 'completed', input_summary: {} },
      }),
    });
    context.rememberResponse(
      chatResponse({ content: '', toolCalls: [new ToolCall('c9', 'fs_list', '{}')] }),
    );
    const tool = buildStoryforgeToolRegistry(context).get('fs_list');
    const pending = pendingToolCall('c9', 'fs_list', {});
    expect(new StoryForgeRuntimePolicy(context).decideTool(tool, pending).kind).toBe('allow');
    await tool.handler(context, {});
    expect([...context.handledCallIds]).toEqual(['c9']);
  });
});

/**
 * 模型参数只在 SDK 边界按 loop_schema 校验一次；处理器入参是后端拼的另一份形状，不再按 loop_schema 校验。
 * 这条钉住前一半：不合 loop_schema 的调用到不了处理器。
 */
describe('模型参数在 SDK 边界按 loop_schema 校验', () => {
  /** 有必填就一个都不给；没有必填就把第一个字段给成错的类型。 */
  const invalidArguments = (parameters: Obj): Obj => {
    if (Array.isArray(parameters.required) && parameters.required.length) return {};
    const [key, schema] = Object.entries(parameters.properties as Obj)[0] as [string, Obj];
    return { [key]: schema.type === 'string' ? 1 : 'x' };
  };

  it('交给模型的每个工具：参数不合 loop_schema 就被拒，处理器一次都没被调用', async () => {
    const specs = new Map(listLoopToolSpecs().map((spec) => [llmToolName(spec.name), spec]));
    const handled: string[] = [];
    const definitions = listLoopToolSpecs().map((item) =>
      toolDefinitionFromSpec(item, async () => {
        handled.push(item.name);
        return {
          status: 'completed',
          output: { entries: [], truncated: false },
          trace: { tool_name: item.name, status: 'completed', input_summary: {} },
        } satisfies ToolResult;
      }),
    );
    const byName = new Map(definitions.map((definition) => [definition.name, definition]));
    const requests: ChatRequest[] = [];
    let offered: string[] = [];
    const complete = async (request: ChatRequest) => {
      requests.push(request);
      if (requests.length > 1) return chatResponse({ content: '完', finishReason: 'stop' });
      offered = request.tools.map((tool) => tool.name);
      const calls = offered.map(
        (name, index) =>
          new ToolCall(
            `bad-${index}`,
            name,
            JSON.stringify(invalidArguments(specs.get(name)!.loop_schema!.parameters)),
          ),
      );
      // 对照：同一批里一条合法调用照常走到处理器，证明这条路是通的。
      calls.push(new ToolCall('ok', 'fs_list', '{}'));
      return chatResponse({ content: '', toolCalls: calls, finishReason: 'tool_calls' });
    };
    const provider: LoopProvider = {
      streaming: false,
      complete,
      async *stream(request): AsyncIterable<StreamEvent> {
        const final = await complete(request);
        yield { kind: 'completed', response: final, usage: final.usage };
      },
    };
    const outcome = await runChatLoop(
      {
        reader: memoryProject(ROOT, FILES).reader,
        conversation: emptyConversation,
        platform,
        assistant: evidenceStore([]),
        secrets: { values: [SECRET] },
        buildProvider: () => provider,
        checkpoints: new LoopCheckpointStore(),
        scope: new RunControlScope(() => null, { clock: () => 1000, wait: async () => {} }),
        newStreamId: () => 'stream-1',
      },
      {
        run: { public_id: 'run-1', permission_profile: 'ask' },
        definitions,
        source: golden.source as Record<string, string>,
        assistantSessionId: 1,
        userMessage: '查一下',
        projectPath: ROOT,
        currentFile: null,
        executeTool: async (registryName, args) =>
          byName.get(registryName)!.handler({} as ToolExecutionContext, args),
        onTrace: () => {},
      },
    );
    expect(outcome.answer).toBe('完');
    expect(offered.filter((name) => name !== 'skill_read').sort()).toEqual(
      [...specs.keys()].filter((name) => name !== 'skill_read').sort(),
    );
    expect(handled).toEqual(['fs.list']);
    const feedback = new Map(
      requests[1].messages
        .filter((message) => message.role === 'tool')
        .map((message) => [message.toolCallId, JSON.parse(message.content!).error as string]),
    );
    offered.forEach((_name, index) =>
      expect(feedback.get(`bad-${index}`)).toMatch(
        /^工具参数解析失败：Tool arguments do not match the declared schema: /,
      ),
    );
    expect(feedback.get('ok')).toBeUndefined();
  });
});
