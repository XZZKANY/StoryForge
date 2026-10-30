import {
  assertSessionProjectMatches,
  AssistantLlmNotConfiguredError,
  AssistantReviseError,
  AssistantSessionConflictError,
  AssistantSessionNotFoundError,
  chatReply,
  engineAssistantLlm,
  type AssistantSessionRef,
  type AssistantStore,
} from '../assistant/service';
import { readProjectFileRaw, resolveNewProjectFile } from '../kernel/fsProjectTools';
import { FsToolError, fsRead, nativeProjectPath, resolveProjectFile } from '../kernel/fsTools';
import { pythonTruthy, type JsonObject, type JsonValue } from '../kernel/json';
import { buildLlmContextSnapshot } from '../kernel/llmContext';
import { llmContextSnapshotToPromptContextBundle } from '../kernel/llmPromptContext';
import { compactText } from '../kernel/pythonText';
import type { PlainJson, SecretContext } from '../kernel/redaction';
import {
  missingSetupBeforeFirstChapter,
  setupNote,
  SKIP_SETUP_PATTERN,
  type SetupKind,
} from '../kernel/projectSetup';
import { revisionReferencesReview } from '../kernel/reviseScope';
import type { ProjectReader } from '../readPort';
import { callLlm, callLlmMessages, ConfiguredLlmProvider } from '../llm/client';
import { missingLlmEnv, type LlmSource } from '../llm/config';
import { checkRunInterruption, RunInterrupted } from '../llm/control';
import { ModelObservation } from '../llm/observation';
import type { HttpPort, LlmContext } from '../llm/transport';
import type { RunEventRecord, RunRecord, RunStatusView, RunStore } from '../store/runs';
import { authorViewFromPayload } from './authorView';
import { ChatLoopUnavailableError, runChatLoop } from './chatLoop';
import type { LoopProvider } from './chatLoopAdapters';
import type { LoopCheckpointStore } from './chatLoopCheckpoints';
import type { LoopToolExecutor } from './chatLoopContext';
import type { ConversationSources } from './conversationHistory';
import { runFixedIntentPipeline, type FixedPipelineHost } from './fixedPipelines';
import { gateDecide } from './permission';
import { AgentRequestObserver } from './requestEvidence';
import { currentConversationReview } from './reviewSources';
import {
  AgentRunEventSink,
  finishAgentExecution,
  planStep,
  popRuntimeInternalMarkers,
  resultRequiresConfirmation,
  runtimeInterruptedResponse,
  startAgentExecution,
  startAgentUserMessageRun,
  type EventObserver,
  type RunServices,
} from './runEvents';
import {
  AgentOrchestrationError,
  detectIntent,
  executionResultPayload,
  messageArgs,
  messageText,
  optionalString,
  roleHints,
  roleMentions,
  type AgentExecutionOutcome,
} from './runPayloads';
import { RUN_MAX_DURATION_SECONDS, RunControlScope } from './runControl';
import {
  buildConversationSystemJobs,
  compactionJob,
  prepareConversationCompaction,
  SYSTEM_SUMMARY_ARTIFACT_KIND,
} from './systemJobs';
import type { TextObserver } from './textStream';
import type {
  AgentToolRegistry,
  ToolArtifact,
  ToolExecutionContext,
  ToolResult,
  ToolRunServices,
} from './tools/execution';
import {
  chatContextBlock,
  optionalPositiveInt,
  sanitizeLoopToolArguments,
} from './tools/runtimeArguments';
import {
  buildRuntimeInterruptionPayload,
  traceAsDict,
  traceObjects,
  type AgentToolTrace,
} from './traces';
import {
  validateCompactionPublication,
  COMPACTION_TRIGGER_BYTES,
  CompactionRejected,
  ContextBudgetError,
  conversationHistoryBytes,
} from './conversationHistory';
import { pythonStrip } from '../kernel/pythonText';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cpSlice = (text: string, end: number) => Array.from(text).slice(0, end).join('');
const truthy = (value: unknown) => pythonTruthy(value as JsonValue);
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const UNANSWERED = '（模型这轮没返回内容，换个说法再问我一次？）';
const NOT_CONFIGURED =
  '还没配置模型服务，所以我现在只能收到你的话、还答不了。' +
  '去设置里填好 LLM 服务商和 key，再来问我就行。';
const FILE_INTENTS = new Set(['file.review', 'file.revise', 'chapter.polish']);
const SETUP_KINDS: readonly string[] = ['outline', 'character', 'setting'];

/** 立项检查转来的那一轮（续跑时从恢复消息里再认一次）。 */
function setupMissingNote(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const missing = value.filter((item): item is SetupKind => SETUP_KINDS.includes(item));
  return missing.length ? setupNote(missing) : null;
}

/** 会话标题的读写（P4 前由 Python 会话库提供）。 */
export interface SessionTitlePort {
  title(sessionId: number): Promise<string>;
  setTitle(sessionId: number, title: string): Promise<void>;
}

export type AgentRuntimeDeps = {
  /** run 的存储；同一个对象要能同步读出状态（运行控制在传输层同步检查）。 */
  readonly store: RunStore & RunStatusView;
  readonly secrets: SecretContext;
  readonly assistant: AssistantStore;
  readonly titles: SessionTitlePort;
  readonly conversation: ConversationSources;
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  /** 这次 run 用的模型配置快照（Python 的 resolved_llm_env）。 */
  readonly source: LlmSource;
  /** 专用润色槽：只有身份四项（键名已映射成 STORYFORGE_LLM_*），出网按槽换真 key。 */
  readonly polish: { readonly source: LlmSource; readonly http: HttpPort };
  /** 出网、时钟与版本；密钥快照、运行控制与证据范围由运行时补上。 */
  readonly llm: Omit<LlmContext, 'secrets' | 'control' | 'observation'>;
  readonly tools: AgentToolRegistry;
  readonly checkpoints: LoopCheckpointStore;
  readonly ids: {
    readonly stream: () => string;
    readonly attempt: () => string;
    /** 管线自己生成的补丁 id（与工具共用一个十六进制生成器）。 */
    readonly hex: () => string;
  };
  readonly now?: () => string;
  /** 每次中断检查的边界（诊断与测试用；控制写只经存储）。 */
  readonly onInterruptionCheck?: (runId: number, boundary: string) => void;
  /** 压缩的门槛（字节，默认 COMPACTION_TRIGGER_BYTES）；回放 Python 时期的样本时给 0。 */
  readonly compactAtHistoryBytes?: number;
  /** 回放 Python 时期的样本：照当时的时序在收尾压缩。缺省在下一轮开头压。 */
  readonly compactAtTurnEnd?: boolean;
  /** 本机插件库根目录；缺省或 null 是没有插件（作品启用的插件技能、写法、指令都不可用）。 */
  readonly pluginLibraryRoot?: string | null;
};

/** 结果骨架（runtime_support.base_response）。 */
export function baseResponse(fields: {
  agentSessionId: string;
  assistantSessionId: number;
  intent: string;
  userMessage: string;
  plan: Obj[];
  agentResult: Obj;
  toolTrace: readonly AgentToolTrace[];
  proposedPatch?: Obj | null;
  roleHints?: string[];
  roleMentions?: string[];
  toolArtifacts?: readonly ToolArtifact[];
}): Obj {
  const response: Obj = {
    type: 'agent_result',
    session_id: fields.agentSessionId,
    assistant_session_id: fields.assistantSessionId,
    intent: fields.intent,
    user_message: fields.userMessage,
    agent_role_hints: fields.roleHints ?? [],
    agent_role_mentions: fields.roleMentions ?? [],
    plan: fields.plan,
    agent_result: fields.agentResult,
    tool_trace: fields.toolTrace.map(traceAsDict),
    proposed_patch: fields.proposedPatch ?? null,
    runtime_mode: 'agent_runtime',
  };
  if (fields.toolArtifacts && fields.toolArtifacts.length)
    response._tool_artifacts = fields.toolArtifacts;
  return response;
}

function toolArtifactsFromResult(result: Obj): ToolArtifact[] {
  const raw = result._tool_artifacts;
  delete result._tool_artifacts;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ToolArtifact[] => {
    if (!isObj(item)) return [];
    const { kind, payload } = item;
    if (typeof kind !== 'string' || !kind || !isObj(payload)) return [];
    return [{ kind, payload, requires_confirmation: truthy(item.requires_confirmation) }];
  });
}

/** 运行时自己发起的 run：作者消息 → 循环 / 回落单轮 → 收尾与隐藏任务。 */
export class AgentRuntime {
  private scope: RunControlScope | null = null;
  private observation: ModelObservation | null = null;

  constructor(
    private readonly deps: AgentRuntimeDeps,
    private readonly sink: AgentRunEventSink,
    private readonly onText: TextObserver | null = null,
  ) {}

  private get control() {
    return this.scope!.control;
  }

  /** 控制通道落成的 paused / stopped（同步读，与 Python 每次 refresh 同义）。 */
  runtimeInterruption(run: RunRecord, boundary: string): Obj | null {
    this.deps.onInterruptionCheck?.(run.id, boundary);
    return buildRuntimeInterruptionPayload(this.deps.store.peek(run.id), boundary);
  }

  private llmContext(): LlmContext {
    return {
      ...this.deps.llm,
      secrets: this.deps.secrets,
      control: this.control,
      observation: this.observation,
    };
  }

  private buildProvider(source: LlmSource): LoopProvider {
    const provider = new ConfiguredLlmProvider(source, this.llmContext());
    return {
      complete: (request) => provider.complete(request),
      stream: (request) => provider.stream(request),
      streaming: true,
    };
  }

  private async resolveAssistantSession(
    userMessage: string,
    message: Obj,
    args: Obj,
  ): Promise<AssistantSessionRef> {
    const messageId = optionalPositiveInt(message.assistant_session_id);
    const argsId = optionalPositiveInt(args.assistant_session_id);
    // 外层与 args 同时声明会话却指向不同 id：判归属冲突，拒绝而不是让外层悄悄胜出。
    if (messageId !== null && argsId !== null && messageId !== argsId)
      throw new AgentOrchestrationError(
        `Agent 会话归属冲突：assistant_session_id 外层=${messageId} args=${argsId}。`,
      );
    const projectPath = optionalString(args.project_path) ?? optionalString(message.project_path);
    const requested = messageId ?? argsId;
    if (requested !== null) {
      let session: AssistantSessionRef;
      try {
        session = await this.deps.assistant.getSession(requested);
      } catch (error) {
        if (error instanceof AssistantSessionNotFoundError)
          throw new AgentOrchestrationError(error.message);
        throw error;
      }
      try {
        assertSessionProjectMatches(session, projectPath, this.deps.platform);
      } catch (error) {
        if (error instanceof AssistantSessionConflictError)
          throw new AgentOrchestrationError(error.message);
        throw error;
      }
      return session;
    }
    return this.deps.assistant.createSession({
      title: `IDE Agent: ${cpSlice(userMessage, 120)}`,
      task_type: 'ide_agent_orchestration',
      project_path: projectPath,
      messages: [],
    });
  }

  /** 收尾结果里的工具产物与审稿 / 补丁：每种只记一次。 */
  private async recordResultArtifacts(run: RunRecord, result: Obj): Promise<void> {
    const recorded = new Set<string>();
    for (const artifact of toolArtifactsFromResult(result)) {
      if (recorded.has(artifact.kind)) continue;
      await this.sink.recordArtifact(run, {
        kind: artifact.kind,
        payload: artifact.payload,
        requiresConfirmation: artifact.requires_confirmation,
      });
      recorded.add(artifact.kind);
    }
    const agent = isObj(result.agent_result) ? result.agent_result : {};
    if (isObj(agent.review_report) && !recorded.has('review_report'))
      await this.sink.recordArtifact(run, {
        kind: 'review_report',
        payload: agent.review_report,
        requiresConfirmation: false,
      });
    const patch = result.proposed_patch;
    if (isObj(patch) && !recorded.has('proposed_patch'))
      await this.sink.recordArtifact(run, {
        kind: 'proposed_patch',
        payload: patch,
        requiresConfirmation: Object.prototype.hasOwnProperty.call(patch, 'requires_confirmation')
          ? truthy(patch.requires_confirmation)
          : true,
      });
  }

  /** 一次工具执行：先过中断边界与权限门，再在工具自己的模型操作范围里跑处理器。 */
  private async executeTool(
    run: RunRecord,
    toolName: string,
    context: ToolExecutionContext,
    payload: Obj,
  ): Promise<ToolResult> {
    checkRunInterruption(this.control, `before_tool:${toolName}`);
    const tool = this.deps.tools.get(toolName);
    // 固定管线可能从 command args 移除确认标记；gate 仍需看见已完成的确认，故仅在策略输入中补回。
    const permissionPayload: Obj = { ...payload };
    if (context.args.confirmed === true || context.args.user_confirmed === true)
      permissionPayload.confirmed = true;
    const decision = gateDecide(run.permission_profile, tool, permissionPayload);
    if (decision.status === 'deny')
      throw new AgentOrchestrationError(`权限策略阻止工具 ${toolName}：${decision.reason}`);
    if (decision.status === 'require_approval' && !decision.allows_pending_artifact)
      throw new AgentOrchestrationError(`工具 ${toolName} 需要先获得权限确认：${decision.reason}`);
    const snapshot = payload.llm_context_snapshot;
    return this.observation!.withOperation(toolName, isObj(snapshot) ? snapshot : null, () =>
      tool.handler(context, payload),
    );
  }

  /** 工具处理器用的本次 run 服务：模型端口绑定本次的运行控制与模型观察。 */
  private toolServices(): ToolRunServices {
    return {
      assistant: {
        reader: this.deps.reader,
        store: this.deps.assistant,
        platform: this.deps.platform,
        pluginLibraryRoot: this.deps.pluginLibraryRoot ?? null,
        llm: async () => {
          const { secrets: _secrets, ...context } = this.llmContext();
          return engineAssistantLlm(this.deps.source, this.deps.secrets, context);
        },
      },
      conversation: this.deps.conversation,
      checkInterruption: (boundary) => checkRunInterruption(this.control, boundary),
      model: {
        source: this.deps.source,
        call: (operation, source, options) =>
          this.observation!.withOperation(operation, null, () =>
            callLlmMessages(
              source,
              {
                messages: options.messages as JsonObject[],
                timeoutSeconds: options.timeoutSeconds,
                maxAttempts: options.maxAttempts,
              },
              this.llmContext(),
            ),
          ),
        complete: (prompt) => callLlm(this.deps.source, prompt, this.llmContext()),
      },
      polish: {
        main: this.deps.source,
        dedicated: this.deps.polish.source,
        provider: (slot, source) =>
          new ConfiguredLlmProvider(
            source,
            slot === 'polish'
              ? { ...this.llmContext(), http: this.deps.polish.http }
              : this.llmContext(),
          ),
      },
    };
  }

  private async toolRunView(run: RunRecord) {
    const current = await this.deps.store.getRun(run.id);
    return {
      public_id: current.public_id,
      permission_profile: current.permission_profile,
      goal: current.goal,
      status: current.status,
      current_step: current.current_step,
      events: (await this.deps.store.events(run.id)) as unknown as Obj[],
      artifacts: (await this.deps.store.artifacts(run.id)) as unknown as Obj[],
    };
  }

  private async tryChatLoop(
    run: RunRecord,
    agentSessionId: string,
    sessionId: number,
    userMessage: string,
    args: Obj,
  ): Promise<Obj | null> {
    const projectPath = optionalString(args.project_path);
    if (!projectPath) return null;
    if (missingLlmEnv(this.deps.source).length) return null;
    const hints = roleHints(args);
    const mentions = roleMentions(args);
    const started = baseResponse({
      agentSessionId,
      assistantSessionId: sessionId,
      intent: 'chat.explain',
      userMessage,
      plan: [planStep('agent.loop', '读取项目文件、检索并整理回答。', 'running')],
      agentResult: { summary: '正在查看项目文件。', requires_user_confirmation: false },
      toolTrace: [],
      roleHints: hints,
      roleMentions: mentions,
    });
    // 续跑：计划与已完成的轨迹在上一段执行里已落库，序号接着往下记。
    let planRecorded = run.current_step === 'resumed';
    let traceIndex = planRecorded
      ? (await this.deps.store.events(run.id)).filter((event) => event.event_type === 'tool_trace')
          .length
      : 0;
    const ensurePlanRecorded = async () => {
      if (!planRecorded) {
        run = await this.sink.recordPlan(run, started);
        planRecorded = true;
      }
    };
    const onTrace = async (trace: AgentToolTrace) => {
      await ensurePlanRecorded();
      await this.sink.recordToolTrace(run, trace, traceIndex);
      traceIndex += 1;
    };
    const offered = isObj(args.review_report) ? args.review_report : null;
    const requiredReview = revisionReferencesReview(userMessage);
    let latestReview =
      offered !== null || requiredReview
        ? await currentConversationReview(this.deps.conversation, sessionId, {
            offered,
            required: requiredReview && offered !== null,
          })
        : null;
    // 循环里 fs.read 读到的独特事实：writer 的快照只吃前端 bundle，不显式交接就没有送达保证。
    const loopReadFacts = new Map<string, Obj>();
    const { reader, platform, secrets } = this.deps;
    const executeTool: LoopToolExecutor = async (registryName, rawArguments, deliveries) => {
      // 路径、正文与内层上下文都由后端生成；模型只能提交 ToolSpec 声明的业务参数。
      const payload = sanitizeLoopToolArguments(rawArguments);
      const definition = this.deps.tools.get(registryName);
      if (definition.loop_input_mode === 'existing_file') {
        const relPath = optionalString(payload.path);
        delete payload.path;
        if (!relPath) throw new FsToolError('缺少 path：请提供项目内的相对文件路径。');
        if (registryName === 'file.revise' || registryName === 'file.review') {
          // 审稿哈希与补丁区间绑定同一份作者原文（不归一换行）。
          const { target, raw } = await readProjectFileRaw(reader, projectPath, relPath);
          payload.file_path = nativeProjectPath(projectPath, target, platform);
          payload.content = STRICT_UTF8.decode(raw);
          payload._trace_file_path = relPath;
        } else {
          const read = await fsRead(reader, projectPath, relPath, { offset: 0, limit: 200_000 });
          if (read.truncated)
            throw new FsToolError(
              '文件超过单次处理上限，请缩小范围（分章 / 拆文件）后再审稿或修订。',
            );
          payload.file_path = nativeProjectPath(
            projectPath,
            await resolveProjectFile(reader, projectPath, relPath),
            platform,
          );
          payload.content = read.content;
          payload._trace_file_path = read.path;
        }
      } else if (definition.loop_input_mode === 'new_file') {
        const relPath = optionalString(payload.path);
        delete payload.path;
        if (!relPath) throw new FsToolError('缺少 path：请提供项目内的相对文件路径。');
        const target = await resolveNewProjectFile(reader, projectPath, relPath);
        payload.file_path = nativeProjectPath(projectPath, target, platform);
        payload._trace_file_path = target;
      } else payload.project_root = projectPath;
      // 作者指令与 canon 约束都要项目根定位；产字工具走上面的分支，这里补上。
      if (!('project_root' in payload)) payload.project_root = projectPath;
      const view = await this.toolRunView(run);
      if (definition.loop_trusted_context) {
        const bundle = args.context_bundle;
        const snapshot = await buildLlmContextSnapshot(
          reader,
          {
            runState: {
              public_id: view.public_id,
              goal: view.goal,
              status: view.status,
              current_step: view.current_step,
            },
            intent: registryName,
            userMessage,
            filePath: String(payload._trace_file_path),
            content: String(payload.content || ''),
            contextBundle: {
              ...(isObj(bundle) ? bundle : {}),
              project_root: projectPath,
            } as PlainJson,
            roleHints: roleHints(args),
            roleMentions: roleMentions(args),
            reviewReport: latestReview as PlainJson,
            eventHistory: view.events as PlainJson[],
            artifacts: view.artifacts as PlainJson[],
            extraContextFiles: [...loopReadFacts.values()] as PlainJson[],
          },
          { platform, secrets },
        );
        if (registryName === 'file.revise')
          payload.review_report = truthy(latestReview) ? latestReview : snapshot.review_report;
        payload.llm_context_snapshot = snapshot;
        payload.llm_prompt_context_bundle = llmContextSnapshotToPromptContextBundle(
          snapshot,
          secrets,
        );
      }
      const context: ToolExecutionContext = {
        run: view,
        services: this.toolServices(),
        deliveries,
        agentSessionId,
        assistantSessionId: sessionId,
        userMessage,
        args,
        currentReviewReport: latestReview,
        writingReadSources: [...loopReadFacts.values()],
      };
      const result = await this.executeTool(run, registryName, context, payload);
      if (result.status === 'completed') {
        for (const artifact of result.artifacts ?? [])
          if (artifact.kind === 'review_report') latestReview = artifact.payload;
        const output = result.output;
        if (registryName === 'fs.read' && isObj(output)) {
          const { path, content } = output;
          if (typeof path === 'string' && path && typeof content === 'string' && content)
            loopReadFacts.set(path, { relative_path: path, excerpt: content });
        }
      }
      return result;
    };
    const chatLoop = () =>
      runChatLoop(
        {
          reader: this.deps.reader,
          conversation: this.deps.conversation,
          platform: this.deps.platform,
          assistant: this.deps.assistant,
          secrets: this.deps.secrets,
          buildProvider: (source) => this.buildProvider(source),
          checkpoints: this.deps.checkpoints,
          scope: this.scope!,
          newStreamId: this.deps.ids.stream,
          now: this.deps.now,
          observation: this.observation,
          pluginLibraryRoot: this.deps.pluginLibraryRoot ?? null,
        },
        {
          run,
          definitions: this.deps.tools.all(),
          source: this.deps.source,
          assistantSessionId: sessionId,
          userMessage,
          projectPath,
          currentFile: optionalString(args.file_path),
          executeTool,
          onTrace,
          onText: this.onText,
          shouldInterrupt: (boundary) => this.runtimeInterruption(run, boundary),
          authorView: authorViewFromPayload(args),
          pinnedContext: chatContextBlock(args),
          setupNote: setupMissingNote(args.setup_missing),
          recoveryMessage: {
            intent: 'chat.explain',
            user_message: userMessage,
            assistant_session_id: sessionId,
            args,
          },
        },
      );
    let outcome;
    try {
      // 会话快满时在这一轮开头压，不在上一轮收尾压：收尾压会让作者看着回答写完了还在请求，补丁也跟着晚出。
      const compactedBeforeTurn =
        !this.deps.compactAtTurnEnd && (await this.historyNearlyFull(sessionId))
          ? await this.compactForBudget(run, sessionId)
          : null;
      try {
        outcome = await chatLoop();
      } catch (error) {
        // 历史超预算时模型还没被调用：先补一次压缩再重组消息；补不上就照原样报错。一轮最多压一次。
        if (
          !(error instanceof ContextBudgetError) ||
          compactedBeforeTurn !== null ||
          !(await this.compactForBudget(run, sessionId))
        )
          throw error;
        outcome = await chatLoop();
      }
    } catch (error) {
      if (error instanceof ChatLoopUnavailableError) return null;
      throw error;
    }
    await ensurePlanRecorded();
    let interruption = outcome.interrupted ? outcome.interruption : null;
    // SDK 已检查模型 / 工具边界；计划落库与最终结算期间仍可能收到新的控制消息。
    // 已中断时保留原边界，但 paused 后又收到 stopped 必须以新的控制状态为准。
    const latest = this.runtimeInterruption(run, 'before_finalize:assistant.chat_loop');
    if (latest !== null && (interruption === null || latest.status !== interruption.status))
      interruption = latest;
    const status =
      interruption !== null
        ? interruption.status === 'paused'
          ? 'paused'
          : 'failed'
        : outcome.executionOutcome !== null
          ? 'failed'
          : 'completed';
    const evidence = {
      tool_name: 'assistant.chat_loop',
      status: status as 'paused' | 'failed' | 'completed',
      ...(outcome.failureDetail !== null ? { error_message: outcome.failureDetail } : {}),
      input_summary: { message: cpSlice(userMessage, 500), project_path: projectPath },
      output_summary: {
        rounds: outcome.rounds,
        tool_call_count: outcome.toolCallCount,
        prompt_tokens: outcome.promptTokens,
        completion_tokens: outcome.completionTokens,
        token_usage: outcome.tokenUsage,
        cost_cny_estimated: outcome.costCnyEstimated,
        cost_breakdown: outcome.costBreakdown,
        token_usage_source: outcome.tokenUsageSource,
        exhausted: outcome.exhausted,
        ...(outcome.executionOutcome ? { execution_outcome: outcome.executionOutcome } : {}),
        proposed_patch_id: (outcome.proposedPatch ?? {}).id ?? null,
        ...(interruption !== null ? { runtime_interruption: interruption } : {}),
      },
    };
    if (interruption !== null) {
      // 停止投递不等于调用未发生：保留累计用量与既有工具审计，不保存迟到回答。
      if (outcome.rounds > 0) await this.deps.assistant.createToolCall(sessionId, evidence);
      // 循环被暂停 / 停止：计划与已完成的轨迹已落库，不追加消息、不完成，run 保持控制通道写下的状态。
      const interrupted = baseResponse({
        agentSessionId,
        assistantSessionId: sessionId,
        intent: 'chat.explain',
        userMessage,
        plan: [planStep('agent.loop', '循环已按作者操作停下。', 'stopped')],
        agentResult: { summary: outcome.answer, requires_user_confirmation: false },
        toolTrace: outcome.traces,
        roleHints: hints,
        roleMentions: mentions,
      });
      return runtimeInterruptedResponse(interrupted, interruption, true);
    }
    const answer = outcome.answer || UNANSWERED;
    await this.deps.assistant.appendMessage(sessionId, { role: 'user', content: userMessage });
    await this.deps.assistant.appendMessage(sessionId, { role: 'assistant', content: answer });
    const loopEvidence = await this.deps.assistant.createToolCall(sessionId, evidence);
    const plan = [
      planStep(
        'agent.loop',
        outcome.executionOutcome
          ? outcome.answer
          : `工具循环完成：${outcome.rounds} 轮、${outcome.toolCallCount} 次工具调用。`,
        outcome.executionOutcome ? 'failed' : 'completed',
      ),
    ];
    // 自动档下补丁自己带着「不必等点击」，run 就不该再挂在 permission.confirm 上。
    const awaitsConfirmation =
      outcome.patchProposal !== null && outcome.patchProposal.requiresConfirmation;
    const agentResult: Obj = {
      summary: answer,
      requires_user_confirmation: awaitsConfirmation,
      ...(outcome.executionOutcome ? { execution_outcome: outcome.executionOutcome } : {}),
    };
    if (outcome.reviewReport !== null) agentResult.review_report = outcome.reviewReport;
    const proposedPatch = outcome.proposedPatch;
    if (proposedPatch !== null) {
      // 作用域以处理器轨迹为准，并且只绑定这一个补丁，不认之前的 writer。
      for (const trace of [...outcome.traces].reverse()) {
        const summary = trace.output_summary ?? {};
        if (
          trace.tool_name === 'file.revise' &&
          trace.status === 'completed' &&
          summary.patch_id === proposedPatch.id
        ) {
          for (const field of [
            'applied_scope',
            'scope_warning',
            'truncation_warning',
            'length_hint',
          ])
            if (isObj(summary[field])) agentResult[field] = summary[field];
          break;
        }
      }
    }
    if (awaitsConfirmation)
      plan.push(planStep('permission.confirm', '文件写回前等待作者确认。', 'needs_approval'));
    else if (proposedPatch !== null)
      plan.push(
        planStep(
          'writeback.auto',
          '补丁已准备，实际写回与快照由 Desktop 执行；这不是落盘回执。',
          'completed',
        ),
      );
    const result = baseResponse({
      agentSessionId,
      assistantSessionId: sessionId,
      intent: 'chat.explain',
      userMessage,
      plan,
      agentResult,
      toolTrace: outcome.traces,
      proposedPatch,
      roleHints: hints,
      roleMentions: mentions,
      toolArtifacts: outcome.artifacts,
    });
    (result.agent_result as Obj).chat_loop = {
      rounds: outcome.rounds,
      tool_call_count: outcome.toolCallCount,
      assistant_tool_call_id: loopEvidence.id,
    };
    result._events_recorded = true;
    return result;
  }

  private async runChatExplain(
    run: RunRecord,
    agentSessionId: string,
    sessionId: number,
    userMessage: string,
    args: Obj,
  ): Promise<Obj> {
    const loopResult = await this.tryChatLoop(run, agentSessionId, sessionId, userMessage, args);
    if (loopResult !== null) return loopResult;
    checkRunInterruption(this.control, 'before_fallback');
    const contextBlock = chatContextBlock(args);
    let failure: AgentExecutionOutcome | null = null;
    let answer: string;
    try {
      const chat = await chatReply(
        {
          reader: this.deps.reader,
          store: this.deps.assistant,
          platform: this.deps.platform,
          llm: async () => {
            const { secrets: _secrets, ...context } = this.llmContext();
            return engineAssistantLlm(this.deps.source, this.deps.secrets, context);
          },
        },
        { userMessage, contextBlock, assistantSessionId: sessionId },
      );
      answer = chat.reply || UNANSWERED;
    } catch (error) {
      if (error instanceof AssistantLlmNotConfiguredError) answer = NOT_CONFIGURED;
      else if (error instanceof AssistantReviseError) {
        answer = `这轮没答上来：${compactText(error.message, 300)}`;
        failure = { status: 'failed', code: 'provider_error', message: answer };
      } else throw error;
    }
    // 完整响应的用量已由 chatReply 记账；取消赢了这个边界就不提交迟到的正文与作者这一轮。
    checkRunInterruption(this.control, 'before_finalize:assistant.chat');
    await this.deps.assistant.appendMessage(sessionId, { role: 'user', content: userMessage });
    await this.deps.assistant.appendMessage(sessionId, { role: 'assistant', content: answer });
    return baseResponse({
      agentSessionId,
      assistantSessionId: sessionId,
      intent: 'chat.explain',
      userMessage,
      plan: [
        planStep('respond', '就项目上下文作答，不执行写命令。', failure ? 'failed' : 'completed'),
      ],
      agentResult: {
        summary: answer,
        requires_user_confirmation: false,
        ...(failure ? { execution_outcome: failure } : {}),
      },
      toolTrace: [],
      roleHints: roleHints(args),
      roleMentions: roleMentions(args),
    });
  }

  private compactionDeps() {
    return {
      conversation: this.deps.conversation,
      assistant: this.deps.assistant,
      source: this.deps.source,
      secrets: this.deps.secrets,
      buildProvider: (source: LlmSource) => new ConfiguredLlmProvider(source, this.llmContext()),
      control: this.control,
      observation: this.observation,
    };
  }

  /**
   * 会话已超历史预算时补做一次压缩：此前每轮收尾的压缩都没成，历史只增不减，
   * 不补就再也进不了模型。走与收尾同一条校验与发布路径；没发布成检查点返回 false。
   */
  private async compactForBudget(run: RunRecord, sessionId: number): Promise<boolean> {
    const payload = await prepareConversationCompaction(this.compactionDeps(), sessionId);
    if (payload === null) return false;
    let job = compactionJob(payload);
    if (job.artifactPayload !== null) {
      try {
        await validateCompactionPublication(
          this.deps.conversation,
          job.artifactPayload,
          this.control,
        );
      } catch (error) {
        if (!(error instanceof CompactionRejected)) throw error;
        job = compactionJob({ ...job.resultPayload, status: 'failed', code: 'source_drift' });
      }
    }
    checkRunInterruption(this.control, 'before_publish:system_job:compaction');
    await this.sink.recordSystemJob(run, {
      key: job.key,
      payload: job.eventPayload,
      artifactKind: job.artifactKind,
      artifactPayload: job.artifactPayload,
    });
    return job.artifactPayload !== null;
  }

  // 离上限还远就不压：压成的检查点会丢掉谈定的设计，还要多等一次模型。
  private async historyNearlyFull(sessionId: number): Promise<boolean> {
    return (
      (await conversationHistoryBytes(this.deps.conversation, sessionId)) >=
      (this.deps.compactAtHistoryBytes ?? COMPACTION_TRIGGER_BYTES)
    );
  }

  /** 收尾时的隐藏任务：标题、短摘要（回放 Python 样本时还有模型压缩）；每个任务发布前都检查一次中断。 */
  private async runHiddenSystemJobs(run: RunRecord, sessionId: number, result: Obj) {
    const currentTitle = await this.deps.titles.title(sessionId);
    const messages = await this.deps.conversation.messages(sessionId);
    const compactionPayload =
      this.deps.compactAtTurnEnd && (await this.historyNearlyFull(sessionId))
        ? await prepareConversationCompaction(this.compactionDeps(), sessionId)
        : null;
    const jobs = buildConversationSystemJobs({
      assistantSessionId: sessionId,
      currentTitle,
      messages,
      result,
      compactionPayload,
    });
    const resultJobs: Obj = {};
    for (let job of jobs) {
      checkRunInterruption(this.control, `before_publish:system_job:${job.key}`);
      if (job.key === 'compaction' && job.artifactPayload !== null) {
        try {
          await validateCompactionPublication(
            this.deps.conversation,
            job.artifactPayload,
            this.control,
          );
        } catch (error) {
          if (!(error instanceof CompactionRejected)) throw error;
          const failed: Obj = { ...job.resultPayload, status: 'failed', code: 'source_drift' };
          delete failed.summary;
          job = {
            ...job,
            resultPayload: failed,
            artifactKind: null,
            artifactPayload: null,
            eventPayload: { ...failed, message: '发布前来源改变，压缩未发布。' },
          };
        }
      }
      resultJobs[job.key] = job.resultPayload;
      if (job.key === 'title' && job.resultPayload.updated_session_title === true) {
        const title = job.resultPayload.title;
        if (typeof title === 'string' && pythonStrip(title))
          await this.deps.titles.setTitle(sessionId, cpSlice(title, 160));
      }
      await this.sink.recordSystemJob(run, {
        key: job.key,
        payload: job.eventPayload,
        artifactKind: job.artifactKind,
        artifactPayload: job.artifactPayload,
      });
    }
    result.system_jobs = resultJobs;
  }

  /** 被中断的结果：撤回未送达的写入；截止时间按失败记，作者的暂停 / 停止按中断记。 */
  /** 固定管线看到的运行时能力。 */
  private fixedPipelineHost(): FixedPipelineHost {
    return {
      sink: this.sink,
      store: this.deps.store,
      assistant: this.deps.assistant,
      conversation: this.deps.conversation,
      reader: this.deps.reader,
      platform: this.deps.platform,
      secrets: this.deps.secrets,
      pluginLibraryRoot: this.deps.pluginLibraryRoot ?? null,
      newHex: () => this.deps.ids.hex(),
      executeTool: (run, toolName, context, payload) =>
        this.executeTool(run, toolName, context, payload),
      toolContext: async (run, request, currentReviewReport = null) => ({
        run: await this.toolRunView(run),
        services: this.toolServices(),
        deliveries: null,
        agentSessionId: request.agentSessionId,
        assistantSessionId: request.assistantSessionId,
        userMessage: request.userMessage,
        args: request.args,
        currentReviewReport,
        writingReadSources: [],
      }),
      runtimeInterruption: (run, boundary) => this.runtimeInterruption(run, boundary),
      renewRunDeadline: () => this.control.renewDeadline(RUN_MAX_DURATION_SECONDS),
      checkResultDelivery: (result, boundary, eventsRecorded) => {
        try {
          checkRunInterruption(this.control, boundary);
        } catch (error) {
          if (!(error instanceof RunInterrupted)) throw error;
          return this.interruptedDeliveryResult(result, error.reason, eventsRecorded);
        }
        return null;
      },
      baseResponse,
    };
  }

  private interruptedDeliveryResult(result: Obj, reason: string, eventsRecorded = false): Obj {
    const agent = result.agent_result as Obj;
    result.proposed_patch = null;
    delete result._tool_artifacts;
    agent.requires_user_confirmation = false;
    agent.writeback_blocked_until_user_confirms = false;
    for (const key of ['confirmation_action', 'confirmation_kind', 'blocked_tool'])
      delete agent[key];
    if (reason !== 'deadline_exceeded') {
      const interruption = this.scope!.interruption;
      if (interruption === null) throw new Error('Interrupted run is missing its control fact');
      return runtimeInterruptedResponse(result, interruption, eventsRecorded);
    }
    const outcome: AgentExecutionOutcome = {
      status: Array.isArray(result.tool_trace) && result.tool_trace.length ? 'partial' : 'failed',
      code: 'runtime_deadline',
      message: '本轮执行时间预算已用完，未继续派发模型或工具。',
    };
    Object.assign(agent, { summary: outcome.message, execution_outcome: outcome });
    for (const step of (result.plan ?? []) as Obj[])
      if (step.status !== 'completed') step.status = 'failed';
    if (eventsRecorded) result._events_recorded = true;
    return result;
  }

  private async settleInterrupted(run: RunRecord, result: Obj, reason: string): Promise<Obj> {
    this.interruptedDeliveryResult(result, reason);
    if (reason === 'deadline_exceeded')
      await this.sink.fail(
        run,
        String((result.agent_result as Obj).summary),
        executionResultPayload(result),
      );
    popRuntimeInternalMarkers(result);
    return result;
  }

  /** 收尾：落产物、跑隐藏任务，再按「待确认 / 失败 / 完成」结算。 */
  private async finalize(
    run: RunRecord,
    sessionId: number,
    result: Obj,
    popMarkers: boolean,
  ): Promise<Obj> {
    await this.recordResultArtifacts(run, result);
    const agent = result.agent_result as Obj;
    const executionOutcome = agent.execution_outcome;
    if (executionOutcome === undefined || executionOutcome === null) {
      try {
        await this.runHiddenSystemJobs(run, sessionId, result);
      } catch (error) {
        if (error instanceof RunInterrupted)
          return this.settleInterrupted(run, result, error.reason);
        throw error;
      }
    }
    if (resultRequiresConfirmation(result)) {
      if (popMarkers) {
        agent.writeback_blocked_until_user_confirms = true;
        await this.sink.recordPermissionRequired(run, result, 'requires_user_confirmation');
        popRuntimeInternalMarkers(result);
      } else {
        await this.sink.recordPermissionRequired(run, result, 'requires_user_confirmation');
        agent.writeback_blocked_until_user_confirms = true;
      }
      return result;
    }
    if (executionOutcome !== undefined && executionOutcome !== null)
      await this.sink.fail(run, String(agent.summary), executionResultPayload(result));
    else await this.sink.complete(run, result);
    if (popMarkers) popRuntimeInternalMarkers(result);
    return result;
  }

  async runUserMessage(run: RunRecord, agentSessionId: string, message: Obj): Promise<Obj> {
    this.observation = new ModelObservation(
      new AgentRequestObserver({
        store: this.deps.store,
        runId: run.id,
        secrets: this.deps.secrets,
        newAttemptId: this.deps.ids.attempt,
      }),
    );
    this.scope = new RunControlScope((boundary) => this.runtimeInterruption(run, boundary), {
      clock: this.deps.llm.clock,
      wait: this.deps.llm.wait,
      onProgress: (progress) => {
        this.observation!.progress(progress);
        this.sink.queueRuntimeProgress(run, progress);
      },
    });
    let result: Obj | null = null;
    const userMessage = messageText(message);
    const args = messageArgs(message);
    let intent = detectIntent(userMessage, args, message.intent);
    // 项目级对话解绑当前文件：需要文件的 intent 若没带 file_path，降级为对话。
    if (FILE_INTENTS.has(intent) && optionalString(args.file_path) === null)
      intent = 'chat.explain';
    let session: AssistantSessionRef | null = null;
    try {
      session = await this.resolveAssistantSession(userMessage, message, args);
      if (run.assistant_session_id !== session.id)
        run = await this.deps.store.updateRun(run.id, { assistant_session_id: session.id });
      // 开写第一章前立项不齐：先不起草，交对话 agent 提醒作者、代起草立项文件。
      let chatArgs = args;
      if (intent === 'chapter.write' && !SKIP_SETUP_PATTERN.test(userMessage)) {
        const root = optionalString(args.project_path);
        const missing =
          root === null
            ? null
            : await missingSetupBeforeFirstChapter(this.deps.reader, root, this.deps.platform);
        if (missing !== null) {
          intent = 'chat.explain';
          chatArgs = { ...args, file_path: null, setup_missing: missing };
        }
      }
      if (intent === 'chat.explain')
        result = await this.runChatExplain(run, agentSessionId, session.id, userMessage, chatArgs);
      else {
        result = await runFixedIntentPipeline(this.fixedPipelineHost(), {
          run,
          agentSessionId,
          assistantSessionId: session.id,
          userMessage,
          args,
          intent,
        });
        if (
          result._runtime_interrupted !== true &&
          !truthy((result.agent_result as Obj).execution_outcome)
        )
          checkRunInterruption(this.control, 'before_finalize:agent_runtime');
      }
    } catch (error) {
      if (error instanceof RunInterrupted) {
        if (result === null)
          result = baseResponse({
            agentSessionId,
            assistantSessionId: session!.id,
            intent,
            userMessage,
            plan: [planStep('agent.runtime', '运行已中断，未继续派发工作。', 'stopped')],
            agentResult: { summary: '运行已中断。', requires_user_confirmation: false },
            toolTrace: [],
          });
        result.run_id = run.public_id;
        return this.settleInterrupted(run, result, error.reason);
      }
      const failure = {
        session_id: agentSessionId,
        run_id: run.public_id,
        runtime: 'agent_runtime',
      };
      await this.sink.fail(run, (error as Error).message, failure);
      if (error instanceof AgentOrchestrationError) throw error;
      throw new AgentOrchestrationError((error as Error).message);
    }
    result.run_id = run.public_id;
    if (!('agent_role_hints' in result)) result.agent_role_hints = roleHints(args);
    if (!('agent_role_mentions' in result)) result.agent_role_mentions = roleMentions(args);
    if (result._events_recorded === true) {
      if (result._runtime_interrupted === true) {
        popRuntimeInternalMarkers(result);
        return result;
      }
      return this.finalize(run, session.id, result, true);
    }
    run = await this.sink.recordPlan(run, result);
    const interruption = this.runtimeInterruption(run, 'after_plan');
    if (interruption !== null) {
      runtimeInterruptedResponse(result, interruption);
      popRuntimeInternalMarkers(result);
      return result;
    }
    // 固定管线的轨迹在这里逐条落库，每条之后都给控制通道一个停下的机会。
    for (const [index, trace] of traceObjects(result).entries()) {
      await this.sink.recordToolTrace(run, trace, index);
      const stop = this.runtimeInterruption(run, `after_tool:${trace.tool_name}`);
      if (stop !== null) {
        runtimeInterruptedResponse(result, stop);
        popRuntimeInternalMarkers(result);
        return result;
      }
    }
    return this.finalize(run, session.id, result, false);
  }
}

/** 执行期间的编排失败（Python 的 AgentRuntimeError）：控制通道里的续跑失败也按它报。 */
export class AgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

/** user_message 失败但 run 已建好：调用方要用 run 发实时错误帧。 */
export class AgentRuntimeUserMessageError extends AgentRuntimeError {
  constructor(
    message: string,
    readonly run: RunRecord,
    readonly startedEvent: RunEventRecord,
  ) {
    super(message);
    this.name = 'AgentRuntimeUserMessageError';
  }
}

export type ExecuteRunInput = {
  readonly agentSessionId: string;
  readonly message: Obj;
  readonly onEvent?: EventObserver | null;
  readonly onText?: TextObserver | null;
};

/** 已建好的 run 跑一次执行：执行开始 → 运行时 → 收尾结算（Python 的 execute_agent_user_message_run）。 */
export async function executeAgentUserMessageRun(
  deps: AgentRuntimeDeps,
  run: RunRecord,
  input: ExecuteRunInput,
): Promise<Obj> {
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  const onEvent = input.onEvent ?? null;
  const started = await startAgentExecution(services, run);
  let result: Obj | null = null;
  const sink = new AgentRunEventSink(services, onEvent);
  sink.bindExecution(started);
  try {
    result = await new AgentRuntime(deps, sink, input.onText ?? null).runUserMessage(
      run,
      input.agentSessionId,
      input.message,
    );
  } catch (error) {
    if (error instanceof AgentOrchestrationError) throw new AgentRuntimeError(error.message);
    throw error;
  } finally {
    await sink.drainRuntimeProgress();
    const [output, settled, current] = await finishAgentExecution(
      services,
      run.id,
      started,
      result,
    );
    result = output;
    onEvent?.(settled, current);
  }
  return result!;
}

/** 一条作者消息的完整执行：建 run → 执行（Python 的 run_agent_user_message）。 */
export async function runAgentUserMessage(
  deps: AgentRuntimeDeps,
  input: {
    agentSessionId: string;
    message: Obj;
    newRunId: () => string;
    onEvent?: EventObserver | null;
    onText?: TextObserver | null;
  },
): Promise<{ run: RunRecord; startedEvent: RunEventRecord; result: Obj }> {
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  const onEvent = input.onEvent ?? null;
  const start = await startAgentUserMessageRun(services, {
    agentSessionId: input.agentSessionId,
    message: input.message,
    newRunId: input.newRunId,
  });
  onEvent?.(start.startedEvent, start.run);
  const runId = start.run.public_id;
  let result: Obj;
  try {
    result = await executeAgentUserMessageRun(deps, start.run, {
      agentSessionId: input.agentSessionId,
      message: { ...input.message, run_id: runId },
      onEvent,
      onText: input.onText,
    });
  } catch (error) {
    if (error instanceof AgentRuntimeError)
      throw new AgentRuntimeUserMessageError(error.message, start.run, start.startedEvent);
    throw error;
  }
  result.run_id = runId;
  return { run: start.run, startedEvent: start.startedEvent, result };
}

export { SYSTEM_SUMMARY_ARTIFACT_KIND };
