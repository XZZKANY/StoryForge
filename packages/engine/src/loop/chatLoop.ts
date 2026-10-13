import type { AssistantStore } from '../assistant/service';
import type { JsonObject } from '../kernel/json';
import type { SecretContext } from '../kernel/redaction';
import type { ProjectReader } from '../readPort';
import { LlmConfigError, requiredEnv, type LlmSource } from '../llm/config';
import { messagesFromOpenai } from '../llm/contracts';
import { RunInterrupted } from '../llm/control';
import type { ModelObservation } from '../llm/observation';
import { LlmError } from '../llm/payload';
import type { AuthorView } from './authorView';
import { LoopCheckpointStore, StoryForgeCheckpointStore } from './chatLoopCheckpoints';
import {
  StoryForgeRuntimeContext,
  type LoopRunView,
  type LoopToolExecutor,
  type TraceCallback,
} from './chatLoopContext';
import {
  buildStoryforgeToolRegistry,
  interruptionCheck,
  StoryForgeFeedbackFormatter,
  StoryForgeProviderAdapter,
  StoryForgeRunTracer,
  StoryForgeRuntimePolicy,
  StoryForgeToolSelector,
  StoryForgeUsageSink,
  type LoopProvider,
} from './chatLoopAdapters';
import { ChatLoopOutcome } from './chatLoopTypes';
import type { ConversationSources } from './conversationHistory';
import { storyforgeMessages } from './loopMessages';
import { RequestEvidenceError } from './requestEvidence';
import { finishInterruptedRun, RUN_MAX_DURATION_SECONDS, type RunControlScope } from './runControl';
import { ToolCallingRuntime } from './sdkLoop';
import { runtimeLimits } from './sdkState';
import type { TextObserver } from './textStream';
import type { ToolDefinition } from './tools/execution';

type Obj = { [key: string]: unknown };

export const LOOP_MAX_ROUNDS = 8;
export const LOOP_MAX_DURATION_SECONDS = RUN_MAX_DURATION_SECONDS;
export const LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000;

const TOOLS_WITHDRAWN_NOTICE =
  '工具已不再可用，请直接用自然语言回答作者，不要再输出任何工具调用格式。';
const FINAL_ROUND_NOTICE = `已到本轮对话的工具调用上限。${TOOLS_WITHDRAWN_NOTICE}`;

const TOOL_MARKUP_MARKERS = ['DSML', '<tool_call', 'invoke name=', '<function_call'];
const UNEXECUTED_TOOL_MARKUP_NOTICE =
  '（这轮模型把工具调用写成了正文、并没有真正执行，所以文件没有任何改动。' +
  '下面是它原样吐出的内容，供你判断；要落盘请再说一次目标文件和要求。）\n\n';

/** 模型把工具调用写成正文时给作者一句说明：文件没有任何改动。 */
export function annotateUnexecutedToolMarkup(content: string): string {
  if (content && TOOL_MARKUP_MARKERS.some((marker) => content.includes(marker)))
    return UNEXECUTED_TOOL_MARKUP_NOTICE + content;
  return content;
}

/** 首轮模型调用就不可用（配置不全、provider 不支持工具）：调用方回落单轮回话。 */
export class ChatLoopUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatLoopUnavailableError';
  }
}

export type ChatLoopDeps = {
  readonly reader: ProjectReader;
  readonly conversation: ConversationSources;
  readonly platform: 'windows' | 'posix';
  readonly assistant: AssistantStore;
  readonly secrets: SecretContext;
  /** 按配置装配模型；配置不全时抛 LlmConfigError / LlmError（调用方据此回落单轮）。 */
  readonly buildProvider: (source: LlmSource) => LoopProvider;
  readonly checkpoints: LoopCheckpointStore;
  /** 本次调用唯一的控制与截止时间所有者（Python 的 agent_run_control_scope）。 */
  readonly scope: RunControlScope;
  readonly newStreamId: () => string;
  /** SDK 轨迹时间戳。 */
  readonly now?: () => string;
  /** 模型请求证据范围：循环自己的派发记为 agent.loop，并带上消息来源指纹。 */
  readonly observation?: ModelObservation | null;
};

export type ChatLoopInput = {
  readonly run: LoopRunView;
  readonly definitions: readonly ToolDefinition[];
  readonly source: LlmSource;
  readonly assistantSessionId: number;
  readonly userMessage: string;
  readonly projectPath: string;
  readonly currentFile: string | null;
  readonly executeTool: LoopToolExecutor;
  readonly onTrace: TraceCallback;
  readonly onText?: TextObserver | null;
  readonly shouldInterrupt?: ((boundary: string) => Obj | null) | null;
  readonly authorView?: AuthorView | null;
  readonly pinnedContext?: string | null;
  readonly recoveryMessage?: Obj | null;
  /** 模型输入的逐段来源指纹（由模型请求证据带走）。 */
  readonly provenance?: Obj | null;
};

const isLlmError = (error: unknown) => error instanceof LlmError || error instanceof LlmConfigError;

/** 组装 StoryForge 上下文，把通用编排交给 SDK 工具循环。 */
export async function runChatLoop(
  deps: ChatLoopDeps,
  input: ChatLoopInput,
): Promise<ChatLoopOutcome> {
  const provenance = input.provenance ?? {};
  const messages = messagesFromOpenai(
    (await storyforgeMessages(
      deps,
      {
        assistantSessionId: input.assistantSessionId,
        userMessage: input.userMessage,
        projectPath: input.projectPath,
        currentFile: input.currentFile,
        authorView: input.authorView ?? null,
        pinnedContext: input.pinnedContext ?? null,
      },
      provenance,
    )) as JsonObject[],
  );
  const outcome = new ChatLoopOutcome('');
  const context = new StoryForgeRuntimeContext({
    assistant: deps.assistant,
    assistantSessionId: input.assistantSessionId,
    run: input.run,
    source: input.source,
    secrets: deps.secrets,
    definitions: new Map(input.definitions.map((definition) => [definition.name, definition])),
    executeTool: input.executeTool,
    onTrace: input.onTrace,
    outcome,
    onText: input.onText ?? null,
    shouldInterrupt: input.shouldInterrupt ?? null,
    recoveryMessage: input.recoveryMessage ?? {
      intent: 'chat.explain',
      user_message: input.userMessage,
      assistant_session_id: input.assistantSessionId,
      args: { project_path: input.projectPath, file_path: input.currentFile },
    },
    newStreamId: deps.newStreamId,
  });
  const checkpoints = new StoryForgeCheckpointStore(context, deps.checkpoints);
  let provider: StoryForgeProviderAdapter;
  let model: string;
  try {
    provider = new StoryForgeProviderAdapter(
      deps.buildProvider(input.source),
      context,
      checkpoints,
    );
    model = requiredEnv(input.source, 'STORYFORGE_LLM_MODEL');
  } catch (error) {
    if (isLlmError(error)) throw new ChatLoopUnavailableError((error as Error).message);
    throw error;
  }
  context.callControl = deps.scope.control;
  const runtime = new ToolCallingRuntime(provider, buildStoryforgeToolRegistry(context), {
    policy: new StoryForgeRuntimePolicy(context),
    selector: new StoryForgeToolSelector(),
    tracer: new StoryForgeRunTracer(context),
    usageSink: new StoryForgeUsageSink(context),
    checkpoints,
    interruption: interruptionCheck(context),
    feedbackFormatter: new StoryForgeFeedbackFormatter(),
    now: deps.now,
  });
  let result;
  try {
    const run = () =>
      runtime.run(messages, {
        model,
        runId: input.run.public_id,
        limits: runtimeLimits({
          maxRounds: LOOP_MAX_ROUNDS,
          maxToolCalls: 32,
          maxToolOutputChars: LOOP_TOOL_OUTPUT_BUDGET_CHARS,
          finalMessage: FINAL_ROUND_NOTICE,
        }),
        applicationContext: context,
      });
    result = deps.observation
      ? await deps.observation.withOperation('agent.loop', provenance, run)
      : await run();
  } catch (error) {
    if (error instanceof RunInterrupted)
      return finishInterruptedRun(context, error.reason, deps.scope);
    if (error instanceof RequestEvidenceError) {
      outcome.markFailed(
        'request_evidence_failed',
        '模型请求证据提交失败，结果需要核对，未交付本次模型结果。',
      );
      outcome.exhausted = true;
      outcome.rounds = context.providerAttempts;
      return outcome;
    }
    if (isLlmError(error)) {
      outcome.markFailed('provider_error', '模型调用失败。');
      outcome.exhausted = true;
      outcome.rounds = context.providerAttempts;
      return outcome;
    }
    throw error;
  }
  outcome.rounds = context.providerAttempts;
  if (result.status === 'completed') {
    outcome.answer = annotateUnexecutedToolMarkup(result.content);
    return outcome;
  }
  if (result.status === 'interrupted') {
    const reason = result.checkpoint === null ? null : result.checkpoint.interruptionReason;
    return finishInterruptedRun(context, reason || 'interrupted', deps.scope);
  }
  if (
    result.status === 'failed' &&
    result.errorCode === 'provider_unsupported' &&
    context.completedModelRounds === 0
  )
    throw new ChatLoopUnavailableError(result.errorMessage || '模型调用不可用。');
  if (result.status === 'failed') {
    outcome.markFailed(result.errorCode || 'runtime_failed', result.errorMessage || '未知错误');
    outcome.exhausted = true;
    return outcome;
  }
  outcome.markFailed('runtime_unsettled', result.errorMessage || '本轮没有完成，不能自动继续。');
  outcome.exhausted = true;
  return outcome;
}

export { RequestEvidenceError };
