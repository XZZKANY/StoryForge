import { ProjectReadError, type ProjectReader } from '../readPort';
import { AuthorEditPolicyError } from '../kernel/authorEditPolicy';
import { buildGenerationSystemPrompt, editPolicyFromGenerationPrompt } from '../kernel/authorVoice';
import { buildSceneConstraintBlock } from '../kernel/canonContext';
import { FsToolError } from '../kernel/fsTools';
import type { GenerationDeliveryCapture } from '../kernel/generationDelivery';
import { GenerationSourceBudgetError, GenerationSourceCapture } from '../kernel/generationSources';
import { InputDomainError } from '../kernel/json';
import {
  PREVIOUS_FULL_MAX_CHARS,
  previousChapterPassage,
  previousChapterTail,
} from '../kernel/previousChapter';
import { fullwidthCjkPunctuation } from '../kernel/punctuation';
import { collectSettingSources } from '../kernel/settingSources';
import { ProjectTreeError } from '../kernel/projectTree';
import { pythonStrip } from '../kernel/pythonText';
import type { PlainJson, SecretContext } from '../kernel/redaction';
import {
  admitWritingRequest,
  sameProjectRoot,
  type AssistantContextBundle,
  type PreparedWritingContext,
} from '../kernel/writingContext';
import { callLlm, callLlmStreamed, errorUsageSummary, streamChatCompletions } from '../llm/client';
import { envValue, missingLlmEnv, type LlmSource } from '../llm/config';
import { RunInterrupted } from '../llm/control';
import { modelFailureMessage } from '../llm/failureMessage';
import { buildChatPayload, LlmError } from '../llm/payload';
import type { LlmContext, StreamFrame } from '../llm/transport';
import {
  buildContinuePrompt,
  CONTINUE_SYSTEM_PROMPT,
  DEFAULT_TARGET_CHARS,
  finalizeContinuation,
  manuscriptSuffix,
  manuscriptTail,
  resolveAnchorLine,
  SUFFIX_MAX_CHARS,
} from './continuation';
import {
  buildChatPrompt,
  buildDraftPrompt,
  CHAT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
} from './prompts';
import { REVISION_SYSTEM_PROMPT, reviseText, RevisionQualityRejected } from './revision';

type Obj = { [key: string]: unknown };
type Platform = 'windows' | 'posix';

// ---- 错误：状态码与文本照 Python 的 DomainError 子类 ----

/** 真实 LLM 未配置（422），在任何会话写入之前抛出。 */
export class AssistantLlmNotConfiguredError extends Error {
  readonly status = 422;
  constructor(readonly missing: string[]) {
    super('真实 LLM 未配置，缺少环境变量：' + missing.join(', '));
    this.name = 'AssistantLlmNotConfiguredError';
  }
}

/** 模型调用失败（502）：文字是给作者的归类说明，原始报错只进证据。 */
export class AssistantReviseError extends Error {
  readonly status = 502;
  constructor(
    message: string,
    readonly usage: unknown = null,
  ) {
    super(message);
    this.name = 'AssistantReviseError';
  }
}

/** 模型候选相对原文退步（409），不能进入行内 diff。 */
export class AssistantReviseQualityGateError extends Error {
  readonly status = 409;
  constructor(readonly reasons: string[]) {
    super('润色候选未通过质量门禁：' + reasons.join(', '));
    this.name = 'AssistantReviseQualityGateError';
  }
}

/** 会话不存在（404）；会话存储实现在查不到时抛它。 */
export class AssistantSessionNotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'AssistantSessionNotFoundError';
  }
}

/** 会话归属与当前项目冲突（409）。 */
export class AssistantSessionConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'AssistantSessionConflictError';
  }
}

// ---- 端口 ----

export type AssistantMessageInput = { role: 'user' | 'assistant' | 'system'; content: string };
export type AssistantSessionRef = { id: number; project_path: string | null };
export type StoredToolCall = { id: number; input_summary: Obj };
export type ToolCallPatch = {
  status?: 'running' | 'completed' | 'failed' | 'paused';
  input_summary?: Obj;
  output_summary?: Obj;
  error_message?: string;
};

/**
 * 会话与工具调用证据链。脱敏由存储负责（与 Python 存储层一致）；P4 前由 Python 现有会话接口实现。
 */
export interface AssistantStore {
  createSession(input: {
    title: string;
    task_type: string;
    project_path: string | null;
    messages: AssistantMessageInput[];
  }): Promise<AssistantSessionRef>;
  /** 查不到时抛 AssistantSessionNotFoundError。 */
  getSession(id: number): Promise<AssistantSessionRef>;
  appendMessage(sessionId: number, message: AssistantMessageInput): Promise<void>;
  /** 循环里先记 running 再结算；压缩任务一步记下已结束的调用（附用量摘要）。 */
  createToolCall(
    sessionId: number,
    input: {
      tool_name: string;
      status: 'running' | 'completed' | 'failed' | 'paused';
      input_summary: Obj;
      output_summary?: Obj;
      error_message?: string;
    },
  ): Promise<StoredToolCall>;
  updateToolCall(toolCallId: number, patch: ToolCallPatch): Promise<StoredToolCall>;
}

/** 已绑定配置源与传输的模型调用（生产由引擎 LLM 客户端实现，测试可脚本化）。 */
export interface AssistantLlm {
  readonly source: LlmSource;
  readonly secrets: SecretContext;
  call(prompts: { systemPrompt: string; userPrompt: string }): Promise<Obj>;
  callStreamed(prompts: { systemPrompt: string; userPrompt: string }): Promise<Obj>;
  stream(payload: Obj): AsyncIterable<StreamFrame>;
}

/** 生产绑定：引擎 LLM 客户端，传输选项取缺省（与 Python 的 service 调用一致）。 */
export function engineAssistantLlm(
  source: LlmSource,
  secrets: SecretContext,
  context: Omit<LlmContext, 'secrets'>,
): AssistantLlm {
  const ctx: LlmContext = { ...context, secrets };
  return {
    source,
    secrets,
    call: (prompts) => callLlm(source, prompts, ctx),
    callStreamed: (prompts) => callLlmStreamed(source, prompts, ctx),
    stream: (payload) => streamChatCompletions(source, payload, {}, ctx),
  };
}

export type AssistantDeps = {
  reader: ProjectReader;
  store: AssistantStore;
  /** 每次请求解析一次配置源；配置文件坏了在这里抛 503。 */
  llm: () => Promise<AssistantLlm>;
  platform: Platform;
  /** 本机插件库根目录；缺省或 null 是没有插件（产字不带插件指令）。 */
  pluginLibraryRoot?: string | null;
};

// ---- 公共步骤 ----

async function configuredLlm(deps: AssistantDeps): Promise<AssistantLlm> {
  const llm = await deps.llm();
  const missing = missingLlmEnv(llm.source);
  if (missing.length) throw new AssistantLlmNotConfiguredError(missing);
  return llm;
}

const modelOf = (llm: AssistantLlm) => envValue(llm.source, 'STORYFORGE_LLM_MODEL');
const cpLen = (text: string) => Array.from(text).length;
const cpSlice = (text: string, end: number) => Array.from(text).slice(0, end).join('');

/** 会话归属必须与当前项目一致；无项目的会话保持无项目。 */
export function assertSessionProjectMatches(
  session: AssistantSessionRef,
  projectRoot: string | null,
  platform: Platform,
) {
  const owned = session.project_path;
  if (!owned && !projectRoot) return; // 无项目的会话保持无项目。
  if (!owned || !projectRoot)
    throw new AssistantSessionConflictError('AI 会话归属未绑定当前作品，请新建这部作品的会话。');
  if (!sameProjectRoot(owned, projectRoot, platform))
    throw new AssistantSessionConflictError('AI 会话归属冲突，请使用当前作品的会话。');
}

async function existingOrNewSession(
  deps: AssistantDeps,
  options: {
    sessionId: number | null | undefined;
    projectRoot: string | null;
    title: string;
    taskType: string;
    message: string;
    appendToExisting: boolean;
  },
): Promise<AssistantSessionRef> {
  const message: AssistantMessageInput = { role: 'user', content: options.message };
  if (options.sessionId !== null && options.sessionId !== undefined) {
    const session = await deps.store.getSession(options.sessionId);
    assertSessionProjectMatches(session, options.projectRoot, deps.platform);
    if (options.appendToExisting) await deps.store.appendMessage(session.id, message);
    return session;
  }
  return deps.store.createSession({
    title: cpSlice(options.title, 160),
    task_type: options.taskType,
    project_path: options.projectRoot,
    messages: [message],
  });
}

/**
 * canon 硬约束 + 活跃伏笔 + 本章伏笔计划（起草和修订另带已写事实）；
 * canon 缺失或损坏绝不能挡住作者继续写。
 */
async function sceneConstraints(
  deps: AssistantDeps,
  projectRoot: string | null,
  filePath: string | null,
  capture: GenerationSourceCapture,
  facts?: { mentionText: string },
): Promise<string | null> {
  if (!projectRoot) return null;
  try {
    return await buildSceneConstraintBlock(deps.reader, projectRoot, filePath, {
      platform: deps.platform,
      capture,
      ...(facts ? { facts } : {}),
    });
  } catch (error) {
    if (
      error instanceof InputDomainError ||
      error instanceof ProjectReadError ||
      error instanceof ProjectTreeError ||
      error instanceof FsToolError
    )
      return null;
    throw error;
  }
}

/** 挑「已写事实」用的本章材料：写作指令、上下文摘录，以及修订时的现有正文。 */
function factMentionText(
  instruction: string,
  content: string,
  bundle: AssistantContextBundle | null | undefined,
): { mentionText: string } {
  const excerpts = (bundle?.files ?? []).map((item) => item.excerpt);
  return { mentionText: [instruction, content, ...excerpts].join('\n') };
}

async function recordGenerationSources(
  deps: AssistantDeps,
  toolCall: StoredToolCall,
  sources: GenerationSourceCapture,
  systemPrompt: string,
  userPrompt: string,
): Promise<StoredToolCall> {
  let evidence: PlainJson;
  try {
    evidence = await sources.manifest(systemPrompt, userPrompt);
  } catch (error) {
    if (!(error instanceof GenerationSourceBudgetError)) throw error;
    const message = '生成来源证据超出预算，未调用模型，请缩小上下文。';
    await deps.store.updateToolCall(toolCall.id, { status: 'failed', error_message: message });
    throw new AssistantReviseError(message);
  }
  return deps.store.updateToolCall(toolCall.id, {
    input_summary: { ...toolCall.input_summary, generation_sources: evidence },
  });
}

/** 模型调用的两种失败：控制面中断记 paused 并原样抛出；模型错误记 failed 并转成 502。 */
async function recordLlmFailure(
  deps: AssistantDeps,
  toolCall: StoredToolCall,
  llm: AssistantLlm,
  error: unknown,
): Promise<never> {
  if (error instanceof RunInterrupted) {
    await deps.store.updateToolCall(toolCall.id, {
      status: 'paused',
      output_summary: {
        execution_state: 'unknown',
        interruption_reason: error.reason,
        ...errorUsageSummary(error, llm.source),
      },
    });
    throw error;
  }
  if (error instanceof LlmError) {
    await deps.store.updateToolCall(toolCall.id, {
      status: 'failed',
      error_message: cpSlice(error.message, 4000),
      output_summary: errorUsageSummary(error, llm.source),
    });
    throw new AssistantReviseError(modelFailureMessage(error), error.usage);
  }
  throw error;
}

const USAGE_KEYS = [
  'prompt_tokens',
  'completion_tokens',
  'token_usage',
  'cost_cny_estimated',
  'cost_breakdown',
  'token_usage_source',
] as const;
const usageSummary = (result: Obj) =>
  Object.fromEntries(USAGE_KEYS.map((key) => [key, result[key] ?? null]));
const latencyOf = (result: Obj) => {
  const value = result.latency_ms;
  return typeof value === 'number' && value ? Math.trunc(value) : 0;
};
const intOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

// ---- 修订（Ctrl+K） ----

export type ReviseRequest = {
  file_path: string;
  content: string;
  instruction: string;
  project_name?: string | null;
  project_root?: string | null;
  assistant_session_id?: number | null;
  context_bundle?: AssistantContextBundle | null;
  quality_gate?: 'polish' | null;
};

export type ReviseResponse = {
  before: string;
  after: string;
  summary: string;
  model: string;
  latency_ms: number;
  completion_tokens: number | null;
  assistant_session_id: number;
};

/** 对当前文件按指令做一次真实 LLM 修订，落会话与工具调用证据链；后端不写盘。 */
export async function reviseFileContent(
  deps: AssistantDeps,
  request: ReviseRequest,
  options: {
    authorInstruction?: string | null;
    preparedContext?: PreparedWritingContext | null;
    /** 整章修订带上台账里的已写事实；Ctrl+K 这类局部改不带。 */
    writtenFacts?: boolean;
  } = {},
): Promise<ReviseResponse> {
  const llm = await configuredLlm(deps);
  const sources = await GenerationSourceCapture.create({
    root: request.project_root ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
  });
  const payload = await admitWritingRequest(deps.reader, request, {
    intent: 'file.revise',
    preparedContext: options.preparedContext ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
    capture: sources,
  });
  const projectRoot = payload.project_root ?? null;
  const constraints = await sceneConstraints(
    deps,
    projectRoot,
    payload.file_path,
    sources,
    options.writtenFacts
      ? factMentionText(payload.instruction, payload.content, payload.context_bundle)
      : undefined,
  );
  const session = await existingOrNewSession(deps, {
    sessionId: payload.assistant_session_id,
    projectRoot,
    title: `修订 ${payload.file_path}`,
    taskType: 'desktop_revise',
    message: payload.instruction,
    appendToExisting: true,
  });
  const files = payload.context_bundle?.files ?? [];
  const toolCall = await deps.store.createToolCall(session.id, {
    tool_name: 'assistant.revise',
    status: 'running',
    input_summary: {
      file_path: payload.file_path,
      instruction: cpSlice(payload.instruction, 500),
      content_chars: cpLen(payload.content),
      context_file_count: files.length,
      has_scene_constraints: constraints !== null,
    },
  });

  let revision;
  try {
    const systemPrompt = await buildGenerationSystemPrompt(
      deps.reader,
      REVISION_SYSTEM_PROMPT,
      projectRoot,
      {
        platform: deps.platform,
        capture: sources,
        pluginLibraryRoot: deps.pluginLibraryRoot ?? null,
        secrets: llm.secrets,
      },
    );
    revision = await reviseText(
      {
        filePath: payload.file_path,
        content: payload.content,
        instruction: payload.instruction,
        systemPrompt,
        projectName: payload.project_name ?? null,
        contextFiles: files.map((item) => ({
          relative_path: item.relative_path,
          kind: item.kind,
          excerpt: item.excerpt,
        })),
        sceneConstraints: constraints,
        qualityGate: payload.quality_gate ?? null,
        editPolicy: editPolicyFromGenerationPrompt(payload.content, {
          instruction: options.authorInstruction ?? payload.instruction,
          systemPrompt,
        }),
      },
      async (prompts) => {
        await recordGenerationSources(
          deps,
          toolCall,
          sources,
          prompts.systemPrompt,
          prompts.userPrompt,
        );
        return llm.callStreamed(prompts);
      },
    );
  } catch (error) {
    if (error instanceof AuthorEditPolicyError) {
      const message = '作者编辑要求无效，请重新指定需要逐字保留的片段。';
      await deps.store.updateToolCall(toolCall.id, { status: 'failed', error_message: message });
      throw new AssistantReviseError(message);
    }
    if (error instanceof RevisionQualityRejected) {
      const gate = error.gate;
      const rejected = new AssistantReviseQualityGateError(gate.reasons);
      await deps.store.updateToolCall(toolCall.id, {
        status: 'failed',
        output_summary: {
          quality_gate: {
            version: gate.gate_version,
            passed: false,
            reasons: [...gate.reasons],
            metrics: { ...gate.metrics },
          },
        },
        error_message: rejected.message,
      });
      throw rejected;
    }
    return recordLlmFailure(deps, toolCall, llm, error);
  }

  const { after, telemetry: result, qualityGate } = revision;
  const latency = latencyOf(result);
  const summary = `已按指令修订 ${payload.file_path}，修订后约 ${cpLen(after)} 字。`;
  const output: Obj = { after_chars: cpLen(after), ...usageSummary(result), latency_ms: latency };
  if (result.reasoning_leak_stripped) output.reasoning_leak_stripped = true;
  if (qualityGate !== null)
    output.quality_gate = {
      version: qualityGate.gate_version,
      passed: true,
      reasons: [],
      advisories: [...qualityGate.advisories],
      metrics: { ...qualityGate.metrics },
    };
  await deps.store.updateToolCall(toolCall.id, { status: 'completed', output_summary: output });
  await deps.store.appendMessage(session.id, { role: 'assistant', content: summary });
  return {
    before: payload.content,
    after,
    summary,
    model: modelOf(llm),
    latency_ms: latency,
    completion_tokens: intOrNull(result.completion_tokens),
    assistant_session_id: session.id,
  };
}

// ---- 光标处续写（Ctrl+Shift+K） ----

export type ContinueRequest = {
  file_path: string;
  content: string;
  cursor_line?: number;
  instruction?: string | null;
  project_root?: string | null;
  project_name?: string | null;
  assistant_session_id?: number | null;
  target_chars?: number | null;
  context_bundle?: AssistantContextBundle | null;
};

/** 与 SSE 的 event / data 同形；`done.text` 是确定性后处理后的权威结果。 */
export type ContinueFrame =
  | {
      event: 'start';
      data: {
        assistant_session_id: number;
        tool_call_id: number;
        model: string;
        target_chars: number;
      };
    }
  | { event: 'delta'; data: { text: string } }
  | {
      event: 'done';
      data: {
        text: string;
        model: string;
        completion_tokens: unknown;
        latency_ms: unknown;
        assistant_session_id: number;
      };
    }
  | { event: 'error'; data: { message: string } };

async function currentFileIdentity(
  deps: AssistantDeps,
  projectRoot: string | null,
  filePath: string,
): Promise<string | null> {
  if (!projectRoot) return null;
  try {
    return (await deps.reader.resolveProjectPath(projectRoot, filePath.replace(/\\/g, '/')))
      .resolvedRelativePath;
  } catch (error) {
    // 认不出目标身份就不具备自动回放来源的资格。
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
}

/**
 * 前置校验与证据链落库在出第一帧之前完成（未配置 / 会话冲突直接抛错，前端拿得到状态码）；
 * 之后逐块回调。控制面中断会在记 paused 后抛出（Python 的流在这里断开）。
 */
export async function streamContinueProse(
  deps: AssistantDeps,
  request: ContinueRequest,
  onFrame: (frame: ContinueFrame) => void,
): Promise<void> {
  const llm = await configuredLlm(deps);
  const projectRoot = request.project_root ?? null;
  const cursorLine = request.cursor_line ?? 0;
  const anchorLine = resolveAnchorLine(request.content, cursorLine);
  const tail = manuscriptTail(request.content, anchorLine);
  const suffix = manuscriptSuffix(request.content, anchorLine);
  const sources = await GenerationSourceCapture.create({
    root: projectRoot,
    platform: deps.platform,
    secrets: llm.secrets,
    writingContextFile: await currentFileIdentity(deps, projectRoot, request.file_path),
  });
  const admitted = await admitWritingRequest(deps.reader, request, {
    intent: 'prose.continue',
    platform: deps.platform,
    secrets: llm.secrets,
    capture: sources,
  });
  const contextBundle = admitted.context_bundle ?? null;
  const targetChars = request.target_chars || DEFAULT_TARGET_CHARS;
  await sources.continuation(request.content, anchorLine, tail, suffix, SUFFIX_MAX_CHARS);
  const constraints = await sceneConstraints(deps, projectRoot, request.file_path, sources);
  const previousChapter = projectRoot
    ? await previousChapterTail(deps.reader, projectRoot, request.file_path, {
        platform: deps.platform,
        capture: sources,
      })
    : null;
  const instruction = request.instruction ?? null;
  const session = await existingOrNewSession(deps, {
    sessionId: request.assistant_session_id,
    projectRoot,
    title: `续写 ${request.file_path}`,
    taskType: 'desktop_continue',
    message: instruction || `续写 ${request.file_path}`,
    appendToExisting: true,
  });
  const suffixChars = cpLen(suffix);
  const toolCall = await deps.store.createToolCall(session.id, {
    tool_name: 'assistant.continue',
    status: 'running',
    input_summary: {
      file_path: request.file_path,
      cursor_line: cursorLine,
      tail_chars: cpLen(tail),
      suffix_chars: Math.min(suffixChars, SUFFIX_MAX_CHARS),
      suffix_truncated: suffixChars > SUFFIX_MAX_CHARS,
      context_file_count: contextBundle ? contextBundle.files.length : 0,
      target_chars: targetChars,
      has_instruction: instruction !== null,
      has_scene_constraints: constraints !== null,
      previous_chapter: previousChapter ? previousChapter[0] : null,
    },
  });
  const systemPrompt = await buildGenerationSystemPrompt(
    deps.reader,
    CONTINUE_SYSTEM_PROMPT,
    projectRoot,
    {
      platform: deps.platform,
      capture: sources,
      pluginLibraryRoot: deps.pluginLibraryRoot ?? null,
      secrets: llm.secrets,
    },
  );
  const userPrompt = buildContinuePrompt({
    tail,
    filePath: request.file_path,
    suffix,
    contextBundle,
    instruction,
    sceneConstraints: constraints,
    previousChapter,
    targetChars,
  });
  const requestPayload = buildChatPayload(llm.source, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: null,
    toolChoice: null,
    stream: true,
    // 中文按字符给足配额，宁可被截断后裁到句末，也不让模型无上限写成整章。
    maxCompletionTokens: Math.max(256, targetChars * 3),
  });
  await recordGenerationSources(deps, toolCall, sources, systemPrompt, userPrompt);
  const model = modelOf(llm);

  onFrame({
    event: 'start',
    data: {
      assistant_session_id: session.id,
      tool_call_id: toolCall.id,
      model,
      target_chars: targetChars,
    },
  });
  const rawParts: string[] = [];
  try {
    for await (const frame of llm.stream(requestPayload)) {
      if (frame.type === 'delta') {
        const text = typeof frame.text === 'string' ? frame.text : '';
        rawParts.push(text);
        onFrame({ event: 'delta', data: { text } });
        continue;
      }
      const raw = rawParts.join('');
      const finalText = finalizeContinuation(tail, raw);
      if (!finalText) {
        const message = '模型这一轮没有写出新内容（可能只是复述了上文）。';
        await deps.store.updateToolCall(toolCall.id, { status: 'failed', error_message: message });
        onFrame({ event: 'error', data: { message } });
        return;
      }
      const output: Obj = {
        final_chars: cpLen(finalText),
        raw_chars: cpLen(raw),
        ...usageSummary(frame),
        latency_ms: frame.latency_ms ?? null,
      };
      if (frame.reasoning_leak_stripped) output.reasoning_leak_stripped = true;
      await deps.store.updateToolCall(toolCall.id, { status: 'completed', output_summary: output });
      await deps.store.appendMessage(session.id, {
        role: 'assistant',
        content: `已在 ${request.file_path} 光标处续写约 ${cpLen(finalText)} 字，待作者确认。`,
      });
      // 流里吐的是原始增量；掐重复开头、裁到句末只能在收尾做，前端须以这一帧覆盖累积缓冲。
      onFrame({
        event: 'done',
        data: {
          text: finalText,
          model,
          completion_tokens: frame.completion_tokens ?? null,
          latency_ms: frame.latency_ms ?? null,
          assistant_session_id: session.id,
        },
      });
      return;
    }
  } catch (error) {
    if (error instanceof LlmError) {
      await deps.store.updateToolCall(toolCall.id, {
        status: 'failed',
        error_message: cpSlice(error.message, 4000),
        output_summary: errorUsageSummary(error, llm.source),
      });
      onFrame({ event: 'error', data: { message: modelFailureMessage(error) } });
      return;
    }
    return recordLlmFailure(deps, toolCall, llm, error);
  }
}

/**
 * 非流式光标处续写，给 agent 循环的 prose.continue 用：与流式共用取窗 / 提示 / 确定性后处理，
 * 只换传输。返回的只是要插入的那一段，落点插入由调用方完成；后端绝不写盘。
 */
export async function draftContinuation(
  deps: AssistantDeps,
  request: ContinueRequest,
  options: {
    preparedContext?: PreparedWritingContext | null;
    /** 嵌套 writer 的送达回执（Python 经 ContextVar 收集）。 */
    deliveries?: GenerationDeliveryCapture | null;
  } = {},
): Promise<DraftResponse> {
  const llm = await configuredLlm(deps);
  const sources = await GenerationSourceCapture.create({
    root: request.project_root ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
    writingContextFile: await currentFileIdentity(
      deps,
      request.project_root ?? null,
      request.file_path,
    ),
  });
  const payload = await admitWritingRequest(deps.reader, request, {
    intent: 'prose.continue',
    preparedContext: options.preparedContext ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
    capture: sources,
  });
  const projectRoot = payload.project_root ?? null;
  const cursorLine = payload.cursor_line ?? 0;
  const anchorLine = resolveAnchorLine(payload.content, cursorLine);
  const tail = manuscriptTail(payload.content, anchorLine);
  const suffix = manuscriptSuffix(payload.content, anchorLine);
  const targetChars = payload.target_chars || DEFAULT_TARGET_CHARS;
  await sources.continuation(payload.content, anchorLine, tail, suffix, SUFFIX_MAX_CHARS);
  const constraints = await sceneConstraints(deps, projectRoot, payload.file_path, sources);
  const previousChapter = projectRoot
    ? await previousChapterTail(deps.reader, projectRoot, payload.file_path, {
        platform: deps.platform,
        capture: sources,
      })
    : null;
  const instruction = payload.instruction ?? null;
  const session = await existingOrNewSession(deps, {
    sessionId: payload.assistant_session_id,
    projectRoot,
    title: `续写 ${payload.file_path}`,
    taskType: 'desktop_continue',
    message: instruction || `续写 ${payload.file_path}`,
    appendToExisting: false,
  });
  const contextBundle = payload.context_bundle ?? null;
  const suffixChars = cpLen(suffix);
  const toolCall = await deps.store.createToolCall(session.id, {
    tool_name: 'assistant.continue',
    status: 'running',
    input_summary: {
      file_path: payload.file_path,
      cursor_line: cursorLine,
      tail_chars: cpLen(tail),
      suffix_chars: Math.min(suffixChars, SUFFIX_MAX_CHARS),
      suffix_truncated: suffixChars > SUFFIX_MAX_CHARS,
      context_file_count: contextBundle ? contextBundle.files.length : 0,
      target_chars: targetChars,
      has_instruction: instruction !== null,
      has_scene_constraints: constraints !== null,
      previous_chapter: previousChapter ? previousChapter[0] : null,
      transport: 'tool_loop',
    },
  });
  let result: Obj;
  try {
    const systemPrompt = await buildGenerationSystemPrompt(
      deps.reader,
      CONTINUE_SYSTEM_PROMPT,
      projectRoot,
      {
        platform: deps.platform,
        capture: sources,
        pluginLibraryRoot: deps.pluginLibraryRoot ?? null,
        secrets: llm.secrets,
      },
    );
    const userPrompt = buildContinuePrompt({
      tail,
      filePath: payload.file_path,
      suffix,
      contextBundle,
      instruction,
      sceneConstraints: constraints,
      previousChapter,
      targetChars,
    });
    const stored = await recordGenerationSources(deps, toolCall, sources, systemPrompt, userPrompt);
    try {
      options.deliveries?.record(
        stored.id,
        stored.input_summary.generation_sources as { [key: string]: PlainJson },
      );
    } catch {
      // 送达回执必须先于模型调用落定，失败就不发请求。
      const message = '生成送达关联未能持久化，未调用模型。';
      await deps.store.updateToolCall(toolCall.id, { status: 'failed', error_message: message });
      throw new AssistantReviseError(message);
    }
    result = await llm.callStreamed({ systemPrompt, userPrompt });
  } catch (error) {
    return recordLlmFailure(deps, toolCall, llm, error);
  }
  const finalText = finalizeContinuation(tail, String(result.content));
  if (!finalText) {
    const message = '模型这一轮没有写出新内容（可能只是复述了上文）。';
    await deps.store.updateToolCall(toolCall.id, { status: 'failed', error_message: message });
    throw new AssistantReviseError(message);
  }
  const latency = latencyOf(result);
  const output: Obj = {
    final_chars: cpLen(finalText),
    ...usageSummary(result),
    latency_ms: latency,
  };
  if (result.reasoning_leak_stripped) output.reasoning_leak_stripped = true;
  await deps.store.updateToolCall(toolCall.id, { status: 'completed', output_summary: output });
  return {
    content: finalText,
    summary: `已在 ${payload.file_path} 光标处续写约 ${cpLen(finalText)} 字，待作者确认。`,
    model: modelOf(llm),
    latency_ms: latency,
    completion_tokens: intOrNull(result.completion_tokens),
    assistant_session_id: session.id,
  };
}

// ---- 新文件起草（agent 循环的 file.create，P3 接线） ----

export type DraftRequest = {
  file_path: string;
  instruction: string;
  project_name?: string | null;
  project_root?: string | null;
  assistant_session_id?: number | null;
  context_bundle?: AssistantContextBundle | null;
};

export type DraftResponse = {
  content: string;
  summary: string;
  model: string;
  latency_ms: number;
  completion_tokens: number | null;
  assistant_session_id: number;
};

/** 按指令为尚不存在的文件起草初稿；不写盘，写回由前端补丁确认承担。 */
export async function draftFileContent(
  deps: AssistantDeps,
  request: DraftRequest,
  options: { preparedContext?: PreparedWritingContext | null } = {},
): Promise<DraftResponse> {
  const llm = await configuredLlm(deps);
  const sources = await GenerationSourceCapture.create({
    root: request.project_root ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
  });
  const payload = await admitWritingRequest(deps.reader, request, {
    intent: 'file.create',
    preparedContext: options.preparedContext ?? null,
    platform: deps.platform,
    secrets: llm.secrets,
    capture: sources,
  });
  const projectRoot = payload.project_root ?? null;
  const constraints = await sceneConstraints(
    deps,
    projectRoot,
    payload.file_path,
    sources,
    factMentionText(payload.instruction, '', payload.context_bundle),
  );
  const previous = await previousChapterPassage(deps.reader, projectRoot, payload.file_path, {
    platform: deps.platform,
    capture: sources,
    maxChars: PREVIOUS_FULL_MAX_CHARS,
  });
  const previousChapter = previous === null ? null : ([previous.path, previous.text] as const);
  const settings =
    projectRoot === null
      ? null
      : await collectSettingSources(deps.reader, projectRoot, {
          secrets: llm.secrets,
          capture: sources,
        });
  const session = await existingOrNewSession(deps, {
    sessionId: payload.assistant_session_id,
    projectRoot,
    title: `起草 ${payload.file_path}`,
    taskType: 'desktop_draft',
    message: payload.instruction,
    appendToExisting: false,
  });
  const toolCall = await deps.store.createToolCall(session.id, {
    tool_name: 'assistant.draft',
    status: 'running',
    input_summary: {
      file_path: payload.file_path,
      instruction: cpSlice(payload.instruction, 500),
      context_file_count: payload.context_bundle ? payload.context_bundle.files.length : 0,
      has_scene_constraints: constraints !== null,
      previous_chapter: previousChapter ? previousChapter[0] : null,
    },
  });
  let result: Obj;
  try {
    const systemPrompt = await buildGenerationSystemPrompt(
      deps.reader,
      DRAFT_SYSTEM_PROMPT,
      projectRoot,
      {
        platform: deps.platform,
        capture: sources,
        pluginLibraryRoot: deps.pluginLibraryRoot ?? null,
        secrets: llm.secrets,
      },
    );
    const userPrompt = buildDraftPrompt(payload, constraints, previousChapter, {
      settings,
      previousTruncated: previous?.truncated,
    });
    await recordGenerationSources(deps, toolCall, sources, systemPrompt, userPrompt);
    result = await llm.callStreamed({ systemPrompt, userPrompt });
  } catch (error) {
    return recordLlmFailure(deps, toolCall, llm, error);
  }
  const [content, punctuationNormalized] = fullwidthCjkPunctuation(String(result.content));
  const latency = latencyOf(result);
  const output: Obj = {
    content_chars: cpLen(content),
    ...usageSummary(result),
    latency_ms: latency,
  };
  // 剥离过思维链泄漏的产物可能被吞正文，证据链留标记供归因与人工复核。
  if (result.reasoning_leak_stripped) output.reasoning_leak_stripped = true;
  if (punctuationNormalized) output.punctuation_normalized = punctuationNormalized;
  await deps.store.updateToolCall(toolCall.id, { status: 'completed', output_summary: output });
  return {
    content,
    summary: `已起草 ${payload.file_path} 初稿，约 ${cpLen(content)} 字。`,
    model: modelOf(llm),
    latency_ms: latency,
    completion_tokens: intOrNull(result.completion_tokens),
    assistant_session_id: session.id,
  };
}

// ---- 项目对话的一次真实回复（agent 循环用，P3 接线） ----

export async function chatReply(
  deps: AssistantDeps,
  options: { userMessage: string; contextBlock: string; assistantSessionId: number },
): Promise<{ reply: string; model: string; completion_tokens: unknown; latency_ms: number }> {
  const llm = await configuredLlm(deps);
  const toolCall = await deps.store.createToolCall(options.assistantSessionId, {
    tool_name: 'assistant.chat',
    status: 'running',
    input_summary: {
      message: cpSlice(options.userMessage, 500),
      context_chars: cpLen(options.contextBlock),
    },
  });
  let result: Obj;
  try {
    result = await llm.call({
      systemPrompt: CHAT_SYSTEM_PROMPT,
      userPrompt: buildChatPrompt(options.userMessage, options.contextBlock),
    });
  } catch (error) {
    return recordLlmFailure(deps, toolCall, llm, error);
  }
  const reply = pythonStrip(String(result.content));
  const model = modelOf(llm);
  await deps.store.updateToolCall(toolCall.id, {
    status: 'completed',
    output_summary: { reply_chars: cpLen(reply), model, ...usageSummary(result) },
  });
  return {
    reply,
    model,
    completion_tokens: result.completion_tokens ?? null,
    latency_ms: latencyOf(result),
  };
}
