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
  | { action: 'write'; ordinal: number; target_path: string; goal: string | null }
  | { action: 'stop'; code: WriteBatchStopCode; message: string; ordinal: number | null }
  | { action: 'finished' };

export type WriteBatchMismatch = {
  ordinal: number;
  /** missing：记录说有正文，文件不在了；changed：写进去以后又改过；written_outside：记录说没写，正文里有了。 */
  kind: 'missing' | 'changed' | 'written_outside';
  message: string;
};

export type WriteBatchView = { batch: WriteBatchRecord | null; mismatches: WriteBatchMismatch[] };

const timestamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

function modelKeyOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new WriteBatchError('缺少当前模型配置的标识（model_key）：换没换模型要靠它看出来。');
  return value;
}

type FileDeps = Pick<WriteBatchRunDeps, 'reader' | 'writer' | 'platform'>;

const save = (deps: FileDeps, root: string, record: WriteBatchRecord) =>
  writeWriteBatchRecord(deps.writer, root, record, deps.platform);

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
 * 第一段带 A 刀给的预估与上限；试写模式没有上限。
 */
export async function startWriteBatch(
  deps: WriteBatchRunDeps,
  input: {
    project_root: string;
    from: number;
    to: number;
    permission_profile: string;
    model_key: string;
  },
): Promise<WriteBatchStartResult> {
  const modelKey = modelKeyOf(input.model_key);
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

/**
 * 续写最近一批（必须是停下的）：对这一批范围里剩下没正文的章重新出计划（同样的拦法，只是不要求先审完），
 * 新开一段（重新估、重新给上限），按新的模型标识记。不能开跑时不改记录。
 */
export async function resumeWriteBatch(
  deps: WriteBatchRunDeps,
  input: { project_root: string; permission_profile: string; model_key: string },
): Promise<WriteBatchStartResult> {
  const modelKey = modelKeyOf(input.model_key);
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
  } satisfies Partial<WriteBatchRecordChapter>);
  const entry = { ordinal: chapter.ordinal, run_id: run.public_id, tokens: usage.tokens };
  const same = leg.runs.findIndex((item) => item.run_id === run.public_id);
  if (same >= 0) leg.runs.splice(same, 1);
  leg.runs.push(entry);
  leg.used_tokens = leg.runs.reduce((total, item) => total + item.tokens, 0);
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
  for (const chapter of record.chapters)
    if (
      (chapter.state === 'pending' || chapter.state === 'after_trial') &&
      book.writtenPath(chapter.ordinal) !== null
    )
      chapter.state = 'skipped_written';
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
          `这一段已用 ${leg.used_tokens} / 上限 ${leg.cap_tokens} token` +
          (over > 0 ? `，超出 ${over}（上限只在两章之间判断，刚写完的这章照常算数）` : '') +
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
  return {
    action: 'write',
    ordinal: target.ordinal,
    target_path: target.target_path,
    goal: book.entry(target.ordinal)?.goal ?? null,
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

/** 读最近一批，并标出记录与正文对不上的章（以正文为准）。没有批量记录时 batch 为 null。 */
export async function readWriteBatch(
  deps: Pick<WriteBatchRunDeps, 'reader' | 'platform'>,
  root: string,
): Promise<WriteBatchView> {
  const record = await readWriteBatchRecord(deps.reader, root);
  if (record === null) return { batch: null, mismatches: [] };
  const book = await bookChapters(deps.reader, root, deps.platform);
  const mismatches: WriteBatchMismatch[] = [];
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
        message: `记录说${label}没写进文件，正文里已经有了：以正文为准。`,
      });
  }
  return { batch: record, mismatches };
}
