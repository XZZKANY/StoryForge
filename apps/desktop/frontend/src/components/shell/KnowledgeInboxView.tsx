import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';

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
  return <ProjectKnowledgeInboxView key={handle.projectRoot} handle={handle} />;
}

function ProjectKnowledgeInboxView({ handle }: { handle: KnowledgeInboxHandle }) {
  const [tab, setTab] = useState<InboxTab>('pending');
  const [editing, setEditing] = useState<{
    group: ApiKnowledgeProposalGroup;
    proposalId: string;
    draft: ApiKnowledgeProposalItemEdit;
  } | null>(null);
  const currentEditingRef = useRef(editing);
  const editorElementRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    currentEditingRef.current = editing;
    return () => {
      currentEditingRef.current = null;
    };
  }, [editing]);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const reviewProposalId = handle.reviewPatch?.proposal_id ?? null;
  const focusLifetimeRef = useRef<object | null>(null);
  const focusFramesRef = useRef(new Set<number>());
  useLayoutEffect(() => {
    focusLifetimeRef.current = {};
    const frames = focusFramesRef.current;
    return () => {
      focusLifetimeRef.current = null;
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      frames.clear();
    };
  }, []);

  const scheduleFocus = (target: HTMLElement | null | (() => HTMLElement | null)) => {
    const lifetime = focusLifetimeRef.current;
    if (!lifetime) return;
    const focus = () => {
      if (focusLifetimeRef.current !== lifetime) return;
      const resolved = typeof target === 'function' ? target() : target;
      resolved?.focus({ preventScroll: true });
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(() => {
        focusFramesRef.current.delete(frame);
        focus();
      });
      focusFramesRef.current.add(frame);
    } else {
      focus();
    }
  };

  const focusEditTrigger = (proposalId: string, preserveNewFocus = false) => {
    scheduleFocus(() => {
      if (preserveNewFocus && document.activeElement !== document.body) return null;
      return (
        [...document.querySelectorAll<HTMLButtonElement>('[data-testid="knowledge-edit"]')].find(
          (button) => button.dataset.proposalId === proposalId,
        ) ?? null
      );
    });
  };

  const focusReviewTrigger = (proposalId: string, preserveNewFocus = false) => {
    scheduleFocus(() => {
      if (preserveNewFocus && document.activeElement !== document.body) return null;
      return reviewButtonRefs.current.get(proposalId) ?? null;
    });
  };

  useEffect(() => {
    if (!reviewProposalId) return;
    scheduleFocus(reviewHeadingRef.current);
  }, [reviewProposalId]);
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
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="knowledge-inbox-view"
      role="region"
      aria-labelledby="knowledge-inbox-title"
    >
      <div className="flex h-shell-row flex-shrink-0 items-center gap-2 border-b border-border px-2.5">
        <h2 id="knowledge-inbox-title" className="min-w-0 flex-1 truncate text-xs font-semibold">
          Knowledge Inbox
        </h2>
        <span
          className="font-mono text-3xs text-subtle"
          data-testid="knowledge-inbox-count"
          aria-label={`${handle.inbox.pending_count} 条待处理知识提议`}
        >
          {handle.inbox.pending_count}
        </span>
        <button
          type="button"
          disabled={handle.loading}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground disabled:cursor-wait disabled:opacity-50"
          title="刷新 Knowledge Inbox"
          aria-label="刷新 Knowledge Inbox"
          onClick={() => void handle.refresh()}
        >
          <RefreshCw size={13} className={handle.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div
        className="grid grid-cols-4 border-b border-border p-1"
        role="tablist"
        aria-label="Knowledge Inbox 状态"
      >
        {(['pending', 'conflict', 'stale', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`knowledge-inbox-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="knowledge-inbox-panel"
            tabIndex={tab === value ? 0 : -1}
            className={`h-7 rounded-sm text-3xs ${
              tab === value ? 'bg-elevated text-foreground' : 'text-muted hover:text-foreground'
            }`}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const tabs = Array.from(
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ) ?? [],
              );
              if (tabs.length === 0) return;
              const current = tabs.indexOf(event.currentTarget);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
          >
            {{ pending: '待处理', conflict: '冲突', stale: '待复核', history: '历史' }[value]}
          </button>
        ))}
      </div>
      {handle.error && (
        <PanelError title="Knowledge Inbox 操作失败" detail={handle.error} compact />
      )}
      {handle.loading && rows.length > 0 && (
        <p className="sr-only" role="status" aria-live="polite">
          正在刷新 Knowledge Inbox…
        </p>
      )}
      <div
        id="knowledge-inbox-panel"
        className="min-h-0 flex-1 overflow-y-auto"
        role="tabpanel"
        aria-labelledby={`knowledge-inbox-tab-${tab}`}
        aria-busy={handle.loading}
      >
        {rows.length === 0 && handle.loading ? (
          <p
            className="px-3 py-8 text-center text-2xs text-subtle"
            role="status"
            aria-live="polite"
          >
            正在读取 Knowledge Inbox…
          </p>
        ) : rows.length === 0 ? (
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
                    editorRef={editorElementRef}
                    draft={editing.draft}
                    onChange={(draft) => setEditing({ ...editing, draft })}
                    onCancel={() => {
                      setEditing(null);
                      focusEditTrigger(proposal.proposal_id);
                    }}
                    onSave={() => {
                      const submitted = editing;
                      const editor = editorElementRef.current;
                      return handle
                        .revise(group, proposal.proposal_id, submitted.draft)
                        .then((saved) => {
                          // A new editing session or later keystrokes still belong to the author.
                          if (!saved || currentEditingRef.current !== submitted) return;
                          const restoreFocus = editor?.contains(document.activeElement);
                          setEditing(null);
                          if (restoreFocus) focusEditTrigger(proposal.proposal_id, true);
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
                      data-testid="knowledge-edit"
                      data-proposal-id={proposal.proposal_id}
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
                        aria-expanded={handle.reviewPatch?.proposal_id === proposal.proposal_id}
                        aria-controls={
                          handle.reviewPatch?.proposal_id === proposal.proposal_id
                            ? `knowledge-patch-review-${proposal.proposal_id}`
                            : undefined
                        }
                        ref={(element) => {
                          if (element) {
                            reviewButtonRefs.current.set(proposal.proposal_id, element);
                          } else {
                            reviewButtonRefs.current.delete(proposal.proposal_id);
                          }
                        }}
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
                  <KnowledgePatchReview
                    handle={handle}
                    proposalId={proposal.proposal_id}
                    headingRef={reviewHeadingRef}
                    onCloseFocus={(preserveNewFocus) =>
                      focusReviewTrigger(proposal.proposal_id, preserveNewFocus)
                    }
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
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
  editorRef,
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  editorRef: Ref<HTMLDivElement>;
  draft: ApiKnowledgeProposalItemEdit;
  onChange: (draft: ApiKnowledgeProposalItemEdit) => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
}) {
  const firstSource = draft.sources[0];
  const [saving, setSaving] = useState(false);
  const pendingSaveRef = useRef<symbol | null>(null);
  useLayoutEffect(
    () => () => {
      pendingSaveRef.current = null;
    },
    [],
  );

  const saveDraft = async () => {
    if (pendingSaveRef.current) return;
    const request = Symbol('knowledge-save');
    pendingSaveRef.current = request;
    setSaving(true);
    try {
      await onSave();
    } finally {
      if (pendingSaveRef.current === request) {
        pendingSaveRef.current = null;
        setSaving(false);
      }
    }
  };

  return (
    <>
      {saving && (
        <p className="sr-only" role="status" aria-live="polite">
          正在保存知识提议…
        </p>
      )}
      <div
        ref={editorRef}
        className="space-y-2"
        role="group"
        aria-label="编辑知识提议"
        aria-busy={saving}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <input
          autoFocus
          className="h-8 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-agent"
          style={{
            boxShadow: 'var(--shadow-inset)',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          aria-label="知识标题"
          data-testid="knowledge-editor-title"
        />
        <textarea
          className="min-h-20 w-full resize-y rounded-sm border border-border bg-background px-2 py-1.5 text-2xs leading-relaxed outline-none focus:border-agent"
          style={{
            boxShadow: 'var(--shadow-inset)',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }}
          value={draft.claim}
          onChange={(event) => onChange({ ...draft, claim: event.target.value })}
          aria-label="知识内容"
        />
        <input
          className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-3xs outline-none focus:border-agent"
          style={{
            boxShadow: 'var(--shadow-inset)',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }}
          value={draft.target_path}
          onChange={(event) => onChange({ ...draft, target_path: event.target.value })}
          aria-label="目标路径"
        />
        <select
          className="h-8 w-full rounded-sm border border-border bg-background px-2 text-2xs outline-none focus:border-agent"
          style={{
            boxShadow: 'var(--shadow-inset)',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              'var(--shadow-inset), 0 0 0 3px rgb(var(--agent) / 0.1)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }}
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
            className="flex h-7 items-center gap-1 rounded-sm bg-foreground px-2 text-3xs text-background disabled:cursor-wait disabled:opacity-50"
            disabled={saving}
            onClick={() => void saveDraft()}
          >
            {saving ? (
              <RefreshCw size={11} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={11} aria-hidden="true" />
            )}
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>
    </>
  );
}

function KnowledgePatchReview({
  handle,
  proposalId,
  headingRef,
  onCloseFocus,
}: {
  handle: KnowledgeInboxHandle;
  proposalId: string;
  headingRef: Ref<HTMLHeadingElement>;
  onCloseFocus: (preserveNewFocus?: boolean) => void;
}) {
  const patch = handle.reviewPatch;
  if (!patch) return null;
  return (
    <section
      className="mt-2 border-t border-border pt-2"
      data-testid="knowledge-patch-review"
      id={`knowledge-patch-review-${proposalId}`}
      role="region"
      aria-labelledby={`knowledge-patch-review-title-${proposalId}`}
    >
      <h3
        ref={headingRef}
        id={`knowledge-patch-review-title-${proposalId}`}
        className="mb-2 text-3xs font-semibold text-foreground"
        tabIndex={-1}
      >
        知识写回预览 · {patch.relative_path}
      </h3>
      <div className="grid gap-2">
        <div>
          <p
            id={`knowledge-patch-before-label-${proposalId}`}
            className="mb-1 text-3xs text-subtle"
          >
            写入前
          </p>
          <pre
            className="max-h-28 overflow-auto whitespace-pre-wrap break-words bg-background p-2 font-mono text-3xs leading-relaxed text-muted"
            aria-labelledby={`knowledge-patch-before-label-${proposalId}`}
          >
            {patch.before || '（新文件）'}
          </pre>
        </div>
        <div>
          <p id={`knowledge-patch-after-label-${proposalId}`} className="mb-1 text-3xs text-subtle">
            写入后
          </p>
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-background p-2 font-mono text-3xs leading-relaxed text-foreground"
            aria-labelledby={`knowledge-patch-after-label-${proposalId}`}
          >
            {patch.after}
          </pre>
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          className="h-7 px-2 text-3xs text-muted"
          onClick={() => {
            handle.clearReview();
            onCloseFocus();
          }}
          aria-label="关闭知识写回预览"
        >
          关闭
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-sm bg-agent px-2 text-3xs text-white"
          disabled={handle.busyProposalId === patch.proposal_id}
          onClick={() =>
            void handle.accept().then((accepted) => {
              if (accepted) onCloseFocus(true);
            })
          }
          data-testid="knowledge-confirm-writeback"
        >
          <Check size={11} /> 确认写回
        </button>
      </div>
    </section>
  );
}
