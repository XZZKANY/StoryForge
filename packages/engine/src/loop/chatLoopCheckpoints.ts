import { startsWithSkillCommand } from '@storyforge/project-core';
import { readPluginInstructions } from '../kernel/authorVoice';
import {
  findAvailableSkill,
  invokedConversationSkills,
  loadAvailableSkills,
  type AvailableSkill,
  type SkillPlugin,
} from '../kernel/conversationSkills';
import { AUTHOR_INSTRUCTIONS_PATH } from '../kernel/fsTools';
import {
  cloneJson,
  isJsonObject,
  isObj,
  parseJson,
  type JsonObject,
  type JsonValue,
  type Obj,
} from '../kernel/json';
import { MAX_READ_BYTES } from '../kernel/projectTree';
import type { SecretContext } from '../kernel/redaction';
import { sha256Hex } from '../kernel/sha256';
import type { ChatRequest } from '../llm/contracts';
import { ProjectReadError, type ProjectReader } from '../readPort';
import type { ChatLoopOutcome } from './chatLoopTypes';
import type { StoryForgeRuntimeContext } from './chatLoopContext';
import type { CheckpointStore } from './sdkPorts';
import { RuntimeCheckpoint } from './sdkState';
import { listLoopToolSpecs, llmToolName } from './tools/catalog';
import type { ToolArtifact } from './tools/execution';
import { traceAsDict, type AgentToolTrace } from './traces';

type CheckpointFields = ConstructorParameters<typeof RuntimeCheckpoint>[0];

/** 本轮读过的一个文件：请求时的写法 → 解析后的项目相对路径与内容摘要（不存在记 null）。 */
export type SourceFingerprint = {
  readonly path: string;
  readonly sha256: string | null;
  /** 超过单文件读量上限，无法核对：续跑一律视为来源已变。 */
  readonly unverifiable?: true;
  /** 插件技能与插件指令（键为 `plugin:<插件id>/<插件内路径>`）：插件文件夹的绝对路径，path 是插件内路径。 */
  readonly plugin_root?: string;
};
export type RecoverySources = {
  readonly project_root: string;
  readonly files: { readonly [requested: string]: SourceFingerprint };
};

/**
 * 一次保存下来的循环检查点：SDK 快照连同结果累计、派发状态与本轮读过文件的指纹。
 * 只留在引擎内存里（§2.6：重启后不续跑，从不落库）；同一进程里暂停后可以接着跑。
 */
export type SavedLoopCheckpoint = {
  readonly checkpoint: RuntimeCheckpoint;
  readonly assistantSessionId: number;
  readonly permissionProfile: string;
  readonly resumeMessage: Obj;
  readonly outcome: Obj;
  readonly dispatchState: 'checkpointed' | 'model_outcome_unknown';
  readonly sources: RecoverySources;
};

/** 按 run 保存检查点；续跑取最近一份。 */
export class LoopCheckpointStore {
  private readonly saved = new Map<string, SavedLoopCheckpoint[]>();

  append(runId: string, item: SavedLoopCheckpoint): void {
    const list = this.saved.get(runId) ?? [];
    list.push(item);
    this.saved.set(runId, list);
  }

  latest(runId: string): SavedLoopCheckpoint | null {
    const list = this.saved.get(runId);
    return list && list.length ? list[list.length - 1] : null;
  }

  /** 测试与对账用：某个 run 的全部保存记录。 */
  history(runId: string): readonly SavedLoopCheckpoint[] {
    return [...(this.saved.get(runId) ?? [])];
  }
}

const OUTCOME_FIELDS: [string, (outcome: ChatLoopOutcome) => unknown][] = [
  ['rounds', (o) => o.rounds],
  ['tool_call_count', (o) => o.toolCallCount],
  ['completion_tokens', (o) => o.completionTokens],
  ['prompt_tokens', (o) => o.promptTokens],
  ['token_usage', (o) => o.tokenUsage],
  ['token_usage_source', (o) => o.tokenUsageSource],
  ['cost_cny_estimated', (o) => o.costCnyEstimated],
  ['cost_breakdown', (o) => o.costBreakdown],
  ['review_report', (o) => o.reviewReport],
];

/** 结果累计的可恢复快照（字段与 Python checkpoint payload 的 outcome 一致）。 */
export function outcomePayload(outcome: ChatLoopOutcome): Obj {
  const result: Obj = Object.fromEntries(
    OUTCOME_FIELDS.map(([name, read]) => [name, read(outcome)]),
  );
  result.traces = outcome.traces.map(traceAsDict);
  result.proposed_patch = outcome.proposedPatch;
  result.artifacts = outcome.artifacts.map((artifact) => ({
    kind: artifact.kind,
    payload: artifact.payload,
    requires_confirmation: artifact.requires_confirmation,
  }));
  return cloneJson(result as JsonObject);
}

/** 会读写文件的循环工具（以及 fs.read）：它们的 path 参数就是本轮读过的文件。 */
const TRACKED_TOOL_NAMES = new Set(
  listLoopToolSpecs()
    .filter(
      (spec) =>
        spec.loop_input_mode === 'existing_file' ||
        spec.loop_input_mode === 'new_file' ||
        spec.name === 'fs.read',
    )
    .map((spec) => llmToolName(spec.name)),
);
const SKILL_READ_LLM_NAME = llmToolName('skill.read');

type SourceDeps = {
  readonly reader: ProjectReader;
  readonly secrets?: SecretContext;
  /** 本机插件库根目录；缺省或 null 是没有插件。 */
  readonly pluginLibraryRoot?: string | null;
};

/** 键里插件 id 后面的部分（插件 id 是文件夹名，不含「/」）。 */
const pluginSourcePath = (key: string) => key.slice(key.indexOf('/') + 1);

/** 一个请求路径的当前指纹；越界返回 undefined（从不检查项目外的路径），目录返回 null。 */
async function fingerprint(
  reader: ProjectReader,
  root: string,
  requested: string,
): Promise<SourceFingerprint | null | undefined> {
  let resolved: string;
  try {
    resolved = (await reader.resolveProjectPath(root, requested)).resolvedRelativePath;
  } catch (error) {
    if (error instanceof ProjectReadError && error.kind === 'outside-project') return undefined;
    throw error;
  }
  const meta = await reader.inspectProjectPath(root, requested);
  if (meta.targetKind === 'missing') return { path: resolved, sha256: null };
  // 目录从来不是正文来源（模型对目录调 fs_read 时工具已经报过「不是文件」）。
  if (meta.targetKind !== 'file') return null;
  if (meta.sizeBytes > MAX_READ_BYTES) return { path: resolved, sha256: null, unverifiable: true };
  const read = await reader.readProjectBytes(root, requested, MAX_READ_BYTES);
  if (read.exceeded) return { path: resolved, sha256: null, unverifiable: true };
  return { path: resolved, sha256: sha256Hex(read.bytes) };
}

/** 插件技能文件的当前指纹；插件文件夹没了或读不到时记成无法核对。 */
async function pluginFingerprint(
  reader: ProjectReader,
  pluginRoot: string,
  path: string,
): Promise<SourceFingerprint> {
  try {
    const current = await fingerprint(reader, pluginRoot, path);
    if (current) return { ...current, plugin_root: pluginRoot };
  } catch (error) {
    if (!(error instanceof ProjectReadError)) throw error;
  }
  return { path, sha256: null, unverifiable: true, plugin_root: pluginRoot };
}

/**
 * 本轮读过的文件：当前文件、作者指令、带摘录的上下文文件、点名的技能、会读文件的工具调用。
 * 插件技能（点名或 skill_read 读过）与这一轮带上的插件指令记在 `plugin:<插件id>/<插件内路径>` 键下，
 * 作品技能仍记项目相对路径。
 */
export async function sourceVersions(
  deps: SourceDeps,
  toolMessages: RuntimeCheckpoint['messages'],
  message: Obj,
): Promise<RecoverySources> {
  const args = isObj(message.args) ? message.args : {};
  const root = String(args.project_path ?? '');
  const paths: unknown[] = [args.file_path, AUTHOR_INSTRUCTIONS_PATH];
  const bundle = args.context_bundle;
  if (isObj(bundle) && Array.isArray(bundle.files))
    for (const item of bundle.files)
      if (isObj(item) && item.excerpt) paths.push(item.relative_path || item.path);
  const userMessage = typeof message.user_message === 'string' ? message.user_message : '';
  let available: AvailableSkill[] | null = null;
  const availableSkills = async () =>
    (available ??= await loadAvailableSkills(
      deps.reader,
      root,
      deps.pluginLibraryRoot ?? null,
      deps.secrets ?? { values: [] },
    ));
  const pluginSkills: { plugin: SkillPlugin; path: string }[] = [];
  const track = ({ plugin, path }: AvailableSkill) => {
    if (plugin === null) paths.push(path);
    else pluginSkills.push({ plugin, path });
  };
  // 先看触发符再读技能目录：检查点每次保存都会走到这里。
  if (startsWithSkillCommand(userMessage))
    for (const skill of invokedConversationSkills(await availableSkills(), userMessage))
      track(skill);
  const readSkillNames: string[] = [];
  for (const message of toolMessages)
    for (const call of message.toolCalls) {
      const skillRead = call.name === SKILL_READ_LLM_NAME;
      if (!skillRead && !TRACKED_TOOL_NAMES.has(call.name)) continue;
      let parsed: JsonValue;
      try {
        parsed = parseJson(call.argumentsJson, 'tool arguments');
      } catch {
        continue;
      }
      if (!isJsonObject(parsed)) continue;
      if (!skillRead) paths.push(parsed.path);
      else if (typeof parsed.name === 'string') readSkillNames.push(parsed.name);
    }
  for (const name of readSkillNames) {
    const skill = findAvailableSkill(await availableSkills(), name);
    if (skill !== null) track(skill);
  }
  const files: { [requested: string]: SourceFingerprint } = {};
  for (const value of paths) {
    if (typeof value !== 'string' || !value) continue;
    const current = await fingerprint(deps.reader, root, value);
    // 请求时的写法与解析后的目标都记下：链接被删或改指向也看得出来。
    if (current) files[value] = current;
  }
  for (const { plugin, path } of pluginSkills)
    files[`plugin:${plugin.id}/${path}`] ??= await pluginFingerprint(
      deps.reader,
      plugin.root,
      path,
    );
  // 这一轮带上的插件指令：与组装对话消息同一个取舍，被丢弃的不记。
  const pluginInstructions = await readPluginInstructions(
    deps.reader,
    root,
    deps.pluginLibraryRoot ?? null,
    deps.secrets ?? { values: [] },
  );
  for (const part of pluginInstructions)
    if (part.omission === null)
      files[`plugin:${part.id}/${part.path}`] ??= await pluginFingerprint(
        deps.reader,
        part.root,
        part.path,
      );
  return { project_root: root, files };
}

/** 续跑前核对：每个记过的文件仍解析到同一处、内容摘要不变。 */
export async function sourcesUnchanged(
  deps: SourceDeps,
  sources: RecoverySources,
  message: Obj,
): Promise<boolean> {
  const args = isObj(message.args) ? message.args : {};
  if (args.project_path !== sources.project_root) return false;
  try {
    for (const [requested, recorded] of Object.entries(sources.files)) {
      if (recorded.unverifiable) return false;
      const current =
        recorded.plugin_root === undefined
          ? await fingerprint(deps.reader, sources.project_root, requested)
          : await fingerprint(deps.reader, recorded.plugin_root, pluginSourcePath(requested));
      if (!current || current.unverifiable) return false;
      if (current.path !== recorded.path || current.sha256 !== recorded.sha256) return false;
    }
  } catch (error) {
    if (error instanceof ProjectReadError) return false;
    throw error;
  }
  return true;
}

/** SDK 的检查点端口：每次保存同时记下结果累计与来源指纹；发模型请求前先存一次「结果未知」。 */
export class StoryForgeCheckpointStore implements CheckpointStore {
  constructor(
    private readonly context: StoryForgeRuntimeContext,
    private readonly store: LoopCheckpointStore,
    private readonly deps: SourceDeps,
  ) {}

  async save(checkpoint: RuntimeCheckpoint): Promise<void> {
    const context = this.context;
    if (checkpoint.runId !== context.run.public_id) throw new Error('checkpoint_identity_mismatch');
    const current = await sourceVersions(this.deps, checkpoint.messages, context.recoveryMessage);
    // 已记过的文件保留第一次读到时的指纹，新出现的才补记。
    const files = { ...(context.recoverySources?.files ?? current.files) };
    for (const [path, value] of Object.entries(current.files)) files[path] ??= value;
    const sources = { project_root: current.project_root, files };
    this.store.append(checkpoint.runId, {
      checkpoint,
      assistantSessionId: context.assistantSessionId,
      permissionProfile: context.run.permission_profile,
      resumeMessage: cloneJson(context.recoveryMessage as JsonValue) as Obj,
      outcome: outcomePayload(context.outcome),
      dispatchState: context.modelOutcomeUnknown ? 'model_outcome_unknown' : 'checkpointed',
      sources,
    });
    context.recoverySources = sources;
    context.latestCheckpoint = checkpoint;
  }

  async modelStarted(request: ChatRequest): Promise<void> {
    const context = this.context;
    context.modelOutcomeUnknown = true;
    const base: CheckpointFields = context.latestCheckpoint ?? {
      runId: context.run.public_id,
      model: request.model,
      phase: 'before_model',
      messages: request.messages,
      roundCount: 0,
      toolAttempts: 0,
      toolOutputChars: 0,
      totalTokens: 0,
      totalCost: null,
      usageAvailable: false,
      costAvailable: false,
      pending: null,
      completedToolCallIds: [],
      artifacts: [],
      exhausted: false,
      sequence: 0,
      interruptionReason: null,
      continuationOmitted: false,
    };
    await this.save(
      new RuntimeCheckpoint({
        ...base,
        messages: request.messages,
        phase: 'before_model',
        roundCount: context.providerAttempts,
      }),
    );
  }

  load(): null {
    // 续跑由调用方先诊断再显式恢复（restoreCheckpointContext），SDK 不自己加载。
    return null;
  }
}

const LOOP_POLICIES = new Map(listLoopToolSpecs().map((spec) => [llmToolName(spec.name), spec]));

/**
 * 能不能从这份检查点接着跑（作者 2026-10-13 同意的规则）：派发结果未知、已经是终态、身份或档位变了、
 * 本轮读过的文件被改过、或卡在一个不可安全重放的工具上，都不续跑，让作者重新发起。
 * 字段形状与 Python 的 checkpoint_diagnostic 一致；检查点不落库，没有 artifact_id。
 */
export async function diagnoseCheckpoint(
  deps: SourceDeps,
  saved: SavedLoopCheckpoint,
  run: { public_id: string; assistant_session_id: number | null; permission_profile: string },
): Promise<Obj> {
  const message = saved.resumeMessage;
  const checkpoint = saved.checkpoint;
  let reason: string | null = null;
  if (!isObj(message) || !isObj(message.args) || typeof message.args.project_path !== 'string')
    reason = 'missing_resume_context';
  else if (saved.dispatchState === 'model_outcome_unknown') reason = 'model_outcome_unknown';
  else if (checkpoint.phase === 'failed' || checkpoint.phase === 'completed')
    reason = 'terminal_checkpoint_requires_delivery_reconciliation';
  else if (
    checkpoint.runId !== run.public_id ||
    saved.assistantSessionId !== run.assistant_session_id
  )
    reason = 'checkpoint_identity_mismatch';
  else if (saved.permissionProfile !== run.permission_profile)
    reason = 'permission_snapshot_changed';
  else if (!(await sourcesUnchanged(deps, saved.sources, message)))
    reason = 'source_version_changed';
  const pending = checkpoint.pending;
  if (
    reason === null &&
    pending !== null &&
    (pending.attempt > 0 || checkpoint.phase === 'tool_started')
  ) {
    const policy = LOOP_POLICIES.get(pending.name);
    if (!policy || !(policy.idempotent && policy.retry_safe)) reason = 'tool_outcome_unknown';
  }
  return {
    kind: 'runtime_checkpoint_resume',
    can_resume: reason === null,
    reason: reason ?? 'durable_checkpoint_ready',
    resume_strategy: reason ? 'reconciliation_required' : 'continue_checkpoint',
    requires_manual_restart: false,
    resume_via_control_channel: reason === null,
  };
}

/** 从检查点恢复结果累计与调用账（补丁一律退回逐次确认）。 */
export function restoreCheckpointContext(
  context: StoryForgeRuntimeContext,
  saved: SavedLoopCheckpoint,
): void {
  const { checkpoint } = saved;
  const raw = cloneJson(saved.outcome as JsonObject) as Obj;
  const outcome = context.outcome;
  context.recoverySources = saved.sources;
  context.latestCheckpoint = checkpoint;
  outcome.rounds = raw.rounds as number;
  outcome.toolCallCount = raw.tool_call_count as number;
  outcome.completionTokens = raw.completion_tokens as number;
  outcome.promptTokens = raw.prompt_tokens as number;
  outcome.tokenUsage = raw.token_usage as number;
  outcome.tokenUsageSource = raw.token_usage_source as string;
  outcome.costCnyEstimated = raw.cost_cny_estimated as number | null;
  outcome.costBreakdown = raw.cost_breakdown as Obj;
  outcome.reviewReport = raw.review_report as Obj | null;
  outcome.traces = raw.traces as AgentToolTrace[];
  outcome.artifacts = raw.artifacts as ToolArtifact[];
  outcome.proposedPatch = raw.proposed_patch as Obj | null;
  const patch = outcome.proposedPatch;
  if (patch !== null) {
    outcome.proposedPatch = { ...patch, requires_confirmation: true };
    outcome.artifacts = outcome.artifacts.map((item) =>
      item.kind === 'proposed_patch'
        ? {
            kind: item.kind,
            payload: { ...item.payload, requires_confirmation: true },
            requires_confirmation: true,
          }
        : item,
    );
  }
  context.callsById = new Map(
    checkpoint.messages.flatMap((message) => message.toolCalls.map((call) => [call.id, call])),
  );
  context.handledCallIds = new Set(checkpoint.completedToolCallIds);
  context.completedModelRounds = checkpoint.roundCount;
  context.providerAttempts = checkpoint.roundCount;
}
