import type { PatchHunk } from './patch-hunks';
import { buildSuggestionOps, matchSuggestionOp, planHunkAccept } from './suggestion-ops';

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
  let after = current;
  for (const op of operations) {
    try {
      after = planHunkAccept(after, op, set.before).content;
    } catch (error) {
      // A failed mapping remains an explicit original operation, not a made-up current→old diff.
      conflicts[op.id] =
        error instanceof Error ? error.message : '原操作无法安全定位，请重新生成修订。';
    }
  }
  return {
    after,
    view: Object.freeze({ operations, conflicts: Object.freeze(conflicts) }),
    finished: operations.length === 0,
  };
}
