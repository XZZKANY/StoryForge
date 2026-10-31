import { chapterHeadingTitle } from '../kernel/bookBreakdown';
import { chapterOrdinals } from '../kernel/canonRebuild';
import { FACTS_LEDGER_PATH } from '../kernel/factLedger';
import { resolveProjectRoot } from '../kernel/fsTools';
import { MAX_READ_BYTES } from '../kernel/projectTree';
import { sha256Hex } from '../kernel/sha256';
import { ProjectReadError, type ProjectReader } from '../readPort';
import type { ArtifactRecord } from '../store/runs';
import type { ProjectWriter } from '../writePort';
import { chapterChars } from './chapterCheckProtocol';
import {
  CHAPTER_BRIEF_ARTIFACT_KIND,
  CHAPTER_CHECK_ARTIFACT_KIND,
} from './chapterWritingContracts';
import { normalizePermissionProfile } from './permission';
import { AgentRunNotFoundError } from './runEvents';
import { AGENT_RUN_FAILED } from './runPayloads';
import {
  bookChapters,
  formatTokenCount,
  ordinalRanges,
  planBatch,
  runUsage,
  type BookChapters,
  type WriteBatchChapter,
  type WriteBatchDeps,
  type WriteBatchPlan,
} from './writeBatch';
import {
  INTERFACE_STOP_CODES,
  readWriteBatchRecord,
  WRITE_BATCH_VERSION,
  writeWriteBatchRecord,
  type WriteBatchCheck,
  type WriteBatchLeg,
  type WriteBatchRecord,
  type WriteBatchRecordChapter,
  type WriteBatchStopCode,
} from './writeBatchRecord';

/**
 * `/写 a-b` 批量写章的记录与「下一步」判定（方案 docs/internal/write-batch-plan-2026-10.md 第 2、6 节）。
 * 界面只「发起 → 等这一章写进文件、事实记账落定 → 记一笔 → 问下一步」；判断全在这里，不调模型。
 */

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export class WriteBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteBatchError';
  }
}

export type WriteBatchRunDeps = WriteBatchDeps & {
  readonly writer: ProjectWriter;
  readonly now: () => Date;
  readonly newHex: () => string;
};

/** 开跑 / 续跑的结果：没开成时 batch 是没动过的最近一批（没有为 null），plan 里写着不能开跑的原因。 */
export type WriteBatchStartResult =
  | { started: true; plan: WriteBatchPlan; batch: WriteBatchRecord }
  | { started: false; plan: WriteBatchPlan; batch: WriteBatchRecord | null };

export type WriteBatchStep =
  | {
      action: 'write';
      ordinal: number;
      target_path: string;
      goal: string | null;
      /** 连载计划里这一章的标题；读不到为 null。 */
      title: string | null;
      /** 作者开这一批时在 `/写` 范围后附的要求，每章发起时带上；没附为 null。 */
      note: string | null;
    }
  | { action: 'stop'; code: WriteBatchStopCode; message: string; ordinal: number | null }
  | { action: 'finished' };

export type WriteBatchMismatch = {
  ordinal: number;
  /** missing：记录说有正文，文件不在了；changed：写进去以后又改过；written_outside：记录说没写，正文里有了。 */
  kind: 'missing' | 'changed' | 'written_outside';
  message: string;
};

/** 读记录时每章带上章名与连载计划里的本章目标（读时取，不存进记录）。 */
export type WriteBatchViewChapter = WriteBatchRecordChapter & {
  /** 正文在的章取正文开头标题里的章名；没有正文、读不到或开头不是标题时用连载计划里的标题。 */
  title: string | null;
  goal: string | null;
};
export type WriteBatchViewRecord = Omit<WriteBatchRecord, 'chapters'> & {
  chapters: WriteBatchViewChapter[];
};

export type WriteBatchView = {
  batch: WriteBatchViewRecord | null;
  mismatches: WriteBatchMismatch[];
  /** 最近一批停下了、而且范围里还有没正文的章：界面只按它决定给不给「从第 k 章接着写」。 */
  can_resume: boolean;
  /** 范围里下一个还没有正文的章序（以正文为准）；没有批量或都写了为 null。 */
  resume_from: number | null;
};

const timestamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

function modelKeyOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new WriteBatchError('缺少当前模型配置的标识（model_key）：换没换模型要靠它看出来。');
  return value;
}

type FileDeps = Pick<WriteBatchRunDeps, 'reader' | 'writer' | 'platform'>;

const save = (deps: FileDeps, root: string, record: WriteBatchRecord) =>
  writeWriteBatchRecord(deps.writer, root, record, deps.platform);

/** 作者在 `/写` 范围后附的要求：去掉首尾空白，空的当没附。 */
function noteOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new WriteBatchError('note 应是字符串或 null。');
  return value.trim() || null;
}

async function latestBatch(
  reader: ProjectReader,
  root: string,
  batchId: string,
): Promise<WriteBatchRecord> {
  const record = await readWriteBatchRecord(reader, root);
  if (record === null) throw new WriteBatchError('这部作品还没有批量写章的记录。');
  if (record.id !== batchId)
    throw new WriteBatchError('这一批已经不是最近一批了：批量记录只留最近一批。');
  return record;
}

function chapterOf(record: WriteBatchRecord, ordinal: unknown): WriteBatchRecordChapter {
  const chapter = record.chapters.find((item) => item.ordinal === ordinal);
  if (chapter === undefined)
    throw new WriteBatchError(
      `第 ${String(ordinal)} 章不在这一批的范围（第 ${record.from}–${record.to} 章）里。`,
    );
  return chapter;
}

const currentLeg = (record: WriteBatchRecord): WriteBatchLeg => record.legs[record.legs.length - 1];

function blankChapter(
  ordinal: number,
  target_path: string,
  state: WriteBatchRecordChapter['state'],
): WriteBatchRecordChapter {
  return {
    ordinal,
    target_path,
    state,
    run_id: null,
    written_sha256: null,
    chars: null,
    check: null,
    tokens: null,
    snapshot_version: null,
    facts_before: null,
    fact_disputes: null,
    facts_added: null,
  };
}

const PLANNED_STATE: Record<WriteBatchChapter['status'], WriteBatchRecordChapter['state']> = {
  write: 'pending',
  skip_written: 'skipped_written',
  after_trial: 'after_trial',
};

function newLeg(plan: WriteBatchPlan, startedAt: string): WriteBatchLeg {
  if (plan.basis === null) throw new Error('能开跑的计划必有预估依据');
  return {
    started_at: startedAt,
    basis: plan.basis,
    estimated_tokens: plan.estimate?.estimated_tokens ?? null,
    cap_tokens: plan.estimate?.cap_tokens ?? null,
    used_tokens: 0,
    runs: [],
  };
}

/**
 * 开一批：内部重跑 planWriteBatch，有不能开跑的原因就拒（不写文件），否则写一条新记录。
 * 第一段带 A 刀给的预估与上限；试写模式没有上限。作者附的要求（note）存进记录，续写时照样带上。
 */
export async function startWriteBatch(
  deps: WriteBatchRunDeps,
  input: {
    project_root: string;
    from: number;
    to: number;
    permission_profile: string;
    model_key: string;
    note?: string | null;
  },
): Promise<WriteBatchStartResult> {
  const modelKey = modelKeyOf(input.model_key);
  const note = noteOf(input.note);
  const root = input.project_root;
  const plan = await planBatch(deps, input, 'new');
  if (!plan.can_start)
    return { started: false, plan, batch: await readWriteBatchRecord(deps.reader, root) };
  const now = timestamp(deps.now());
  const record: WriteBatchRecord = {
    version: WRITE_BATCH_VERSION,
    id: `write-batch-${deps.newHex()}`,
    from: plan.from,
    to: plan.to,
    created_at: now,
    model_key: modelKey,
    note,
    facts_ledger_sha256: null,
    status: 'running',
    reviewed: false,
    stop: null,
    legs: [newLeg(plan, now)],
    chapters: plan.chapters.map((chapter) =>
      blankChapter(chapter.ordinal, chapter.target_path, PLANNED_STATE[chapter.status]),
    ),
  };
  await save(deps, root, record);
  return { started: true, plan, batch: record };
}

/** 续写的那一段计划：只读最近一批（必须是停下的）并重出计划，不写文件。章都有正文时说明换成 batch_all_written。 */
async function resumePlan(
  deps: WriteBatchDeps,
  input: { project_root: string; permission_profile: string; model_key: string },
): Promise<{ record: WriteBatchRecord; plan: WriteBatchPlan; allWritten: boolean }> {
  modelKeyOf(input.model_key);
  const root = input.project_root;
  const record = await readWriteBatchRecord(deps.reader, root);
  if (record === null) throw new WriteBatchError('这部作品还没有批量写章的记录，没有可续写的。');
  if (record.status !== 'stopped')
    throw new WriteBatchError(
      record.status === 'running'
        ? '最近一批还在写，不用续。'
        : '最近一批已经写完了，没有可续写的章。',
    );
  const plan = await planBatch(
    deps,
    {
      project_root: root,
      from: record.from,
      to: record.to,
      permission_profile: input.permission_profile,
    },
    'resume',
  );
  const allWritten = plan.blockers.some((blocker) => blocker.code === 'nothing_to_write');
  if (allWritten)
    plan.blockers = plan.blockers.map((blocker) =>
      blocker.code === 'nothing_to_write'
        ? {
            code: 'batch_all_written',
            message: `这一批（第 ${record.from}–${record.to} 章）的章都已经有正文了，没有要续写的：去清单上审完就行。`,
            chapters: [],
          }
        : blocker,
    );
  return { record, plan, allWritten };
}

/**
 * 续写前给作者看的计划：和 resumeWriteBatch 同一份计划与拦法，但只读、不写文件（作者在确认卡上点开始才续写）。
 * 这一批的章都已经有正文时，plan 里是 batch_all_written 的说明，记录不改。
 */
export async function previewWriteBatchResume(
  deps: WriteBatchDeps,
  root: string,
  input: { permission_profile: string; model_key: string },
): Promise<WriteBatchPlan> {
  return (await resumePlan(deps, { project_root: root, ...input })).plan;
}

/**
 * 续写最近一批（必须是停下的）：对这一批范围里剩下没正文的章重新出计划（同样的拦法，只是不要求先审完），
 * 新开一段（重新估、重新给上限），按新的模型标识记。不能开跑时不改记录。
 * 例外：这一批的章都已经有正文了（比如停在最后一章、作者自己处理完了），就把这一批记成写完，
 * 不再停在「停下了却续不了」；plan 里用 batch_all_written 说明去清单上审完。
 */
export async function resumeWriteBatch(
  deps: WriteBatchRunDeps,
  input: { project_root: string; permission_profile: string; model_key: string },
): Promise<WriteBatchStartResult> {
  const modelKey = modelKeyOf(input.model_key);
  const root = input.project_root;
  const { record, plan, allWritten } = await resumePlan(deps, input);
  if (allWritten) {
    markSkipped(record, await bookChapters(deps.reader, root, deps.platform));
    record.status = 'finished';
    record.stop = null;
    await save(deps, root, record);
    return { started: false, plan, batch: record };
  }
  if (!plan.can_start) return { started: false, plan, batch: record };
  record.chapters = record.chapters.map((chapter, index) => {
    const planned = plan.chapters[index];
    // 已有正文、又是这一批写进去的，照旧；其余按这次的计划重来（旧的那次尝试作废）。
    if (planned.status === 'skip_written' && chapter.state === 'written') return chapter;
    if (planned.status === 'skip_written' && chapter.state === 'skipped_written') return chapter;
    return blankChapter(chapter.ordinal, planned.target_path, PLANNED_STATE[planned.status]);
  });
  record.legs.push(newLeg(plan, timestamp(deps.now())));
  record.stop = null;
  record.status = 'running';
  record.model_key = modelKey;
  await save(deps, root, record);
  return { started: true, plan, batch: record };
}

const latestOf = (artifacts: readonly ArtifactRecord[], kind: string) =>
  artifacts.filter((artifact) => artifact.kind === kind).pop() ?? null;

const CHECK_STATUSES = new Set(['pass', 'repairable', 'blocked']);

/** 这次运行最后一条检查结论，压成清单上的一行。 */
export function checkSummary(artifact: ArtifactRecord | null): WriteBatchCheck | null {
  if (artifact === null) return null;
  const payload = artifact.payload;
  const status = payload.status;
  if (typeof status !== 'string' || !CHECK_STATUSES.has(status))
    throw new WriteBatchError(`检查结论不认识：${String(status)}`);
  const hard = isCount(payload.manuscript_hard_failure_count)
    ? payload.manuscript_hard_failure_count
    : isCount(payload.hard_failure_count)
      ? payload.hard_failure_count
      : 0;
  const issues = Array.isArray(payload.findings)
    ? payload.findings.length
    : (isCount(payload.hard_failure_count) ? payload.hard_failure_count : 0) +
      (isCount(payload.advisory_count) ? payload.advisory_count : 0);
  // 与写章流程同一个口径：检查器重查后仍失败、程序又没查出正文硬问题，就是「未经检查」。
  const executed = payload.execution_status;
  if (typeof executed === 'string' && executed !== 'completed' && hard === 0)
    return {
      verdict: 'unchecked',
      issue_count: issues,
      summary: '检查器重查后仍没给出结果，这章未经检查',
    };
  if (status === 'pass') {
    const repaired = isCount(payload.repair_count) && payload.repair_count > 0;
    return {
      verdict: 'pass',
      issue_count: issues,
      summary: (repaired ? '修过一次后通过' : '通过') + (issues ? `，有 ${issues} 条建议` : ''),
    };
  }
  return {
    verdict: status as 'repairable' | 'blocked',
    issue_count: issues,
    summary: `检查拦下：${hard} 个硬问题`,
  };
}

async function resolvedRelative(reader: ProjectReader, root: string, path: string) {
  try {
    return (await reader.resolveProjectPath(root, path)).resolvedRelativePath;
  } catch (error) {
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
}

/** 事实台账当前的指纹；不在、读不出、超过 2 MiB 为 null（当成说不准）。 */
async function ledgerFingerprint(reader: ProjectReader, root: string): Promise<string | null> {
  try {
    if ((await reader.inspectProjectPath(root, FACTS_LEDGER_PATH)).targetKind !== 'file')
      return null;
    const read = await reader.readProjectBytes(root, FACTS_LEDGER_PATH, MAX_READ_BYTES);
    return read.exceeded ? null : sha256Hex(read.bytes);
  } catch (error) {
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
}

/** 正文文件当前的指纹与字数；文件不在为 null。 */
async function fileFingerprint(
  reader: ProjectReader,
  root: string,
  relative: string,
): Promise<{ sha256: string; chars: number } | null> {
  try {
    if ((await reader.inspectProjectPath(root, relative)).targetKind !== 'file') return null;
    const read = await reader.readProjectBytes(root, relative, MAX_READ_BYTES);
    if (read.exceeded) throw new WriteBatchError(`${relative} 超过 2 MiB，不像一章正文。`);
    return {
      sha256: sha256Hex(read.bytes),
      chars: chapterChars(new TextDecoder('utf-8').decode(read.bytes)),
    };
  } catch (error) {
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
}

/** 正文开头标题里的章名；文件不在、读不到、太大或开头不是标题为 null。 */
async function headingTitleOnDisk(
  reader: ProjectReader,
  root: string,
  relative: string,
): Promise<string | null> {
  try {
    if ((await reader.inspectProjectPath(root, relative)).targetKind !== 'file') return null;
    const read = await reader.readProjectBytes(root, relative, MAX_READ_BYTES);
    if (read.exceeded) return null;
    return chapterHeadingTitle(new TextDecoder('utf-8').decode(read.bytes));
  } catch (error) {
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
}

const optionalText = (value: unknown, name: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new WriteBatchError(`${name} 应是字符串或 null。`);
  return value;
};

/**
 * 一章跑完（写进文件、事实记账落定）后界面记一笔。用量、检查结论、写进去的指纹与字数都由引擎自己算，
 * 不收界面送来的；写前快照的版本记录和记账前的台账版本只有界面知道，原样存。
 * 同一次运行重复记是覆盖，不重复累加用量。
 */
export async function recordWriteBatchChapter(
  deps: WriteBatchRunDeps,
  root: string,
  batchId: string,
  input: {
    ordinal: number;
    run_id: string;
    written_path: string | null;
    snapshot_version: string | null;
    facts_before: string | null;
    fact_disputes: number;
    /** 记账时新记下的事实条数（不含待定的）；没记账或不知道为 null。 */
    facts_added?: number | null;
  },
): Promise<WriteBatchRecord> {
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status !== 'running')
    throw new WriteBatchError('这一批已经停下或写完了，不再记新的章；要接着写请先续写。');
  const chapter = chapterOf(record, input.ordinal);
  if (typeof input.run_id !== 'string' || !input.run_id)
    throw new WriteBatchError('缺少这一章那次运行的 id。');
  if (!isCount(input.fact_disputes)) throw new WriteBatchError('fact_disputes 应是非负整数。');
  const factsAdded = input.facts_added ?? null;
  if (factsAdded !== null && !isCount(factsAdded))
    throw new WriteBatchError('facts_added 应是非负整数或 null。');
  const snapshotVersion = optionalText(input.snapshot_version, 'snapshot_version');
  const factsBefore = optionalText(input.facts_before, 'facts_before');
  const writtenPath = optionalText(input.written_path, 'written_path');
  const leg = currentLeg(record);
  if (record.legs.slice(0, -1).some((item) => item.runs.some((run) => run.run_id === input.run_id)))
    throw new WriteBatchError('这次运行已经记在这一批前面那一段里了，不能再记一次。');

  const run = await deps.store.findRun(input.run_id);
  if (run === null) throw new AgentRunNotFoundError();
  if (run.status === 'running')
    throw new WriteBatchError(`第 ${chapter.ordinal} 章这次运行还没结束，等它结束再记。`);
  const artifacts = await deps.store.artifacts(run.id);
  const brief = latestOf(artifacts, CHAPTER_BRIEF_ARTIFACT_KIND);
  if (brief !== null && brief.payload.target_path !== chapter.target_path)
    throw new WriteBatchError(
      `这次运行写的是 ${String(brief.payload.target_path)}，不是第 ${chapter.ordinal} 章的 ${chapter.target_path}。`,
    );
  let written: { sha256: string; chars: number } | null = null;
  if (writtenPath !== null) {
    if (latestOf(artifacts, 'proposed_patch') === null)
      throw new WriteBatchError(`第 ${chapter.ordinal} 章这次运行没有交出修订，却说写进了文件。`);
    if ((await resolvedRelative(deps.reader, root, writtenPath)) !== chapter.target_path)
      throw new WriteBatchError(
        `写进的文件不是第 ${chapter.ordinal} 章的目标文件 ${chapter.target_path}。`,
      );
    written = await fileFingerprint(deps.reader, root, chapter.target_path);
    if (written === null)
      throw new WriteBatchError(
        `说第 ${chapter.ordinal} 章写进了 ${chapter.target_path}，但正文里找不到这个文件。`,
      );
  }
  const usage = await runUsage(deps.store, input.run_id);
  Object.assign(chapter, {
    state: written !== null ? 'written' : 'stopped_here',
    run_id: run.public_id,
    written_sha256: written?.sha256 ?? null,
    chars: written?.chars ?? null,
    check: checkSummary(latestOf(artifacts, CHAPTER_CHECK_ARTIFACT_KIND)),
    tokens: usage.tokens,
    snapshot_version: snapshotVersion,
    facts_before: factsBefore,
    fact_disputes: input.fact_disputes,
    facts_added: factsAdded,
  } satisfies Partial<WriteBatchRecordChapter>);
  const entry = { ordinal: chapter.ordinal, run_id: run.public_id, tokens: usage.tokens };
  const same = leg.runs.findIndex((item) => item.run_id === run.public_id);
  if (same >= 0) leg.runs.splice(same, 1);
  leg.runs.push(entry);
  leg.used_tokens = leg.runs.reduce((total, item) => total + item.tokens, 0);
  // 记一笔时事实记账已经落定：这时的台账就是「这一批最后一次记账后」的样子。
  record.facts_ledger_sha256 = await ledgerFingerprint(deps.reader, root);
  await save(deps, root, record);
  return record;
}

type StopReason = { code: WriteBatchStopCode; message: string };

/** 规则 1、2：上一章本身没写成，或修订要作者处理。没有问题为 null。 */
async function previousChapterProblem(
  deps: WriteBatchRunDeps,
  chapter: WriteBatchRecordChapter,
): Promise<StopReason | null> {
  const label = `第 ${chapter.ordinal} 章`;
  const run = chapter.run_id === null ? null : await deps.store.findRun(chapter.run_id);
  if (run === null)
    return {
      code: 'no_revision',
      message: `${label}那次运行的记录找不到了，确认不了它交出了修订。`,
    };
  if (run.status === 'failed') {
    const failure = (await deps.store.events(run.id))
      .filter((event) => event.event_type === AGENT_RUN_FAILED)
      .pop();
    return {
      code: 'run_failed',
      message: `${label}的运行失败了` + (failure?.message ? `：${failure.message}` : '。'),
    };
  }
  if (
    run.status === 'stopped' ||
    (run.status === 'paused' && run.current_step !== 'permission.confirm')
  )
    return { code: 'run_stopped', message: `${label}的运行被停下了，没有交出修订。` };
  const artifacts = await deps.store.artifacts(run.id);
  const patch = latestOf(artifacts, 'proposed_patch');
  if (patch === null) {
    const check = latestOf(artifacts, CHAPTER_CHECK_ARTIFACT_KIND);
    if (check !== null && check.payload.status !== 'pass')
      return {
        code: 'check_blocked',
        message:
          `${label}检查拦下了（${chapter.check?.summary ?? '有硬问题'}）：` +
          '候选稿留在运行记录里，没有写进文件。看过检查意见再续写或自己写这一章。',
      };
    return { code: 'no_revision', message: `${label}这次运行没有交出修订。` };
  }
  if (patch.requires_confirmation)
    return {
      code: 'needs_confirmation',
      message:
        `${label}的修订要你点接受才写进文件` +
        (chapter.check?.verdict === 'unchecked' ? '（检查器重查后仍没给出结果）' : '') +
        '：先在编辑器里通读、处理完再续写。',
    };
  if (chapter.state !== 'written')
    return {
      code: 'writeback_blocked',
      message: `${label}的修订没有写进文件（被写进文件前的保护拦下了）：处理完再续写。`,
    };
  return null;
}

async function stopBatch(
  deps: FileDeps,
  root: string,
  record: WriteBatchRecord,
  reason: StopReason,
  ordinal: number | null,
): Promise<WriteBatchStep> {
  record.status = 'stopped';
  record.stop = { ...reason, ordinal };
  await save(deps, root, record);
  return { action: 'stop', ...reason, ordinal };
}

/** 计划里还没写（或撤销过）、正文却已经有了的章（作者中途自己写的）：跳过并标出来。 */
function markSkipped(record: WriteBatchRecord, book: BookChapters) {
  for (const chapter of record.chapters)
    if (
      (chapter.state === 'pending' ||
        chapter.state === 'after_trial' ||
        chapter.state === 'undone') &&
      book.writtenPath(chapter.ordinal) !== null
    )
      chapter.state = 'skipped_written';
}

/** 范围里第一章还没有正文的（正文是真值源）；都有了为 null。 */
const firstUnwritten = (record: WriteBatchRecord, book: BookChapters) =>
  record.chapters.find((chapter) => book.writtenPath(chapter.ordinal) === null) ?? null;

/**
 * 问下一步：接着写哪一章，还是停、为什么停。按顺序判断（测试逐条钉住）：
 * 1. 上一章没交出修订、检查拦下、运行失败（含超时、断网重发仍失败）、被停下 → 停在那一章。
 * 2. 上一章的修订要作者点接受，或没写进文件（被保护拦下）→ 停在那一章。
 *    （上一章 = 当前这一段最后记的那章；这一段还没记过就跳过 1、2。）
 *    范围里已经没有没正文的章 → 写完。下面 3–6 都是「开下一章之前」的判断。
 * 3. 上一章记事实时有对不上的 → 停在下一章之前（作者 10-30 第 6 问选 A）。
 * 4. 权限改成了只读 → 停；模型标识和这一段开跑时不同 → 停，续写时按新模型重估。
 * 5. 这一段有上限、已用 ≥ 上限 → 停（上限只在两章之间判断，刚写完的这章算数；第 9 问选 B）。
 * 6. 试写段写完了一章 → 停，续写时按实际用量估剩下的。
 * 7. 写范围里下一章还没有正文的（读盘；作者中途自己写了的跳过并标 skipped_written）。
 * 停或写完时把状态落盘；已经停了或写完的批，原样回报不再判断。
 */
export async function nextWriteBatchStep(
  deps: WriteBatchRunDeps,
  root: string,
  batchId: string,
  input: { permission_profile: string; model_key: string },
): Promise<WriteBatchStep> {
  const profile = normalizePermissionProfile(input.permission_profile, false).profile;
  const modelKey = modelKeyOf(input.model_key);
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status === 'stopped') return { action: 'stop', ...record.stop! };
  if (record.status === 'finished') return { action: 'finished' };
  const leg = currentLeg(record);
  const lastRun = leg.runs.length ? leg.runs[leg.runs.length - 1] : null;
  const previous = lastRun === null ? null : chapterOf(record, lastRun.ordinal);
  if (previous !== null) {
    const problem = await previousChapterProblem(deps, previous);
    if (problem !== null) {
      if (previous.state !== 'written') previous.state = 'stopped_here';
      return stopBatch(deps, root, record, problem, previous.ordinal);
    }
  }
  const book = await bookChapters(deps.reader, root, deps.platform);
  markSkipped(record, book);
  const target = firstUnwritten(record, book);
  if (target === null) {
    record.status = 'finished';
    await save(deps, root, record);
    return { action: 'finished' };
  }
  const before = `第 ${target.ordinal} 章开写前停下`;
  if (previous !== null && (previous.fact_disputes ?? 0) > 0)
    return stopBatch(
      deps,
      root,
      record,
      {
        code: 'fact_disputes',
        message:
          `第 ${previous.ordinal} 章记事实时有 ${previous.fact_disputes} 条和已记的对不上（存成了待定）：` +
          `${before}。先在观测镜里定了再续写。`,
      },
      target.ordinal,
    );
  if (profile === 'read')
    return stopBatch(
      deps,
      root,
      record,
      {
        code: 'read_only',
        message: `这部作品的 AI 权限改成了「只读」，AI 不能把写好的章写进文件：${before}。改回「询问」或「自动」后再续写。`,
      },
      target.ordinal,
    );
  if (modelKey !== record.model_key)
    return stopBatch(
      deps,
      root,
      record,
      {
        code: 'model_changed',
        message: `开跑后换了模型，每章用量会跟着变：${before}。续写时按新模型重新估、再确认。`,
      },
      target.ordinal,
    );
  if (leg.cap_tokens !== null && leg.used_tokens >= leg.cap_tokens) {
    const over = leg.used_tokens - leg.cap_tokens;
    return stopBatch(
      deps,
      root,
      record,
      {
        code: 'cap_reached',
        message:
          `这一段已用 ${formatTokenCount(leg.used_tokens)} / 上限 ${formatTokenCount(leg.cap_tokens)} token` +
          (over > 0
            ? `，超出 ${formatTokenCount(over)}（上限只在两章之间判断，刚写完的这章照常算数）`
            : '') +
          `：${before}。续写时按最近的用量重新估、再确认。`,
      },
      target.ordinal,
    );
  }
  if (leg.basis === 'trial' && leg.runs.length > 0) {
    const left = record.chapters.filter((chapter) => book.writtenPath(chapter.ordinal) === null);
    return stopBatch(
      deps,
      root,
      record,
      {
        code: 'trial_done',
        message: `试写的一章写完了，用量量完了：续写时按实际用量给剩下 ${left.length} 章的预估，再问你一次。`,
      },
      target.ordinal,
    );
  }
  await save(deps, root, record);
  const planned = book.entry(target.ordinal);
  return {
    action: 'write',
    ordinal: target.ordinal,
    target_path: target.target_path,
    goal: planned?.goal ?? null,
    title: planned?.title ?? null,
    note: record.note,
  };
}

/** 作者按停止，或界面发现应用上次是被关掉的。已经停了或写完的批不改。 */
export async function stopWriteBatch(
  deps: FileDeps,
  root: string,
  batchId: string,
  input: { code: string; message: string },
): Promise<WriteBatchRecord> {
  if (!(INTERFACE_STOP_CODES as readonly string[]).includes(input.code))
    throw new WriteBatchError(`界面不能用这个原因停下一批：${String(input.code)}`);
  if (typeof input.message !== 'string' || !input.message.trim())
    throw new WriteBatchError('停下要附一句给作者看的说明。');
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status !== 'running') return record;
  const book = await bookChapters(deps.reader, root, deps.platform);
  record.status = 'stopped';
  record.stop = {
    code: input.code as WriteBatchStopCode,
    message: input.message,
    ordinal: firstUnwritten(record, book)?.ordinal ?? null,
  };
  await save(deps, root, record);
  return record;
}

/**
 * 打开作品时调用：最近一批还标着在写，说明应用上次是在写的中途关掉的（调度器不可能还活着），
 * 改成停下，不自动续。
 */
export async function recoverInterruptedWriteBatch(
  deps: FileDeps,
  root: string,
): Promise<{ recovered: boolean; batch: WriteBatchRecord | null }> {
  const record = await readWriteBatchRecord(deps.reader, root);
  if (record === null || record.status !== 'running') return { recovered: false, batch: record };
  const book = await bookChapters(deps.reader, root, deps.platform);
  const ordinal = firstUnwritten(record, book)?.ordinal ?? null;
  record.status = 'stopped';
  record.stop = {
    code: 'app_closed',
    message:
      '应用上次关闭时这一批还在写' +
      (ordinal !== null ? `，停在第 ${ordinal} 章` : '') +
      '。没有自动接着写；要续写请再确认一次。',
    ordinal,
  };
  await save(deps, root, record);
  return { recovered: true, batch: record };
}

/** 作者在清单上点了「这批审完了」：之后才能开新的一批。还在写的批不能标。 */
export async function markWriteBatchReviewed(
  deps: FileDeps,
  root: string,
  batchId: string,
): Promise<WriteBatchRecord> {
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status === 'running')
    throw new WriteBatchError('这一批还在写：停下或写完以后才能标「审完了」。');
  if (record.reviewed) return record;
  record.reviewed = true;
  await save(deps, root, record);
  return record;
}

/**
 * 读最近一批，并标出记录与正文对不上的章（以正文为准）。没有批量记录时 batch 为 null。
 * 每章带上章名（正文在的取正文开头标题里的，否则用连载计划里的）与本章目标，读时取，不存进记录。
 */
export async function readWriteBatch(
  deps: Pick<WriteBatchRunDeps, 'reader' | 'platform'>,
  root: string,
): Promise<WriteBatchView> {
  const record = await readWriteBatchRecord(deps.reader, root);
  if (record === null) return { batch: null, mismatches: [], can_resume: false, resume_from: null };
  const book = await bookChapters(deps.reader, root, deps.platform);
  const resumeFrom = firstUnwritten(record, book)?.ordinal ?? null;
  const mismatches: WriteBatchMismatch[] = [];
  const headingTitles = new Map<number, string | null>();
  for (const chapter of record.chapters) {
    const textPath =
      chapter.state === 'written' ? chapter.target_path : book.writtenPath(chapter.ordinal);
    headingTitles.set(
      chapter.ordinal,
      textPath === null ? null : await headingTitleOnDisk(deps.reader, root, textPath),
    );
  }
  for (const chapter of record.chapters) {
    const label = `第 ${chapter.ordinal} 章`;
    const present = book.writtenPath(chapter.ordinal) !== null;
    if (chapter.state === 'written') {
      const current = await fileFingerprint(deps.reader, root, chapter.target_path);
      if (current === null)
        mismatches.push({
          ordinal: chapter.ordinal,
          kind: 'missing',
          message: `记录说${label}写进了 ${chapter.target_path}，正文里找不到了：以正文为准。`,
        });
      else if (current.sha256 !== chapter.written_sha256)
        mismatches.push({
          ordinal: chapter.ordinal,
          kind: 'changed',
          message: `${label}写进文件以后又改过，和写进去时的内容对不上：以正文为准。`,
        });
    } else if (chapter.state === 'skipped_written') {
      if (!present)
        mismatches.push({
          ordinal: chapter.ordinal,
          kind: 'missing',
          message: `记录说${label}已有正文，正文里找不到了：以正文为准。`,
        });
    } else if (present)
      mismatches.push({
        ordinal: chapter.ordinal,
        kind: 'written_outside',
        message:
          chapter.state === 'undone'
            ? `记录说${label}已经撤销了，正文里又有了：以正文为准。`
            : `记录说${label}没写进文件，正文里已经有了：以正文为准。`,
      });
  }
  return {
    batch: {
      ...record,
      chapters: record.chapters.map((chapter) => ({
        ...chapter,
        title: headingTitles.get(chapter.ordinal) ?? book.entry(chapter.ordinal)?.title ?? null,
        goal: book.entry(chapter.ordinal)?.goal ?? null,
      })),
    },
    mismatches,
    can_resume: record.status === 'stopped' && resumeFrom !== null,
    resume_from: resumeFrom,
  };
}

export type WriteBatchUndoBlockerCode =
  | 'batch_running'
  | 'not_batch_written'
  | 'changed'
  | 'missing'
  | 'outside_chapters';

export type WriteBatchUndoBlocker = {
  code: WriteBatchUndoBlockerCode;
  /** 给作者看的说明。 */
  message: string;
  /** 涉及的章序。 */
  chapters: number[];
};

export type WriteBatchUndoChapter = {
  ordinal: number;
  target_path: string;
  /** 写进去时记下的内容指纹：删之前当前文件得还是这一份。 */
  written_sha256: string;
  /**
   * 删到这一章（含）就停下时，事实台账要恢复到的版本：已删的各章里章序最小、记过账的那一章记账前的那一版
   * （版本记录的作品内相对路径）；已删的章都没记过账为 null。
   */
  facts_restore: string | null;
};

/** 「撤销第 k 章及之后」的计划：只读，不写文件。 */
export type WriteBatchUndoPlan = {
  batch_id: string;
  from: number;
  /** 要删的最后一章；没有可删的为 null。 */
  to: number | null;
  /** 要删的章，从最后一章倒着排。 */
  chapters: WriteBatchUndoChapter[];
  /** 全部删完时事实台账要恢复到的版本：第 k 章记账前的那一版（第 k 章没记过账就往后找第一章记过的）。 */
  facts_before: string | null;
  /**
   * 当前台账和这一批最后一次记账后（或上次撤销恢复后）的那一版比：unchanged 一致；changed 不一致（含台账
   * 不在了），作者之后在观测镜里的改动会一起回退；unknown 说不准（记录里没有那一版的指纹）。没有要恢复的台账为 null。
   */
  facts_ledger: 'unchanged' | 'changed' | 'unknown' | null;
  blockers: WriteBatchUndoBlocker[];
  can_undo: boolean;
};

const undoBlocker = (
  code: WriteBatchUndoBlockerCode,
  message: string,
  chapters: number[] = [],
): WriteBatchUndoBlocker => ({ code, message, chapters });

const RUNNING_UNDO = '这一批还在写：停下或写完以后才能撤销。';
const notBatchWritten = (ordinal: number) =>
  undoBlocker(
    'not_batch_written',
    `第 ${ordinal} 章不是这一批写进文件的（或已经撤销过），没有可撤销的。`,
    [ordinal],
  );
const changedBlocker = (ordinals: number[]) =>
  undoBlocker(
    'changed',
    `第 ${ordinalRanges(ordinals)} 章写进文件以后改过，和写进去时的内容对不上：` +
      '撤销会吃掉你的改动，先自己处理这几章（要留就别从这里撤，不要就自己删掉或改回去）。',
    ordinals,
  );
const missingBlocker = (ordinals: number[]) =>
  undoBlocker(
    'missing',
    `第 ${ordinalRanges(ordinals)} 章的文件已经不在了，和记录对不上：先自己核对这几章，再撤销。`,
    ordinals,
  );

const pathKey = (path: string) => path.split('\\').join('/');

/** 这一章当前的文件还是不是写进去时那一份：不在了为 missing，改过为 changed，没变为 null。 */
async function undoFileProblem(
  reader: ProjectReader,
  root: string,
  chapter: WriteBatchRecordChapter,
): Promise<'missing' | 'changed' | null> {
  const current = await fileFingerprint(reader, root, chapter.target_path);
  if (current === null) return 'missing';
  return current.sha256 === chapter.written_sha256 ? null : 'changed';
}

/**
 * 撤销第 k 章及之后之前先看能不能撤（只读，不写文件）：要删的是这一批写进文件的第 k 章及之后的章，
 * 从最后一章倒着排。拦法：这一批还在写；第 k 章不是这一批写进的；有章写进去以后改过或文件不在了
 * （撤销会吃掉作者的改动）；第 k 章往后还有不是这一批写的正文（删掉前面的章，它们的章序会往前错位）。
 * 事实台账要恢复到第 k 章记账前的那一版（facts_before）。
 */
export async function planWriteBatchUndo(
  deps: Pick<WriteBatchRunDeps, 'reader' | 'platform'>,
  root: string,
  batchId: string,
  fromOrdinal: number,
): Promise<WriteBatchUndoPlan> {
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  const first = chapterOf(record, fromOrdinal);
  const blockers: WriteBatchUndoBlocker[] = [];
  if (record.status === 'running') blockers.push(undoBlocker('batch_running', RUNNING_UNDO));
  if (first.state !== 'written') blockers.push(notBatchWritten(first.ordinal));
  const targets = record.chapters
    .filter((chapter) => chapter.ordinal >= first.ordinal && chapter.state === 'written')
    .sort((a, b) => b.ordinal - a.ordinal);
  const changed: number[] = [];
  const missing: number[] = [];
  for (const chapter of targets) {
    const problem = await undoFileProblem(deps.reader, root, chapter);
    if (problem === 'changed') changed.push(chapter.ordinal);
    if (problem === 'missing') missing.push(chapter.ordinal);
  }
  if (changed.length) blockers.push(changedBlocker(changed));
  if (missing.length) blockers.push(missingBlocker(missing));
  // 章序 = 正文按路径排序后的第几个：第 k 章往后只要还有一份不删的正文，删完它就会往前错位。
  const deleting = new Set(targets.map((chapter) => pathKey(chapter.target_path)));
  const outside: [string, number][] = [];
  for (const [path, ordinal] of await chapterOrdinals(deps.reader, root, '*.md', deps.platform))
    if (ordinal >= first.ordinal && !deleting.has(pathKey(path))) outside.push([path, ordinal]);
  if (outside.length) {
    const ordinals = outside.map(([, ordinal]) => ordinal);
    const names = outside.slice(0, 3).map(([path]) => path);
    blockers.push(
      undoBlocker(
        'outside_chapters',
        `第 ${ordinalRanges(ordinals)} 章不是这一批写的正文（${names.join('、')}` +
          `${outside.length > names.length ? ' 等' : ''}）：撤销第 ${first.ordinal} 章及之后会删掉排在它们前面的章，` +
          '它们的章序会跟着往前错位。先自己处理这几章，再撤销。',
        ordinals,
      ),
    );
  }
  let restore: string | null = null;
  const chapters = targets.map((chapter) => {
    // 倒着删：删到哪一章停下，台账就回到已删各章里最早一次记账之前。
    if (chapter.facts_before !== null) restore = chapter.facts_before;
    return {
      ordinal: chapter.ordinal,
      target_path: chapter.target_path,
      written_sha256: chapter.written_sha256 ?? '',
      facts_restore: restore,
    };
  });
  let factsLedger: WriteBatchUndoPlan['facts_ledger'] = null;
  if (restore !== null) {
    const current = await ledgerFingerprint(deps.reader, root);
    // 记下过指纹、现在台账却不在或读不出，也算和那一版不一样。
    factsLedger =
      record.facts_ledger_sha256 === null
        ? 'unknown'
        : current === record.facts_ledger_sha256
          ? 'unchanged'
          : 'changed';
  }
  return {
    batch_id: record.id,
    from: first.ordinal,
    to: targets[0]?.ordinal ?? null,
    chapters,
    facts_before: restore,
    facts_ledger: factsLedger,
    blockers,
    can_undo: blockers.length === 0 && chapters.length > 0,
  };
}

/**
 * 删一章之前再核一次（只读）：这一章还是这一批写进的、文件还是写进去时那一份。能删为 null。
 * 计划出来以后到真删之间作者可能又动过，所以每章删之前都问一次。
 */
export async function checkWriteBatchUndoChapter(
  deps: Pick<WriteBatchRunDeps, 'reader' | 'platform'>,
  root: string,
  batchId: string,
  ordinal: number,
): Promise<WriteBatchUndoBlocker | null> {
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status === 'running') return undoBlocker('batch_running', RUNNING_UNDO);
  const chapter = chapterOf(record, ordinal);
  if (chapter.state !== 'written') return notBatchWritten(chapter.ordinal);
  const problem = await undoFileProblem(deps.reader, root, chapter);
  if (problem === 'changed') return changedBlocker([chapter.ordinal]);
  if (problem === 'missing') return missingBlocker([chapter.ordinal]);
  return null;
}

/**
 * 界面撤销完（倒着删了文件、计划里退回未写、事实台账恢复）以后记一笔：删掉了的章记成已撤销，
 * 这一批改成停下（undone），续写照常按正文算（撤销后能从删掉的第一章重写）。
 * 删没删由引擎读盘核对，界面说删了、文件却还在就不认；删掉的必须是这一批写进的、从某一章起往后的全部。
 * failure：没删完就停下时的原因；facts_restored / facts_error：事实台账恢复了没有。
 */
export async function recordWriteBatchUndo(
  deps: FileDeps,
  root: string,
  batchId: string,
  fromOrdinal: number,
  input: {
    deleted: number[];
    failure: string | null;
    facts_restored: boolean;
    facts_error: string | null;
  },
): Promise<WriteBatchRecord> {
  await resolveProjectRoot(deps.reader, root);
  const record = await latestBatch(deps.reader, root, batchId);
  if (record.status === 'running') throw new WriteBatchError(RUNNING_UNDO);
  chapterOf(record, fromOrdinal);
  const failure = optionalText(input.failure, 'failure');
  const factsError = optionalText(input.facts_error, 'facts_error');
  if (!Array.isArray(input.deleted) || !input.deleted.length)
    throw new WriteBatchError('没有删掉任何一章，不用记撤销。');
  const deleted = [...new Set(input.deleted)].map((ordinal) => chapterOf(record, ordinal));
  const lowest = Math.min(...deleted.map((chapter) => chapter.ordinal));
  for (const chapter of deleted) {
    if (chapter.ordinal < fromOrdinal || chapter.state !== 'written')
      throw new WriteBatchError(
        `第 ${chapter.ordinal} 章不是要撤销的第 ${fromOrdinal} 章及之后这一批写进的章。`,
      );
    if ((await fileFingerprint(deps.reader, root, chapter.target_path)) !== null)
      throw new WriteBatchError(
        `第 ${chapter.ordinal} 章的文件还在 ${chapter.target_path}，不能记成已撤销。`,
      );
  }
  const left = record.chapters.filter(
    (chapter) =>
      chapter.state === 'written' &&
      chapter.ordinal > lowest &&
      !deleted.some((item) => item.ordinal === chapter.ordinal),
  );
  if (left.length)
    throw new WriteBatchError(
      `第 ${ordinalRanges(left.map((chapter) => chapter.ordinal))} 章还在：撤销要从最后一章倒着删，不能跳过。`,
    );
  for (const chapter of deleted) chapter.state = 'undone';
  // 台账是这一批自己恢复的：恢复后的样子当作新的基准，下次撤销不把它算成作者的改动。
  if (input.facts_restored) record.facts_ledger_sha256 = await ledgerFingerprint(deps.reader, root);
  const book = await bookChapters(deps.reader, root, deps.platform);
  const resume = firstUnwritten(record, book)?.ordinal ?? null;
  const facts = factsError
    ? `；事实台账没能恢复（${factsError}），去观测镜里核对`
    : input.facts_restored
      ? `，事实台账回到第 ${lowest} 章记账前`
      : '';
  record.status = 'stopped';
  record.stop = {
    code: 'undone',
    message:
      `撤销了第 ${ordinalRanges(deleted.map((chapter) => chapter.ordinal))} 章：文件删了，连载计划里退回未写${facts}。` +
      (failure ? `没撤完就停下了：${failure}。` : '') +
      (resume !== null ? `要重写就从第 ${resume} 章接着写。` : ''),
    ordinal: resume,
  };
  await save(deps, root, record);
  return record;
}
