export type PatchHunk = {
  id: string;
  originalStartIndex: number;
  originalEndIndex: number;
  modifiedStartIndex: number;
  modifiedEndIndex: number;
  removedLines: number;
  addedLines: number;
  beforeText: string;
  afterText: string;
};

const MAX_DIFF_MATRIX_CELLS = 4_000_000;

function splitLineUnits(text: string): string[] {
  if (!text) return [];
  return (text.match(/[^\n]*(?:\n|$)/g) ?? []).filter((part) => part.length > 0);
}

function createHunk(
  originalUnits: string[],
  modifiedUnits: string[],
  originalStartIndex: number,
  originalEndIndex: number,
  modifiedStartIndex: number,
  modifiedEndIndex: number,
): PatchHunk | null {
  if (originalStartIndex === originalEndIndex && modifiedStartIndex === modifiedEndIndex) {
    return null;
  }
  const removedLines = originalEndIndex - originalStartIndex;
  const addedLines = modifiedEndIndex - modifiedStartIndex;
  return {
    id: [originalStartIndex, originalEndIndex, modifiedStartIndex, modifiedEndIndex].join(':'),
    originalStartIndex,
    originalEndIndex,
    modifiedStartIndex,
    modifiedEndIndex,
    removedLines,
    addedLines,
    beforeText: originalUnits.slice(originalStartIndex, originalEndIndex).join(''),
    afterText: modifiedUnits.slice(modifiedStartIndex, modifiedEndIndex).join(''),
  };
}

function fallbackSingleHunk(
  originalUnits: string[],
  modifiedUnits: string[],
  prefixLength: number,
  suffixLength: number,
): PatchHunk[] {
  const hunk = createHunk(
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
    originalUnits[prefixLength] === modifiedUnits[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength + prefixLength < originalUnits.length &&
    suffixLength + prefixLength < modifiedUnits.length &&
    originalUnits[originalUnits.length - 1 - suffixLength] ===
      modifiedUnits[modifiedUnits.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const originalMiddle = originalUnits.slice(prefixLength, originalUnits.length - suffixLength);
  const modifiedMiddle = modifiedUnits.slice(prefixLength, modifiedUnits.length - suffixLength);
  if (originalMiddle.length === 0 && modifiedMiddle.length === 0) return [];

  if (originalMiddle.length * modifiedMiddle.length > MAX_DIFF_MATRIX_CELLS) {
    return fallbackSingleHunk(originalUnits, modifiedUnits, prefixLength, suffixLength);
  }

  const rows = originalMiddle.length + 1;
  const cols = modifiedMiddle.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let i = originalMiddle.length - 1; i >= 0; i -= 1) {
    for (let j = modifiedMiddle.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        originalMiddle[i] === modifiedMiddle[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let originalCursor = 0;
  let modifiedCursor = 0;
  while (originalCursor < originalMiddle.length && modifiedCursor < modifiedMiddle.length) {
    if (originalMiddle[originalCursor] === modifiedMiddle[modifiedCursor]) {
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

export function applyPatchHunk(before: string, after: string, hunk: PatchHunk): string {
  const originalUnits = splitLineUnits(before);
  const modifiedUnits = splitLineUnits(after);
  return [
    ...originalUnits.slice(0, hunk.originalStartIndex),
    ...modifiedUnits.slice(hunk.modifiedStartIndex, hunk.modifiedEndIndex),
    ...originalUnits.slice(hunk.originalEndIndex),
  ].join('');
}
