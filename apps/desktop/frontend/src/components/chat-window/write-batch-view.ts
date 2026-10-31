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
  /**
   * 新记下的事实（total 含待定的）；记录里没有为 unknown。只有写进文件的章有：没写的为 null，
   * 撤销了的也为 null（这些事实随台账一起回退了）。
   */
  facts: { total: number; pending: number } | 'unknown' | null;
  /** 写进文件的章一条新事实都没记下时的提醒；其余为 null。 */
  factsWarning: string | null;
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
  if (chapter.state !== 'written') return null;
  if (chapter.facts_added === null) return 'unknown';
  const pending = chapter.fact_disputes ?? 0;
  return { total: chapter.facts_added + pending, pending };
}

const NO_FACTS_WARNING = '这章没抽出新事实，事实台账可能漏了这章的内容。';

/** 这一批的每一章一行，没轮到的也列（每一章的去向都要在清单上）。 */
export function chapterRows(
  batch: ApiWriteBatchViewRecord,
  mismatches: readonly ApiWriteBatchMismatch[] = [],
): WriteBatchChapterRow[] {
  return batch.chapters.map((chapter) => {
    const facts = factsOf(chapter);
    return {
      ordinal: chapter.ordinal,
      name: `第 ${chapter.ordinal} 章${chapter.title ? `《${chapter.title}》` : ''}`,
      targetPath: chapter.target_path,
      openable: chapter.state === 'written' || chapter.state === 'skipped_written',
      chars: chapter.state === 'written' && chapter.chars !== null ? `${chapter.chars} 字` : null,
      check: checkText(chapter),
      goal: chapter.goal,
      facts,
      factsWarning:
        facts !== null && facts !== 'unknown' && facts.total === 0 ? NO_FACTS_WARNING : null,
      tokens: chapter.tokens,
      mismatch:
        mismatches
          .filter((item) => item.ordinal === chapter.ordinal)
          .map((item) => item.message)
          .join(' ') || null,
      undoable: chapter.state === 'written' && batch.status !== 'running',
    };
  });
}

/** 「撤销这章及之后」确认时说的范围（引擎计划里要删的第一章到最后一章）。 */
export function undoRangeLabel(from: number, to: number): string {
  return to === from ? `第 ${from} 章` : `第 ${from}–${to} 章`;
}

/**
 * 确认撤销时关于事实台账的那句：台账整份回到第 k 章记账前。引擎比对过当前台账和这一批最后一次记账后的那一版：
 * 一致只说回到哪；不一致（changed，醒目）或说不准（unknown）就说作者之后在观测镜里的改动也会一起回退。
 * 这几章都没记过账（没有要恢复的台账）不说。
 */
export function undoFactsNotice(
  from: number,
  factsLedger: 'unchanged' | 'changed' | 'unknown' | null,
): { text: string; emphasis: boolean } | null {
  if (factsLedger === null) return null;
  const head = `事实台账会回到第 ${from} 章记账之前的样子`;
  if (factsLedger === 'unchanged') return { text: `${head}。`, emphasis: false };
  return {
    text: `${head}；之后你在观测镜里对事实的改动也会一起回退（回退前留了快照，能在版本历史里找回）。`,
    emphasis: factsLedger === 'changed',
  };
}
