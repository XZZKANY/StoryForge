/**
 * 事实台账 `.storyforge/canon/facts.json` 的唯一写入口：作者接受整份写章补丁后自动记账。
 *
 * 记什么由引擎算（检查时抽出的新事实 → 对接受后的正文重核原句 → 和台账比对）；
 * 这里只管写：文件在记账期间被别处改过就停手，写前给整本书拍一版快照，写完把「撤销」交出去。
 * 和台账对不上的不记，只在通知里告诉作者。
 */

import {
  prepareChapterFactRecord,
  type ChapterFactConflict,
  type ChapterFactRecordPlan,
} from './api/facts';
import { TauriFileSystem } from './tauri-fs';
import { emitToast } from './toast';
import { snapshotBeforeWrite } from './versions';

type Planned = Exclude<ChapterFactRecordPlan, { status: 'skipped' }>;

export type FactRecordOutcome =
  | { status: 'skipped' }
  | { status: 'unchanged'; plan: Planned }
  | { status: 'written'; plan: Planned; undo: () => Promise<void> };

const FACTS_RELATIVE = ['.storyforge', 'canon', 'facts.json'];

export function factsLedgerPathFor(projectPath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return [projectPath.replace(/[/\\]+$/, ''), ...FACTS_RELATIVE].join(separator);
}

async function readLedger(path: string): Promise<string | null> {
  return (await TauriFileSystem.pathExists(path)) ? await TauriFileSystem.readFile(path) : null;
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
  await snapshotBeforeWrite(projectPath, path, before ?? '', {
    source: 'Editor',
    summary: `事实台账记下${chapterLabel(plan)}的 ${plan.added} 条事实`,
    checkpoint: true,
  });
  await TauriFileSystem.writeFile(projectPath, path, plan.after);
  return {
    status: 'written',
    plan,
    undo: () => undoFactsWrite(projectPath, path, before, plan.after),
  };
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
  else await TauriFileSystem.writeFile(projectPath, path, before);
}

function describeConflict(conflict: ChapterFactConflict): string {
  const what = conflict.attribute ? `${conflict.subject}的${conflict.attribute}` : conflict.subject;
  const where = conflict.existingOrdinal !== null ? `第 ${conflict.existingOrdinal} 章` : '台账';
  return `${what}，本章「${conflict.value}」，${where}「${conflict.existingValue}」`;
}

/** 记账结果给作者的一句话；没记也没有要说的就返回 null（不打扰）。 */
export function factRecordMessage(plan: Planned): string | null {
  const parts: string[] = [];
  if (plan.status === 'ready') parts.push(`${chapterLabel(plan)}记下 ${plan.added} 条事实`);
  if (plan.conflicts.length) {
    const [first] = plan.conflicts;
    const more = plan.conflicts.length > 1 ? ` 等 ${plan.conflicts.length} 条` : '';
    parts.push(`和已记的事实对不上，没记：${describeConflict(first)}${more}`);
  }
  if (plan.unverified) parts.push(`${plan.unverified} 条在接受后的正文里找不到原句，没记`);
  if (!parts.length) return null;
  if (plan.status === 'unchanged') parts.unshift(`${chapterLabel(plan)}没有新事实要记`);
  return parts.join('；') + '。';
}

/** 接受补丁之后调用：失败只提示，不影响已经落盘的正文。 */
export async function recordAcceptedChapterFacts(
  projectPath: string | null,
  filePath: string,
  runId: string | undefined,
): Promise<void> {
  if (!projectPath || !runId) return;
  try {
    const outcome = await recordChapterFacts({ projectPath, filePath, runId });
    if (outcome.status === 'skipped') return;
    const message = factRecordMessage(outcome.plan);
    if (!message) return;
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
  } catch (error) {
    emitToast(`这章的事实没记上：${error instanceof Error ? error.message : String(error)}`, {
      tone: 'error',
    });
  }
}
