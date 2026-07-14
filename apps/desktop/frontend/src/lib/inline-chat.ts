/**
 * 行间对话（Ctrl+K）的纯逻辑：指令构造、hunk→编辑器行级 diff 映射、diff 概要与陈旧判定。
 * 全部与 Monaco 无关，便于单测；壳层（useInlineChat）只负责把这些结果画成 view zone / decoration。
 *
 * 边界说明：单发 /assistant/revise 端点是「整文件进、整文件出」，且不跑 agent-loop 的 revise_scope
 * 最小改动契约。所以「只改锚定文本」的约束由这里拼进 instruction，其余段落逐字保留全靠提示词。
 */

import { buildPatchHunks } from './patch-hunks';

// instruction 上限对齐后端 AssistantReviseRequest.instruction（max_length=4000）。
const INLINE_INSTRUCTION_MAX = 4000;
// 锚定文本只是「指哪打哪」的指针（全文另在 content 里），过长的选区在指令里截断即可。
const INLINE_ANCHOR_MAX = 1500;

export const INLINE_MINIMAL_EDIT_CONTRACT = [
  '最小改动约束（必须严格遵守）：',
  '1. 只改动下面【锚定文本】直接相关的字句；其余段落、句子、标题、frontmatter 与空行必须逐字原样保留，不得改写、润色、重排或调整标点。',
  '2. 不要改动文件开头的标题或导出元信息。',
  '3. 仍输出修订后的完整正文，但未点名处必须与原文逐字一致。',
].join('\n');

export type InlineAnchor = {
  /** 1-based 起始行（锚定范围首行）。 */
  startLine: number;
  /** 1-based 结束行（锚定范围末行，含）。 */
  endLine: number;
  /** 锚定文本：选区文本，或光标所在整行文本。 */
  text: string;
  /** true=来自非空选区；false=退回光标所在行。 */
  isSelection: boolean;
};

export function buildInlineReviseInstruction(params: {
  anchorText: string;
  isSelection: boolean;
  userInstruction: string;
}): string {
  const anchor = params.anchorText.trim().slice(0, INLINE_ANCHOR_MAX);
  const user = params.userInstruction.trim();
  const anchorLabel = params.isSelection ? '选中的这段' : '光标所在这一行';
  const blocks = [
    user || '按下面的意图润色锚定文本。',
    INLINE_MINIMAL_EDIT_CONTRACT,
    `锚定文本（${anchorLabel}）：\n<<<ANCHOR\n${anchor}\nANCHOR>>>`,
  ];
  return blocks.join('\n\n').slice(0, INLINE_INSTRUCTION_MAX);
}

export type LineDiffHunk = {
  /** 需红标的旧行 1-based 起始行；纯新增时为 null。 */
  removedStartLine: number | null;
  /** 需红标的旧行 1-based 末行（含）；纯新增时为 null。 */
  removedEndLine: number | null;
  /** 绿色新增块插在此 1-based 行之后（0 = 文件顶部）。 */
  afterLineNumber: number;
  /** 绿色新增块的整行文本（无尾随空行）；纯删除时为空。 */
  newLines: string[];
  removedLineCount: number;
  addedLineCount: number;
};

/**
 * 把（分段感知的）buildPatchHunks 结果归一成整行级的编辑器 diff：红标旧行范围 + 绿色新增块锚点。
 * 用 hunk 的 modified 行边界从 after 取「整行」新文本（而非分段片段），并按行范围去重——
 * 同一行上的多个分段改动会塌陷成一条整行替换，避免绿块重复。
 */
export function hunksToLineDiff(before: string, after: string): LineDiffHunk[] {
  const normBefore = before.replace(/\r\n/g, '\n');
  const normAfter = after.replace(/\r\n/g, '\n');
  const hunks = buildPatchHunks(normBefore, normAfter);
  const afterLines = normAfter.split('\n');
  const seen = new Set<string>();
  const result: LineDiffHunk[] = [];

  for (const hunk of hunks) {
    const hasRemoval = hunk.originalEndIndex > hunk.originalStartIndex;
    const hasAddition = hunk.modifiedEndIndex > hunk.modifiedStartIndex;
    const removedStartLine = hasRemoval ? hunk.originalStartIndex + 1 : null;
    const removedEndLine = hasRemoval ? hunk.originalEndIndex : null;
    const afterLineNumber = hunk.originalEndIndex;
    const newLines = hasAddition
      ? afterLines.slice(hunk.modifiedStartIndex, hunk.modifiedEndIndex)
      : [];
    const key = `${removedStartLine}:${removedEndLine}:${afterLineNumber}:${newLines.join('')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      removedStartLine,
      removedEndLine,
      afterLineNumber,
      newLines,
      removedLineCount: hunk.removedLines,
      addedLineCount: hunk.addedLines,
    });
  }

  return result;
}

export type InlineDiffSummary = {
  hunks: LineDiffHunk[];
  addedLines: number;
  removedLines: number;
  /** true=模型没有提出任何改动。 */
  isNoop: boolean;
};

export function summarizeInlineDiff(before: string, after: string): InlineDiffSummary {
  const hunks = hunksToLineDiff(before, after);
  const addedLines = hunks.reduce((total, hunk) => total + hunk.addedLineCount, 0);
  const removedLines = hunks.reduce((total, hunk) => total + hunk.removedLineCount, 0);
  return { hunks, addedLines, removedLines, isNoop: hunks.length === 0 };
}

/**
 * 发起修订到接受之间，作者可能又改了文件——此时旧补丁（基于捕获时的 before）不能直接整体写回。
 * 按 LF 归一比较，避免仅换行差异误判。
 */
export function isInlineEditStale(capturedBefore: string, currentContent: string): boolean {
  return capturedBefore.replace(/\r\n/g, '\n') !== currentContent.replace(/\r\n/g, '\n');
}
