import type { AssistantStore } from '../assistant/service';
import type { JsonObject, Obj } from '../kernel/json';
import type { SecretContext } from '../kernel/redaction';
import type { ProjectReader } from '../readPort';
import { LlmConfigError, requiredEnv, type LlmSource } from '../llm/config';
import { messagesFromOpenai, ProviderError, type ProviderErrorCategory } from '../llm/contracts';
import { RunInterrupted } from '../llm/control';
import { modelFailureMessage } from '../llm/failureMessage';
import type { ModelObservation } from '../llm/observation';
import { LlmError } from '../llm/payload';
import type { AuthorView } from './authorView';
import {
  diagnoseCheckpoint,
  LoopCheckpointStore,
  restoreCheckpointContext,
  sourceVersions,
  StoryForgeCheckpointStore,
} from './chatLoopCheckpoints';
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

export const LOOP_MAX_ROUNDS = 8;
export const LOOP_MAX_DURATION_SECONDS = RUN_MAX_DURATION_SECONDS;
export const LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000;

const TOOLS_WITHDRAWN_NOTICE =
  '工具已不再可用，请直接用自然语言回答作者，不要再输出任何工具调用格式。';
const FINAL_ROUND_NOTICE = `已到本轮对话的工具调用上限。${TOOLS_WITHDRAWN_NOTICE}`;

const TOOL_MARKUP_MARKERS = ['DSML', '<tool_call', 'invoke name=', '<function_call'];
const UNEXECUTED_TOOL_MARKUP_NOTICE =
  '（这轮模型把工具调用写成了正文、并没有真正执行，所以文件没有任何改动。' +
  '下面是它原样吐出的内容，供你判断；要写进文件请再说一次目标文件和要求。）\n\n';

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
  /** 本机插件库根目录；缺省或 null 是没有插件。 */
  readonly pluginLibraryRoot?: string | null;
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
  /** 立项检查转来时附在本轮作者消息前的说明。 */
  readonly setupNote?: string | null;
  readonly recoveryMessage?: Obj | null;
  /** 模型输入的逐段来源指纹（由模型请求证据带走）。 */
  readonly provenance?: Obj | null;
};

const isLlmError = (error: unknown) => error instanceof LlmError || error instanceof LlmConfigError;

/** 模型调用失败时给作者看的那句，与 Ctrl+K / 续写 / 修订共用一套归类。 */
export function providerFailureMessage(failure: unknown, streamRetries: number): string {
  return modelFailureMessage(failure, streamRetries);
}

const PROVIDER_FAILURE = 'provider_';

/** SDK 只回分类与安全摘要；本轮捕获到的 provider 错误还带着状态码、错误码与请求号。 */
function providerFailureDetail(code: string, message: string, error: ProviderError | null): string {
  const parts = [`${code}: ${message}`];
  if (error !== null) {
    const { statusCode, providerCode, requestId } = error.details;
    if (statusCode !== null) parts.push(`status=${statusCode}`);
    if (providerCode !== null) parts.push(`provider_code=${providerCode}`);
    if (requestId !== null) parts.push(`request_id=${requestId}`);
  }
  return parts.join(' ');
}

/** 组装 StoryForge 上下文，把通用编排交给 SDK 工具循环。 */
export async function runChatLoop(
  deps: ChatLoopDeps,
  input: ChatLoopInput,
): Promise<ChatLoopOutcome> {
  const provenance = input.provenance ?? {};
  const recoveryMessage = input.recoveryMessage ?? {
    intent: 'chat.explain',
    user_message: input.userMessage,
    assistant_session_id: input.assistantSessionId,
    args: { project_path: input.projectPath, file_path: input.currentFile },
  };
  // 来源指纹要在读作者指令、拼消息之前记：之后文件再变，续跑核对一定对不上；
  // 反过来先拼后记，中间被改了就会拿新指纹去担保旧消息。
  const initialSources =
    input.run.current_step === 'resumed' ? null : await sourceVersions(deps, [], recoveryMessage);
  const skillUse = { pluginSkills: false };
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
        setupNote: input.setupNote ?? null,
      },
      provenance,
      skillUse,
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
    recoveryMessage,
    newStreamId: deps.newStreamId,
    pluginSkills: skillUse.pluginSkills,
  });
  context.recoverySources = initialSources;
  const checkpoints = new StoryForgeCheckpointStore(context, deps.checkpoints, deps);
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
  // 控制通道认领续跑时把步骤写成 resumed；诊断在认领后已做过一次，这里再核一遍再恢复。
  const saved =
    input.run.current_step === 'resumed' ? deps.checkpoints.latest(input.run.public_id) : null;
  if (saved !== null) {
    const diagnostic = await diagnoseCheckpoint(deps, saved, {
      public_id: input.run.public_id,
      assistant_session_id: input.run.assistant_session_id ?? null,
      permission_profile: input.run.permission_profile,
    });
    if (diagnostic.can_resume !== true) throw new Error(String(diagnostic.reason));
    restoreCheckpointContext(context, saved);
  }
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
        resume: saved === null ? null : { checkpoint: saved.checkpoint, command: 'continue' },
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
      outcome.markFailed('provider_error', providerFailureMessage(error, context.streamRetries));
      outcome.failureDetail = error.message;
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
    const code = result.errorCode || 'runtime_failed';
    const message = result.errorMessage || '未知错误';
    if (code.startsWith(PROVIDER_FAILURE)) {
      const category = code.slice(PROVIDER_FAILURE.length) as ProviderErrorCategory;
      const captured =
        context.providerError !== null && context.providerError.details.category === category
          ? context.providerError
          : null;
      const failure = captured ?? new ProviderError({ category, safeMessage: message });
      outcome.markFailed(code, providerFailureMessage(failure, context.streamRetries));
      outcome.failureDetail = providerFailureDetail(code, message, captured);
    } else outcome.markFailed(code, message);
    outcome.exhausted = true;
    return outcome;
  }
  outcome.markFailed('runtime_unsettled', result.errorMessage || '本轮没有完成，不能自动继续。');
  outcome.exhausted = true;
  return outcome;
}

export { RequestEvidenceError };
