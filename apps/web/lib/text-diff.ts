export type DiffSegmentType = 'equal' | 'add' | 'del';

export type DiffSegment = {
  readonly type: DiffSegmentType;
  readonly text: string;
};

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(/(?<=\n)/);
}

function computeLcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  return table;
}

function backtrackSegments(
  table: readonly (readonly number[])[],
  a: readonly string[],
  b: readonly string[],
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      segments.push({ type: 'equal', text: a[i - 1] });
      i -= 1;
      j -= 1;
      continue;
    }
    if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      segments.push({ type: 'add', text: b[j - 1] });
      j -= 1;
      continue;
    }
    segments.push({ type: 'del', text: a[i - 1] });
    i -= 1;
  }
  segments.reverse();
  return mergeConsecutiveSegments(segments);
}

function mergeConsecutiveSegments(segments: readonly DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) {
      merged[merged.length - 1] = { type: last.type, text: last.text + segment.text };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

export function diffLines(original: string, revised: string): DiffSegment[] {
  if (original === revised) {
    return original.length === 0 ? [] : [{ type: 'equal', text: original }];
  }
  const originalLines = splitLines(original);
  const revisedLines = splitLines(revised);
  const table = computeLcsTable(originalLines, revisedLines);
  return backtrackSegments(table, originalLines, revisedLines);
}

export type DiffStats = {
  readonly additions: number;
  readonly deletions: number;
  readonly unchanged: number;
};

export function summarizeDiff(segments: readonly DiffSegment[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;
  for (const segment of segments) {
    const lineCount = countLines(segment.text);
    if (segment.type === 'add') {
      additions += lineCount;
    } else if (segment.type === 'del') {
      deletions += lineCount;
    } else {
      unchanged += lineCount;
    }
  }
  return { additions, deletions, unchanged };
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (trimmed.length === 0) {
    return 1;
  }
  return trimmed.split('\n').length;
}
