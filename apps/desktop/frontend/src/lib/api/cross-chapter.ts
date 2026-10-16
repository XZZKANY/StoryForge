import type { CrossChapterRequest, CrossChapterResult } from './types';

/** 跨章一致性检查：整章正文交给模型，在进程内的 TS 引擎里跑。 */
export async function requestCrossChapterConsistency(
  request: CrossChapterRequest,
): Promise<CrossChapterResult> {
  return (await import('../engine/crossChapter')).crossChapterWithEngine(request);
}
