/**
 * 批量写章停下 / 写完那张卡上的字：只把引擎记下的东西排成句子，不自己下结论
 * （检查说法、停下原因、章名都是引擎给的）。完整清单与「撤销第 k 章及之后」是下一刀。
 */
import type { ApiWriteBatch, ApiWriteBatchViewRecord } from '../../lib/api/contracts';

export type WriteBatchChapterLine = { ordinal: number; text: string };

export function writtenChapterCount(batch: ApiWriteBatch | ApiWriteBatchViewRecord): number {
  return batch.chapters.filter((chapter) => chapter.state === 'written').length;
}

/** 这一批各段加起来用了多少 token（原始整数，显示时再按「万」说）。 */
export function batchUsedTokens(batch: ApiWriteBatch | ApiWriteBatchViewRecord): number {
  return batch.legs.reduce((total, leg) => total + leg.used_tokens, 0);
}

/** 这一批动过的章，每章一行（章名是引擎读记录时从连载计划取的）；还没轮到的章不列。 */
export function chapterLines(batch: ApiWriteBatchViewRecord): WriteBatchChapterLine[] {
  return batch.chapters.flatMap((chapter) => {
    const name = `第 ${chapter.ordinal} 章${chapter.title ? `《${chapter.title}》` : ''}`;
    const check = chapter.check ? `检查：${chapter.check.summary}` : null;
    const parts =
      chapter.state === 'written'
        ? [name, chapter.chars !== null ? `${chapter.chars} 字` : null, check ?? '检查：没有记录']
        : chapter.state === 'stopped_here'
          ? [name, '没写进文件', check]
          : chapter.state === 'skipped_written'
            ? [name, '已有正文，跳过']
            : null;
    if (parts === null) return [];
    return [{ ordinal: chapter.ordinal, text: parts.filter(Boolean).join(' · ') }];
  });
}
