import { useMemo, useState } from 'react';

import type {
  ApiKnowledgeProposalGroup,
  ApiKnowledgeProposalItem,
  ApiKnowledgeProposalItemEdit,
} from '../../lib/api/contracts';
import type { KnowledgeInboxHandle } from '../app/useKnowledgeInbox';
import { proposalToEdit } from '../app/useKnowledgeInbox';
import { AppDialogHost, useAppDialog } from '../app/AppDialog';
import { Check, Eye, Inbox, Pencil, RefreshCw, X } from '../icons/shell-icons';
import { IconButton } from '../ui';
import { LiveStatus } from './LiveStatus';
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
  // 拒绝提案是终态操作（离开待处理列表、无撤销）：与全仓破坏性操作同口径，先经 AppDialog 确认。
  const confirmDialog = useAppDialog();
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
      {/* 相位级播报：刷新中 / 载入错误 / 待处理数变化 */}
      <LiveStatus
        text={
          handle.loading
            ? '正在刷新 Knowledge Inbox…'
            : `${handle.inbox.pending_count} 条待处理知识提案。`
        }
        testid="knowledge-inbox-live"
      />
      <div className="flex h-shell-row flex-shrink-0 items-center gap-2 px-2.5">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">Knowledge Inbox</h2>
        <span className="font-mono text-3xs text-subtle" data-testid="knowledge-inbox-count">
          {handle.inbox.pending_count}
        </span>
        <IconButton
          size="xs"
          label="刷新 Knowledge Inbox"
          icon={<RefreshCw size={13} className={handle.loading ? 'animate-spin' : ''} />}
          disabled={handle.loading}
          onClick={() => void handle.refresh()}
          data-testid="knowledge-inbox-refresh"
        />
      </div>
      <div
        className="grid grid-cols-4 gap-1 p-1"
        role="tablist"
        aria-label="Knowledge Inbox 分类"
        onKeyDown={(event) => {
          if (
            event.key !== 'ArrowLeft' &&
            event.key !== 'ArrowRight' &&
            event.key !== 'Home' &&
            event.key !== 'End'
          ) {
            return;
          }
          const tabEls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
          );
          const idx = tabEls.indexOf(document.activeElement as HTMLElement);
          if (idx === -1) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabEls.length - 1
                : event.key === 'ArrowRight'
                  ? (idx + 1) % tabEls.length
                  : (idx - 1 + tabEls.length) % tabEls.length;
          tabEls[next]?.focus();
          tabEls[next]?.click(); // roving：移动焦点同时激活该页签（自动激活模式）
        }}
      >
        {(['pending', 'conflict', 'stale', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rows.length === 0 && !handle.loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
              <Inbox size={20} strokeWidth={1.4} className="text-subtle" aria-hidden="true" />
            </div>
            <p className="text-xs text-muted">暂无条目</p>
            <p className="text-2xs leading-relaxed text-subtle">
              {tab === 'history'
                ? '处理完成或复核过的提案会归入历史。'
                : 'Agent 提交的知识提案会先在这里等你处理。'}
            </p>
          </div>
        ) : (
          rows.map(({ group, proposal }) => {
            const isEditing = editing?.proposalId === proposal.proposal_id;
            return (
              <div
                key={`${group.artifact_id}:${proposal.proposal_id}`}
                className="mx-2 mb-2 rounded-md bg-background px-2.5 py-2.5"
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
                        .then((saved) => {
                          // 保存失败时保持编辑态与已输入草稿（失败原因在面板顶部 PanelError）。
                          if (saved) setEditing(null);
                        });
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
                      data-testid={`knowledge-reject-${proposal.proposal_id}`}
                      onClick={() =>
                        void confirmDialog
                          .confirm({
                            title: '拒绝这条知识提案？',
                            message: `「${proposal.title}」将被标记为已拒绝并离开待处理列表；拒绝后不可撤销，但仍可在「历史」页签中查看。`,
                            confirmLabel: '拒绝提案',
                            cancelLabel: '取消',
                            tone: 'danger',
                          })
                          .then((confirmed) => {
                            if (confirmed) return handle.reject(group, proposal);
                          })
                      }
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
      <AppDialogHost
        dialog={confirmDialog.dialog}
        onClose={confirmDialog.closeDialog}
        onPromptValueChange={confirmDialog.updatePromptValue}
      />
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
        className="sf-input h-8 w-full rounded-sm border border-border bg-background px-2 text-xs"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        aria-label="知识标题"
      />
      <textarea
        className="sf-input min-h-20 w-full resize-y rounded-sm border border-border bg-background px-2 py-1.5 text-2xs leading-relaxed"
        value={draft.claim}
        onChange={(event) => onChange({ ...draft, claim: event.target.value })}
        aria-label="知识内容"
      />
      <input
        className="sf-input h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-3xs"
        value={draft.target_path}
        onChange={(event) => onChange({ ...draft, target_path: event.target.value })}
        aria-label="目标路径"
      />
      <select
        className="sf-input h-8 w-full rounded-sm border border-border bg-background px-2 text-2xs"
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
          className="sf-input h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-3xs"
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
          className="flex h-7 items-center gap-1 rounded-sm bg-agent px-2 text-3xs text-agent-foreground"
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
