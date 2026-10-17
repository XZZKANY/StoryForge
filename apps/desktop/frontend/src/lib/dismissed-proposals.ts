/**
 * 观测镜里作者点了「不要」的 canon 提案。只是不再摆出来，不碰 canon.json；
 * 按作品记在本机，下次 AI 提同一条也不会再冒出来。
 */

import type { CanonMergeTarget } from './canon-merge';
import type { ObservatoryProposals } from './observations';

const PREFIX = 'storyforge:dismissed-canon-proposals:';
/** 撤销可能在换过作品、观测镜重挂之后才点：改了就广播，当前那份观测镜自己去重读。 */
export const DISMISSED_PROPOSALS_EVENT = 'storyforge:dismissed-canon-proposals';

export function proposalKey(target: CanonMergeTarget): string {
  return target.kind === 'entity'
    ? JSON.stringify(['entity', target.entity])
    : JSON.stringify(['claim', target.invariant, target.entry]);
}

export function loadDismissedProposals(project: string | null): Set<string> {
  if (!project) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(`${PREFIX}${project}`) ?? 'null') as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((key): key is string => typeof key === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveDismissedProposals(project: string, keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(`${PREFIX}${project}`, JSON.stringify([...keys].slice(-500)));
  } catch {
    // 存不下就只在这次打开期间隐藏。
  }
  window.dispatchEvent(new CustomEvent(DISMISSED_PROPOSALS_EVENT, { detail: { project } }));
}

export function withoutDismissed(
  proposals: ObservatoryProposals,
  dismissed: ReadonlySet<string>,
): ObservatoryProposals {
  if (dismissed.size === 0) return proposals;
  const newEntities = proposals.newEntities.filter(
    (entity) => !dismissed.has(proposalKey({ kind: 'entity', entity: entity.raw })),
  );
  const newClaims = proposals.newClaims.filter(
    (claim) =>
      !dismissed.has(
        proposalKey({ kind: 'claim', invariant: claim.invariant, entry: claim.entry }),
      ),
  );
  return {
    ...proposals,
    newEntities,
    newClaims,
    pendingCount: newEntities.length + newClaims.length,
  };
}
