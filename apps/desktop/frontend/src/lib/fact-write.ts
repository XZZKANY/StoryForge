/**
 * 事实台账 `.storyforge/canon/facts.json` 的唯一写入口：作者接受整份写章补丁后自动记账。
 *
 * 记什么由引擎算（检查时抽出的新事实 → 对接受后的正文重核原句 → 和台账比对）；
 * 这里只管写：文件在记账期间被别处改过就停手，写前给整本书拍一版快照，写完把「撤销」交出去。
 * 和已记的固定事实对不上的存成待定，等作者在观测镜里定。
 */

import {
  prepareChapterFactRecord,
  prepareFactBackfill,
  resolveLedgerDispute,
  retireLedgerFact,
  type ChapterFactConflict,
  type ChapterFactRecordPlan,
  type FactBackfillPlan,
} from './api/facts';
import { relativePathInsideProject } from './project/path';
import { TauriFileSystem } from './tauri-fs';
import { emitToast } from './toast';
import { listVersions, readVersionState, snapshotBeforeWrite } from './versions';

type Planned = Exclude<ChapterFactRecordPlan, { status: 'skipped' }>;

export type FactRecordOutcome =
  | { status: 'skipped' }
  | { status: 'unchanged'; plan: Planned }
  | {
      status: 'written';
      plan: Planned;
      undo: () => Promise<void>;
      /** 记账前给台账拍的那条版本记录（绝对路径）；宿主没记成为 null。 */
      snapshotPath: string | null;
    };

const FACTS_RELATIVE = ['.storyforge', 'canon', 'facts.json'];

export function factsLedgerPathFor(projectPath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return [projectPath.replace(/[/\\]+$/, ''), ...FACTS_RELATIVE].join(separator);
}

async function readLedger(path: string): Promise<string | null> {
  return (await TauriFileSystem.pathExists(path)) ? await TauriFileSystem.readFile(path) : null;
}

/** 以 baseline 为准写：等快照那几秒里别处改过（另一次记账、作者手改），宿主拒写，不拿旧计划盖掉。 */
async function writeLedger(
  projectPath: string,
  path: string,
  baseline: string | null,
  content: string,
): Promise<void> {
  await TauriFileSystem.writeFileIfUnchanged(
    projectPath,
    path,
    content,
    baseline === null ? { kind: 'missing' } : { kind: 'content', content: baseline },
  );
}

const chapterLabel = (plan: Planned) =>
  plan.chapterOrdinal !== null
    ? `第 ${plan.chapterOrdinal} 章`
    : `「${plan.chapterPath.split('/').pop()}」`;

export async function recordChapterFacts({
  projectPath,
  filePath,
  runId,
}: {
  projectPath: string;
  filePath: string;
  runId: string;
}): Promise<FactRecordOutcome> {
  const path = factsLedgerPathFor(projectPath);
  const before = await readLedger(path);
  const plan = await prepareChapterFactRecord({
    projectRoot: projectPath,
    filePath,
    runId,
    ledgerText: before,
  });
  if (plan.status === 'skipped') return { status: 'skipped' };
  if (plan.status === 'unchanged') return { status: 'unchanged', plan };
  if ((await readLedger(path)) !== before) {
    throw new Error('facts.json 在记账期间被改过了，这次没有写入。');
  }
  const snapshot = await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: `事实台账记下${chapterLabel(plan)}的 ${plan.added} 条事实`,
    checkpoint: true,
  });
  await writeLedger(projectPath, path, before, plan.after);
  return {
    status: 'written',
    plan,
    undo: () => undoFactsWrite(projectPath, path, before, plan.after),
    snapshotPath: snapshot?.path ?? null,
  };
}

/** 作者在观测镜里作废一条事实：同一套写法——期间被改就停、写前快照、可撤销。 */
export async function retireFactGuarded({
  projectPath,
  factId,
  label,
}: {
  projectPath: string;
  factId: string;
  /** 写进版本记录的那条事实。 */
  label: string;
}): Promise<{ undo: () => Promise<void> }> {
  const path = factsLedgerPathFor(projectPath);
  const before = await readLedger(path);
  const after = await retireLedgerFact(before, factId);
  if ((await readLedger(path)) !== before) {
    throw new Error('facts.json 刚被别处改过，这次没有作废。');
  }
  await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: `事实台账作废：${label}`,
    checkpoint: true,
  });
  await writeLedger(projectPath, path, before, after);
  return { undo: () => undoFactsWrite(projectPath, path, before, after) };
}

/** 作者处理一条对不上的事实：同一套写法——期间被改就停、写前快照、可撤销。 */
export async function resolveDisputeGuarded({
  projectPath,
  factId,
  choice,
  label,
}: {
  projectPath: string;
  factId: string;
  choice: 'accept' | 'reject';
  label: string;
}): Promise<{ undo: () => Promise<void> }> {
  const path = factsLedgerPathFor(projectPath);
  const before = await readLedger(path);
  const after = await resolveLedgerDispute(projectPath, before, factId, choice);
  if ((await readLedger(path)) !== before) {
    throw new Error('facts.json 刚被别处改过，这次没有写入。');
  }
  await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: `事实台账${choice === 'accept' ? '以本章为准' : '保留已记的'}：${label}`,
    checkpoint: true,
  });
  await writeLedger(projectPath, path, before, after);
  return { undo: () => undoFactsWrite(projectPath, path, before, after) };
}

async function undoFactsWrite(
  projectPath: string,
  path: string,
  before: string | null,
  written: string,
): Promise<void> {
  if ((await readLedger(path)) !== written) {
    throw new Error('facts.json 之后又改过，不能直接撤销；记账前的那一份在版本记录里。');
  }
  if (before === null) await TauriFileSystem.deletePath(projectPath, path);
  else await writeLedger(projectPath, path, written, before);
}

/**
 * 批量写章「撤销第 k 章及之后」：事实台账回到 versionRef（第 k 章记账前给台账拍的那条版本记录，
 * 作品内相对路径）存下的样子。同一套写法——恢复前再拍一版（之后记下的、作者在观测镜里改的都还能从
 * 版本记录找回）、以读到的那一份为准写（期间被别处改了宿主拒写）。已经是那一版就不写，返回 false。
 */
export async function restoreFactsLedger(
  projectPath: string,
  versionRef: string,
): Promise<boolean> {
  const path = factsLedgerPathFor(projectPath);
  const entry = (await listVersions(projectPath, path)).find(
    (version) =>
      relativePathInsideProject(projectPath, version.path)?.replace(/\\/g, '/') === versionRef,
  );
  if (!entry)
    throw new Error('找不到记账前那一版事实台账的版本记录，没法自动恢复：去版本历史里找。');
  const target = await readVersionState(projectPath, entry);
  const goal = target.exists ? target.content : null;
  const before = await readLedger(path);
  if (goal === before) return false;
  await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: '批量写章撤销：事实台账回到记账前',
    checkpoint: true,
  });
  if (goal !== null) {
    await writeLedger(projectPath, path, before, goal);
    return true;
  }
  if ((await readLedger(path)) !== before)
    throw new Error('facts.json 刚被别处改过，这次没有恢复。');
  await TauriFileSystem.deletePath(projectPath, path);
  return true;
}

/**
 * 老章补录：引擎逐章调模型抽事实，全部抽完给出新台账；这里一次写入——期间被改就停、
 * 写前一次快照、一次撤销整批撤回。没有新事实就不写。
 */
export async function backfillFactsGuarded({
  projectPath,
  paths,
  onProgress,
}: {
  projectPath: string;
  paths: readonly string[];
  onProgress?: (done: number, total: number, path: string) => void;
}): Promise<{ plan: FactBackfillPlan; undo: (() => Promise<void>) | null }> {
  const path = factsLedgerPathFor(projectPath);
  const before = await readLedger(path);
  const plan = await prepareFactBackfill(
    { projectRoot: projectPath, ledgerText: before, paths },
    onProgress,
  );
  if (plan.status === 'unchanged') return { plan, undo: null };
  if ((await readLedger(path)) !== before) {
    throw new Error('facts.json 在补录期间被改过了，这次没有写入；再点一次补录。');
  }
  const done = plan.chapters.filter((chapter) => chapter.status === 'done').length;
  await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: `事实台账补录 ${done} 章，记下 ${plan.added} 条事实`,
    checkpoint: true,
  });
  await writeLedger(projectPath, path, before, plan.after);
  return { plan, undo: () => undoFactsWrite(projectPath, path, before, plan.after) };
}

const ordinalLabel = (chapter: { ordinal: number | null; path: string }) =>
  chapter.ordinal !== null ? `第 ${chapter.ordinal} 章` : `「${chapter.path.split('/').pop()}」`;

/** 补录结果的一句话：补了几章、记了几条，哪些没抽成，有几条和已记的对不上。 */
export function backfillMessage(plan: FactBackfillPlan): string {
  const done = plan.chapters.filter((chapter) => chapter.status === 'done');
  const failed = plan.chapters.filter((chapter) => chapter.status === 'failed');
  const conflicts = done.flatMap((chapter) => chapter.conflicts);
  const parts = [`补录 ${done.length} 章，记下 ${plan.added} 条事实`];
  if (conflicts.length)
    parts.push(
      `${conflicts.length} 条和已记的事实对不上、先不用，等你在观测镜里定：${describeConflict(conflicts[0])}${conflicts.length > 1 ? ' 等' : ''}`,
    );
  if (failed.length)
    parts.push(`${failed.map(ordinalLabel).join('、')}没抽成（${failed[0].message}）`);
  return parts.join('；') + '。';
}

function describeConflict(conflict: ChapterFactConflict): string {
  const what = conflict.attribute ? `${conflict.subject}的${conflict.attribute}` : conflict.subject;
  const where = conflict.existingOrdinal !== null ? `第 ${conflict.existingOrdinal} 章` : '台账';
  return `${what}，本章「${conflict.value}」，${where}「${conflict.existingValue}」`;
}

/** 记账结果给作者的一句话；没记也没有要说的就返回 null（不打扰）。 */
export function factRecordMessage(plan: Planned): string | null {
  const parts: string[] = [];
  if (plan.added) parts.push(`${chapterLabel(plan)}记下 ${plan.added} 条事实`);
  if (plan.conflicts.length) {
    const [first] = plan.conflicts;
    const more = plan.conflicts.length > 1 ? ` 等 ${plan.conflicts.length} 条` : '';
    parts.push(`和已记的事实对不上、先不用，等你在观测镜里定：${describeConflict(first)}${more}`);
  }
  if (plan.unverified) parts.push(`${plan.unverified} 条在接受后的正文里找不到原句，没记`);
  if (!parts.length) return null;
  if (!plan.added) parts.unshift(`${chapterLabel(plan)}没有新事实要记`);
  return parts.join('；') + '。';
}

/** 这一章记账落定后的样子：批量写章要把它存进批量记录，对不上的事实要停下。 */
export type AcceptedChapterFacts = {
  /** 记账前给台账拍的那条版本记录（绝对路径）；这次没写台账为 null。 */
  snapshotPath: string | null;
  /** 和已记事实对不上、存成待定的条数。 */
  disputes: number;
  /** 新记下的事实条数（不含待定的）。 */
  added: number;
  /** 没记上（出错）时的原因；正文不受影响。 */
  error: string | null;
};

/**
 * 接受补丁之后调用：失败只提示，不影响已经落盘的正文。
 * `canNotify` 在出通知前才问：发起的页面已卸载或换了项目，就照样记账、不再出通知（含「撤销记账」）。
 * 平时没人等它；批量写章的调度器要等它落定再开下一章，所以把结果交回去。
 */
export async function recordAcceptedChapterFacts(
  projectPath: string | null,
  filePath: string,
  runId: string | undefined,
  canNotify: () => boolean = () => true,
): Promise<AcceptedChapterFacts> {
  const settled: AcceptedChapterFacts = { snapshotPath: null, disputes: 0, added: 0, error: null };
  if (!projectPath || !runId) return settled;
  try {
    const outcome = await recordChapterFacts({ projectPath, filePath, runId });
    if (outcome.status === 'skipped') return settled;
    settled.disputes = outcome.plan.conflicts.length;
    settled.added = outcome.plan.added;
    if (outcome.status === 'written') settled.snapshotPath = outcome.snapshotPath;
    const message = factRecordMessage(outcome.plan);
    if (!message || !canNotify()) return settled;
    emitToast(message, {
      tone: 'info',
      action:
        outcome.status === 'written'
          ? {
              label: '撤销记账',
              run: async () => {
                try {
                  await outcome.undo();
                  emitToast('已撤销这次记账。', { tone: 'success' });
                } catch (error) {
                  emitToast(error instanceof Error ? error.message : String(error), {
                    tone: 'error',
                  });
                }
              },
            }
          : undefined,
    });
    return settled;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (canNotify()) emitToast(`这章的事实没记上：${message}`, { tone: 'error' });
    return { snapshotPath: null, disputes: 0, added: 0, error: message };
  }
}
