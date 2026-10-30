import { AssistantSessionNotFoundError, type AssistantSessionRef } from '../assistant/service';
import { chapterOrdinals } from '../kernel/canonRebuild';
import { resolveNewProjectFile } from '../kernel/fsProjectTools';
import { FsToolError, resolveProjectRoot } from '../kernel/fsTools';
import { missingSetupBeforeFirstChapter, setupLabels } from '../kernel/projectSetup';
import {
  buildPlan,
  STATUS_BLOCKED,
  type PlannedChapter,
  type SerialPlan,
} from '../kernel/serialPlan';
import { sameProjectRoot } from '../kernel/writingContext';
import { ProjectReadError, type ProjectReader } from '../readPort';
import type { ArtifactRecord, RunStore } from '../store/runs';
import { CHAPTER_CHECK_ARTIFACT_KIND, plannedChapterPath } from './chapterWritingContracts';
import { normalizePermissionProfile, type PermissionProfile } from './permission';
import { REQUEST_EVIDENCE_KIND } from './requestEvidence';
import { AgentRunNotFoundError } from './runEvents';
import { readWriteBatchRecord, type WriteBatchRecord } from './writeBatchRecord';

/**
 * `/写 a-b` 批量写章的引擎一侧（方案见 docs/internal/write-batch-plan-2026-10.md）：每章仍是一次普通的
 * `chapter.write` 运行，由界面按顺序发起；要写哪几章、能不能开跑、预估花多少都在这里算，不调模型。
 */

type Obj = { [key: string]: unknown };
type Platform = 'windows' | 'posix';
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * 服务商没报用量时，llm/usage.ts 按「每 4 个字 1 个 token」估（tokenUsage 的最后一支），对中文偏低好几倍
 * （测量期作者的模型约 3 个 token 一个字）。批量记账把这几次换算成「每字 1.5 个 token」：偏保守，系数待实测再定。
 * 只改批量这边的口径，usage.ts 的输出不动（golden 要逐字节不变）。
 */
export const ESTIMATED_TOKENS_PER_CHAR = 1.5;
const USAGE_ESTIMATE_CHARS_PER_TOKEN = 4;
/** 按字数估出来的用量乘上它，就是按「每字 1.5 个 token」算的量：1.5 × 4 = 6。 */
export const CHAR_ESTIMATE_SCALE = ESTIMATED_TOKENS_PER_CHAR * USAGE_ESTIMATE_CHARS_PER_TOKEN;
/** 预估取本作品最近几次走到检查结论的写章运行。 */
export const HISTORY_SAMPLE_RUNS = 10;
/** 上限 = 预估 × 1.5，向上取整（作者 2026-10-30 已审）。 */
export const BATCH_CAP_FACTOR = 1.5;

export type RunUsage = {
  /** 合计 token；按字数估的那几次已乘 CHAR_ESTIMATE_SCALE，没拿到用量的不计。 */
  tokens: number;
  /** 模型请求次数：一条请求证据算一次（传输层 429 / 5xx 的退避重试记在同一条里，不另算）。 */
  calls: number;
  /** 其中服务商没报、按字数估的。 */
  estimated_calls: number;
  /** 其中没拿到用量的（请求失败没回报，或没结算就中断）：它们花的量不知道，不当成 0 以外的数。 */
  unknown_calls: number;
};

type AttemptUsage = { kind: 'reported' | 'estimated' | 'unknown'; tokens: number };

/**
 * 一条请求证据的用量。usage.ts 标 `estimated_split` 的有两种：服务商只报了总数（总数是真的，只是拆分靠估），
 * 和服务商什么都没报（总数按字数估）。后一种缓存命中必为 null、两段各至少 1、总数恰为两段之和；
 * 不满足其中任何一条的是前一种，不换算。两种都满足的分不开，按字数估算处理（宁可估高）。
 */
function attemptUsage(payload: Obj): AttemptUsage {
  const usage = payload.usage;
  if (!isObj(usage) || !isCount(usage.token_usage)) return { kind: 'unknown', tokens: 0 };
  const total = usage.token_usage;
  if (usage.token_usage_source === 'provider_usage') return { kind: 'reported', tokens: total };
  if (usage.token_usage_source !== 'estimated_split') return { kind: 'unknown', tokens: 0 };
  const { prompt_tokens: prompt, completion_tokens: completion } = usage;
  const charEstimate =
    typeof usage.cache_hit_tokens !== 'number' &&
    isCount(prompt) &&
    isCount(completion) &&
    prompt >= 1 &&
    completion >= 1 &&
    prompt + completion === total;
  return charEstimate
    ? { kind: 'estimated', tokens: total * CHAR_ESTIMATE_SCALE }
    : { kind: 'reported', tokens: total };
}

/** 一次运行的全部请求证据加起来。 */
export function sumRunUsage(artifacts: readonly ArtifactRecord[]): RunUsage {
  const total: RunUsage = { tokens: 0, calls: 0, estimated_calls: 0, unknown_calls: 0 };
  for (const artifact of artifacts) {
    if (artifact.kind !== REQUEST_EVIDENCE_KIND) continue;
    const usage = attemptUsage(artifact.payload);
    total.calls += 1;
    total.tokens += usage.tokens;
    if (usage.kind === 'estimated') total.estimated_calls += 1;
    if (usage.kind === 'unknown') total.unknown_calls += 1;
  }
  return total;
}

/** 单次运行（public id）的用量；运行不存在时报 AgentRunNotFoundError。 */
export async function runUsage(
  store: RunStore,
  runId: string,
): Promise<RunUsage & { run_id: string }> {
  const run = await store.findRun(runId);
  if (run === null) throw new AgentRunNotFoundError();
  return { run_id: run.public_id, ...sumRunUsage(await store.artifacts(run.id)) };
}

export type WriteBatchStoreDeps = {
  readonly store: RunStore;
  /** 会话在哪个库就从哪里取；不存在时抛 AssistantSessionNotFoundError。 */
  readonly sessions: { getSession(id: number): Promise<AssistantSessionRef> };
  readonly platform: Platform;
};

export type WriteChapterHistory = {
  /** 用上的运行数（0–10）。 */
  sample_count: number;
  /** 用上的运行，最近的在前。 */
  run_ids: string[];
  average_tokens: number | null;
  min_tokens: number | null;
  max_tokens: number | null;
  /** 这些运行合计的请求次数、其中按字数估的、没拿到用量的。 */
  calls: number;
  estimated_calls: number;
  unknown_calls: number;
};

async function sessionProject(
  sessions: WriteBatchStoreDeps['sessions'],
  id: number,
): Promise<string | null> {
  try {
    return (await sessions.getSession(id)).project_path;
  } catch (error) {
    // 会话删了，这次运行就认不出是哪部作品的，不算本作品的样本。
    if (error instanceof AssistantSessionNotFoundError) return null;
    throw error;
  }
}

/**
 * 本作品最近 10 次走到检查结论的写章运行，每次的用量。
 * - 「写章运行、走到检查结论」= 运行里有 `chapter_check` 产物：只有写章流程会记它，且只在检查给出结论后才记。
 * - 「本作品」= 运行所属会话（`agent_runs.assistant_session_id`）的 `project_path` 与作品根是同一个目录。
 * - 「最近」按运行最后一条检查结论的产物 id（全局自增）排。一条请求证据都没有的运行没有用量可看，不算样本。
 */
export async function writeChapterHistory(
  deps: WriteBatchStoreDeps,
  projectRoot: string,
): Promise<WriteChapterHistory> {
  const latestCheck = new Map<number, number>();
  for (const check of await deps.store.artifactsOfKind(CHAPTER_CHECK_ARTIFACT_KIND))
    latestCheck.set(check.run_id, Math.max(latestCheck.get(check.run_id) ?? 0, check.id));
  const ordered = [...latestCheck].sort((a, b) => b[1] - a[1]).map(([runId]) => runId);
  const owners = new Map<number, string | null>();
  const samples: (RunUsage & { run_id: string })[] = [];
  for (const id of ordered) {
    if (samples.length >= HISTORY_SAMPLE_RUNS) break;
    const run = await deps.store.getRun(id);
    const sessionId = run.assistant_session_id;
    if (sessionId === null) continue;
    if (!owners.has(sessionId))
      owners.set(sessionId, await sessionProject(deps.sessions, sessionId));
    const owner = owners.get(sessionId);
    if (!owner || !sameProjectRoot(owner, projectRoot, deps.platform)) continue;
    const usage = sumRunUsage(await deps.store.artifacts(run.id));
    if (usage.calls === 0) continue;
    samples.push({ run_id: run.public_id, ...usage });
  }
  const tokens = samples.map((sample) => sample.tokens);
  const sum = (key: 'calls' | 'estimated_calls' | 'unknown_calls') =>
    samples.reduce((total, sample) => total + sample[key], 0);
  return {
    sample_count: samples.length,
    run_ids: samples.map((sample) => sample.run_id),
    average_tokens: samples.length
      ? Math.round(tokens.reduce((a, b) => a + b, 0) / samples.length)
      : null,
    min_tokens: samples.length ? Math.min(...tokens) : null,
    max_tokens: samples.length ? Math.max(...tokens) : null,
    calls: sum('calls'),
    estimated_calls: sum('estimated_calls'),
    unknown_calls: sum('unknown_calls'),
  };
}

export type WriteBatchChapterStatus = 'write' | 'skip_written' | 'after_trial';

export type WriteBatchChapter = {
  ordinal: number;
  /** 写章流程会新建的文件（作品内相对路径），规则同 chapterWritingContracts 的 plannedChapterPath。 */
  target_path: string;
  title: string | null;
  goal: string | null;
  /** write：这次要写；skip_written：正文已存在，跳过；after_trial：试写量完用量后再估。 */
  status: WriteBatchChapterStatus;
  /** 已有正文时它的路径；没有为 null。 */
  written_path: string | null;
};

export type WriteBatchBlockerCode =
  | 'read_only'
  | 'invalid_range'
  | 'gap_before_start'
  | 'chapter_blocked'
  | 'missing_goal'
  | 'target_unavailable'
  | 'setup_incomplete'
  | 'nothing_to_write'
  | 'batch_running'
  | 'previous_batch_unreviewed';

export type WriteBatchBlocker = {
  code: WriteBatchBlockerCode;
  /** 给作者看的说明。 */
  message: string;
  /** 涉及的章序，没有为空。 */
  chapters: number[];
};

export type WriteBatchEstimate = {
  /** 要写的章数。 */
  chapter_count: number;
  sample_count: number;
  average_tokens: number;
  min_tokens: number;
  max_tokens: number;
  /** 样本里按字数估的、没拿到用量的请求次数。 */
  estimated_calls: number;
  unknown_calls: number;
  /** 要写章数 × 每章平均。 */
  estimated_tokens: number;
  /** ceil(预估 × 1.5)。 */
  cap_tokens: number;
};

export type WriteBatchPlan = {
  project_root: string;
  from: number;
  to: number;
  permission_profile: PermissionProfile;
  chapters: WriteBatchChapter[];
  blockers: WriteBatchBlocker[];
  can_start: boolean;
  /** history：按本作品写章记录估；trial：没有记录，先只写第一章量一量；没有要写的章为 null。 */
  basis: 'history' | 'trial' | null;
  /** 只在 basis = history 时有。 */
  estimate: WriteBatchEstimate | null;
  /** 试写模式的说明；其余为 null。 */
  note: string | null;
};

export type WriteBatchDeps = WriteBatchStoreDeps & { readonly reader: ProjectReader };

export type WriteBatchInput = {
  readonly project_root: string;
  readonly from: number;
  readonly to: number;
  /** 作者为这部作品存的档位（界面随请求送来）。 */
  readonly permission_profile: string;
};

/** 章序列表说成「4–6、9」。 */
export function ordinalRanges(ordinals: readonly number[]): string {
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; ) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end === index ? String(sorted[index]) : `${sorted[index]}–${sorted[end]}`);
    index = end + 1;
  }
  return parts.join('、');
}

const blocker = (
  code: WriteBatchBlockerCode,
  message: string,
  chapters: number[] = [],
): WriteBatchBlocker => ({ code, message, chapters });

const validOrdinal = (value: number) => Number.isSafeInteger(value) && value >= 1;

/** 范围最多跨 10000 章：只防手滑输错（如 `/写 1-100000`），不是每批章数的上限（作者定了不设）。 */
export const MAX_BATCH_RANGE = 10000;

export type BookChapters = {
  plan: SerialPlan | null;
  /** 计划里这一章的条目，没有为 null。 */
  entry(ordinal: number): PlannedChapter | null;
  /** 这一章的正文路径，还没有正文为 null。 */
  writtenPath(ordinal: number): string | null;
};

/**
 * 每章有没有正文（正文是真值源）：计划里有这一章就用 buildPlan 认出的落盘路径（计划记过路径就按路径认），
 * 没有就看按路径排序后这个章序上有没有正文。不看计划里的 status。
 */
export async function bookChapters(
  reader: ProjectReader,
  root: string,
  platform: Platform,
): Promise<BookChapters> {
  const pathByOrdinal = new Map(
    [...(await chapterOrdinals(reader, root, '*.md', platform))].map(([path, ordinal]) => [
      ordinal,
      path,
    ]),
  );
  const plan = await buildPlan(reader, root, platform);
  const entry = (ordinal: number): PlannedChapter | null =>
    plan?.chapters.find((chapter) => chapter.ordinal === ordinal) ?? null;
  return {
    plan,
    entry,
    writtenPath(ordinal) {
      const planned = entry(ordinal);
      return planned !== null ? planned.writtenPath : (pathByOrdinal.get(ordinal) ?? null);
    },
  };
}

const batchRange = (record: WriteBatchRecord) =>
  record.from === record.to ? `第 ${record.from} 章` : `第 ${record.from}–${record.to} 章`;

/** 新开一批前看最近一批：还在跑的不能另开；停了或写完了但作者还没点「这批审完了」的也不能（作者 10-30 第 5 问选 A）。 */
function previousBatchBlocker(record: WriteBatchRecord | null): WriteBatchBlocker | null {
  if (record === null) return null;
  if (record.status === 'running')
    return blocker(
      'batch_running',
      `上一批（${batchRange(record)}）还在写：等它写完或先停下，再开新的一批。`,
    );
  if (record.reviewed) return null;
  return blocker(
    'previous_batch_unreviewed',
    record.status === 'stopped'
      ? `上一批（${batchRange(record)}）停下了，还没审完。两条路：先在清单上点「这批审完了」再开新的一批；` +
          '或者续写上一批剩下的章。'
      : `上一批（${batchRange(record)}）写完了，还没审完：先在清单上点「这批审完了」，再开新的一批。`,
  );
}

/** 新建文件这一步写章流程会不会拒：与 resolveTarget 同一个判断（越界、是目录、已有非空文件都拒）。 */
async function targetRejected(reader: ProjectReader, root: string, path: string) {
  try {
    await resolveNewProjectFile(reader, root, path);
    return false;
  } catch (error) {
    if (error instanceof FsToolError || error instanceof ProjectReadError) return true;
    throw error;
  }
}

/**
 * 批量写章的计划：范围内每一章写不写、写到哪个文件，能不能开跑，以及预估。
 * 正文是真值源：章序 = 正文按路径排序后的第几个，已有正文就跳过，不看计划里的 status。
 * 不设单批章数上限（作者 2026-10-30：「有多少章生成多少章」），只受预估 × 1.5 的上限与逐章停约束。
 */
export async function planWriteBatch(
  deps: WriteBatchDeps,
  input: WriteBatchInput,
): Promise<WriteBatchPlan> {
  return planBatch(deps, input, 'new');
}

/**
 * `new`：新开一批，最近一批还在跑或没审完就拦下。
 * `resume`：续写最近一批剩下的章，不受「没审完」约束（续跑不要求先审完）；由 resumeWriteBatch 调用。
 */
export async function planBatch(
  deps: WriteBatchDeps,
  input: WriteBatchInput,
  mode: 'new' | 'resume',
): Promise<WriteBatchPlan> {
  const { reader, platform } = deps;
  const root = input.project_root;
  const profile = normalizePermissionProfile(input.permission_profile, false).profile;
  await resolveProjectRoot(reader, root);
  const blockers: WriteBatchBlocker[] = [];
  if (profile === 'read')
    blockers.push(
      blocker(
        'read_only',
        '这部作品的 AI 权限是「只读」：AI 不能把写好的章写进文件，批量写章整批不能开跑。先把权限改成「询问」或「自动」。',
      ),
    );
  if (mode === 'new') {
    const previous = previousBatchBlocker(await readWriteBatchRecord(reader, root));
    if (previous !== null) blockers.push(previous);
  }
  const base = {
    project_root: root,
    from: input.from,
    to: input.to,
    permission_profile: profile,
  };
  const invalid =
    !validOrdinal(input.from) || !validOrdinal(input.to) || input.from > input.to
      ? '章序范围不对：起点和终点都要是从 1 起的整数，起点不能大于终点。'
      : input.to - input.from + 1 > MAX_BATCH_RANGE
        ? `章序范围一次跨了 ${input.to - input.from + 1} 章，超过 ${MAX_BATCH_RANGE}：` +
          '这是防输错的上限，不是每批写几章的限制（每批章数不设上限）。请核对起点和终点。'
        : null;
  if (invalid !== null) {
    blockers.push(blocker('invalid_range', invalid));
    return {
      ...base,
      chapters: [],
      blockers,
      can_start: false,
      basis: null,
      estimate: null,
      note: null,
    };
  }
  const { plan, entry, writtenPath } = await bookChapters(reader, root, platform);

  const gap: number[] = [];
  for (let ordinal = 1; ordinal < input.from; ordinal++)
    if (writtenPath(ordinal) === null) gap.push(ordinal);
  if (gap.length)
    blockers.push(
      blocker(
        'gap_before_start',
        `第 ${ordinalRanges(gap)} 章还没有正文：章序按正文文件的先后排，跳过去写，后面的章会错位。` +
          `先写完这几章，或者从第 ${gap[0]} 章开始写。`,
        gap,
      ),
    );

  const chapters: WriteBatchChapter[] = [];
  for (let ordinal = input.from; ordinal <= input.to; ordinal++) {
    const planned = entry(ordinal);
    const written = writtenPath(ordinal);
    chapters.push({
      ordinal,
      target_path: plannedChapterPath({ ordinal, declaredPath: planned?.declaredPath ?? null }),
      title: planned?.title ?? null,
      goal: planned?.goal ?? null,
      status: written !== null ? 'skip_written' : 'write',
      written_path: written,
    });
  }
  const toWrite = chapters.filter((chapter) => chapter.status === 'write');
  const stuck = toWrite.filter((chapter) => entry(chapter.ordinal)?.status === STATUS_BLOCKED);
  if (stuck.length) {
    const list = stuck.map((chapter) => chapter.ordinal);
    blockers.push(
      blocker(
        'chapter_blocked',
        `第 ${ordinalRanges(list)} 章在连载计划里标着卡住：先解除卡点再写。`,
        list,
      ),
    );
  }
  const goalless = toWrite
    .filter((chapter) => chapter.goal === null)
    .map((chapter) => chapter.ordinal);
  if (goalless.length)
    blockers.push(
      blocker(
        'missing_goal',
        (plan === null
          ? `这部作品还没有连载计划，第 ${ordinalRanges(goalless)} 章没有本章目标。`
          : `第 ${ordinalRanges(goalless)} 章在连载计划里没写本章目标。`) +
          '批量写时从第二章起，AI 主要靠计划里的本章目标定每章写什么：先把目标补进计划（可以让 AI 起草目标，你确认）。',
        goalless,
      ),
    );
  const unavailable: number[] = [];
  for (const chapter of toWrite)
    if (await targetRejected(reader, root, chapter.target_path)) unavailable.push(chapter.ordinal);
  if (unavailable.length)
    blockers.push(
      blocker(
        'target_unavailable',
        `第 ${ordinalRanges(unavailable)} 章的目标文件已经存在或不能新建：` +
          '先核对正文文件的命名和连载计划里记的路径。',
        unavailable,
      ),
    );
  if (toWrite.length) {
    const missing = await missingSetupBeforeFirstChapter(reader, root, platform);
    if (missing !== null)
      blockers.push(
        blocker(
          'setup_incomplete',
          `这部作品还没有正文，也还缺${setupLabels(missing)}文件：先把立项补齐再批量写。`,
        ),
      );
  } else
    blockers.push(
      blocker(
        'nothing_to_write',
        `第 ${ordinalRanges(chapters.map((chapter) => chapter.ordinal))} 章都已经有正文，没有要写的章。`,
      ),
    );

  let basis: WriteBatchPlan['basis'] = null;
  let estimate: WriteBatchEstimate | null = null;
  let note: string | null = null;
  if (toWrite.length) {
    const history = await writeChapterHistory(deps, root);
    if (history.sample_count > 0) {
      basis = 'history';
      const average = history.average_tokens!;
      const estimated = toWrite.length * average;
      estimate = {
        chapter_count: toWrite.length,
        sample_count: history.sample_count,
        average_tokens: average,
        min_tokens: history.min_tokens!,
        max_tokens: history.max_tokens!,
        estimated_calls: history.estimated_calls,
        unknown_calls: history.unknown_calls,
        estimated_tokens: estimated,
        cap_tokens: Math.ceil(estimated * BATCH_CAP_FACTOR),
      };
    } else {
      basis = 'trial';
      const [first, ...rest] = toWrite;
      for (const chapter of rest) chapter.status = 'after_trial';
      note = rest.length
        ? `这部作品还没有写章的用量记录：这次先只写第 ${first.ordinal} 章量一量，` +
          `写完按实际用量给剩下 ${rest.length} 章的预估，再问你一次。`
        : `这部作品还没有写章的用量记录，这次只写第 ${first.ordinal} 章，所以先不给预估和上限；` +
          '写完就有了记录，下次批量写会按它估。';
    }
  }
  return {
    ...base,
    chapters,
    blockers,
    can_start: blockers.length === 0,
    basis,
    estimate,
    note,
  };
}
