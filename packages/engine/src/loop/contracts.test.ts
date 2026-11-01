import { describe, expect, it } from 'vitest';
import golden from '../../golden/p3-contracts.json';
import { composeScopedInstruction, INSTRUCTION_BUDGET } from '../kernel/reviseDelivery';
import { chatResponse, ProviderError, TokenUsage, type StreamEvent } from '../llm/contracts';
import { RunControl, RunInterrupted } from '../llm/control';
import {
  authorViewFromPayload,
  authorViewHasView,
  authorViewSummary,
  buildAuthorViewBlock,
  buildPinnedContextBlock,
  cursorWindow,
} from './authorView';
import { controlAckFrame, framesForEvent, type RunEventView, type RunView } from './frames';
import {
  canonicalPermissionProfile,
  decideStage,
  decideTool,
  gateDecide,
  normalizePermissionProfile,
  patchRequiresConfirmation,
  PermissionProfileError,
} from './permission';
import {
  AgentOrchestrationError,
  budgetSummary,
  controlEventMessage,
  controlEventType,
  currentPlanStep,
  detectIntent,
  executionResultPayload,
  hasScopeKey,
  isConfirmWritebackRequest,
  messageArgs,
  messageInputSummary,
  messageText,
  payloadMessageText,
  resolveExecutionResult,
  roleHints,
  roleMentions,
  scopeStringList,
  scopeSummary,
} from './runPayloads';
import { completeWithTextStream } from './textStream';
import {
  buildRuntimeInterruptionPayload,
  buildRuntimePendingCallSummary,
  buildToolRecoveryPayload,
  normalizeRuntimeProgress,
  publicRuntimeEventPayload,
  traceAsDict,
  type AgentToolTrace,
  type ToolRecoveryPolicy,
} from './traces';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- golden 记录是任意 JSON，按函数名分派后才知道形状
type Obj = { [key: string]: any };
const secrets = { values: [golden.secret] };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const CALLS: Record<string, (a: Obj) => unknown> = {
  normalize_permission_profile: (a) => normalizePermissionProfile(a.value, a.allow_missing),
  canonical_permission_profile: (a) => canonicalPermissionProfile(a.value, a.fallback),
  patch_requires_confirmation: (a) => patchRequiresConfirmation(a.profile),
  decide_stage: (a) => decideStage(a.profile, a.stage),
  decide_tool: (a) => decideTool(a.profile, a as never, a.payload),
  gate_decide: (a) => gateDecide(a.profile, a as never, a.payload),
  is_confirm_writeback_request: (a) => isConfirmWritebackRequest(a.message),
  detect_intent: (a) => detectIntent(a.message, a.args, a.explicit),
  message_text: (a) => messageText(a.message),
  payload_message_text: (a) => payloadMessageText(a.message),
  message_args: (a) => messageArgs(a.message),
  role_hints: (a) => roleHints(a.args),
  role_mentions: (a) => roleMentions(a.args),
  scope_summary: (a) => scopeSummary(a.args),
  message_input_summary: (a) => messageInputSummary(a.message),
  has_scope_key: (a) => hasScopeKey(a.scope, ...a.keys),
  scope_string_list: (a) => scopeStringList(a.scope, a.key),
  budget_summary: (a) => budgetSummary(a.args),
  current_plan_step: (a) => currentPlanStep(a.plan),
  control_event_type: (a) => controlEventType(a.control),
  event_type_for_control_message: (a) => controlEventType(a.control),
  control_event_message: (a) => controlEventMessage(a.control),
  execution_result_payload: (a) => executionResultPayload(a.result),
  resolve_execution_result: (a) => resolveExecutionResult(a.payload, a.approved),
  author_view: (a) => {
    const view = authorViewFromPayload(a.args);
    return {
      view,
      has_view: authorViewHasView(view),
      block: buildAuthorViewBlock(view),
      summary: authorViewSummary(view),
    };
  },
  cursor_window: (a) => cursorWindow(a.content, a.line, a.before, a.after),
  build_pinned_context_block: (a) => buildPinnedContextBlock(a.block),
  trace_as_dict: (a) => traceAsDict(a.trace as AgentToolTrace),
  build_tool_recovery_payload: (a) =>
    buildToolRecoveryPayload(
      a.trace as AgentToolTrace,
      a.index,
      a.spec as ToolRecoveryPolicy | null,
    ),
  build_runtime_interruption_payload: (a) =>
    buildRuntimeInterruptionPayload({ status: a.status, current_step: a.current_step }, a.boundary),
  build_runtime_pending_call_summary: (a) =>
    buildRuntimePendingCallSummary(a.payload, a.artifact_id, a.artifact_kind),
  public_runtime_event_payload: (a) => publicRuntimeEventPayload(a.event_type, a.payload),
  normalize_runtime_progress: (a) => normalizeRuntimeProgress(a.progress),
  stream_frames: (a) => framesForEvent(a.run as RunView, a.event as RunEventView, secrets),
  control_frame: (a) => controlAckFrame(a.event),
};

const ERRORS: Record<string, new (...args: never[]) => Error> = {
  PermissionProfileError,
  ValueError: RangeError,
  AgentOrchestrationError,
};

describe('P3-2 Agent 契约（Python 预言机）', () => {
  it('逐条函数记录一致', () => {
    expect(golden.records.length).toBeGreaterThan(1500);
    const seen = new Set<string>();
    for (const record of golden.records as Obj[]) {
      const call = CALLS[record.fn];
      expect(call, record.fn).toBeDefined();
      seen.add(record.fn);
      const label = `${record.fn} ${JSON.stringify(record.args).slice(0, 300)}`;
      if (record.error) {
        let caught: unknown = null;
        try {
          call(record.args);
        } catch (error) {
          caught = error;
        }
        expect(caught, label).toBeInstanceOf(ERRORS[record.error.type]);
        expect((caught as Error).message, label).toBe(record.error.message);
      } else {
        expect(plain(call(record.args)), label).toEqual(record.output);
      }
    }
    expect(seen.size).toBe(Object.keys(CALLS).length);
  });

  it.each(golden.text_stream.map((item) => [item.id, item] as const))(
    '文本流帧 %s',
    async (_id, item: Obj) => {
      const usageOf = (spec: number[]) =>
        new TokenUsage(spec[0], spec[1], spec[2], null, null, 'provider_usage');
      const counts = new Map<string, number>();
      const control = new RunControl({
        checkInterruption: (boundary) => {
          counts.set(boundary, (counts.get(boundary) ?? 0) + 1);
          const rule = item.interrupt as [string, number] | null;
          return rule && boundary === rule[0] && counts.get(boundary)! >= rule[1]
            ? 'stopped'
            : null;
        },
        clock: () => 0,
        wait: async () => undefined,
      });
      const frames: unknown[] = [];
      const provider = {
        streaming: item.streaming as boolean,
        complete: async (request: { model: string }) =>
          chatResponse({ content: 'completed:' + request.model, finishReason: 'stop' }),
        async *stream(): AsyncGenerator<StreamEvent> {
          for (const step of item.script as Obj[]) {
            const usage = step.usage ? usageOf(step.usage) : null;
            if (step.raise) throw new ProviderError({ category: step.raise, safeMessage: 'boom' });
            if ('done' in step)
              yield {
                kind: 'completed',
                response: chatResponse({
                  content: step.done,
                  finishReason: step.finish,
                  usage: usage ?? new TokenUsage(),
                }),
                usage,
              };
            else yield { kind: 'text_delta', text: step.text, usage };
          }
        },
      };
      const row: Obj = {};
      try {
        const response = await completeWithTextStream(
          provider,
          {
            model: 'm',
            messages: [],
            tools: [],
            temperature: null,
            maxTokens: null,
            toolChoice: null,
            reasoningEffort: null,
          },
          {
            onText: item.observer ? (frame) => frames.push(frame) : null,
            runId: 'run-9',
            roundIndex: 3,
            secrets,
            control,
            newStreamId: () => 'stream-1',
          },
        );
        row.response = { content: response.content, finish_reason: response.finishReason };
      } catch (error) {
        const usage = (error as { usage?: TokenUsage | null }).usage ?? null;
        row.error = {
          type: error instanceof RunInterrupted ? 'LLMRunInterrupted' : (error as Error).name,
          message: (error as Error).message,
          category: error instanceof ProviderError ? error.details.category : null,
          code: error instanceof ProviderError ? error.details.providerCode : null,
          usage: usage === null ? null : usage.toLegacy(),
        };
      }
      expect(plain({ ...row, frames })).toEqual(
        plain({
          ...(item.response ? { response: item.response } : { error: item.error }),
          frames: item.frames,
        }),
      );
    },
  );
});

describe('P3-2 范围补充', () => {
  it('运行进度的时长必须是有限数（Python 用 math.isfinite，JSON golden 写不出 Infinity）', () => {
    for (const bad of [Infinity, Number.NaN])
      expect(() =>
        normalizeRuntimeProgress({ phase: 'retry_wait', request_number: 1, delay_seconds: bad }),
      ).toThrow(RangeError);
  });

  it('确认写回类请求也认界面新说法「写进文件」，旧说法照认', () => {
    for (const message of ['确认写进文件', '就这版写进文件吧', '确认写回', '接受当前补丁'])
      expect(isConfirmWritebackRequest(message), message).toBe(true);
    expect(isConfirmWritebackRequest('这段写进文件了吗')).toBe(false);
  });

  it('内核修订范围抛的编排错误，loop 的 instanceof 也认得（只有一个类）', () => {
    const tooLong = ['字'.repeat(INSTRUCTION_BUDGET + 1)];
    expect(() => composeScopedInstruction(tooLong, [], [], { values: [] })).toThrow(
      AgentOrchestrationError,
    );
  });
});
