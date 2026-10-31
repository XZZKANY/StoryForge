/**
 * 批量写章清单上的「撤销第 k 章及之后」（方案 docs/internal/write-batch-plan-2026-10.md 第 4.2 节）。
 * 判断全在引擎：能不能撤、删哪几章、按什么顺序、事实台账回到哪一版（planWriteBatchUndo），
 * 每章删之前这一份还是不是写进去时那一份（checkWriteBatchUndoChapter）。这里只照着做：
 * 倒着删，每章走新建文件撤销的同一条删除路径（删、清上下文缓存、计划里退回未写），
 * 任何一章没删成就停、不接着删；删掉了的照实记下来（recordWriteBatchUndo），台账回到已删各章里最早一次记账前。
 * 撤销需要的东西全在批量记录里，重开应用后照样能撤。
 */
import type { ApiWriteBatchUndoPlan } from './api/contracts';
import {
  checkWriteBatchUndoChapter,
  planWriteBatchUndo,
  recordWriteBatchUndo,
} from './api/write-batch';
import { deleteCreatedFile } from './created-file-delete';
import { restoreFactsLedger } from './fact-write';
import { resolveProjectRelativePath } from './project-context';
import { TauriFileSystem } from './tauri-fs';
import { dropWriteBatchTab, writeBatchTabDirty } from './write-batch-tabs';

export type WriteBatchUndoOutcome =
  /** 不能撤：引擎给的原因，或编辑器里有未保存的修改。什么都没动。 */
  | { kind: 'blocked'; messages: string[] }
  | {
      kind: 'done';
      /** 删掉了的章，按删的先后（倒着）。 */
      deleted: number[];
      /** 没删完就停下的原因；全删完为 null。 */
      failure: string | null;
      factsError: string | null;
      /** 删了，但批量记录没记上。 */
      recordError: string | null;
    };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 正文派生的 canon 缓存，与宿主写进文件后清掉的是同一张单子（fs_writeback_receipts.rs 的
 * CANON_DERIVED_INVALIDATION_NAMES；proposals.json 是待决草稿，不在其列）。
 */
const CANON_DERIVED_CACHES = ['presence.json', 'observations.json', 'dossier.md', 'report.json'];

/**
 * 删章不经写入回执，派生缓存的来源版本不变：删之前写的缓存（还算着删掉的章）删之后仍会被当成最新的。
 * 照写进文件那样先清掉，删章触发的观测重扫再按现在的正文重建。清不掉也只是缓存，那次重扫照样会覆盖它。
 */
async function invalidateCanonDerivedCaches(projectRoot: string): Promise<void> {
  for (const name of CANON_DERIVED_CACHES) {
    const filePath = resolveProjectRelativePath(projectRoot, `.storyforge/canon/derived/${name}`);
    if (!filePath) continue;
    try {
      if (await TauriFileSystem.pathExists(filePath))
        await TauriFileSystem.deletePath(projectRoot, filePath);
    } catch {
      // 见上：重扫会覆盖它。
    }
  }
}

async function stillThere(filePath: string): Promise<boolean> {
  try {
    return await TauriFileSystem.pathExists(filePath);
  } catch {
    return true;
  }
}

function absolutePaths(projectRoot: string, plan: ApiWriteBatchUndoPlan) {
  return plan.chapters.map((chapter) => ({
    ...chapter,
    filePath: resolveProjectRelativePath(projectRoot, chapter.target_path),
  }));
}

export async function undoWriteBatchFrom(input: {
  projectRoot: string;
  batchId: string;
  fromOrdinal: number;
}): Promise<WriteBatchUndoOutcome> {
  const { projectRoot, batchId, fromOrdinal } = input;
  const plan = await planWriteBatchUndo(projectRoot, batchId, fromOrdinal);
  if (!plan.can_undo) return { kind: 'blocked', messages: plan.blockers.map((b) => b.message) };
  const chapters = absolutePaths(projectRoot, plan);
  // 编辑器里没保存的字引擎看不见：删之前一起问，有就一章都不删。
  const dirty = chapters.filter(
    (chapter) => chapter.filePath && writeBatchTabDirty(chapter.filePath),
  );
  if (dirty.length)
    return {
      kind: 'blocked',
      messages: dirty.map(
        (chapter) => `第 ${chapter.ordinal} 章在编辑器里有未保存的修改：先保存或放弃，再撤销。`,
      ),
    };

  const deleted: number[] = [];
  let failure: string | null = null;
  for (const chapter of chapters) {
    const label = `第 ${chapter.ordinal} 章`;
    const blocker = await checkWriteBatchUndoChapter(projectRoot, batchId, chapter.ordinal);
    if (blocker) {
      failure = blocker.message;
      break;
    }
    const filePath = chapter.filePath;
    if (!filePath) {
      failure = `${label}的文件不在这部作品里（${chapter.target_path}）`;
      break;
    }
    if (writeBatchTabDirty(filePath)) {
      failure = `${label}在编辑器里有未保存的修改`;
      break;
    }
    try {
      await deleteCreatedFile(projectRoot, filePath);
    } catch (error) {
      // 删的这一步报错了，文件却真没了：照实算删掉了。
      if (!(await stillThere(filePath))) deleted.push(chapter.ordinal);
      failure = `${label}没删成：${errorText(error)}`;
      break;
    }
    deleted.push(chapter.ordinal);
    dropWriteBatchTab(filePath);
  }
  if (!deleted.length)
    return { kind: 'done', deleted, failure, factsError: null, recordError: null };
  await invalidateCanonDerivedCaches(projectRoot);

  // 删到哪一章停下，台账就回到已删各章里最早一次记账之前（引擎按删的顺序给好了）。
  const restoreTo = plan.chapters[deleted.length - 1].facts_restore;
  let factsRestored = false;
  let factsError: string | null = null;
  if (restoreTo !== null) {
    try {
      await restoreFactsLedger(projectRoot, restoreTo);
      factsRestored = true;
    } catch (error) {
      factsError = errorText(error);
    }
  }
  let recordError: string | null = null;
  try {
    await recordWriteBatchUndo({
      projectRoot,
      batchId,
      fromOrdinal,
      deleted,
      failure,
      factsRestored,
      factsError,
    });
  } catch (error) {
    recordError = errorText(error);
  }
  return { kind: 'done', deleted, failure, factsError, recordError };
}
