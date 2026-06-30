export type PatchUnitKind = 'line' | 'segment';

export type PatchHunk = {
  id: string;
  originalStartIndex: number;
  originalEndIndex: number;
  modifiedStartIndex: number;
  modifiedEndIndex: number;
  originalStartOffset: number;
  originalEndOffset: number;
  modifiedStartOffset: number;
  modifiedEndOffset: number;
  removedLines: number;
  addedLines: number;
  beforeText: string;
  afterText: string;
  unitKind: PatchUnitKind;
  originalPrefixContext: string;
  originalSuffixContext: string;
};

const MAX_DIFF_MATRIX_CELLS = 4_000_000;
const HUNK_CONTEXT_CHARS = 48;
const CJK_SEGMENT_BREAKS = '。！？!?；;，,、：:';
const CJK_TRAILING_CLOSERS = '”’）】》〉」』';

type PatchUnit = {
  text: string;
  startOffset: number;
  endOffset: number;
  lineStartIndex: number;
  lineEndIndex: number;
  kind: PatchUnitKind;
};

function splitLineUnits(text: string): PatchUnit[] {
  if (!text) return [];
  const units: PatchUnit[] = [];
  let offset = 0;
  let lineIndex = 0;

  while (offset < text.length) {
    const newlineIndex = text.indexOf('\n', offset);
    const lineEndOffset = newlineIndex === -1 ? text.length : newlineIndex + 1;
    const lineText = text.slice(offset, lineEndOffset);
    const hasNewline = lineText.endsWith('\n');
    const lineBody = hasNewline ? lineText.slice(0, -1) : lineText;
    const segmentRanges = splitCjkSegmentRanges(lineBody);

    if (segmentRanges.length > 1) {
      for (let index = 0; index < segmentRanges.length; index += 1) {
        const [segmentStart, segmentEnd] = segmentRanges[index];
        const isLastSegment = index === segmentRanges.length - 1;
        units.push({
          text:
            lineBody.slice(segmentStart, segmentEnd) + (isLastSegment && hasNewline ? '\n' : ''),
          startOffset: offset + segmentStart,
          endOffset: offset + segmentEnd + (isLastSegment && hasNewline ? 1 : 0),
          lineStartIndex: lineIndex,
          lineEndIndex: lineIndex + 1,
          kind: 'segment',
        });
      }
    } else {
      units.push({
        text: lineText,
        startOffset: offset,
        endOffset: lineEndOffset,
        lineStartIndex: lineIndex,
        lineEndIndex: lineIndex + 1,
        kind: 'line',
      });
    }

    offset = lineEndOffset;
    lineIndex += 1;
  }

  return units;
}

function splitCjkSegmentRanges(lineBody: string): Array<[number, number]> {
  if (!/[\u3400-\u9fff]/.test(lineBody)) return [[0, lineBody.length]];
  const ranges: Array<[number, number]> = [];
  let segmentStart = 0;

  for (let index = 0; index < lineBody.length; index += 1) {
    if (!CJK_SEGMENT_BREAKS.includes(lineBody[index])) continue;
    let segmentEnd = index + 1;
    while (segmentEnd < lineBody.length && CJK_TRAILING_CLOSERS.includes(lineBody[segmentEnd])) {
      segmentEnd += 1;
    }
    while (segmentEnd < lineBody.length && /[ \t]/.test(lineBody[segmentEnd])) {
      segmentEnd += 1;
    }
    if (segmentEnd > segmentStart) ranges.push([segmentStart, segmentEnd]);
    segmentStart = segmentEnd;
    index = segmentEnd - 1;
  }

  if (segmentStart < lineBody.length) ranges.push([segmentStart, lineBody.length]);
  return ranges.length > 0 ? ranges : [[0, lineBody.length]];
}

function offsetForBoundary(units: PatchUnit[], index: number, textLength: number): number {
  if (index <= 0) return units[0]?.startOffset ?? 0;
  if (index >= units.length) return textLength;
  return units[index].startOffset;
}

function lineIndexForBoundary(units: PatchUnit[], index: number): number {
  if (index < units.length) return units[index].lineStartIndex;
  return units[index - 1]?.lineEndIndex ?? 0;
}

function endLineIndexForRange(units: PatchUnit[], startIndex: number, endIndex: number): number {
  if (startIndex === endIndex) return lineIndexForBoundary(units, startIndex);
  return units[endIndex - 1]?.lineEndIndex ?? lineIndexForBoundary(units, startIndex);
}

function touchedLineCount(units: PatchUnit[], startIndex: number, endIndex: number): number {
  if (startIndex === endIndex) return 0;
  const startLine = units[startIndex]?.lineStartIndex ?? lineIndexForBoundary(units, startIndex);
  const endLine = units[endIndex - 1]?.lineEndIndex ?? startLine;
  return Math.max(1, endLine - startLine);
}

function rangeUnitKind(
  originalUnits: PatchUnit[],
  modifiedUnits: PatchUnit[],
  originalStartIndex: number,
  originalEndIndex: number,
  modifiedStartIndex: number,
  modifiedEndIndex: number,
): PatchUnitKind {
  const changedUnits = [
    ...originalUnits.slice(originalStartIndex, originalEndIndex),
    ...modifiedUnits.slice(modifiedStartIndex, modifiedEndIndex),
  ];
  return changedUnits.some((unit) => unit.kind === 'segment') ? 'segment' : 'line';
}

function createHunk(
  originalText: string,
  modifiedText: string,
  originalUnits: PatchUnit[],
  modifiedUnits: PatchUnit[],
  originalStartIndex: number,
  originalEndIndex: number,
  modifiedStartIndex: number,
  modifiedEndIndex: number,
): PatchHunk | null {
  if (originalStartIndex === originalEndIndex && modifiedStartIndex === modifiedEndIndex) {
    return null;
  }
  const originalStartOffset = offsetForBoundary(
    originalUnits,
    originalStartIndex,
    originalText.length,
  );
  const originalEndOffset = offsetForBoundary(originalUnits, originalEndIndex, originalText.length);
  const modifiedStartOffset = offsetForBoundary(
    modifiedUnits,
    modifiedStartIndex,
    modifiedText.length,
  );
  const modifiedEndOffset = offsetForBoundary(modifiedUnits, modifiedEndIndex, modifiedText.length);
  const beforeText = originalText.slice(originalStartOffset, originalEndOffset);
  const afterText = modifiedText.slice(modifiedStartOffset, modifiedEndOffset);
  const unitKind = rangeUnitKind(
    originalUnits,
    modifiedUnits,
    originalStartIndex,
    originalEndIndex,
    modifiedStartIndex,
    modifiedEndIndex,
  );
  return {
    id: [
      originalStartOffset,
      originalEndOffset,
      modifiedStartOffset,
      modifiedEndOffset,
      unitKind,
    ].join(':'),
    originalStartIndex: lineIndexForBoundary(originalUnits, originalStartIndex),
    originalEndIndex: endLineIndexForRange(originalUnits, originalStartIndex, originalEndIndex),
    modifiedStartIndex: lineIndexForBoundary(modifiedUnits, modifiedStartIndex),
    modifiedEndIndex: endLineIndexForRange(modifiedUnits, modifiedStartIndex, modifiedEndIndex),
    originalStartOffset,
    originalEndOffset,
    modifiedStartOffset,
    modifiedEndOffset,
    removedLines: touchedLineCount(originalUnits, originalStartIndex, originalEndIndex),
    addedLines: touchedLineCount(modifiedUnits, modifiedStartIndex, modifiedEndIndex),
    beforeText,
    afterText,
    unitKind,
    originalPrefixContext: originalText.slice(
      Math.max(0, originalStartOffset - HUNK_CONTEXT_CHARS),
      originalStartOffset,
    ),
    originalSuffixContext: originalText.slice(
      originalEndOffset,
      Math.min(originalText.length, originalEndOffset + HUNK_CONTEXT_CHARS),
    ),
  };
}

function fallbackSingleHunk(
  originalText: string,
  modifiedText: string,
  originalUnits: PatchUnit[],
  modifiedUnits: PatchUnit[],
  prefixLength: number,
  suffixLength: number,
): PatchHunk[] {
  const hunk = createHunk(
    originalText,
    modifiedText,
    originalUnits,
    modifiedUnits,
    prefixLength,
    originalUnits.length - suffixLength,
    prefixLength,
    modifiedUnits.length - suffixLength,
  );
  return hunk ? [hunk] : [];
}

type DiffOp = 'equal' | 'delete' | 'insert';

export function buildPatchHunks(before: string, after: string): PatchHunk[] {
  const originalUnits = splitLineUnits(before);
  const modifiedUnits = splitLineUnits(after);

  let prefixLength = 0;
  while (
    prefixLength < originalUnits.length &&
    prefixLength < modifiedUnits.length &&
    originalUnits[prefixLength].text === modifiedUnits[prefixLength].text
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength + prefixLength < originalUnits.length &&
    suffixLength + prefixLength < modifiedUnits.length &&
    originalUnits[originalUnits.length - 1 - suffixLength].text ===
      modifiedUnits[modifiedUnits.length - 1 - suffixLength].text
  ) {
    suffixLength += 1;
  }

  const originalMiddle = originalUnits.slice(prefixLength, originalUnits.length - suffixLength);
  const modifiedMiddle = modifiedUnits.slice(prefixLength, modifiedUnits.length - suffixLength);
  if (originalMiddle.length === 0 && modifiedMiddle.length === 0) return [];

  if (originalMiddle.length * modifiedMiddle.length > MAX_DIFF_MATRIX_CELLS) {
    return fallbackSingleHunk(
      before,
      after,
      originalUnits,
      modifiedUnits,
      prefixLength,
      suffixLength,
    );
  }

  const rows = originalMiddle.length + 1;
  const cols = modifiedMiddle.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let i = originalMiddle.length - 1; i >= 0; i -= 1) {
    for (let j = modifiedMiddle.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        originalMiddle[i].text === modifiedMiddle[j].text
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let originalCursor = 0;
  let modifiedCursor = 0;
  while (originalCursor < originalMiddle.length && modifiedCursor < modifiedMiddle.length) {
    if (originalMiddle[originalCursor].text === modifiedMiddle[modifiedCursor].text) {
      ops.push('equal');
      originalCursor += 1;
      modifiedCursor += 1;
    } else if (lcs[originalCursor + 1][modifiedCursor] >= lcs[originalCursor][modifiedCursor + 1]) {
      ops.push('delete');
      originalCursor += 1;
    } else {
      ops.push('insert');
      modifiedCursor += 1;
    }
  }
  while (originalCursor < originalMiddle.length) {
    ops.push('delete');
    originalCursor += 1;
  }
  while (modifiedCursor < modifiedMiddle.length) {
    ops.push('insert');
    modifiedCursor += 1;
  }

  const hunks: PatchHunk[] = [];
  let absoluteOriginal = prefixLength;
  let absoluteModified = prefixLength;
  let active: {
    originalStartIndex: number;
    modifiedStartIndex: number;
  } | null = null;

  const finishActiveHunk = () => {
    if (!active) return;
    const hunk = createHunk(
      before,
      after,
      originalUnits,
      modifiedUnits,
      active.originalStartIndex,
      absoluteOriginal,
      active.modifiedStartIndex,
      absoluteModified,
    );
    if (hunk) hunks.push(hunk);
    active = null;
  };

  for (const op of ops) {
    if (op === 'equal') {
      finishActiveHunk();
      absoluteOriginal += 1;
      absoluteModified += 1;
      continue;
    }
    active ??= {
      originalStartIndex: absoluteOriginal,
      modifiedStartIndex: absoluteModified,
    };
    if (op === 'delete') {
      absoluteOriginal += 1;
    } else {
      absoluteModified += 1;
    }
  }
  finishActiveHunk();

  return hunks;
}

type ApplyRange = {
  startOffset: number;
  endOffset: number;
};

function rangeContextMatchScore(
  currentContent: string,
  startOffset: number,
  endOffset: number,
  hunk: PatchHunk,
): number {
  const prefix = hunk.originalPrefixContext;
  const suffix = hunk.originalSuffixContext;
  let score = 0;
  if (
    prefix &&
    currentContent.slice(Math.max(0, startOffset - prefix.length), startOffset) === prefix
  ) {
    score += 1;
  }
  if (suffix && currentContent.slice(endOffset, endOffset + suffix.length) !== suffix) {
    return score;
  }
  return suffix ? score + 1 : score;
}

function rangeContextMatches(
  currentContent: string,
  startOffset: number,
  endOffset: number,
  hunk: PatchHunk,
): boolean {
  const expected = (hunk.originalPrefixContext ? 1 : 0) + (hunk.originalSuffixContext ? 1 : 0);
  if (expected === 0) return true;
  return rangeContextMatchScore(currentContent, startOffset, endOffset, hunk) === expected;
}

function findTextRanges(currentContent: string, hunk: PatchHunk): ApplyRange[] {
  const allRanges: ApplyRange[] = [];
  const scoredRanges: Array<ApplyRange & { score: number }> = [];
  let index = currentContent.indexOf(hunk.beforeText);

  while (index !== -1) {
    const range = { startOffset: index, endOffset: index + hunk.beforeText.length };
    allRanges.push(range);
    scoredRanges.push({
      ...range,
      score: rangeContextMatchScore(currentContent, range.startOffset, range.endOffset, hunk),
    });
    index = currentContent.indexOf(hunk.beforeText, index + Math.max(1, hunk.beforeText.length));
  }

  const bestScore = Math.max(0, ...scoredRanges.map((range) => range.score));
  return bestScore > 0
    ? scoredRanges
        .filter((range) => range.score === bestScore)
        .map(({ startOffset, endOffset }) => ({ startOffset, endOffset }))
    : allRanges;
}

function findInsertionRanges(currentContent: string, hunk: PatchHunk): ApplyRange[] {
  const prefix = hunk.originalPrefixContext;
  const suffix = hunk.originalSuffixContext;
  const candidates = new Map<string, ApplyRange & { score: number }>();

  const addCandidate = (offset: number) => {
    const boundedOffset = Math.max(0, Math.min(offset, currentContent.length));
    const range = { startOffset: boundedOffset, endOffset: boundedOffset };
    const score = rangeContextMatchScore(currentContent, boundedOffset, boundedOffset, hunk);
    if (score === 0) return;
    candidates.set(`${boundedOffset}:${boundedOffset}`, { ...range, score });
  };

  if (!prefix && !suffix) {
    const offset = Math.min(hunk.originalStartOffset, currentContent.length);
    return [{ startOffset: offset, endOffset: offset }];
  }

  if (prefix) {
    let index = currentContent.indexOf(prefix);
    while (index !== -1) {
      addCandidate(index + prefix.length);
      index = currentContent.indexOf(prefix, index + 1);
    }
  }

  if (suffix) {
    let index = currentContent.indexOf(suffix);
    while (index !== -1) {
      addCandidate(index);
      index = currentContent.indexOf(suffix, index + 1);
    }
  }

  const ranges = [...candidates.values()];
  const bestScore = Math.max(0, ...ranges.map((range) => range.score));
  return ranges
    .filter((range) => range.score === bestScore)
    .map(({ startOffset, endOffset }) => ({ startOffset, endOffset }));
}

function findApplyRange(currentContent: string, hunk: PatchHunk): ApplyRange {
  const originalStart = hunk.originalStartOffset;
  const originalEnd = hunk.originalEndOffset;
  if (
    originalStart <= currentContent.length &&
    originalEnd <= currentContent.length &&
    currentContent.slice(originalStart, originalEnd) === hunk.beforeText &&
    (hunk.beforeText.length > 0 ||
      rangeContextMatches(currentContent, originalStart, originalEnd, hunk))
  ) {
    return { startOffset: originalStart, endOffset: originalEnd };
  }

  const ranges =
    hunk.beforeText.length > 0
      ? findTextRanges(currentContent, hunk)
      : findInsertionRanges(currentContent, hunk);
  if (ranges.length === 1) return ranges[0];
  if (ranges.length > 1) {
    throw new Error('该修改块的原文在当前文件中出现多次，无法安全定位。');
  }
  throw new Error('该修改块的原文已变化，请重新生成修订或手动处理冲突。');
}

export function applyPatchHunk(before: string, after: string, hunk: PatchHunk): string {
  void after;
  return applyPatchHunkToCurrent(before, hunk);
}

export function applyPatchHunkToCurrent(currentContent: string, hunk: PatchHunk): string {
  const range = findApplyRange(currentContent, hunk);
  return [
    currentContent.slice(0, range.startOffset),
    hunk.afterText,
    currentContent.slice(range.endOffset),
  ].join('');
}
