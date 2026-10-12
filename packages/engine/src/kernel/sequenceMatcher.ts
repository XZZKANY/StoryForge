/**
 * difflib.SequenceMatcher(None, a, b, autojunk=False) 的匹配块与 opcodes。
 * 没有 junk、没有「流行元素」剪枝：最长连续匹配，平局取 a 中最早、再取 b 中最早。
 */
export function matchingBlocks<T>(a: readonly T[], b: readonly T[]): [number, number, number][] {
  const positions = new Map<T, number[]>();
  b.forEach((item, index) => {
    const indices = positions.get(item) ?? [];
    indices.push(index);
    positions.set(item, indices);
  });
  const pending: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  const matches: [number, number, number][] = [];
  while (pending.length > 0) {
    const [aStart, aEnd, bStart, bEnd] = pending.pop()!;
    let bestA = aStart;
    let bestB = bStart;
    let bestSize = 0;
    let lengths = new Map<number, number>();
    for (let i = aStart; i < aEnd; i++) {
      const next = new Map<number, number>();
      for (const j of positions.get(a[i]) ?? []) {
        if (j < bStart) continue;
        if (j >= bEnd) break;
        const size = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, size);
        if (size > bestSize) {
          bestA = i - size + 1;
          bestB = j - size + 1;
          bestSize = size;
        }
      }
      lengths = next;
    }
    if (bestSize > 0) {
      matches.push([bestA, bestB, bestSize]);
      if (aStart < bestA && bStart < bestB) pending.push([aStart, bestA, bStart, bestB]);
      if (bestA + bestSize < aEnd && bestB + bestSize < bEnd)
        pending.push([bestA + bestSize, aEnd, bestB + bestSize, bEnd]);
    }
  }
  return matches.sort(([a1, b1], [a2, b2]) => a1 - a2 || b1 - b2);
}

export type Opcode = ['replace' | 'delete' | 'insert' | 'equal', number, number, number, number];

/** get_opcodes：先把相邻的匹配块合并，再在末尾补一个 (len(a), len(b), 0) 哨兵。 */
export function sequenceOpcodes<T>(a: readonly T[], b: readonly T[]): Opcode[] {
  const coalesced: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of matchingBlocks(a, b)) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else {
      if (k1) coalesced.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) coalesced.push([i1, j1, k1]);
  coalesced.push([a.length, b.length, 0]);
  const opcodes: Opcode[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj, size] of coalesced) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : null;
    if (tag) opcodes.push([tag, i, ai, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size) opcodes.push(['equal', ai, i, bj, j]);
  }
  return opcodes;
}
