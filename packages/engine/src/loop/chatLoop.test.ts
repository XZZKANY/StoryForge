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
import { listLoopToolSpecs } from './tools/catalog';
import { toolDefinitionFromSpec, type ToolResult } from './tools/execution';
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
        { category: spec.category as ProviderErrorCategory, safeMessage: spec.message },
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
/** 唯一接受的差异：Python 对目录调 fs_read 时检查点来源指纹抛错，整轮以基础设施失败结束。 */
const DIRECTORY_READ = 'fs-read-directory';

describe('chat loop replays the Python oracle', () => {
  it('pins the oracle sources and scenario count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(7);
    expect(scenarios).toHaveLength(36);
  });

  it.each(scenarios.filter(([id]) => id !== DIRECTORY_READ))('%s', async (_id, scenario) => {
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

  it('keeps going when the model reads a directory (Python fails the whole turn)', async () => {
    const scenario = scenarios.find(([id]) => id === DIRECTORY_READ)![1];
    expect(scenario.outcome.execution_outcome).toEqual({
      status: 'failed',
      code: 'runtime_infrastructure',
      message: '本轮未完成：Checkpoint store failed.',
    });
    const { record, outcome } = await replay(scenario);
    expect(outcome!.executionOutcome).toBeNull();
    expect(outcome!.answer).toBe('那是目录。');
    expect(record.unused_model_steps).toBe(0);
    expect(record.traces).toEqual([
      {
        tool_name: 'fs.read',
        status: 'failed',
        input_summary: { path: '正文' },
        error_message: '不是文件：正文',
        assistant_tool_call_id: 1,
      },
    ]);
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
  it('rejects a checkpoint for another run', () => {
    const context = bareContext();
    const store = new StoryForgeCheckpointStore(context, new LoopCheckpointStore());
    store.modelStarted({ model: 'm', messages: [], tools: [] } as unknown as ChatRequest);
    const other = new RuntimeCheckpoint({ ...context.latestCheckpoint!, runId: 'run-2' });
    expect(() => store.save(other)).toThrow('checkpoint_identity_mismatch');
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
