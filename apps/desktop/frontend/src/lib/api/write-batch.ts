/**
 * `/写 a-b` 批量写章：引擎算计划、预估与单次运行用量，界面只「发起 → 等待 → 问引擎下一步」。
 * 回包按契约逐字段解码（只留契约里的字段），形状不对就报错，不拿空值冒充「没有要写的章」。
 */
import type { AgentPermissionProfile } from '../agent-permission';
import type {
  ApiRunUsage,
  ApiWriteBatchBlocker,
  ApiWriteBatchChapter,
  ApiWriteBatchEstimate,
  ApiWriteBatchPlan,
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
