import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  ApiKnowledgeProposalGroup,
  ApiKnowledgeProposalInbox,
  ApiKnowledgeProposalItem,
  ApiKnowledgeProposalItemEdit,
  ApiKnowledgeProposalPatch,
} from '../../lib/api/contracts';
import {
  materializeKnowledgeProposal,
  refreshKnowledgeProposals,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
} from '../../lib/api/knowledge-proposals';
import { applyKnowledgePatch } from '../../lib/project/knowledge-writeback';
import { emitToast } from '../../lib/toast';

const EMPTY_INBOX: ApiKnowledgeProposalInbox = { items: [], pending_count: 0 };

export function proposalToEdit(item: ApiKnowledgeProposalItem): ApiKnowledgeProposalItemEdit {
  return {
    target_path: item.target_path,
    operation: item.state === 'stale' ? 'extend' : item.operation,
    title: item.title,
    claim: item.claim,
    kind: item.kind,
    confidence: item.confidence,
    related_knowledge_ids:
      item.state === 'stale' && item.related_knowledge_ids.length === 0
        ? [item.knowledge_id]
        : item.related_knowledge_ids,
    reason: item.reason,
    sources: item.sources.map((source) => ({
      type: source.type,
      path: source.path,
      locator: source.locator,
      title: source.title,
      summary_sha256: source.summary_sha256,
    })),
  };
}

/** 发起时记下当时那一代作品；回来时还是同一代（且就是发起时那本）才动界面。 */
function claimLive(liveRoot: { current: { root: string | null } }, root: string) {
  const owner = liveRoot.current;
  return () => liveRoot.current === owner && owner.root === root;
}

export function useKnowledgeInbox(projectRoot: string | null) {
  const [inbox, setInbox] = useState<ApiKnowledgeProposalInbox>(EMPTY_INBOX);
  const [loading, setLoading] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [reviewPatch, setReviewPatch] = useState<ApiKnowledgeProposalPatch | null>(null);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  // 修改 / 拒绝 / 生成补丁 / 接受都要等引擎：回来时作者可能已换了作品，结果不能写到新作品的收件箱上。
  // 每换一次作品记一代：切走再切回同一本（A→B→A）时根路径又相等了，旧请求的结果仍不算数。
  const liveRoot = useRef({ root: projectRoot });
  useLayoutEffect(() => {
    liveRoot.current = { root: projectRoot };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换作品时清掉上一本留下的审阅与处理中标记
    setReviewPatch(null);
    setBusyProposalId(null);
  }, [projectRoot]);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!projectRoot) {
      setInbox(EMPTY_INBOX);
      setReviewPatch(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await refreshKnowledgeProposals(projectRoot);
      if (version === requestVersion.current) {
        setInbox(next);
        setError('');
      }
    } catch (cause) {
      if (version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [projectRoot]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    if (!projectRoot) return () => window.clearTimeout(initialRefresh);
    const timer = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [projectRoot, refresh]);

  const materialize = useCallback(
    async (group: ApiKnowledgeProposalGroup, proposal: ApiKnowledgeProposalItem) => {
      if (!projectRoot) return;
      const root = projectRoot;
      const live = claimLive(liveRoot, root);
      setBusyProposalId(proposal.proposal_id);
      try {
        const patch = await materializeKnowledgeProposal({
          projectRoot: root,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposalId: proposal.proposal_id,
        });
        if (!live()) return;
        setReviewPatch(patch);
        setError('');
      } catch (cause) {
        if (live()) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (live()) setBusyProposalId(null);
      }
    },
    [projectRoot],
  );

  const revise = useCallback(
    async (
      group: ApiKnowledgeProposalGroup,
      proposalId: string,
      edited: ApiKnowledgeProposalItemEdit,
    ): Promise<boolean> => {
      if (!projectRoot) return false;
      const root = projectRoot;
      const live = claimLive(liveRoot, root);
      setBusyProposalId(proposalId);
      try {
        const next = await reviseKnowledgeProposalGroup({
          projectRoot: root,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposals: group.proposals.map((item) =>
            item.proposal_id === proposalId ? edited : proposalToEdit(item),
          ),
        });
        if (!live()) return true;
        setInbox(next);
        setReviewPatch(null);
        setError('');
        return true;
      } catch (cause) {
        if (live()) setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        if (live()) setBusyProposalId(null);
      }
    },
    [projectRoot],
  );

  const reject = useCallback(
    async (group: ApiKnowledgeProposalGroup, proposal: ApiKnowledgeProposalItem) => {
      if (!projectRoot) return;
      const root = projectRoot;
      const live = claimLive(liveRoot, root);
      setBusyProposalId(proposal.proposal_id);
      try {
        const next = await resolveKnowledgeProposal({
          project_root: root,
          artifact_id: group.artifact_id,
          revision: group.revision,
          proposal_id: proposal.proposal_id,
          resolution: 'rejected',
        });
        if (!live()) return;
        setInbox(next);
        if (reviewPatch?.proposal_id === proposal.proposal_id) setReviewPatch(null);
        setError('');
      } catch (cause) {
        if (live()) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (live()) setBusyProposalId(null);
      }
    },
    [projectRoot, reviewPatch],
  );

  const accept = useCallback(async () => {
    if (!projectRoot || !reviewPatch) return;
    const root = projectRoot;
    const live = claimLive(liveRoot, root);
    setBusyProposalId(reviewPatch.proposal_id);
    try {
      const result = await applyKnowledgePatch(root, reviewPatch);
      if (live()) {
        setReviewPatch(null);
        await refresh();
      }
      emitToast(result === 'written' ? '知识已写入项目' : '知识写回状态已恢复', {
        tone: 'success',
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (live()) setError(message);
      emitToast(message, { tone: 'error' });
    } finally {
      if (live()) setBusyProposalId(null);
    }
  }, [projectRoot, refresh, reviewPatch]);

  return {
    inbox,
    loading,
    busyProposalId,
    reviewPatch,
    error,
    refresh,
    materialize,
    revise,
    reject,
    accept,
    clearReview: () => setReviewPatch(null),
  };
}

export type KnowledgeInboxHandle = ReturnType<typeof useKnowledgeInbox>;
