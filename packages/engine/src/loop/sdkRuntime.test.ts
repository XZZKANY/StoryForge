import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-sdk-runtime.json';
import {
  cloneJson,
  dumpJson,
  isJsonObject,
  parseJson,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import {
  chatResponse,
  ChatMessage,
  messagesFromOpenai,
  ProviderError,
  TokenUsage,
  ToolCall,
  ToolSpec,
  type ChatRequest,
  type ProviderErrorCategory,
} from '../llm/contracts';
import { ToolCallingRuntime } from './sdkLoop';
import {
  DefaultRuntimePolicy,
  InMemoryCheckpointStore,
  utcIsoTimestamp,
  type RuntimeProvider,
} from './sdkPorts';
import {
  RuntimeCheckpoint,
  runtimeLimits,
  type PendingToolCall,
  type RuntimeLimits,
} from './sdkState';
import {
  parseToolArguments,
  runtimeArtifact,
  runtimeTool,
  RuntimeToolResult,
  ToolRegistry,
  validateJsonSchema,
  type RuntimeTool,
} from './sdkTools';

type Obj = { [key: string]: unknown };
const plain = (value: unknown): unknown => JSON.parse(dumpJson(value, { ensureAscii: false }));

const usageOf = (spec: JsonValue | undefined) =>
  Array.isArray(spec)
    ? new TokenUsage(
        spec[0] as number,
        spec[1] as number,
        spec[2] as number,
        null,
        null,
        spec[3] as string,
      )
    : new TokenUsage();

const messageRecord = (message: ChatMessage) => {
  const row: Obj = message.toOpenai();
  if (message.continuation !== null) row.continuation = message.continuation;
  return row;
};

class ScriptedFailure extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage | null,
  ) {
    super(message);
  }
}

const LIMIT_KEYS: Record<string, keyof RuntimeLimits> = {
  max_rounds: 'maxRounds',
  max_tool_calls: 'maxToolCalls',
  max_tool_output_chars: 'maxToolOutputChars',
  max_tokens: 'maxTokens',
  max_cost: 'maxCost',
  final_message: 'finalMessage',
};
const limitsOf = (fields: JsonObject) =>
  runtimeLimits(
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        LIMIT_KEYS[key],
        typeof value === 'object' && value !== null && 'value' in value ? value.value : value,
      ]),
    ) as Partial<RuntimeLimits>,
  );

/** 把 golden 里的 Python 检查点字典读成 TS 检查点；外部写回字段不在 TS 契约里。 */
function checkpointFromPython(raw: JsonObject): RuntimeCheckpoint {
  const copy = cloneJson(raw);
  expect(copy.external_operation_id ?? null).toBeNull();
  delete copy.external_operation_id;
  return RuntimeCheckpoint.fromDict(copy);
}

async function runScenario(spec: JsonObject) {
  const tools = spec.tools as JsonObject[];
  const storeOptions = (spec.store ?? {}) as JsonObject;
  const tracerOptions = (spec.tracer ?? {}) as JsonObject;
  const sinkOptions = (spec.usage_sink ?? {}) as JsonObject;
  const policyOptions = (spec.policy ?? {}) as JsonObject;
  const events: unknown[] = [];
  const saves: unknown[] = [];
  const usage: unknown[] = [];
  let saveCount = 0;
  const control = {
    reason: null as string | null,
    counts: new Map<string, number>(),
    rules: [] as JsonObject[],
  };
  const trigger = (kind: string, value: string | null) => {
    control.rules.forEach((rule, index) => {
      if (rule.on !== kind || ('match' in rule && rule.match !== value)) return;
      const key = `${kind}:${index}`;
      const count = (control.counts.get(key) ?? 0) + 1;
      control.counts.set(key, count);
      if (control.reason === null && count === ((rule.nth as number) ?? 1))
        control.reason = rule.reason as string;
    });
  };
  let log: Obj = {};
  let stepSpec: JsonObject = {};
  let responses: JsonObject[] = [];

  const store = new (class extends InMemoryCheckpointStore {
    save(checkpoint: RuntimeCheckpoint) {
      saveCount += 1;
      if (saveCount === storeOptions.fail_nth) {
        saves.push({ failed_save: saveCount });
        throw new Error('disk full');
      }
      saves.push(checkpoint.toDict());
      super.save(checkpoint);
      trigger('save', checkpoint.phase);
    }
  })();
  const tracer = {
    emit(event: { sequence: number; roundNumber: number; kind: string; payload: JsonObject }) {
      if (event.kind === tracerOptions.fail) {
        events.push({ failed_emit: event.kind, sequence: event.sequence });
        throw new Error('tracer down');
      }
      events.push([event.sequence, event.roundNumber, event.kind, event.payload]);
      trigger('event', event.kind);
    },
  };
  const sink = {
    record(runId: string, round: number, value: TokenUsage) {
      usage.push([runId, round, value.toLegacy()]);
      if (sinkOptions.fail) throw new Error('ledger down');
      const cost = sinkOptions.cost_per_1k;
      if (cost === undefined || cost === null || value.source === 'unavailable') return null;
      const rate = typeof cost === 'number' ? cost : (cost as { value: number }).value;
      return (value.totalTokens * rate) / 1000;
    },
  };
  const policy = new (class extends DefaultRuntimePolicy {
    decideTool(tool: RuntimeTool, call: PendingToolCall, context: unknown) {
      (log.policy as unknown[]).push([
        tool.spec.name,
        call.callId,
        call.arguments,
        call.attempt,
        context,
      ]);
      const deny = (policyOptions.deny ?? {}) as JsonObject;
      if (Object.prototype.hasOwnProperty.call(deny, tool.spec.name))
        return { kind: 'deny' as const, reason: deny[tool.spec.name] as string | null };
      return super.decideTool(tool, call, context);
    }
    canResumeStartedTool(tool: RuntimeTool, call: PendingToolCall) {
      if ('can_resume' in policyOptions) return policyOptions.can_resume as boolean;
      return super.canResumeStartedTool(tool, call);
    }
  })((policyOptions.max_tool_attempts as number) ?? 2);
  const selector = {
    select(registry: ToolRegistry) {
      log.selects = (log.selects as number) + 1;
      trigger('select', null);
      const choices = stepSpec.select as string[][] | null;
      if (choices === null) return registry.all();
      const names = choices[Math.min(log.selects as number, choices.length) - 1];
      return registry.all().filter((tool) => names.includes(tool.spec.name));
    },
  };
  const provider: RuntimeProvider = {
    async complete(request: ChatRequest) {
      (log.requests as unknown[]).push({
        model: request.model,
        messages: request.messages.map(messageRecord),
        tools: request.tools.map((tool) => tool.toOpenai()),
      });
      const item = responses.shift()!;
      if (isJsonObject(item.provider_error)) {
        const error = item.provider_error;
        throw new ProviderError(
          {
            category: error.category as ProviderErrorCategory,
            safeMessage: error.message as string,
          },
          error.usage === null ? null : usageOf(error.usage),
        );
      }
      if ('raise' in item)
        throw new ScriptedFailure(
          item.raise as string,
          item.usage === null ? null : usageOf(item.usage),
        );
      const continuation = item.continuation as JsonObject | undefined;
      return chatResponse({
        content: item.content as string,
        toolCalls: (item.tool_calls as string[][]).map(
          ([id, name, args]) => new ToolCall(id, name, args),
        ),
        usage: usageOf(item.usage),
        finishReason: item.finish_reason as string | null,
        continuation: continuation
          ? { provider: continuation.provider as string, state: continuation.state as JsonObject }
          : null,
      });
    },
  };
  const registry = new ToolRegistry(
    tools.map((tool) =>
      runtimeTool(
        new ToolSpec(
          tool.name as string,
          tool.description as string,
          tool.input_schema as JsonObject,
        ),
        (context, args) => {
          const name = tool.name as string;
          (log.handlers as unknown[]).push([name, args, context]);
          const item = (stepSpec.handlers as Record<string, JsonObject[]>)[name].shift()!;
          if ('raise' in item) throw new Error(item.raise as string);
          if ('failure' in item) {
            const [code, message, retryable] = item.failure as [string, string, boolean];
            return RuntimeToolResult.failure(code, message, retryable);
          }
          return RuntimeToolResult.success(
            item.success as JsonObject,
            (item.artifacts as [string, JsonObject, string | null][]).map(([kind, payload, ref]) =>
              runtimeArtifact(kind, payload, ref),
            ),
          );
        },
        {
          outputSchema: (tool.output_schema ?? {}) as JsonObject,
          retrySafe: (tool.retry_safe as boolean) ?? false,
          idempotent: (tool.idempotent as boolean) ?? false,
        },
      ),
    ),
  );

  const steps: Obj[] = [];
  const firstRunId = (spec.steps as JsonObject[])[0].run_id as string;
  for (const raw of spec.steps as JsonObject[]) {
    stepSpec = cloneJson(raw);
    log = { requests: [], handlers: [], policy: [], selects: 0, interruptions: [] };
    events.length = 0;
    saves.length = 0;
    usage.length = 0;
    control.reason = null;
    control.counts.clear();
    control.rules = stepSpec.interrupt as JsonObject[];
    responses = stepSpec.responses as JsonObject[];
    const resume = stepSpec.resume;
    let checkpoint: RuntimeCheckpoint | null = null;
    if (resume === 'store' || resume === 'store_roundtrip') {
      checkpoint = store.load(firstRunId)!;
      if (resume === 'store_roundtrip')
        checkpoint = RuntimeCheckpoint.fromDict(
          parseJson(dumpJson(checkpoint.toDict()), 'checkpoint'),
        );
    } else if (isJsonObject(resume)) {
      checkpoint = checkpointFromPython(resume.checkpoint as JsonObject);
    }
    const runtime = new ToolCallingRuntime(provider, registry, {
      policy,
      selector,
      tracer,
      usageSink: sink,
      checkpoints: store,
      interruption: (runId, boundary, cp) => {
        trigger('boundary', boundary);
        (log.interruptions as unknown[]).push([
          runId,
          boundary,
          cp.phase,
          cp.roundCount,
          cp.sequence,
          cp.toolAttempts,
          cp.pending === null ? null : [cp.pending.callId, cp.pending.attempt],
          control.reason,
        ]);
        return control.reason;
      },
      diagnosticTraceBestEffort: (spec.best_effort as boolean | undefined) ?? true,
      now: () => '2026-10-12T00:00:00+00:00',
    });
    const row: Obj = {};
    try {
      const result = await runtime.run(messagesFromOpenai(stepSpec.messages as JsonObject[]), {
        model: stepSpec.model as string,
        runId: stepSpec.run_id as string,
        limits: limitsOf(stepSpec.limits as JsonObject),
        applicationContext: stepSpec.context,
        resume: checkpoint
          ? { checkpoint, command: (stepSpec.command as 'continue' | null) ?? null }
          : null,
      });
      row.result = {
        status: result.status,
        run_id: result.runId,
        content: result.content,
        messages: result.messages.map(messageRecord),
        artifacts: result.artifacts.map((a) => [a.kind, a.payload, a.reference]),
        total_tokens: result.totalTokens,
        total_cost: result.totalCost,
        usage_available: result.usageAvailable,
        cost_available: result.costAvailable,
        tool_attempts: result.toolAttempts,
        exhausted: result.exhausted,
        error_code: result.errorCode,
        error_message: result.errorMessage,
        checkpoint: result.checkpoint === null ? null : result.checkpoint.toDict(),
        pending_tool_call_id: result.pendingToolCallId,
      };
    } catch (error) {
      if (!(error instanceof ScriptedFailure)) throw error;
      row.raised = error.message;
    }
    const handlers = stepSpec.handlers as Record<string, JsonObject[]>;
    row.unused = {
      responses: responses.length,
      handlers: Object.fromEntries(
        Object.entries(handlers)
          .filter(([, items]) => items.length)
          .map(([key, items]) => [key, items.length]),
      ),
    };
    Object.assign(row, { events: [...events], saves: [...saves], usage: [...usage] }, log);
    steps.push(row);
  }
  return steps;
}

type GoldenStep = { saves: Obj[]; result?: { checkpoint: Obj | null } };
const stripExternal = (steps: GoldenStep[]) =>
  steps.map((step) => ({
    ...step,
    saves: step.saves.map((save) => {
      const { external_operation_id: _ignored, ...rest } = save;
      return 'failed_save' in save ? save : rest;
    }),
    ...(step.result
      ? {
          result: {
            ...step.result,
            checkpoint:
              step.result.checkpoint === null
                ? null
                : (({ external_operation_id: _x, ...rest }) => rest)(step.result.checkpoint),
          },
        }
      : {}),
  }));

describe('P3-1 SDK 工具循环（Python ToolCallingRuntime 预言机）', () => {
  it.each(golden.runs.map((run) => [run.id, run] as const))('%s', async (_id, run) => {
    const spec = parseJson(run.spec_json, 'spec') as JsonObject;
    const actual = plain(await runScenario(spec));
    expect(actual).toEqual(plain(stripExternal(run.steps as unknown as GoldenStep[])));
  });

  it('schema 校验逐条一致', () => {
    for (const item of golden.validation) {
      const value = parseJson(item.value_json, 'value');
      const issues = validateJsonSchema(value, item.schema as unknown as JsonObject);
      expect(
        issues.map((issue) => [issue.path, issue.code, issue.message]),
        item.value_json,
      ).toEqual(item.issues);
    }
  });

  it('工具参数解析逐条一致', () => {
    const tool = runtimeTool(
      new ToolSpec('lookup', '', {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      }),
      () => RuntimeToolResult.failure('x', 'x'),
    );
    for (const item of golden.parse_arguments) {
      const parsed = parseToolArguments(new ToolCall('c', 'lookup', item.arguments_json), tool);
      expect(
        {
          parsed: parsed.args === null ? null : plain(parsed.args),
          failure: parsed.failure && [parsed.failure.errorCode, parsed.failure.errorMessage],
        },
        item.arguments_json,
      ).toEqual({ parsed: item.parsed, failure: item.failure });
    }
  });

  it('限额校验文案一致', () => {
    for (const item of golden.limits) {
      let error: string | null = null;
      try {
        limitsOf(item.fields as JsonObject);
      } catch (caught) {
        error = (caught as Error).message;
      }
      expect(error, JSON.stringify(item.fields)).toBe(item.error);
    }
  });

  it('检查点字典往返不丢字段，形状不符直接报错', () => {
    const saved = golden.runs.flatMap((run) =>
      (stripExternal(run.steps as unknown as GoldenStep[]) as GoldenStep[]).flatMap((step) =>
        step.saves.filter((save) => !('failed_save' in save)),
      ),
    );
    expect(saved.length).toBeGreaterThan(200);
    for (const raw of saved) {
      const dict = parseJson(JSON.stringify(raw), 'checkpoint');
      expect(plain(RuntimeCheckpoint.fromDict(dict).toDict())).toEqual(raw);
    }
    const base = saved[0];
    for (const broken of [
      { ...base, phase: 'approval_required' },
      { ...base, round_count: '1' },
      {
        ...base,
        messages: [
          { role: 'robot', content: null, tool_calls: [], tool_call_id: null, name: null },
        ],
      },
      { ...base, pending: { call_id: 'c', name: 'n', arguments: [], attempt: 0 } },
      { ...base, usage_available: 1 },
    ])
      expect(() => RuntimeCheckpoint.fromDict(parseJson(JSON.stringify(broken), 'cp'))).toThrow();
  });

  it('轨迹时间戳与 Python isoformat 同形', () => {
    expect(utcIsoTimestamp(new Date(Date.UTC(2026, 9, 12, 1, 2, 3, 45)))).toBe(
      '2026-10-12T01:02:03.045000+00:00',
    );
    expect(utcIsoTimestamp(new Date(Date.UTC(2026, 9, 12, 1, 2, 3, 0)))).toBe(
      '2026-10-12T01:02:03+00:00',
    );
  });

  it('模型参数超出标准 JSON 时按非法 JSON 反馈（接受的差异）', () => {
    const tool = runtimeTool(new ToolSpec('t', '', { type: 'object' }), () =>
      RuntimeToolResult.failure('x', 'x'),
    );
    for (const raw of [
      '{"n":NaN}',
      '{"n":Infinity}',
      '{"n":12345678901234567890}',
      '{"s":"\\ud800"}',
    ])
      expect(parseToolArguments(new ToolCall('c', 't', raw), tool).failure?.errorMessage).toBe(
        'Tool arguments are not valid JSON.',
      );
  });

  it('运行时拿到的是 ChatMessage 副本，调用方后续改动不影响', async () => {
    const messages = [new ChatMessage('user', 'hi')];
    const runtime = new ToolCallingRuntime(
      { complete: async () => chatResponse({ content: 'ok' }) },
      new ToolRegistry(),
    );
    const pending = runtime.run(messages, { model: 'm', runId: 'r', limits: runtimeLimits() });
    messages.push(new ChatMessage('user', 'late'));
    expect((await pending).messages.map((m) => m.content)).toEqual(['hi', 'ok']);
  });
});
