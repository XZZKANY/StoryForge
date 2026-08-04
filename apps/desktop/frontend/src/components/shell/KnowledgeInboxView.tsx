import { useMemo, useState } from 'react';

import type {
  ApiKnowledgeProposalGroup,
  ApiKnowledgeProposalItem,
  ApiKnowledgeProposalItemEdit,
} from '../../lib/api/contracts';
import type { KnowledgeInboxHandle } from '../app/useKnowledgeInbox';
import { proposalToEdit } from '../app/useKnowledgeInbox';
import { Check, Eye, Pencil, RefreshCw, X } from '../icons/shell-icons';
import { PanelError } from './PanelError';

type InboxTab = 'pending' | 'conflict' | 'stale' | 'history';

const ACTIVE_STATES = new Set(['pending', 'conflict', 'stale']);

export function KnowledgeInboxView({ handle }: { handle: KnowledgeInboxHandle }) {
  const [tab, setTab] = useState<InboxTab>('pending');
  const [editing, setEditing] = useState<{
    group: ApiKnowledgeProposalGroup;
    proposalId: string;
    draft: ApiKnowledgeProposalItemEdit;
  } | null>(null);
  const rows = useMemo(
    () =>
      handle.inbox.items.flatMap((group) =>
        group.proposals
          .filter((proposal) =>
            tab === 'history' ? !ACTIVE_STATES.has(proposal.state) : proposal.state === tab,
          )
          .map((proposal) => ({ group, proposal })),
      ),
    [handle.inbox.items, tab],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="knowledge-inbox-view">
      <div className="flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border px-2.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">Knowledge Inbox</span>
        <span className="font-mono text-3xs text-subtle" data-testid="knowledge-inbox-count">
          {handle.inbox.pending_count}
        </span>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
          title="刷新 Knowledge Inbox"
          onClick={() => void handle.refresh()}
        >
          <RefreshCw size={13} className={handle.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="grid grid-cols-4 border-b border-border p-1" role="tablist">
        {(['pending', 'conflict', 'stale', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`h-7 rounded-sm text-3xs ${
              tab === value ? 'bg-elevated text-foreground' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setTab(value)}
          >
            {{ pending: '待处理', conflict: '冲突', stale: '待复核', history: '历史' }[value]}
          </button>
        ))}
      </div>
      {handle.error && (
        <PanelError title="Knowledge Inbox 操作失败" detail={handle.error} compact />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && !handle.loading ? (
          <p className="px-3 py-8 text-center text-2xs text-subtle">暂无条目</p>
        ) : (
          rows.map(({ group, proposal }) => {
            const isEditing = editing?.proposalId === proposal.proposal_id;
            return (
              <div
                key={`${group.artifact_id}:${proposal.proposal_id}`}
                className="border-b border-border px-2.5 py-2.5"
                data-testid={`knowledge-proposal-${proposal.proposal_id}`}
              >
                {isEditing && editing ? (
                  <ProposalEditor
                    draft={editing.draft}
                    onChange={(draft) => setEditing({ ...editing, draft })}
                    onCancel={() => setEditing(null)}
                    onSave={() => {
                      void handle
                        .revise(group, proposal.proposal_id, editing.draft)
                        .then(() => setEditing(null));
                    }}
                  />
                ) : (
                  <ProposalSummary proposal={proposal} />
                )}
                {!isEditing && ACTIVE_STATES.has(proposal.state) && (
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      className="flex h-7 items-center gap-1 rounded-sm px-2 text-3xs text-muted hover:bg-elevated hover:text-foreground"
                      onClick={() =>
                        setEditing({
                          group,
                          proposalId: proposal.proposal_id,
                          draft: proposalToEdit(proposal),
                        })
                      }
                    >
                      <Pencil size={11} /> 编辑
                    </button>
                    {proposal.operation === 'conflict' ? (
                      <span className="text-3xs text-warning">先编辑并选择裁决方式</span>
                    ) : (
                      <button
                        type="button"
                        className="flex h-7 items-center gap-1 rounded-sm px-2 text-3xs text-muted hover:bg-elevated hover:text-foreground"
                        disabled={handle.busyProposalId === proposal.proposal_id}
                        onClick={() => void handle.materialize(group, proposal)}
                      >
                        <Eye size={11} /> 审阅
                      </button>
                    )}
                    <button
                      type="button"
                      className="ml-auto flex h-7 items-center gap-1 rounded-sm px-2 text-3xs text-subtle hover:bg-error/10 hover:text-error"
                      disabled={handle.busyProposalId === proposal.proposal_id}
                      onClick={() => void handle.reject(group, proposal)}
                    >
                      <X size={11} /> 拒绝
                    </button>
                  </div>
                )}
                {handle.reviewPatch?.proposal_id === proposal.proposal_id && (
                  <KnowledgePatchReview handle={handle} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ProposalSummary({ proposal }: { proposal: ApiKnowledgeProposalItem }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xs font-medium leading-5 text-foreground">
          {proposal.title}
        </p>
        <span className="rounded-sm border border-border px-1 py-0.5 font-mono text-3xs text-subtle">
          {proposal.state}
        </span>
      </div>
      <p className="mt-1 break-words text-2xs leading-relaxed text-muted">{proposal.claim}</p>
      {(proposal.conflicts?.length ?? 0) > 0 && (
        <div className="mt-2 grid gap-2" data-testid="knowledge-conflict-comparison">
          {(proposal.conflicts ?? []).map((existing) => (
            <div key={existing.knowledge_id} className="border-l-2 border-warning pl-2">
              <p className="text-3xs text-subtle">现有知识 · {existing.relative_path}</p>
              <p className="mt-1 break-words text-2xs leading-relaxed text-foreground">
                {existing.claim}
              </p>
              <p className="mt-1 text-3xs text-subtle">
                来源：{existing.sources.map(sourceLabel).join('、') || '未记录'}
              </p>
            </div>
          ))}
          <div className="border-l-2 border-agent pl-2">
            <p className="text-3xs text-subtle">新提议</p>
            <p className="mt-1 break-words text-2xs leading-relaxed text-foreground">
              {proposal.claim}
            </p>
            <p className="mt-1 text-3xs text-subtle">
              来源：{proposal.sources.map(sourceLabel).join('、') || '未记录'}
            </p>
          </div>
        </div>
      )}
      <p className="mt-1 truncate font-mono text-3xs text-subtle" title={proposal.target_path}>
        {proposal.target_path}
      </p>
    </>
  );
}

function sourceLabel(source: ApiKnowledgeProposalItem['sources'][number]): string {
  if (source.type === 'project_file') return source.path ?? '项目文件';
  if (source.type === 'author_statement') return '作者声明';
  if (source.type === 'external_reference') return source.title ?? source.locator ?? '外部参考';
  return source.type;
}

function ProposalEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ApiKnowledgeProposalItemEdit;
  onChange: (draft: ApiKnowledgeProposalItemEdit) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const firstSource = draft.sources[0];
  return (
    <div className="space-y-2">
      <input
        className="h-8 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-agent"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        aria-label="知识标题"
      />
      <textarea
        className="min-h-20 w-full resize-y rounded-sm border border-border bg-background px-2 py-1.5 text-2xs leading-relaxed outline-none focus:border-agent"
        value={draft.claim}
        onChange={(event) => onChange({ ...draft, claim: event.target.value })}
        aria-label="知识内容"
      />
      <input
        className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-3xs outline-none focus:border-agent"
        value={draft.target_path}
        onChange={(event) => onChange({ ...draft, target_path: event.target.value })}
        aria-label="目标路径"
      />
      <select
        className="h-8 w-full rounded-sm border border-border bg-background px-2 text-2xs outline-none focus:border-agent"
        value={draft.operation}
        onChange={(event) => onChange({ ...draft, operation: event.target.value })}
        aria-label="处理方式"
      >
        <option value="create">新建条目</option>
        <option value="extend">修订原条目</option>
        <option value="supersede">替代原条目</option>
        <option value="dispute">保留双方为争议</option>
        <option value="retire">归档原条目</option>
        <option value="migrate">迁移旧资料</option>
        <option value="conflict">待裁决冲突</option>
      </select>
      {firstSource?.type === 'project_file' && (
        <input
          className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-3xs outline-none focus:border-agent"
          value={firstSource.path ?? ''}
          onChange={(event) =>
            onChange({
              ...draft,
              sources: [{ ...firstSource, path: event.target.value }, ...draft.sources.slice(1)],
            })
          }
          aria-label="来源路径"
        />
      )}
      <div className="flex justify-end gap-1">
        <button type="button" className="h-7 px-2 text-3xs text-muted" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-sm bg-foreground px-2 text-3xs text-background"
          onClick={onSave}
        >
          <Check size={11} /> 保存修改
        </button>
      </div>
    </div>
  );
}

function KnowledgePatchReview({ handle }: { handle: KnowledgeInboxHandle }) {
  const patch = handle.reviewPatch;
  if (!patch) return null;
  return (
    <div className="mt-2 border-t border-border pt-2" data-testid="knowledge-patch-review">
      <div className="grid gap-2">
        <div>
          <p className="mb-1 text-3xs text-subtle">写入前</p>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words bg-background p-2 font-mono text-3xs leading-relaxed text-muted">
            {patch.before || '（新文件）'}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-3xs text-subtle">写入后</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-background p-2 font-mono text-3xs leading-relaxed text-foreground">
            {patch.after}
          </pre>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" className="h-7 px-2 text-3xs text-muted" onClick={handle.clearReview}>
          关闭
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-sm bg-agent px-2 text-3xs text-white"
          disabled={handle.busyProposalId === patch.proposal_id}
          onClick={() => void handle.accept()}
          data-testid="knowledge-confirm-writeback"
        >
          <Check size={11} /> 确认写回
        </button>
      </div>
    </div>
  );
}
