/**
 * 批量发章计划（纯函数）。
 *
 * 复用单章发布流程加节流：本模块只排计划——按线上已发标题去重（防 -3010）、
 * 按字数下限跳过（防 <1000 字），实际发布与节流在 hook 里顺序驱动。
 */
import { normalizeBookTitle } from './reconcile';

export type BatchChapterInput = {
  path: string;
  name: string;
  title: string;
  charCount: number;
};

export type BatchPlanItem = BatchChapterInput & {
  alreadyOnline: boolean;
  tooShort: boolean;
  skip: boolean;
  skipReason: string | null;
};

export type BatchPlan = {
  items: BatchPlanItem[];
  publishCount: number;
  skipOnlineCount: number;
  skipShortCount: number;
  /** 是否拿到线上章节标题做去重（拿不到时不去重，只按字数） */
  dedupAvailable: boolean;
};

export function planBatchPublish(input: {
  chapters: BatchChapterInput[];
  onlineTitles: string[];
  minChars: number;
  dedupAvailable?: boolean;
}): BatchPlan {
  const { chapters, onlineTitles, minChars } = input;
  const dedupAvailable = input.dedupAvailable ?? onlineTitles.length > 0;
  const onlineSet = new Set(onlineTitles.map(normalizeBookTitle).filter(Boolean));

  let skipOnlineCount = 0;
  let skipShortCount = 0;
  const items: BatchPlanItem[] = chapters.map((c) => {
    const alreadyOnline = dedupAvailable && onlineSet.has(normalizeBookTitle(c.title));
    const tooShort = c.charCount < minChars;
    let skip = false;
    let skipReason: string | null = null;
    if (alreadyOnline) {
      skip = true;
      skipReason = '已在线';
      skipOnlineCount += 1;
    } else if (tooShort) {
      skip = true;
      skipReason = `不足${minChars}字`;
      skipShortCount += 1;
    }
    return { ...c, alreadyOnline, tooShort, skip, skipReason };
  });

  return {
    items,
    publishCount: items.filter((i) => !i.skip).length,
    skipOnlineCount,
    skipShortCount,
    dedupAvailable,
  };
}
