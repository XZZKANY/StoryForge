/**
 * `/写 a-b` 批量写章：引擎算计划、预估、单次运行用量、批量记录与下一步，界面只「发起 → 等待 → 问引擎下一步」。
 * 回包按契约逐字段解码（只留契约里的字段），形状不对就报错，不拿空值冒充「没有要写的章」「没有批量」。
 */
import type { AgentPermissionProfile } from '../agent-permission';
import { listLlmProfiles } from '../host/desktop-llm-config';
import type {
  ApiRunUsage,
  ApiWriteBatch,
  ApiWriteBatchBlocker,
  ApiWriteBatchChapter,
  ApiWriteBatchCheck,
  ApiWriteBatchEstimate,
  ApiWriteBatchLeg,
  ApiWriteBatchMismatch,
  ApiWriteBatchPlan,
  ApiWriteBatchRecordChapter,
  ApiWriteBatchRecovery,
  ApiWriteBatchStartResult,
  ApiWriteBatchStep,
  ApiWriteBatchStop,
  ApiWriteBatchStopCode,
  ApiWriteBatchUndoBlocker,
  ApiWriteBatchUndoPlan,
  ApiWriteBatchView,
  ApiWriteBatchViewChapter,
} from './contracts';

const engine = () => import('../engine/writeBatch');

export class WriteBatchShapeError extends Error {}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isOrdinal = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1;
const isString = (value: unknown) => typeof value === 'string';
const orNull = (ok: (value: unknown) => boolean) => (value: unknown) => value === null || ok(value);
const oneOf =
  (...values: readonly unknown[]) =>
  (value: unknown) =>
    values.includes(value);

function field<T>(raw: Raw, key: string, ok: (value: unknown) => boolean, where: string): T {
  if (!ok(raw[key])) throw new WriteBatchShapeError(`${where}的 ${key} 不对`);
  return raw[key] as T;
}

function object(value: unknown, where: string): Raw {
  if (!isRaw(value)) throw new WriteBatchShapeError(`${where}不是对象`);
  return value;
}

export function decodeRunUsage(value: unknown): ApiRunUsage {
  const raw = object(value, '运行用量');
  const at = '运行用量';
  return {
    run_id: field(raw, 'run_id', isString, at),
    tokens: field(raw, 'tokens', isCount, at),
    calls: field(raw, 'calls', isCount, at),
    estimated_calls: field(raw, 'estimated_calls', isCount, at),
    unknown_calls: field(raw, 'unknown_calls', isCount, at),
  };
}

function decodeChapter(value: unknown): ApiWriteBatchChapter {
  const at = '批量计划的章';
  const raw = object(value, at);
  return {
    ordinal: field(raw, 'ordinal', isOrdinal, at),
    target_path: field(raw, 'target_path', isString, at),
    title: field(raw, 'title', orNull(isString), at),
    goal: field(raw, 'goal', orNull(isString), at),
    status: field(raw, 'status', oneOf('write', 'skip_written', 'after_trial'), at),
    written_path: field(raw, 'written_path', orNull(isString), at),
    outline_path: field(raw, 'outline_path', orNull(isString), at),
  };
}

const BLOCKER_CODES = [
  'read_only',
  'invalid_range',
  'gap_before_start',
  'chapter_blocked',
  'missing_goal',
  'target_unavailable',
  'setup_incomplete',
  'nothing_to_write',
  'batch_running',
  'previous_batch_unreviewed',
  'batch_all_written',
] as const;

function decodeBlocker(value: unknown): ApiWriteBatchBlocker {
  const at = '批量计划不能开跑的原因';
  const raw = object(value, at);
  const chapters = field<unknown[]>(raw, 'chapters', Array.isArray, at);
  if (!chapters.every(isOrdinal)) throw new WriteBatchShapeError(`${at}的 chapters 不对`);
  return {
    code: field(raw, 'code', oneOf(...BLOCKER_CODES), at),
    message: field(raw, 'message', isString, at),
    chapters: chapters as number[],
  };
}

function decodeEstimate(value: unknown): ApiWriteBatchEstimate {
  const at = '批量计划的预估';
  const raw = object(value, at);
  const count = (key: string) => field<number>(raw, key, isCount, at);
  return {
    chapter_count: count('chapter_count'),
    sample_count: count('sample_count'),
    average_tokens: count('average_tokens'),
    min_tokens: count('min_tokens'),
    max_tokens: count('max_tokens'),
    estimated_calls: count('estimated_calls'),
    unknown_calls: count('unknown_calls'),
    estimated_tokens: count('estimated_tokens'),
    cap_tokens: count('cap_tokens'),
  };
}

export function decodeWriteBatchPlan(value: unknown): ApiWriteBatchPlan {
  const at = '批量计划';
  const raw = object(value, at);
  const basis = field<ApiWriteBatchPlan['basis']>(
    raw,
    'basis',
    oneOf('history', 'trial', null),
    at,
  );
  const estimate = raw.estimate === null ? null : decodeEstimate(raw.estimate);
  if ((basis === 'history') !== (estimate !== null))
    throw new WriteBatchShapeError('批量计划的预估与依据对不上');
  return {
    project_root: field(raw, 'project_root', isString, at),
    // 范围非法时引擎原样带回作者给的数，这里不要求是正整数。
    from: field(raw, 'from', (item) => typeof item === 'number', at),
    to: field(raw, 'to', (item) => typeof item === 'number', at),
    permission_profile: field(raw, 'permission_profile', oneOf('read', 'ask', 'auto', 'full'), at),
    chapters: field<unknown[]>(raw, 'chapters', Array.isArray, at).map(decodeChapter),
    blockers: field<unknown[]>(raw, 'blockers', Array.isArray, at).map(decodeBlocker),
    can_start: field(raw, 'can_start', (item) => typeof item === 'boolean', at),
    basis,
    estimate,
    note: field(raw, 'note', orNull(isString), at),
  };
}

/** 给 `/写 a-b` 出计划：作品根、章序范围（两端都含）、作者为这部作品存的权限档位。 */
export async function planWriteBatch(input: {
  projectRoot: string;
  from: number;
  to: number;
  permissionProfile: AgentPermissionProfile;
}): Promise<ApiWriteBatchPlan> {
  const raw = await (
    await engine()
  ).planEngineWriteBatch({
    project_root: input.projectRoot,
    from: input.from,
    to: input.to,
    permission_profile: input.permissionProfile,
  });
  return decodeWriteBatchPlan(raw);
}

/** 一次 AI 运行（public id）用了多少；运行不存在时报错。 */
export async function loadRunUsage(runId: string): Promise<ApiRunUsage> {
  return decodeRunUsage(await (await engine()).engineRunUsage(runId));
}

const STOP_CODES = [
  'run_failed',
  'run_stopped',
  'check_blocked',
  'no_revision',
  'needs_confirmation',
  'writeback_blocked',
  'fact_disputes',
  'read_only',
  'model_changed',
  'cap_reached',
  'trial_done',
  'author_stopped',
  'app_closed',
  'run_not_started',
  'scheduler_error',
  'undone',
] as const satisfies readonly ApiWriteBatchStopCode[];

/**
 * 界面能送给 stopWriteBatch 的停下原因；其余都由引擎判定。scheduler_error：界面这边出错，说明里原样带着错误。
 */
export type WriteBatchInterfaceStopCode =
  | 'author_stopped'
  | 'app_closed'
  | 'run_not_started'
  | 'scheduler_error';

const isText = orNull(isString);
const isCountOrNull = orNull(isCount);
const isOrdinalOrNull = orNull(isOrdinal);

function list<T>(raw: Raw, key: string, where: string, decode: (value: unknown) => T): T[] {
  return field<unknown[]>(raw, key, Array.isArray, where).map(decode);
}

function decodeStop(value: unknown): ApiWriteBatchStop {
  const at = '批量停下的原因';
  const raw = object(value, at);
  return {
    code: field(raw, 'code', oneOf(...STOP_CODES), at),
    message: field(raw, 'message', isString, at),
    ordinal: field(raw, 'ordinal', isOrdinalOrNull, at),
  };
}

function decodeLeg(value: unknown): ApiWriteBatchLeg {
  const at = '批量的一段';
  const raw = object(value, at);
  return {
    basis: field(raw, 'basis', oneOf('history', 'trial'), at),
    cap_tokens: field(raw, 'cap_tokens', isCountOrNull, at),
    estimated_tokens: field(raw, 'estimated_tokens', isCountOrNull, at),
    runs: list(raw, 'runs', at, (item) => {
      const run = object(item, `${at}的运行`);
      return {
        ordinal: field(run, 'ordinal', isOrdinal, at),
        run_id: field(run, 'run_id', isString, at),
        tokens: field(run, 'tokens', isCount, at),
      };
    }),
    started_at: field(raw, 'started_at', isString, at),
    used_tokens: field(raw, 'used_tokens', isCount, at),
  };
}

function decodeCheck(value: unknown): ApiWriteBatchCheck {
  const at = '批量里一章的检查';
  const raw = object(value, at);
  return {
    issue_count: field(raw, 'issue_count', isCount, at),
    summary: field(raw, 'summary', isString, at),
    verdict: field(raw, 'verdict', oneOf('pass', 'repairable', 'blocked', 'unchecked'), at),
  };
}

function decodeRecordChapter(value: unknown): ApiWriteBatchRecordChapter {
  const at = '批量里的一章';
  const raw = object(value, at);
  return {
    chars: field(raw, 'chars', isCountOrNull, at),
    check: raw.check === null ? null : decodeCheck(raw.check),
    fact_disputes: field(raw, 'fact_disputes', isCountOrNull, at),
    facts_added: field(raw, 'facts_added', isCountOrNull, at),
    facts_before: field(raw, 'facts_before', isText, at),
    ordinal: field(raw, 'ordinal', isOrdinal, at),
    run_id: field(raw, 'run_id', isText, at),
    snapshot_version: field(raw, 'snapshot_version', isText, at),
    state: field(
      raw,
      'state',
      oneOf('pending', 'written', 'stopped_here', 'skipped_written', 'after_trial', 'undone'),
      at,
    ),
    target_path: field(raw, 'target_path', isString, at),
    tokens: field(raw, 'tokens', isCountOrNull, at),
    written_sha256: field(raw, 'written_sha256', isText, at),
  };
}

export function decodeWriteBatch(value: unknown): ApiWriteBatch {
  const at = '批量记录';
  const raw = object(value, at);
  const status = field<ApiWriteBatch['status']>(
    raw,
    'status',
    oneOf('running', 'stopped', 'finished'),
    at,
  );
  const stop = raw.stop === null ? null : decodeStop(raw.stop);
  if ((status === 'stopped') !== (stop !== null))
    throw new WriteBatchShapeError('批量记录的状态与停下原因对不上');
  return {
    chapters: list(raw, 'chapters', at, decodeRecordChapter),
    created_at: field(raw, 'created_at', isString, at),
    facts_ledger_sha256: field(raw, 'facts_ledger_sha256', isText, at),
    from: field(raw, 'from', isOrdinal, at),
    id: field(raw, 'id', isString, at),
    legs: list(raw, 'legs', at, decodeLeg),
    model_key: field(raw, 'model_key', isString, at),
    note: field(raw, 'note', isText, at),
    reviewed: field(raw, 'reviewed', (item) => typeof item === 'boolean', at),
    status,
    stop,
    to: field(raw, 'to', isOrdinal, at),
    version: field(raw, 'version', isOrdinal, at),
  };
}

const decodeBatchOrNull = (value: unknown) => (value === null ? null : decodeWriteBatch(value));

export function decodeWriteBatchStart(value: unknown): ApiWriteBatchStartResult {
  const at = '开跑结果';
  const raw = object(value, at);
  const plan = decodeWriteBatchPlan(raw.plan);
  if (field(raw, 'started', (item) => typeof item === 'boolean', at))
    return { batch: decodeWriteBatch(raw.batch), plan, started: true };
  return { batch: decodeBatchOrNull(raw.batch), plan, started: false };
}

export function decodeWriteBatchStep(value: unknown): ApiWriteBatchStep {
  const at = '下一步';
  const raw = object(value, at);
  const action = field<ApiWriteBatchStep['action']>(
    raw,
    'action',
    oneOf('write', 'stop', 'finished'),
    at,
  );
  if (action === 'finished') return { action };
  if (action === 'stop') return { action, ...decodeStop(raw) };
  return {
    action,
    goal: field(raw, 'goal', isText, at),
    note: field(raw, 'note', isText, at),
    ordinal: field(raw, 'ordinal', isOrdinal, at),
    target_path: field(raw, 'target_path', isString, at),
    title: field(raw, 'title', isText, at),
  };
}

function decodeMismatch(value: unknown): ApiWriteBatchMismatch {
  const at = '批量记录与正文对不上的章';
  const raw = object(value, at);
  return {
    kind: field(raw, 'kind', oneOf('missing', 'changed', 'written_outside'), at),
    message: field(raw, 'message', isString, at),
    ordinal: field(raw, 'ordinal', isOrdinal, at),
  };
}

/** 读记录时的那份：每章多带读时取的标题与本章目标。 */
function decodeViewBatch(value: unknown): ApiWriteBatchView['batch'] {
  if (value === null) return null;
  const batch = decodeWriteBatch(value);
  const raws = object(value, '批量记录').chapters as unknown[];
  const chapters: ApiWriteBatchViewChapter[] = batch.chapters.map((chapter, index) => {
    const raw = object(raws[index], '批量记录的章');
    return {
      ...chapter,
      goal: field(raw, 'goal', isText, '批量记录的章'),
      title: field(raw, 'title', isText, '批量记录的章'),
    };
  });
  return { ...batch, chapters };
}

export function decodeWriteBatchView(value: unknown): ApiWriteBatchView {
  const at = '批量记录';
  const raw = object(value, at);
  const batch = decodeViewBatch(raw.batch);
  const canResume = field<boolean>(raw, 'can_resume', (item) => typeof item === 'boolean', at);
  const resumeFrom = field<number | null>(raw, 'resume_from', isOrdinalOrNull, at);
  if (canResume && (batch?.status !== 'stopped' || resumeFrom === null))
    throw new WriteBatchShapeError('批量记录说能续写，但没有停下的批或没有要续写的章');
  return {
    batch,
    can_resume: canResume,
    mismatches: list(raw, 'mismatches', at, decodeMismatch),
    resume_from: resumeFrom,
  };
}

function decodeRecovery(value: unknown): ApiWriteBatchRecovery {
  const raw = object(value, '恢复结果');
  return {
    batch: decodeBatchOrNull(raw.batch),
    recovered: field(raw, 'recovered', (item) => typeof item === 'boolean', '恢复结果'),
  };
}

/** 开一批：引擎重出一次计划，能开跑就写下批量记录；不能开跑时 plan 里写着原因，不写记录。 */
export async function startWriteBatch(input: {
  projectRoot: string;
  from: number;
  to: number;
  permissionProfile: AgentPermissionProfile;
  /** 当前模型配置的标识：中途换了模型，引擎据此停下重估。 */
  modelKey: string;
  /** 作者在 `/写` 范围后附的要求，存进记录，每章发起时带上。 */
  note?: string | null;
}): Promise<ApiWriteBatchStartResult> {
  const raw = await (
    await engine()
  ).startEngineWriteBatch({
    project_root: input.projectRoot,
    from: input.from,
    to: input.to,
    permission_profile: input.permissionProfile,
    model_key: input.modelKey,
    note: input.note ?? null,
  });
  return decodeWriteBatchStart(raw);
}

/**
 * 续写前给作者看的计划：和续写同一份计划与拦法，但只读、不改记录（作者点了开始才 resumeWriteBatch）。
 * 这一批的章都已经有正文时，plan 里是 batch_all_written 的说明。
 */
export async function previewWriteBatchResume(input: {
  projectRoot: string;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchPlan> {
  const raw = await (
    await engine()
  ).previewEngineWriteBatchResume(input.projectRoot, {
    permission_profile: input.permissionProfile,
    model_key: input.modelKey,
  });
  return decodeWriteBatchPlan(raw);
}

/**
 * 续写停下的最近一批：剩下没正文的章重新估、重新确认；不要求先审完。
 * 这一批的章都已经有正文时，引擎把它记成写完，started=false、plan 里是 batch_all_written。
 */
export async function resumeWriteBatch(input: {
  projectRoot: string;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchStartResult> {
  const raw = await (
    await engine()
  ).resumeEngineWriteBatch({
    project_root: input.projectRoot,
    permission_profile: input.permissionProfile,
    model_key: input.modelKey,
  });
  return decodeWriteBatchStart(raw);
}

/**
 * 一章跑完（写进文件、事实记账都落定）后记一笔。用量、检查、写进去的指纹与字数由引擎自己算；
 * 写前快照的版本记录与记账前的台账版本由界面给，引擎原样存。没写进文件时 writtenPath 为 null。
 */
export async function recordWriteBatchChapter(input: {
  projectRoot: string;
  batchId: string;
  ordinal: number;
  runId: string;
  writtenPath: string | null;
  snapshotVersion: string | null;
  factsBefore: string | null;
  factDisputes: number;
  /** 记账时新记下的事实条数（不含待定的）；没记账或不知道为 null。 */
  factsAdded: number | null;
}): Promise<ApiWriteBatch> {
  const raw = await (
    await engine()
  ).recordEngineWriteBatchChapter(input.projectRoot, input.batchId, {
    ordinal: input.ordinal,
    run_id: input.runId,
    written_path: input.writtenPath,
    snapshot_version: input.snapshotVersion,
    facts_before: input.factsBefore,
    fact_disputes: input.factDisputes,
    facts_added: input.factsAdded,
  });
  return decodeWriteBatch(raw);
}

/** 问引擎下一步：写哪一章，还是停、为什么停，或者写完了。 */
export async function nextWriteBatchStep(input: {
  projectRoot: string;
  batchId: string;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchStep> {
  const raw = await (
    await engine()
  ).nextEngineWriteBatchStep(input.projectRoot, input.batchId, {
    permission_profile: input.permissionProfile,
    model_key: input.modelKey,
  });
  return decodeWriteBatchStep(raw);
}

/** 作者按停止，或界面发现应用上次是被关掉的；已经停了或写完的批不改。 */
export async function stopWriteBatch(input: {
  projectRoot: string;
  batchId: string;
  code: WriteBatchInterfaceStopCode;
  message: string;
}): Promise<ApiWriteBatch> {
  const raw = await (
    await engine()
  ).stopEngineWriteBatch(input.projectRoot, input.batchId, {
    code: input.code,
    message: input.message,
  });
  return decodeWriteBatch(raw);
}

/** 打开作品时调用：上次关应用时还在写的那一批改成停下，不自动续。 */
export async function recoverInterruptedWriteBatch(
  projectRoot: string,
): Promise<ApiWriteBatchRecovery> {
  return decodeRecovery(await (await engine()).recoverEngineWriteBatch(projectRoot));
}

/** 作者在清单上点了「这批审完了」。 */
export async function markWriteBatchReviewed(
  projectRoot: string,
  batchId: string,
): Promise<ApiWriteBatch> {
  return decodeWriteBatch(
    await (await engine()).markEngineWriteBatchReviewed(projectRoot, batchId),
  );
}

/**
 * 最近一批的记录，加上记录与正文对不上的章；没有批量记录时 batch 为 null。
 * 给不给「从第 k 章接着写」只看 can_resume，k 是 resume_from，界面不自己算。
 */
export async function readWriteBatch(projectRoot: string): Promise<ApiWriteBatchView> {
  return decodeWriteBatchView(await (await engine()).readEngineWriteBatch(projectRoot));
}

const UNDO_BLOCKER_CODES = [
  'batch_running',
  'not_batch_written',
  'changed',
  'missing',
  'outside_chapters',
] as const satisfies readonly ApiWriteBatchUndoBlocker['code'][];

function decodeUndoBlocker(value: unknown): ApiWriteBatchUndoBlocker {
  const at = '不能撤销的原因';
  const raw = object(value, at);
  const chapters = field<unknown[]>(raw, 'chapters', Array.isArray, at);
  if (!chapters.every(isOrdinal)) throw new WriteBatchShapeError(`${at}的 chapters 不对`);
  return {
    chapters: chapters as number[],
    code: field(raw, 'code', oneOf(...UNDO_BLOCKER_CODES), at),
    message: field(raw, 'message', isString, at),
  };
}

export function decodeWriteBatchUndoPlan(value: unknown): ApiWriteBatchUndoPlan {
  const at = '撤销计划';
  const raw = object(value, at);
  const plan: ApiWriteBatchUndoPlan = {
    batch_id: field(raw, 'batch_id', isString, at),
    blockers: list(raw, 'blockers', at, decodeUndoBlocker),
    can_undo: field(raw, 'can_undo', (item) => typeof item === 'boolean', at),
    chapters: list(raw, 'chapters', at, (item) => {
      const chapter = object(item, `${at}的章`);
      return {
        facts_restore: field(chapter, 'facts_restore', isText, at),
        ordinal: field(chapter, 'ordinal', isOrdinal, at),
        target_path: field(chapter, 'target_path', isString, at),
        written_sha256: field(chapter, 'written_sha256', isString, at),
      };
    }),
    facts_before: field(raw, 'facts_before', isText, at),
    facts_ledger: field(raw, 'facts_ledger', oneOf('unchanged', 'changed', 'unknown', null), at),
    from: field(raw, 'from', isOrdinal, at),
    to: field(raw, 'to', isOrdinalOrNull, at),
  };
  // 界面按这个顺序删：必须是从最后一章倒着排的。
  const ordinals = plan.chapters.map((chapter) => chapter.ordinal);
  if (ordinals.some((ordinal, index) => index > 0 && ordinal >= ordinals[index - 1]))
    throw new WriteBatchShapeError('撤销计划里的章不是从最后一章倒着排的');
  if ((plan.facts_before === null) !== (plan.facts_ledger === null))
    throw new WriteBatchShapeError('撤销计划的台账版本与台账比对对不上');
  if (plan.can_undo && (plan.blockers.length > 0 || plan.chapters.length === 0))
    throw new WriteBatchShapeError('撤销计划说能撤，却有不能撤的原因或没有要删的章');
  return plan;
}

/** 撤销第 k 章及之后之前先问引擎能不能撤、要删哪几章（倒着排）、台账恢复到哪一版；只读。 */
export async function planWriteBatchUndo(
  projectRoot: string,
  batchId: string,
  fromOrdinal: number,
): Promise<ApiWriteBatchUndoPlan> {
  return decodeWriteBatchUndoPlan(
    await (await engine()).planEngineWriteBatchUndo(projectRoot, batchId, fromOrdinal),
  );
}

/** 删一章之前再问一次：这一章的文件还是写进去时那一份为 null，否则是不能删的原因。 */
export async function checkWriteBatchUndoChapter(
  projectRoot: string,
  batchId: string,
  ordinal: number,
): Promise<ApiWriteBatchUndoBlocker | null> {
  const raw = await (
    await engine()
  ).checkEngineWriteBatchUndoChapter(projectRoot, batchId, ordinal);
  return raw === null ? null : decodeUndoBlocker(raw);
}

/**
 * 撤销做完以后记一笔：删掉了的章（倒着删的顺序）、没删完时停下的原因、事实台账恢复了没有。
 * 引擎读盘核对删没删，这一批改成停下（undone），续写从删掉的第一章起。
 */
export async function recordWriteBatchUndo(input: {
  projectRoot: string;
  batchId: string;
  fromOrdinal: number;
  deleted: number[];
  failure: string | null;
  factsRestored: boolean;
  factsError: string | null;
}): Promise<ApiWriteBatch> {
  const raw = await (
    await engine()
  ).recordEngineWriteBatchUndo(input.projectRoot, input.batchId, input.fromOrdinal, {
    deleted: input.deleted,
    failure: input.failure,
    facts_restored: input.factsRestored,
    facts_error: input.factsError,
  });
  return decodeWriteBatch(raw);
}

/** 给作者看的 token 数按「万」说，与引擎停下说明里同一种说法。 */
export async function formatWriteBatchTokens(tokens: number): Promise<string> {
  return (await engine()).formatEngineTokenCount(tokens);
}

/**
 * 开跑、续写、问下一步要带的模型标识：当前启用的那套配置的 id 加上它正在用的模型名，
 * 换配置或换模型都会变（引擎据此停下重估）。读不到配置就明确报错，不拿空串冒充。
 */
export async function currentWriteBatchModelKey(): Promise<string> {
  const list = await listLlmProfiles();
  if (!list) throw new Error('读不到本机的模型配置：批量写章只能在桌面应用里用。');
  const active = list.profiles.find((profile) => profile.id === list.activeProfileId);
  if (!active) throw new Error('还没有启用的模型配置：先在设置里选一套模型，再批量写章。');
  return JSON.stringify([active.id, active.model]);
}
