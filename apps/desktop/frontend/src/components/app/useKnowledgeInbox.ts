import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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

type InboxValues = {
  inbox: ApiKnowledgeProposalInbox;
  loading: boolean;
  busyProposalId: string | null;
  reviewPatch: ApiKnowledgeProposalPatch | null;
  error: string;
};
type ProjectScope = { projectRoot: string | null };
type ProjectLifetime = {
  scope: ProjectScope;
  refreshVersion: number;
  reviewVersion: number;
  busyRequest: symbol | null;
};
type InboxUpdate = Partial<InboxValues> | ((current: InboxValues) => Partial<InboxValues>);
const EMPTY_VALUES: InboxValues = {
  inbox: EMPTY_INBOX,
  loading: false,
  busyProposalId: null,
  reviewPatch: null,
  error: '',
};

export function useKnowledgeInbox(projectRoot: string | null) {
  // Scope stamps the rendered projection; only the committed lifetime authorizes callbacks.
  const scope = useMemo<ProjectScope>(() => ({ projectRoot }), [projectRoot]);
  const [stored, setStored] = useState<{ scope: ProjectScope | null; value: InboxValues }>({
    scope: null,
    value: EMPTY_VALUES,
  });
  const lifetimeRef = useRef<ProjectLifetime | null>(null);
  useLayoutEffect(() => {
    lifetimeRef.current = { scope, refreshVersion: 0, reviewVersion: 0, busyRequest: null };
    return () => {
      lifetimeRef.current = null;
    };
  }, [scope]);

  const getLifetime = useCallback(() => {
    const lifetime = lifetimeRef.current;
    return lifetime?.scope === scope ? lifetime : null;
  }, [scope]);
  const isCurrent = useCallback(
    (lifetime: ProjectLifetime) => lifetimeRef.current === lifetime,
    [],
  );
  const commit = useCallback((lifetime: ProjectLifetime, update: InboxUpdate) => {
    if (lifetimeRef.current !== lifetime) return;
    setStored((previous) => {
      const current = previous.scope === lifetime.scope ? previous.value : EMPTY_VALUES;
      return {
        scope: lifetime.scope,
        value: { ...current, ...(typeof update === 'function' ? update(current) : update) },
      };
    });
  }, []);
  const begin = useCallback(
    (proposalId: string) => {
      const lifetime = getLifetime();
      if (!lifetime || !projectRoot) return null;
      const request = Symbol('knowledge-operation');
      lifetime.busyRequest = request;
      commit(lifetime, { busyProposalId: proposalId });
      return { lifetime, request };
    },
    [commit, getLifetime, projectRoot],
  );
  const finish = useCallback(
    (operation: { lifetime: ProjectLifetime; request: symbol }) => {
      if (operation.lifetime.busyRequest !== operation.request) return;
      operation.lifetime.busyRequest = null;
      commit(operation.lifetime, { busyProposalId: null });
    },
    [commit],
  );
  const current = stored.scope === scope ? stored.value : EMPTY_VALUES;
  const { inbox, busyProposalId, reviewPatch, error } = current;
  const loading = stored.scope === scope ? current.loading : Boolean(projectRoot);

  const refresh = useCallback(async () => {
    const lifetime = getLifetime();
    if (!projectRoot || !lifetime) return;
    const version = ++lifetime.refreshVersion;
    commit(lifetime, { loading: true });
    try {
      const next = await refreshKnowledgeProposals(projectRoot);
      if (version === lifetime.refreshVersion) commit(lifetime, { inbox: next, error: '' });
    } catch (cause) {
      if (version === lifetime.refreshVersion) {
        commit(lifetime, { error: cause instanceof Error ? cause.message : String(cause) });
      }
    } finally {
      if (version === lifetime.refreshVersion) commit(lifetime, { loading: false });
    }
  }, [commit, getLifetime, projectRoot]);

  useEffect(() => {
    if (!projectRoot) return;
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
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
      const operation = begin(proposal.proposal_id);
      if (!operation) return;
      const version = ++operation.lifetime.reviewVersion;
      try {
        const patch = await materializeKnowledgeProposal({
          projectRoot,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposalId: proposal.proposal_id,
        });
        if (version === operation.lifetime.reviewVersion) {
          commit(operation.lifetime, { reviewPatch: patch, error: '' });
        }
      } catch (cause) {
        if (version !== operation.lifetime.reviewVersion) return;
        commit(operation.lifetime, {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        finish(operation);
      }
    },
    [begin, commit, finish, projectRoot],
  );

  const revise = useCallback(
    async (
      group: ApiKnowledgeProposalGroup,
      proposalId: string,
      edited: ApiKnowledgeProposalItemEdit,
    ): Promise<boolean> => {
      if (!projectRoot) return false;
      const operation = begin(proposalId);
      if (!operation) return false;
      try {
        const next = await reviseKnowledgeProposalGroup({
          projectRoot,
          artifactId: group.artifact_id,
          revision: group.revision,
          proposals: group.proposals.map((item) =>
            item.proposal_id === proposalId ? edited : proposalToEdit(item),
          ),
        });
        if (!isCurrent(operation.lifetime)) return false;
        // The mutation's full inbox supersedes reads begun before it completed.
        operation.lifetime.refreshVersion += 1;
        commit(operation.lifetime, { inbox: next, loading: false, reviewPatch: null, error: '' });
        return true;
      } catch (cause) {
        commit(operation.lifetime, {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return false;
      } finally {
        finish(operation);
      }
    },
    [begin, commit, finish, isCurrent, projectRoot],
  );

  const reject = useCallback(
    async (group: ApiKnowledgeProposalGroup, proposal: ApiKnowledgeProposalItem) => {
      if (!projectRoot) return;
      const operation = begin(proposal.proposal_id);
      if (!operation) return;
      try {
        const next = await resolveKnowledgeProposal({
          project_root: projectRoot,
          artifact_id: group.artifact_id,
          revision: group.revision,
          proposal_id: proposal.proposal_id,
          resolution: 'rejected',
        });
        operation.lifetime.refreshVersion += 1;
        commit(operation.lifetime, (value) => ({
          inbox: next,
          loading: false,
          reviewPatch:
            value.reviewPatch?.proposal_id === proposal.proposal_id ? null : value.reviewPatch,
          error: '',
        }));
      } catch (cause) {
        commit(operation.lifetime, {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        finish(operation);
      }
    },
    [begin, commit, finish, projectRoot],
  );

  const accept = useCallback(async (): Promise<boolean> => {
    if (!projectRoot || !reviewPatch) return false;
    const operation = begin(reviewPatch.proposal_id);
    if (!operation) return false;
    try {
      const result = await applyKnowledgePatch(projectRoot, reviewPatch);
      if (!isCurrent(operation.lifetime)) return false;
      commit(operation.lifetime, (value) => ({
        reviewPatch: value.reviewPatch === reviewPatch ? null : value.reviewPatch,
      }));
      await refresh();
      if (!isCurrent(operation.lifetime)) return false;
      emitToast(result === 'written' ? '知识已写入项目' : '知识写回状态已恢复', {
        tone: 'success',
      });
      return true;
    } catch (cause) {
      if (!isCurrent(operation.lifetime)) return false;
      const message = cause instanceof Error ? cause.message : String(cause);
      commit(operation.lifetime, { error: message });
      emitToast(message, { tone: 'error' });
      return false;
    } finally {
      finish(operation);
    }
  }, [begin, commit, finish, isCurrent, projectRoot, refresh, reviewPatch]);

  const clearReview = useCallback(() => {
    const lifetime = getLifetime();
    if (!lifetime) return;
    // Closing the preview also supersedes any pending request to display it.
    lifetime.reviewVersion += 1;
    commit(lifetime, { reviewPatch: null });
  }, [commit, getLifetime]);

  return {
    projectRoot,
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
    clearReview,
  };
}

export type KnowledgeInboxHandle = ReturnType<typeof useKnowledgeInbox>;
