import { Button, IconButton, FloatingSurface } from '../ui';

import { memo, useEffect, useRef, useState } from 'react';
import {
  semanticKindLabel,
  type ContextBundle,
  type SemanticFile,
} from '../../lib/project-context';
import type { AssistantSessionRecord } from '../../lib/api-client';
import { AgentStepsPanel } from '../AgentStepsPanel';
import {
  ChevronDown,
  Maximize2,
  PanelLeft,
  PanelRightClose,
  Plus,
  Radar,
  Sparkles,
} from '../icons/shell-icons';
import type { LayoutMode } from '../shell/useShellState';
import { AssistantMarkdown } from './AssistantMarkdown';
import { contextBudgetText } from './display-utils';
import { shouldShowAgentRunRecovery, type AgentRunRecoveryDisplay } from './recovery';
import type { AgentRun, AgentRunControlHandlers, Message } from './types';

// 会话下拉的 updated_at 是 ISO 原串：主行只露 MM-dd HH:mm 短格式，完整时间留在 title。
function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// RunActionBar 按钮统一到 Button 原语后的公共类：保留等效 h-8/text-xs 与按压反馈。
const runActionButtonClass = 'interactive-press font-medium transition-colors text-xs';

// 「停止」两段确认的有效窗口：超时自动回到未确认态。
const STOP_CONFIRM_TIMEOUT_MS = 5000;

export function ConversationHeader({
  title,
  sessions,
  activeSessionId = null,
  onSelectSession,
  onNewSession,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention = false,
}: {
  title: string;
  sessions?: AssistantSessionRecord[];
  activeSessionId?: number | null;
  onSelectSession?: (id: number) => void;
  onNewSession?: () => void;
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
}) {
  // Q5：会话下拉——会话按项目划分，标题变下拉入口（当前项目会话列表 + 新建）。
  // 下拉走内联 absolute（不 portal），token 在 :root/#app 内，避免 portal 出主题作用域翻车。
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const sessionList = sessions ?? [];
  return (
    <header
      className="relative flex h-shell-row flex-shrink-0 items-center gap-2 bg-panel px-3 pr-2"
      data-testid="conversation-header"
    >
      <button
        ref={menuTriggerRef}
        type="button"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-elevated"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="conversation-session-switch"
        title="本项目的会话（会话按项目划分，不再放全局左栏）"
      >
        <Sparkles size={13} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <ChevronDown size={13} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
      </button>
      {onNewSession && (
        <IconButton
          type="button"
          onClick={onNewSession}
          data-testid="conversation-new-session"
          size="xs"
          className="relative"
          label="新建会话"
          tooltip="新建会话"
          icon={
            <>
              <Plus size={15} strokeWidth={1.7} />
            </>
          }
        />
      )}
      {onOpenObservatory && (
        <IconButton
          type="button"
          onClick={onOpenObservatory}
          data-testid="conversation-open-observatory"
          size="xs"
          className="relative"
          label="世界线观测镜"
          tooltip="世界线观测镜 · Ctrl Shift O"
          icon={
            <>
              <Radar size={14} strokeWidth={1.6} />
              {observatoryAttention && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-agent"
                  data-testid="observatory-attention-dot"
                />
              )}
            </>
          }
        />
      )}
      {/* Q4 布局三态就地控件：对话头切 编辑 / 平衡 / 对话聚焦 */}
      {onSetLayoutMode &&
        (layoutMode === 'chat' ? (
          <IconButton
            type="button"
            onClick={() => onSetLayoutMode('balanced')}
            data-testid="conversation-back-to-balanced"
            size="xs"
            className="relative"
            label="回到编辑"
            tooltip="回到编辑 · Ctrl 2"
            icon={
              <>
                <PanelLeft size={15} strokeWidth={1.6} />
              </>
            }
          />
        ) : (
          <>
            <IconButton
              type="button"
              onClick={() => onSetLayoutMode('chat')}
              data-testid="conversation-expand-chat"
              size="xs"
              className="relative"
              label="对话占满中右"
              tooltip="对话占满中右 · Ctrl 3"
              icon={
                <>
                  <Maximize2 size={14} strokeWidth={1.6} />
                </>
              }
            />
            <IconButton
              type="button"
              onClick={() => onSetLayoutMode('editor')}
              data-testid="conversation-collapse-right"
              size="xs"
              className="relative"
              label="收起对话栏，编辑占满"
              tooltip="收起对话栏，编辑占满 · Ctrl 1"
              icon={
                <>
                  <PanelRightClose size={15} strokeWidth={1.6} />
                </>
              }
            />
          </>
        ))}
      {menuOpen && (
        <>
          <FloatingSurface
            role="menu"
            aria-label="操作"
            triggerRef={menuTriggerRef}
            onDismiss={() => setMenuOpen(false)}
            className="animate-fade-in overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-dropdown w-64"
          >
            <div className="px-2 py-1 text-3xs uppercase tracking-[0.08em] text-subtle">
              本项目的会话
            </div>
            {sessionList.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-subtle">暂无历史会话</div>
            ) : (
              sessionList.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <button
                    role="menuitem"
                    key={session.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-elevated ${
                      active ? 'text-foreground' : 'text-muted hover:text-foreground'
                    }`}
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectSession?.(session.id);
                    }}
                    title={`会话 #${session.id} · ${session.updated_at}`}
                    data-testid="session-item"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {active ? '✓ ' : ''}
                      {session.title.replace(/^IDE Agent:\s*/, '') || `会话 #${session.id}`}
                    </span>
                    <span className="flex-shrink-0 text-3xs text-subtle">
                      {formatSessionTime(session.updated_at)}
                    </span>
                  </button>
                );
              })
            )}
            {onNewSession && (
              <>
                <div className="mx-1.5 my-1 h-px bg-border" />
                <button
                  role="menuitem"
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewSession();
                  }}
                >
                  <Plus size={13} strokeWidth={1.7} />
                  新建会话
                </button>
              </>
            )}
          </FloatingSurface>
        </>
      )}
    </header>
  );
}

export function MessageList({
  conversationScope = 0,
  messages,
  agentRun,
  agentRunRecovery,
}: {
  conversationScope?: string | number;
  messages: Message[];
  agentRun: AgentRun | null;
  agentRunRecovery: AgentRunRecoveryDisplay | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [nearBottom, setNearBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A newly selected conversation opens at its latest content; shell visibility changes
    // retain the existing scope and reading position instead of remounting the messages.
    const resetScroll = () => {
      nearBottomRef.current = true;
      setNearBottom(true);
      setHasUnread(false);
      if (element.clientHeight > 0) element.scrollTop = element.scrollHeight;
    };
    resetScroll();
    const onScroll = () => {
      if (element.clientHeight === 0) return; // hidden workspace is not a user scroll
      const nextNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
      nearBottomRef.current = nextNearBottom;
      setNearBottom(nextNearBottom);
      if (nextNearBottom) setHasUnread(false);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (element.clientHeight > 0 && nearBottomRef.current) {
              element.scrollTop = element.scrollHeight;
            }
          })
        : null;
    observer?.observe(element);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [conversationScope]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateContent = () => {
      if (nearBottomRef.current) {
        if (element.clientHeight > 0) element.scrollTop = element.scrollHeight;
        setHasUnread(false);
      } else {
        setHasUnread(true);
      }
    };
    updateContent();
  }, [messages, agentRun, agentRunRecovery]);

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    nearBottomRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    setNearBottom(true);
    setHasUnread(false);
  };
  const content =
    messages.length === 0 ? null : (
      <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-5 py-6">
        {messages.map((message, index) => (
          <MessageItem key={message.id ?? messageKey(message) + ':' + index} message={message} />
        ))}

        {agentRun && agentRun.steps.length > 0 && (
          <div className="animate-slide-up-fade space-y-2">
            <AgentStepsPanel run={agentRun} />
            {shouldShowAgentRunRecovery(agentRun.status, agentRunRecovery) && (
              <AgentRunRecoveryPanel recovery={agentRunRecovery} />
            )}
          </div>
        )}
      </div>
    );
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
        data-testid="message-list-scroll"
        role="region"
        aria-label="对话消息"
        tabIndex={0}
      >
        <div ref={contentRef} className="min-h-full">
          {content}
        </div>
      </div>
      {hasUnread && !nearBottom && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-agent/40 bg-surface px-3 py-1.5 text-xs text-foreground shadow-dropdown transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent"
          data-testid="message-list-new-content"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (document.activeElement === event.currentTarget) scrollRef.current?.focus();
            jumpToLatest();
          }}
        >
          有新内容 · 回到底部
        </button>
      )}
    </div>
  );
}

export function AgentRunRecoveryPanel({ recovery }: { recovery: AgentRunRecoveryDisplay | null }) {
  if (!recovery) return null;
  const toneClass = recoveryToneClass(recovery.tone);
  return (
    <section
      className={`rounded-lg border px-3 py-2 ${toneClass}`}
      data-testid="agent-run-recovery"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div
          className="truncate text-xs font-semibold text-foreground"
          title={`${recovery.statusText}；${recovery.resumeText}`}
        >
          {recovery.statusText}；{recovery.resumeText}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {recovery.pendingText && <span>{recovery.pendingText}</span>}
          {recovery.latestControlText && <span>{recovery.latestControlText}</span>}
          {recovery.boundaryText && <span>{recovery.boundaryText}</span>}
          {recovery.checkpointText && <span>{recovery.checkpointText}</span>}
        </div>
      </div>
    </section>
  );
}

function recoveryToneClass(tone: AgentRunRecoveryDisplay['tone']): string {
  if (tone === 'error') return 'border-error/40 bg-error/10';
  if (tone === 'waiting') return 'border-warning/40 bg-warning/10';
  if (tone === 'ok') return 'border-success/40 bg-success/10';
  return 'border-border bg-panel';
}

/**
 * Composer 上方固定操作条：统一 run 控制单一来源。
 * 包括暂停/恢复/停止 + 权限批准/拒绝 + 补丁接受/拒绝。
 */
export function RunActionBar({
  run,
  controls,
  recovery,
  resumePending = false,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
  recovery?: AgentRunRecoveryDisplay | null;
  resumePending?: boolean;
}) {
  const [rejectDraft, setRejectDraft] = useState<string | null>(null);
  // 停止是破坏性终态动作：第一次点击只进入待确认，再点才执行；超时/失焦/划走都取消。
  const [stopConfirmArmed, setStopConfirmArmed] = useState(false);
  const stopConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (stopConfirmTimerRef.current) clearTimeout(stopConfirmTimerRef.current);
    },
    [],
  );
  const waitingForPermission = run.steps.some(
    (step) => step.id === 'permission-required' && step.status === 'waiting',
  );
  // status==='waiting' 且非权限 = run 已产出补丁、等作者确认。此时「停止」会把 run 误标 failed
  // 却不清掉待确认补丁（放弃应走下方或编辑器里拒绝），故这里只给操作入口、不给破坏性停止。
  const awaitingConfirm = run.status === 'waiting' && !waitingForPermission;
  // 暂停态给「恢复」出口（不再是死胡同），并保留「停止」；停止是终态、由轻状态条中性收尾。
  const isPaused = run.status === 'paused';
  const isRunning = run.status === 'running';
  // 终态只留轻状态/回复收尾，不再渲染没有动作的空操作条。
  const isTerminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'stopped';
  if (isTerminal && !run.deliveryUnknown) return null;
  // External approval belongs only to the whole-writeback panel, never legacy events.
  if (run.status === 'waiting' && run.executionProtocol === 'external_writeback_v1') return null;

  const handleAcceptPatch = () => {
    controls.onAcceptPatch?.();
  };

  const handleRejectPatch = () => {
    if (rejectDraft === null) {
      setRejectDraft('');
      return;
    }
    const direction = rejectDraft.trim();
    setRejectDraft(null);
    controls.onRejectPatch?.(direction);
  };

  const cancelStopConfirm = () => {
    if (stopConfirmTimerRef.current) {
      clearTimeout(stopConfirmTimerRef.current);
      stopConfirmTimerRef.current = null;
    }
    setStopConfirmArmed(false);
  };

  const handleStopClick = () => {
    if (!stopConfirmArmed) {
      setStopConfirmArmed(true);
      stopConfirmTimerRef.current = setTimeout(cancelStopConfirm, STOP_CONFIRM_TIMEOUT_MS);
      return;
    }
    cancelStopConfirm();
    controls.onStopRun();
  };

  if (run.deliveryUnknown)
    return (
      <div
        className="flex flex-wrap items-center gap-2 border-t border-border p-3"
        data-testid="run-action-bar"
      >
        <span role="status" className="text-xs text-warning" data-testid="run-action-status">
          本轮结果未知；连接结束不代表执行失败。请核对原运行，不会自动重放。
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={controls.onReconcileRun}
          data-testid="run-reconcile"
        >
          核对状态
        </Button>
        <Button size="sm" variant="secondary" onClick={controls.onPauseRun} data-testid="run-pause">
          请求暂停
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleStopClick}
          onBlur={cancelStopConfirm}
          data-testid="run-stop"
        >
          {stopConfirmArmed ? '确认停止' : '请求停止'}
        </Button>
      </div>
    );

  return (
    <div
      className="flex flex-shrink-0 flex-col border-t border-border bg-panel shadow-bar-top animate-slide-in-up"
      data-testid="run-action-bar"
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-2">
          <div className="flex items-center gap-3">
            {isRunning && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-agent shadow-sm" />
              </span>
            )}
            <div
              className="min-w-0 flex-1 text-xs font-medium text-muted"
              title={`运行 ${run.id}`}
              data-testid="run-action-status"
            >
              {waitingForPermission
                ? '等待你确认'
                : awaitingConfirm
                  ? 'AI 修订已生成，可接受或拒绝'
                  : isPaused
                    ? '已暂停'
                    : isRunning
                      ? (() => {
                          // 运行中：三点动画 + 当前活动步骤名，作者一眼看到「正在跑哪个工具」。
                          const activeStep =
                            run.steps.find((step) => step.status === 'running') ??
                            run.steps.find((step) => step.status === 'waiting') ??
                            run.steps.find((step) => step.status === 'pending');
                          return (
                            <span
                              className="inline-flex items-baseline gap-2"
                              data-testid="run-action-active-step"
                            >
                              <span className="sf-thinking-dots" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                              </span>
                              <span className="text-foreground">
                                {activeStep ? activeStep.title : '正在处理'}
                              </span>
                            </span>
                          );
                        })()
                      : '准备中'}
            </div>
          </div>
          {/* 运行态：暂停按钮 */}
          {isRunning && (
            <Button
              size="sm"
              variant="secondary"
              className={runActionButtonClass}
              onClick={controls.onPauseRun}
              title="暂停本轮"
              data-testid="run-pause"
            >
              暂停
            </Button>
          )}
          {/* 暂停态：恢复按钮 */}
          {isPaused && (
            <Button
              size="sm"
              variant="primary"
              className={runActionButtonClass}
              onClick={controls.onResumeRun}
              disabled={resumePending || recovery?.checkpointResume?.canResume === false}
              title={recovery?.checkpointResume?.message ?? '恢复本轮'}
              data-testid="run-resume"
            >
              恢复
            </Button>
          )}
          {isPaused && recovery?.checkpointResume && (
            <span className="text-xs text-muted" role="status" data-testid="run-resume-guidance">
              {recovery.checkpointResume.message}
            </span>
          )}
          {isPaused && recovery?.checkpointResume && controls.onReconcileRun && (
            <Button
              size="sm"
              variant="secondary"
              className={runActionButtonClass}
              onClick={controls.onReconcileRun}
              data-testid="run-reconcile"
              title="只读取本轮状态，不重新执行"
            >
              核对状态
            </Button>
          )}
          {/* 权限确认：批准/拒绝 */}
          {waitingForPermission && (
            <>
              <Button
                size="sm"
                variant="primary"
                className={runActionButtonClass}
                onClick={controls.onApprovePermission}
                title="批准权限请求"
                data-testid="run-approve-permission"
              >
                批准
              </Button>
              <Button
                size="sm"
                variant="danger"
                className={runActionButtonClass}
                onClick={controls.onDenyPermission}
                title="拒绝权限请求"
                data-testid="run-deny-permission"
              >
                拒绝
              </Button>
            </>
          )}
          {/* 补丁确认：接受/拒绝 */}
          {awaitingConfirm && (
            <>
              <Button
                size="sm"
                variant="primary"
                className={runActionButtonClass}
                onClick={handleAcceptPatch}
                title="接受这版修订并写回"
                data-testid="run-accept-patch"
              >
                接受
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={runActionButtonClass}
                onClick={handleRejectPatch}
                title="拒绝这版修订"
                data-testid="run-reject-patch"
              >
                {rejectDraft === null ? '拒绝' : '取消'}
              </Button>
            </>
          )}
          {/* 停止按钮：在运行/暂停/等待权限时可用，补丁确认时不显示（避免误操作）。
              两段式确认：先点变「确认停止本轮？」，再点才执行（内联确认，不开弹窗）。 */}
          {(isRunning || isPaused || waitingForPermission) && (
            <Button
              size="sm"
              variant="danger"
              className={runActionButtonClass}
              onClick={handleStopClick}
              onBlur={cancelStopConfirm}
              onMouseLeave={cancelStopConfirm}
              title={stopConfirmArmed ? '再次点击确认停止本轮' : '停止本轮'}
              data-testid="run-stop"
              data-armed={stopConfirmArmed ? 'true' : 'false'}
            >
              {stopConfirmArmed ? '确认停止本轮？' : '停止'}
            </Button>
          )}
        </div>
      </div>
      {rejectDraft !== null && awaitingConfirm && (
        <div
          className="flex items-center gap-2 border-t border-border px-4 py-2"
          data-testid="run-reject-form"
        >
          <div className="mx-auto flex w-full max-w-[800px] items-center gap-2">
            <input
              autoFocus
              value={rejectDraft}
              onChange={(e) => setRejectDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRejectPatch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRejectDraft(null);
                }
              }}
              placeholder="说说该怎么改（回车发出，留空则只否掉这版）"
              className="sf-input min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground placeholder:text-muted"
              data-testid="run-reject-input"
            />
            <button
              type="button"
              onClick={handleRejectPatch}
              className="h-7 flex-shrink-0 rounded-md border border-border px-2.5 text-xs text-foreground transition-colors hover:bg-elevated"
              data-testid="run-reject-confirm"
            >
              {rejectDraft.trim() ? '否掉并重来' : '否掉'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContextSummaryPanel({
  compact = false,
  currentFileLabel,
  explicitContextPaths,
  contextCandidates,
  contextCandidatesLoading,
  contextCandidatesError,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onRetryContextCandidates,
}: {
  compact?: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextCandidatesLoading: boolean;
  contextCandidatesError: string | null;
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  onRetryContextCandidates: () => void;
}) {
  const [expanded, setExpanded] = useState(!compact);
  // 上下文索引错误条可关闭：按错误串记忆已关内容，新错误会重新出现；打开选择器时
  // 无论是否已关都在列表区保留重试入口，避免关掉后找不到恢复路径。
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const errorBannerVisible =
    Boolean(contextCandidatesError) && contextCandidatesError !== dismissedError;
  const handleRetryCandidates = () => {
    setDismissedError(null);
    onRetryContextCandidates();
  };
  const hasWarning = Boolean(
    missingContextPaths.length || contextCandidatesError || lastContextBundle?.budget.truncated,
  );
  // 空会话不展示上下文占位；只有作者主动打开或真实警告才占用空间。
  if (!contextPickerOpen && !hasWarning) return null;

  const visibleCandidates = contextCandidates
    .filter((file) => file.relativePath !== currentFileLabel)
    .slice(0, 24);
  const detailsOpen = !compact || expanded || contextPickerOpen;

  return (
    <section
      className="mx-3 mb-2 max-h-[40%] flex-shrink-0 overflow-y-auto rounded-lg bg-background px-3 py-2"
      data-testid="context-summary"
      data-compact={compact ? 'true' : 'false'}
      data-expanded={detailsOpen ? 'true' : 'false'}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            if (contextPickerOpen) onAddContext();
            else setExpanded((value) => !value);
          }}
          data-testid="context-summary-toggle"
          aria-expanded={detailsOpen}
        >
          <span
            className={`flex-shrink-0 text-3xs text-subtle transition-transform ${detailsOpen ? '' : '-rotate-90'}`}
          >
            ▾
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-subtle">
            参考上下文
            {explicitContextPaths.length > 0 ? ` · 固定 ${explicitContextPaths.length}` : ''}
          </span>
          {lastContextBundle?.budget.truncated && (
            <span
              className="flex-shrink-0 rounded-sm bg-warning/15 px-1.5 py-px text-3xs leading-4 text-warning"
              data-testid="context-truncated-badge"
            >
              已截断
            </span>
          )}
        </button>
        <button
          type="button"
          className="h-7 flex-shrink-0 rounded-md border border-border-strong px-2.5 text-xs text-foreground transition-colors hover:bg-elevated"
          onClick={onAddContext}
          data-testid="context-picker-toggle"
        >
          {contextPickerOpen ? '完成' : '添加上下文'}
        </button>
      </div>

      {detailsOpen && (
        <>
          {lastContextBundle && (
            <div className="mt-2 text-xs text-subtle">
              <div>{contextBudgetText(lastContextBundle)}</div>
              {lastContextBundle.files.length > 0 && (
                <ul className="mt-1 space-y-0.5" aria-label="本轮实际引用">
                  {lastContextBundle.files.map((file) => (
                    <li key={file.path} className="break-words">
                      {file.relativePath}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {explicitContextPaths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pinned-context-list">
              {explicitContextPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="max-w-full truncate rounded-md border border-accent bg-accent px-2 py-1 text-xs text-accent-foreground transition-colors hover:bg-accent/90"
                  title={path}
                  aria-label={`取消固定参考：${path}`}
                  onClick={() => onTogglePinnedContext(path)}
                >
                  已固定 {path}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {missingContextPaths.length > 0 && (
        <div
          className="mt-2 break-words text-xs text-warning"
          data-testid="missing-context-warning"
        >
          未读到：{missingContextPaths.join('、')}
        </div>
      )}
      {errorBannerVisible && (
        <div
          className="mt-2 flex items-center gap-2 text-xs text-warning"
          data-testid="context-candidates-error"
        >
          <span className="flex-shrink-0 rounded-sm bg-warning/15 px-1.5 py-px text-3xs font-medium leading-4 text-warning">
            项目上下文索引失败
          </span>
          <span className="min-w-0 flex-1 break-words">{contextCandidatesError}</span>
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 transition-colors hover:bg-elevated"
            onClick={handleRetryCandidates}
            data-testid="context-candidates-retry"
          >
            重试
          </button>
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 transition-colors hover:bg-elevated"
            onClick={() => setDismissedError(contextCandidatesError)}
            data-testid="context-candidates-error-dismiss"
          >
            关闭
          </button>
        </div>
      )}
      {contextPickerOpen && (
        <div
          className="mt-3 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto pt-2"
          data-testid="context-picker"
        >
          {contextCandidatesLoading ? (
            <div className="px-2 py-1 text-xs text-subtle" data-testid="context-candidates-loading">
              正在读取项目上下文…
            </div>
          ) : contextCandidatesError ? (
            errorBannerVisible ? null : (
              <div
                className="flex items-center gap-2 px-2 py-1 text-xs text-warning"
                data-testid="context-candidates-picker-error"
              >
                <span className="min-w-0 flex-1 break-words">
                  项目上下文索引失败：{contextCandidatesError}
                </span>
                <button
                  type="button"
                  className="h-7 flex-shrink-0 rounded-md border border-warning px-2.5 transition-colors hover:bg-elevated"
                  onClick={handleRetryCandidates}
                  data-testid="context-candidates-picker-retry"
                >
                  重试
                </button>
              </div>
            )
          ) : visibleCandidates.length === 0 ? (
            <div className="px-2 py-1 text-xs text-subtle">
              当前项目还没有可选的 Markdown 上下文。
            </div>
          ) : (
            visibleCandidates.map((file) => {
              const pinned =
                explicitContextPaths.includes(file.relativePath) ||
                explicitContextPaths.includes(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs ${pinned ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-elevated'}`}
                  onClick={() => onTogglePinnedContext(file.relativePath)}
                  data-testid="context-candidate"
                  data-context-path={file.relativePath}
                  title={file.relativePath}
                >
                  <span className="w-10 flex-shrink-0 text-subtle">
                    {semanticKindLabel(file.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                  <span className="flex-shrink-0 text-subtle">{pinned ? '已固定' : '固定'}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

/**
 * P1-1 修复：消息项 React.memo + 稳定 key。
 * 背景：Agent step 事件高频（每秒则可能 20+ setAgentRun），此前 key={index} 导致
 * 任意 step 更新触发整个消息列表 reconcile，每条 assistant 消息的 react-markdown 全量重渲染。
 * 流消息使用固定 id，增量不重建组件；旧消息以 role/内容 hash + 位置兜底去重。
 * memo 阻断未改变的历史消息重渲染。
 * key 不依赖 index，故会话切换/批量插入/pending 槽位变化均不会误判为不同消息。
 */
function messageKey(message: Message): string {
  // 简单非加密 hash：djb2。长度截短避免 key 过长。
  const text = `${message.role}:${message.content}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) + hash + text.charCodeAt(i);
  }
  return `${message.role}-${hash >>> 0}`;
}

export const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-slide-up-fade justify-end" data-testid="user-message">
        <div className="sf-bubble-user max-w-[85%] bg-elevated px-4 py-3 text-sm leading-6 text-foreground">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <article
      className="max-w-[760px] animate-slide-up-fade text-sm leading-7 text-foreground"
      data-testid="assistant-message"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-agent text-2xs font-semibold text-agent-foreground shadow-sm">
          AI
        </span>
        <span className="text-2xs text-subtle">StoryForge</span>
      </div>
      <div className="py-1">
        <AssistantMarkdown content={message.content} />
        {message.stream && message.stream.phase !== 'complete' && (
          <div
            className="mt-2 flex items-center gap-2 text-xs text-muted"
            data-testid="stream-phase"
            role="status"
          >
            {(message.stream.phase === 'waiting' ||
              message.stream.phase === 'streaming' ||
              message.stream.phase === 'working') && (
              <span
                aria-hidden="true"
                data-testid="stream-indicator"
                data-phase={message.stream.phase}
                className={
                  message.stream.phase === 'streaming'
                    ? 'h-1.5 w-1.5 rounded-full bg-agent motion-safe:animate-pulse'
                    : 'h-1.5 w-1.5 rounded-full bg-agent/60'
                }
              />
            )}
            <span>
              {
                {
                  waiting: '等待正文输出…',
                  streaming: '正在输出…',
                  working: '等待下一步…',
                  unknown: '连接或内容不完整，等待核对结果',
                  interrupted: '回复未完成',
                  complete: '',
                }[message.stream.phase]
              }
            </span>
          </div>
        )}
        {message.stream?.detail && (
          <p className="mt-1 text-xs text-muted">{message.stream.detail}</p>
        )}
      </div>
    </article>
  );
});

export function LightweightStatus({
  text,
  retryVisible = false,
  onRetry,
}: {
  text: string;
  retryVisible?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-shrink-0 bg-panel px-5 py-2">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-xs text-muted" title={text}>
          {text}
        </div>
        {retryVisible && (
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-border-strong px-2.5 text-xs text-foreground transition-colors hover:bg-elevated"
            onClick={onRetry}
          >
            重试本轮
          </button>
        )}
      </div>
    </div>
  );
}
