/**
 * 批量写章清单上的字：只把引擎记下的东西排成一行一行，不自己下结论
 * （检查说法、停下原因、章名与本章目标、对不上的标注都是引擎给的）。不放质量分、通过率之类的总评：
 * 检查通过不等于写得好。
 */
import type {
  ApiWriteBatch,
  ApiWriteBatchMismatch,
  ApiWriteBatchViewChapter,
  ApiWriteBatchViewRecord,
} from '../../lib/api/contracts';

export function writtenChapterCount(batch: ApiWriteBatch | ApiWriteBatchViewRecord): number {
  return batch.chapters.filter((chapter) => chapter.state === 'written').length;
}

/** 这一批计划写的章：范围里开跑时（或中途作者自己写了而）跳过的不算。 */
export function plannedChapterCount(batch: ApiWriteBatch | ApiWriteBatchViewRecord): number {
  return batch.chapters.filter((chapter) => chapter.state !== 'skipped_written').length;
}

/** 这一批各段加起来用了多少 token（原始整数，显示时再按「万」说）。 */
export function batchUsedTokens(batch: ApiWriteBatch | ApiWriteBatchViewRecord): number {
  return batch.legs.reduce((total, leg) => total + leg.used_tokens, 0);
}

export type WriteBatchChapterRow = {
  ordinal: number;
  /** 「第 k 章《标题》」。 */
  name: string;
  /** 作品内相对路径；正文在的章点名字就打开它。 */
  targetPath: string;
  openable: boolean;
  /** 「3000 字」；没写进文件为 null。 */
  chars: string | null;
  check: string;
  /** 连载计划里本章的目标。 */
  goal: string | null;
  /** 新记下的事实（total 含待定的）；记录里没有为 unknown；没写进文件的章为 null。 */
  facts: { total: number; pending: number } | 'unknown' | null;
  tokens: number | null;
  /** 记录与正文对不上时引擎给的说明。 */
  mismatch: string | null;
  /** 这一批写进文件的章：行尾给「撤销这章及之后」。 */
  undoable: boolean;
};

function checkText(chapter: ApiWriteBatchViewChapter): string {
  switch (chapter.state) {
    case 'written':
      return `检查：${chapter.check ? chapter.check.summary : '没有记录'}`;
    case 'stopped_here':
      return `没写（停在这里）${chapter.check ? `，${chapter.check.summary}` : ''}`;
    case 'skipped_written':
      return '已有正文，跳过';
    case 'undone':
      return '已撤销';
    default:
      return '没写';
  }
}

function factsOf(chapter: ApiWriteBatchViewChapter): WriteBatchChapterRow['facts'] {
  if (chapter.state !== 'written' && chapter.state !== 'undone') return null;
  if (chapter.facts_added === null) return 'unknown';
  const pending = chapter.fact_disputes ?? 0;
  return { total: chapter.facts_added + pending, pending };
}

/** 这一批的每一章一行，没轮到的也列（每一章的去向都要在清单上）。 */
export function chapterRows(
  batch: ApiWriteBatchViewRecord,
  mismatches: readonly ApiWriteBatchMismatch[] = [],
): WriteBatchChapterRow[] {
  return batch.chapters.map((chapter) => ({
    ordinal: chapter.ordinal,
    name: `第 ${chapter.ordinal} 章${chapter.title ? `《${chapter.title}》` : ''}`,
    targetPath: chapter.target_path,
    openable: chapter.state === 'written' || chapter.state === 'skipped_written',
    chars: chapter.state === 'written' && chapter.chars !== null ? `${chapter.chars} 字` : null,
    check: checkText(chapter),
    goal: chapter.goal,
    facts: factsOf(chapter),
    tokens: chapter.tokens,
    mismatch:
      mismatches
        .filter((item) => item.ordinal === chapter.ordinal)
        .map((item) => item.message)
        .join(' ') || null,
    undoable: chapter.state === 'written' && batch.status !== 'running',
  }));
}

/** 「撤销这章及之后」确认时说的范围：从这一章到这一批写进文件的最后一章。 */
export function undoRangeLabel(batch: ApiWriteBatchViewRecord, from: number): string {
  const last = Math.max(
    from,
    ...batch.chapters
      .filter((chapter) => chapter.state === 'written')
      .map((chapter) => chapter.ordinal),
  );
  return last === from ? `第 ${from} 章` : `第 ${from}–${last} 章`;
}
