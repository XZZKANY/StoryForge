import type { PatchHunk } from './patch-hunks';
import { buildSuggestionOps, locateHunkTarget, matchSuggestionOp } from './suggestion-ops';

/** Exact source content is the revision identity; no lossy hash or current diff is authoritative. */
export type SuggestionChangeSet = Readonly<{
  before: string;
  after: string;
  baseRevision: Readonly<{ content: string }>;
  operations: readonly PatchHunk[];
}>;

export type SuggestionOperationView = Readonly<{
  operations: readonly PatchHunk[];
  conflicts: Readonly<Record<string, string>>;
}>;

export function createSuggestionChangeSet(before: string, after: string): SuggestionChangeSet {
  return Object.freeze({
    before,
    after,
    baseRevision: Object.freeze({ content: before }),
    operations: Object.freeze(buildSuggestionOps(before, after).map((op) => Object.freeze(op))),
  });
}

export function matchChangeSetOperation(
  set: SuggestionChangeSet,
  candidate: PatchHunk,
): PatchHunk | null {
  // Owned immutable objects bind identical-looking operations to their original source spans.
  // Legacy/current diff descriptors still need the conservative unique-content check, not an id guess.
  return set.operations.includes(candidate)
    ? candidate
    : matchSuggestionOp(set.operations, candidate);
}

export function projectRemainingSuggestion(
  current: string,
  set: SuggestionChangeSet,
  accepted: ReadonlySet<string>,
): { after: string; view: SuggestionOperationView; finished: boolean } {
  const operations = Object.freeze(set.operations.filter((op) => !accepted.has(op.id)));
  const conflicts: Record<string, string> = {};
  // 与整份接受同法：先在未改动的当前稿上把剩余各处都定位好，再从后往前套用；
  // 边改边定位时，相邻一处写进去会把下一处的 48 字前文截断。
  const targets: Array<{ op: PatchHunk; start: number; end: number }> = [];
  for (const op of [...operations].sort((a, b) => a.originalStartOffset - b.originalStartOffset)) {
    try {
      const target = locateHunkTarget(current, op, set.before, {
        operations: set.operations,
        appliedOpIds: accepted,
      });
      const previous = targets[targets.length - 1];
      if (target && previous && target.start <= previous.end)
        throw new Error('这个修改块与前一处在当前文件里的位置重叠，无法安全定位。');
      if (target) targets.push({ op, ...target });
    } catch (error) {
      // A failed mapping remains an explicit original operation, not a made-up current→old diff.
      conflicts[op.id] =
        error instanceof Error ? error.message : '原操作无法安全定位，请重新生成修订。';
    }
  }
  let after = current;
  for (const { op, start, end } of targets.reverse())
    after = after.slice(0, start) + op.afterText + after.slice(end);
  return {
    after,
    view: Object.freeze({ operations, conflicts: Object.freeze(conflicts) }),
    finished: operations.length === 0,
  };
}
