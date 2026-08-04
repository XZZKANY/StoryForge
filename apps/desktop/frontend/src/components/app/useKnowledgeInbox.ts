import { useCallback, useEffect, useRef, useState } from 'react';

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

export function useKnowledgeInbox(projectRoot: string | null) {
  const [inbox, setInbox] = useState<ApiKnowledgeProposalInbox>(EMPTY_INBOX);
  const [loading, setLoading] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [reviewPatch, setReviewPatch] = useState<ApiKnowledgeProposalPatch | null>(null);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

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
      setBusyProposalId(proposal.proposal_id);
      try {
        const patch = await materializeKnowledgeProposal({
          projectRoot,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposalId: proposal.proposal_id,
        });
        setReviewPatch(patch);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyProposalId(null);
      }
    },
    [projectRoot],
  );

  const revise = useCallback(
    async (
      group: ApiKnowledgeProposalGroup,
      proposalId: string,
      edited: ApiKnowledgeProposalItemEdit,
    ) => {
      if (!projectRoot) return;
      setBusyProposalId(proposalId);
      try {
        const next = await reviseKnowledgeProposalGroup({
          projectRoot,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposals: group.proposals.map((item) =>
            item.proposal_id === proposalId ? edited : proposalToEdit(item),
          ),
        });
        setInbox(next);
        setReviewPatch(null);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyProposalId(null);
      }
    },
    [projectRoot],
  );

  const reject = useCallback(
    async (group: ApiKnowledgeProposalGroup, proposal: ApiKnowledgeProposalItem) => {
      if (!projectRoot) return;
      setBusyProposalId(proposal.proposal_id);
      try {
        const next = await resolveKnowledgeProposal({
          project_root: projectRoot,
          artifact_id: group.artifact_id,
          revision: group.revision,
          proposal_id: proposal.proposal_id,
          resolution: 'rejected',
        });
        setInbox(next);
        if (reviewPatch?.proposal_id === proposal.proposal_id) setReviewPatch(null);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyProposalId(null);
      }
    },
    [projectRoot, reviewPatch],
  );

  const accept = useCallback(async () => {
    if (!projectRoot || !reviewPatch) return;
    setBusyProposalId(reviewPatch.proposal_id);
    try {
      const result = await applyKnowledgePatch(projectRoot, reviewPatch);
      setReviewPatch(null);
      await refresh();
      emitToast(result === 'written' ? '知识已写入项目' : '知识写回状态已恢复', {
        tone: 'success',
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      emitToast(message, { tone: 'error' });
    } finally {
      setBusyProposalId(null);
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
