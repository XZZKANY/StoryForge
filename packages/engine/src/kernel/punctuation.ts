/** Dialogue forms shared by prose scans and polishing; use matchAll/replace, not exec state. */
export const DIALOGUE_PATTERN = /“[^“”]*”|「[^「」]*」|『[^『』]*』|"[^"\n]*"/gsu;

const FOLDS: Readonly<Record<string, string>> = {
  '“': '"',
  '”': '"',
  '「': '"',
  '」': '"',
  '『': '"',
  '』': '"',
  '„': '"',
  '‟': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '…': '.',
  '\u00a0': ' ',
  '\u3000': ' ',
  '\u2007': ' ',
  '\u202f': ' ',
};

/** Comparison only: never write this normalized text back to the manuscript. */
export function canonicalPunctuation(text: string): string {
  return Array.from(text, (character) => FOLDS[character] ?? character)
    .join('')
    .replace(/([.\- ])\1+/g, '$1');
}

// SequenceMatcher(None, before, after, autojunk=False): longest contiguous match,
// ties prefer earliest before position, then earliest after position. No junk pruning.
function matchingLines(
  before: readonly string[],
  after: readonly string[],
): [number, number, number][] {
  const positions = new Map<string, number[]>();
  after.forEach((line, index) => {
    const indices = positions.get(line) ?? [];
    indices.push(index);
    positions.set(line, indices);
  });
  const pending: [number, number, number, number][] = [[0, before.length, 0, after.length]];
  const matches: [number, number, number][] = [];
  while (pending.length > 0) {
    const [beforeStart, beforeEnd, afterStart, afterEnd] = pending.pop()!;
    let bestBefore = beforeStart;
    let bestAfter = afterStart;
    let bestSize = 0;
    let lengths = new Map<number, number>();
    for (let i = beforeStart; i < beforeEnd; i++) {
      const next = new Map<number, number>();
      for (const j of positions.get(before[i]) ?? []) {
        if (j < afterStart) continue;
        if (j >= afterEnd) break;
        const size = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, size);
        if (size > bestSize) {
          bestBefore = i - size + 1;
          bestAfter = j - size + 1;
          bestSize = size;
        }
      }
      lengths = next;
    }
    if (bestSize > 0) {
      matches.push([bestBefore, bestAfter, bestSize]);
      if (beforeStart < bestBefore && afterStart < bestAfter)
        pending.push([beforeStart, bestBefore, afterStart, bestAfter]);
      if (bestBefore + bestSize < beforeEnd && bestAfter + bestSize < afterEnd)
        pending.push([bestBefore + bestSize, beforeEnd, bestAfter + bestSize, afterEnd]);
    }
  }
  // Adjacent equal blocks need no coalescing when reconstructing lines, unlike opcodes.
  return matches.sort(([a, b], [c, d]) => a - c || b - d);
}

function punctuationUnits(text: string): [string, string][] {
  const units: [string, string][] = [];
  for (const character of text) {
    const canonical = FOLDS[character] ?? character;
    const last = units[units.length - 1];
    if ('.- '.includes(canonical) && last?.[0] === canonical) last[1] += character;
    else units.push([canonical, character]);
  }
  return units;
}

/** Restore only canonically equal lines; a wholly punctuation-only edit remains intentional. */
export function restoreIncidentalPunctuation(
  before: string,
  after: string,
  editPolicy: { readonly allowed_punctuation_forms: ReadonlySet<string> } | null = null,
): string {
  if (before === after) return after;
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const original = beforeLines.map(canonicalPunctuation);
  const candidate = afterLines.map(canonicalPunctuation);
  if (original.length === candidate.length && original.every((line, i) => line === candidate[i]))
    return after;
  const restored: string[] = [];
  let position = 0;
  for (const [i, j, size] of matchingLines(original, candidate)) {
    for (; position < j; position++) restored.push(afterLines[position]);
    for (let offset = 0; offset < size; offset++) {
      const old = beforeLines[i + offset];
      const next = afterLines[j + offset];
      if (!editPolicy?.allowed_punctuation_forms.has('quotes')) restored.push(old);
      else {
        const newUnits = punctuationUnits(next);
        restored.push(
          punctuationUnits(old)
            .map(([canonical, raw], index) =>
              canonical === '"' || canonical === "'" ? newUnits[index][1] : raw,
            )
            .join(''),
        );
      }
    }
    position = j + size;
  }
  for (; position < afterLines.length; position++) restored.push(afterLines[position]);
  return restored.join('\n');
}
