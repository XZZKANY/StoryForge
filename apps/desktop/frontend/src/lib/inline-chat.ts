/**
 * 行间对话（Ctrl+K）的纯逻辑：指令构造、hunk→编辑器行级 diff 映射、diff 概要与陈旧判定。
 * 全部与 Monaco 无关，便于单测；壳层（useInlineChat）只负责把这些结果画成 view zone / decoration。
 *
 * 边界说明：单发 /assistant/revise 端点不跑 agent-loop 的 revise_scope 最小改动契约，
 * 所以「只改锚定文本」的约束由这里拼进 instruction，其余段落逐字保留全靠提示词。
 * 长文件只送锚点附近的窗口（见 planInlineReviseWindow），返回后拼回整文再走同一条夹紧路径。
 */

import { buildPatchHunks } from './patch-hunks';

// instruction 上限对齐后端 AssistantReviseRequest.instruction（max_length=4000）。
const INLINE_INSTRUCTION_MAX = 4000;
// 锚定文本只是「指哪打哪」的指针（正文另在 content 里），过长的选区在指令里截断即可。
const INLINE_ANCHOR_MAX = 1500;

export const INLINE_MINIMAL_EDIT_CONTRACT = [
  '最小改动约束（必须严格遵守）：',
  '1. 只改动下面【锚定文本】直接相关的字句；其余段落、句子、标题、frontmatter 与空行必须逐字原样保留，不得改写、润色、重排或调整标点。',
  '2. 不要改动文件开头的标题或导出元信息。',
  '3. 仍输出修订后的完整正文，但未点名处必须与原文逐字一致。',
].join('\n');

export const INLINE_EXCERPT_NOTE =
  '注意：给你的正文是这一章的一段节选，不是全文。请只返回这段节选修订后的完整文本，' +
  '不要补写节选之外的内容，也不要试图给这段加开头或结尾。';

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
  isExcerpt?: boolean;
}): string {
  const anchor = params.anchorText.trim().slice(0, INLINE_ANCHOR_MAX);
  const user = params.userInstruction.trim();
  const anchorLabel = params.isSelection ? '选中的这段' : '光标所在这一行';
  const blocks = [
    user || '按下面的意图润色锚定文本。',
    INLINE_MINIMAL_EDIT_CONTRACT,
    ...(params.isExcerpt ? [INLINE_EXCERPT_NOTE] : []),
    `锚定文本（${anchorLabel}）：\n<<<ANCHOR\n${anchor}\nANCHOR>>>`,
  ];
  return blocks.join('\n\n').slice(0, INLINE_INSTRUCTION_MAX);
}

// 锚点上下各留多少字。上文给得多一点：改一句话时，读者刚读过的那几段决定语感；
// 下文只要够模型知道这段之后接什么、别把过渡写死。
const INLINE_WINDOW_BEFORE_CHARS = 2000;
const INLINE_WINDOW_AFTER_CHARS = 1000;

export type InlineReviseWindow = {
  /** 送给模型的正文（LF 归一）。 */
  text: string;
  /** 1-based 起始行（含）。 */
  startLine: number;
  /** 1-based 结束行（含）。 */
  endLine: number;
  /** true = 窗口就是整篇——短文件不切窗，行为与切窗前逐字一致。 */
  isWholeDocument: boolean;
};

/**
 * 只把锚点附近的窗口送给模型，而不是整章。
 *
 * 改一句话却把整章发出去有两笔代价：BYO-key 作者每次 Ctrl+K 都为整章付费；模型被要求
 * 逐字重抄几千字，drift 正是从那里来的——而 drift 到锚点之外的改动会被
 * `planAnchoredInlineDiff` 静默丢弃，作者只看到一句「有改动被丢弃」。
 *
 * 短文件（整篇装得下预算）一律整篇送出：这一刀的风险因此被限制在长章节上，而收益也只在那里。
 */
export function planInlineReviseWindow(
  content: string,
  anchor: InlineAnchorRange,
): InlineReviseWindow {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const budget = INLINE_WINDOW_BEFORE_CHARS + INLINE_WINDOW_AFTER_CHARS;
  const anchorStart = Math.max(1, Math.min(anchor.startLine, lines.length));
  const anchorEnd = Math.max(anchorStart, Math.min(anchor.endLine, lines.length));

  if (normalized.length <= budget) {
    return {
      text: normalized,
      startLine: 1,
      endLine: lines.length,
      isWholeDocument: true,
    };
  }

  let startLine = anchorStart;
  let spent = 0;
  while (startLine > 1) {
    const cost = (lines[startLine - 2] ?? '').length + 1;
    if (spent + cost > INLINE_WINDOW_BEFORE_CHARS) break;
    spent += cost;
    startLine -= 1;
  }
  let endLine = anchorEnd;
  spent = 0;
  while (endLine < lines.length) {
    const cost = (lines[endLine] ?? '').length + 1;
    if (spent + cost > INLINE_WINDOW_AFTER_CHARS) break;
    spent += cost;
    endLine += 1;
  }

  return {
    text: lines.slice(startLine - 1, endLine).join('\n'),
    startLine,
    endLine,
    isWholeDocument: startLine === 1 && endLine === lines.length,
  };
}

/** 把模型改过的窗口拼回整文，得到「整文件 after」——下游的夹紧与写回契约因此完全不变。 */
export function spliceInlineReviseWindow(
  content: string,
  window: InlineReviseWindow,
  revisedWindowText: string,
): string {
  if (window.isWholeDocument) return revisedWindowText.replace(/\r\n/g, '\n');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const revised = revisedWindowText.replace(/\r\n/g, '\n').split('\n');
  lines.splice(window.startLine - 1, window.endLine - window.startLine + 1, ...revised);
  return lines.join('\n');
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

/**
 * 单行替换的句内变动区间：掐掉相同的公共前缀/后缀，只留真正改动的中段（1-based 列，endCol 独占）。
 * 供 Ctrl+K 行间 diff 在红旧行 / 绿新行里高亮「改了哪几个字」，而非整行铺色。
 * 无变动或纯前/后缀差异时，start===end 表示该侧无高亮区间（纯插入/纯删除）。
 */
export function intraLineChangeRange(
  oldLine: string,
  newLine: string,
): { oldStartCol: number; oldEndCol: number; newStartCol: number; newEndCol: number } {
  const oldLen = oldLine.length;
  const newLen = newLine.length;
  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldLine[prefix] === newLine[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(oldLen - prefix, newLen - prefix);
  while (suffix < maxSuffix && oldLine[oldLen - 1 - suffix] === newLine[newLen - 1 - suffix]) {
    suffix += 1;
  }
  return {
    oldStartCol: prefix + 1,
    oldEndCol: oldLen - suffix + 1,
    newStartCol: prefix + 1,
    newEndCol: newLen - suffix + 1,
  };
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

export type InlineAnchorRange = {
  /** 1-based 起始行（含）。 */
  startLine: number;
  /** 1-based 结束行（含）。 */
  endLine: number;
};

function lineHunkOverlapsAnchor(hunk: LineDiffHunk, anchor: InlineAnchorRange): boolean {
  if (hunk.removedStartLine !== null && hunk.removedEndLine !== null) {
    return hunk.removedStartLine <= anchor.endLine && hunk.removedEndLine >= anchor.startLine;
  }
  // 纯新增插在 afterLineNumber（0=顶部）之后：落在锚定范围内或紧贴上沿都算锚定处。
  return hunk.afterLineNumber >= anchor.startLine - 1 && hunk.afterLineNumber <= anchor.endLine;
}

export type AnchoredInlineDiff = {
  /** 仅与锚定行相交的 hunk（供渲染红/绿）。 */
  hunks: LineDiffHunk[];
  /** 只应用锚定处 hunk 后的整文，供接受写回——模型 drift 到别处的改动被丢弃。 */
  clampedAfter: string;
  addedLines: number;
  removedLines: number;
  /** 被丢弃的锚定处之外的 hunk 数（>0 时提示作者）。 */
  droppedOffAnchor: number;
  /** true=锚定处没有任何改动（模型只改了别处，或整体无改动）。 */
  isNoop: boolean;
};

/**
 * 把整文件修订「夹」到锚定行：只保留与锚定范围相交的改动，模型跑到别处的改动一律丢弃，
 * 兑现「只改这附近，不整段重写」。返回夹紧后的整文供接受写回，以及供渲染的锚定处 diff。
 */
export function planAnchoredInlineDiff(
  before: string,
  after: string,
  anchor: InlineAnchorRange,
): AnchoredInlineDiff {
  const normBefore = before.replace(/\r\n/g, '\n');
  const normAfter = after.replace(/\r\n/g, '\n');
  const allHunks = hunksToLineDiff(normBefore, normAfter);
  const onAnchor = allHunks.filter((hunk) => lineHunkOverlapsAnchor(hunk, anchor));
  const droppedOffAnchor = allHunks.length - onAnchor.length;

  // 自底向上 splice，保持未处理 hunk 的行号有效。
  const lines = normBefore.split('\n');
  for (const hunk of [...onAnchor].sort((a, b) => b.afterLineNumber - a.afterLineNumber)) {
    if (hunk.removedStartLine !== null && hunk.removedEndLine !== null) {
      lines.splice(
        hunk.removedStartLine - 1,
        hunk.removedEndLine - hunk.removedStartLine + 1,
        ...hunk.newLines,
      );
    } else {
      lines.splice(hunk.afterLineNumber, 0, ...hunk.newLines);
    }
  }

  const addedLines = onAnchor.reduce((total, hunk) => total + hunk.addedLineCount, 0);
  const removedLines = onAnchor.reduce((total, hunk) => total + hunk.removedLineCount, 0);
  return {
    hunks: onAnchor,
    clampedAfter: lines.join('\n'),
    addedLines,
    removedLines,
    droppedOffAnchor,
    isNoop: onAnchor.length === 0,
  };
}

/**
 * 光标处续写的插入计划：不走 LCS 猜插入点——续写的落点是已知的，直接构造纯新增 hunk。
 *
 * 刻意不复用 planAnchoredInlineDiff：那条路会把新段跟上文做 diff，而 buildPatchHunks 会把
 * 段间空行当可匹配单元吃进公共前缀，导致纯新增的 afterLineNumber 落到锚定容忍窗口之外被
 * 当成 drift 静默丢弃——而「光标停在段末空行按键」正是续写最典型的起手式。
 *
 * @param insertAfterLine 1-based：在此行之后插入；0 = 文件顶部。越界自动夹取。
 */
export function planCursorInsertion(
  before: string,
  insertAfterLine: number,
  insertedText: string,
): AnchoredInlineDiff {
  const normBefore = before.replace(/\r\n/g, '\n');
  const lines = normBefore.split('\n');
  const anchor = Math.max(0, Math.min(Math.trunc(insertAfterLine), lines.length));
  const body = insertedText.replace(/\r\n/g, '\n').trim();

  if (!body) {
    return {
      hunks: [],
      clampedAfter: normBefore,
      addedLines: 0,
      removedLines: 0,
      droppedOffAnchor: 0,
      isNoop: true,
    };
  }

  // 续写一律另起段落，锚定行非空时补一个空行分隔：既不改动作者已写下的任何一个字，
  // 也让绿块边界与接受后的落点完全一致。要接着上一句往下写用 Ctrl+K，不走这条路。
  const needsBlankLine = anchor > 0 && (lines[anchor - 1] ?? '').trim() !== '';
  const newLines = needsBlankLine ? ['', ...body.split('\n')] : body.split('\n');
  const nextLines = [...lines];
  nextLines.splice(anchor, 0, ...newLines);

  return {
    hunks: [
      {
        removedStartLine: null,
        removedEndLine: null,
        afterLineNumber: anchor,
        newLines,
        removedLineCount: 0,
        addedLineCount: newLines.length,
      },
    ],
    clampedAfter: nextLines.join('\n'),
    addedLines: newLines.length,
    removedLines: 0,
    droppedOffAnchor: 0,
    isNoop: false,
  };
}

/**
 * 发起修订到接受之间，作者可能又改了文件——此时旧补丁（基于捕获时的 before）不能直接整体写回。
 * 按 LF 归一比较，避免仅换行差异误判。
 */
export function isInlineEditStale(capturedBefore: string, currentContent: string): boolean {
  return capturedBefore.replace(/\r\n/g, '\n') !== currentContent.replace(/\r\n/g, '\n');
}

/**
 * 接受建议时的「落位」时长。改前是硬切换：先 teardown 拆掉红标绿块，再整篇 setValue，
 * 作者眼里改动凭空发生，看不见落在哪一行。现在先播一段旧行褪去 / 绿块落位再写回。
 * 必须与 index.css 里 .sf-inline-diff-zone--settling 的过渡时长一致（有护栏比对两处）。
 */
export const INLINE_SETTLE_MS = 170;

/** 降低动效偏好下不补间——直接落地，别让无障碍设置变成「多等一会儿」。 */
export function inlineSettleDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : INLINE_SETTLE_MS;
}
