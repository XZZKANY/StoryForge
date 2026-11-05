import { parseWriteBatchCommand } from '@storyforge/project-core';
import type { ManuscriptChapter } from '../../lib/book-context';
import type { ChapterWriteback } from '../../lib/write-batch-writeback';
import type { RunAuthorAgentOutcome } from './types';
import { chapterOrdinalFromText } from './cross-chapter';

export type RevisionBatchRequest = { from: number; to: number; instruction: string };
export type RevisionBatchCommand =
  | { kind: 'range'; request: RevisionBatchRequest }
  | { kind: 'invalid'; message: string };
const USAGE = '请写成 /改 1-7 修改要求，例如 /改 1-7 把世界规则自然融入情节。';
const NUM = '[0-9０-９一二三四五六七八九十百零〇两]+';
const NATURAL = new RegExp(
  '^(?:(?:请|帮我|麻烦|继续|接着|连续|批量|逐章)\\s*)*(?:修改|修订|改写|重写|润色|优化|精简|压缩|扩写)(?:一下)?\\s*第?\\s*(' +
    NUM +
    ')\\s*章?\\s*[-－—–~～至到]\\s*第?\\s*(' +
    NUM +
    ')\\s*章',
);
const ordinal = (raw: string) =>
  chapterOrdinalFromText(
    raw.replace(/[０-９]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
  );

/** 只有显式范围的修改命令进入队列，引用、提问、否定式仍是普通对话。 */
export function parseRevisionBatchCommand(text: string): RevisionBatchCommand | null {
  const message = text.trim();
  if (/^[/／、]改(?=\s|$)/u.test(message)) {
    const parsed = parseWriteBatchCommand(message.replace(/^[/／、]改/u, '/写'));
    if (!parsed || parsed.kind !== 'range') return { kind: 'invalid', message: USAGE };
    if (parsed.to - parsed.from >= 10000)
      return { kind: 'invalid', message: '范围超过10000章，请核对章序。' };
    return {
      kind: 'range',
      request: {
        from: parsed.from,
        to: parsed.to,
        instruction: parsed.note ?? '修订这些章节，保持设定、人物及前后文一致。',
      },
    };
  }
  if (/[?？]|如何|怎么|能否|是否|可不可以|可以吗|好吗/u.test(message)) return null;
  const match = NATURAL.exec(message);
  if (!match) return null;
  const from = ordinal(match[1]),
    to = ordinal(match[2]);
  if (
    from === null ||
    to === null ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from > to ||
    to - from >= 10000
  )
    return { kind: 'invalid', message: USAGE };
  // 范围之外再指定另一组章节不猜测，交回普通对话澄清。
  if (
    new RegExp('第?\\s*' + NUM + '\\s*[-—–~～至到]\\s*第?\\s*' + NUM + '\\s*章').test(
      message.slice(match[0].length),
    )
  )
    return null;
  return { kind: 'range', request: { from, to, instruction: message } };
}

export function resolveRevisionChapters(
  request: RevisionBatchRequest,
  chapters: readonly ManuscriptChapter[],
): ManuscriptChapter[] {
  // book.context 的 ordinal 是阅读次序，缺章时不能把第三章误当成第二章。
  const numbered = chapters.map((chapter) => {
    const filename = chapter.relativePath.replace(/\\/g, '/').split('/').pop() ?? chapter.name;
    const matches = [...filename.matchAll(new RegExp('第\\s*(' + NUM + ')\\s*章', 'g'))];
    const value = matches.length === 1 ? ordinal(matches[0][1]) : null;
    return { chapter, number: value };
  });
  const targets: ManuscriptChapter[] = [];
  for (let ordinal = request.from; ordinal <= request.to; ordinal++) {
    const matches = numbered
      .filter((entry) => entry.number === ordinal)
      .map((entry) => ({ ...entry.chapter, ordinal }));
    if (matches.length !== 1)
      throw new Error(
        '第 ' + ordinal + ' 章不存在、有重号或文件名未标明章号，请核对“第N章”文件名后再开始。',
      );
    if (!matches[0].estimatedChars)
      throw new Error('第 ' + ordinal + ' 章没有正文，不能连续修改。');
    targets.push(matches[0]);
  }
  return targets;
}

export function revisionChapterPrompt(
  request: RevisionBatchRequest,
  chapter: ManuscriptChapter,
  index: number,
  total: number,
): string {
  return (
    '作者统一修改要求：\n' +
    request.instruction +
    '\n\n当前连续修改步骤：只修改第 ' +
    chapter.ordinal +
    ' 章（' +
    (index + 1) +
    '/' +
    total +
    '），文件：' +
    chapter.relativePath +
    '。完整执行上述要求，遵守世界规则与相关人物设定，保持与上一章连贯。' +
    '本轮只提交此文件的修订，不创建或修改其他章节；其余章节由队列逐章处理。' +
    '保持作者未要求改变的事实；生成修订不等于保存成功。'
  );
}

export type RevisionBatchLoopDeps = {
  chapters: readonly ManuscriptChapter[];
  alive: () => boolean;
  validate: () => Promise<void>;
  dispatch: (chapter: ManuscriptChapter, index: number) => Promise<RunAuthorAgentOutcome>;
  awaitWriteback: (runId: string) => Promise<ChapterWriteback>;
  matchesTarget: (path: string, chapter: ManuscriptChapter) => boolean;
  progress: (phase: 'running' | 'waiting', index: number) => void;
  saved: (chapter: ManuscriptChapter, index: number) => void;
};

/** 只认目标文件的写回回执，模型返回和补丁生成都不会推进下一章。 */
export async function runRevisionBatchLoop(deps: RevisionBatchLoopDeps): Promise<void> {
  for (let index = 0; index < deps.chapters.length; index++) {
    if (!deps.alive()) return;
    await deps.validate();
    if (!deps.alive()) return;
    const chapter = deps.chapters[index];
    deps.progress('running', index);
    const outcome = await deps.dispatch(chapter, index);
    if (!deps.alive()) return;
    if (outcome.kind === 'not_dispatched') throw new Error('本章没有启动，已停止后续修改。');
    if (outcome.kind === 'unsettled')
      throw new Error('本轮结果未知，请先核对原运行；后续章节未启动。');
    if (!outcome.proposal) throw new Error('本章没有生成可接受的修订，请核对本轮结果。');
    if (!deps.matchesTarget(outcome.proposal.filePath, chapter))
      throw new Error('修订目标与本章不符，连续修改已停止。');
    deps.progress('waiting', index);
    const receipt = await deps.awaitWriteback(outcome.runId);
    if (!deps.alive()) return;
    if (!receipt.written) throw new Error(receipt.reason);
    if (!deps.matchesTarget(receipt.filePath, chapter))
      throw new Error('保存回执与本章不符，连续修改已停止。');
    deps.saved(chapter, index);
    if (receipt.factError)
      throw new Error('本章已保存，但事实记录失败：' + receipt.factError + '。后续章节未启动。');
  }
}
