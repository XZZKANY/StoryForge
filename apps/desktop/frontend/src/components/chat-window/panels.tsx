import { Button, IconButton, PlainButton, revealOnHover } from '../ui';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AUTHOR_LOOP_RESULT_EVENT, type AuthorLoopResult } from '../../lib/assistant-events';
import type { AssistantSessionRecord } from '../../lib/api-client';
import { AgentStepsPanel, hasProcess } from '../AgentStepsPanel';
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
import { CHAT_COLUMN } from './column';
import { DecisionChoices } from './DecisionChoices';
import { SessionMenu } from './SessionMenu';
import { MessageActions } from './MessageActions';
import { shouldShowAgentRunRecovery, type AgentRunRecoveryDisplay } from './recovery';
import { StreamPhase } from './StreamPhase';
import type { AgentRun, AgentRunControlHandlers, Message } from './types';

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
  onRenameSession,
  onRemoveSession,
  layoutMode,
  onSetLayoutMode,
  onOpenObservatory,
  observatoryAttention = false,
  checkHistoryToggle,
  contextToggle,
}: {
  title: string;
  sessions?: AssistantSessionRecord[];
  activeSessionId?: number | null;
  onSelectSession?: (id: number) => void;
  onNewSession?: () => void;
  onRenameSession?: (id: number, title: string) => void | Promise<void | boolean>;
  onRemoveSession?: (id: number) => void;
  layoutMode?: LayoutMode;
  onSetLayoutMode?: (mode: LayoutMode) => void;
  onOpenObservatory?: () => void;
  observatoryAttention?: boolean;
  checkHistoryToggle?: ReactNode;
  contextToggle?: ReactNode;
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
      <PlainButton
        ref={menuTriggerRef}
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-elevated"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="conversation-session-switch"
        title="本作品的会话（会话按作品划分，不再放全局左栏）"
      >
        <Sparkles size={13} strokeWidth={1.7} className="flex-shrink-0 text-agent" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <ChevronDown size={13} strokeWidth={1.6} className="flex-shrink-0 text-subtle" />
      </PlainButton>
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
      {checkHistoryToggle}
      {contextToggle}
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
        <SessionMenu
          sessions={sessionList}
          activeSessionId={activeSessionId}
          triggerRef={menuTriggerRef}
          onDismiss={() => setMenuOpen(false)}
          onSelectSession={onSelectSession}
          onNewSession={onNewSession}
          onRenameSession={onRenameSession}
          onRemoveSession={onRemoveSession}
        />
      )}
    </header>
  );
}

export function MessageList({
  conversationScope = 0,
  messages,
  agentRun,
  agentRunRecovery,
  emptyState = null,
  onRegenerate,
}: {
  conversationScope?: string | number;
  messages: Message[];
  agentRun: AgentRun | null;
  agentRunRecovery: AgentRunRecoveryDisplay | null;
  /** 没有任何消息时显示（新会话开场）；不进会话记录。 */
  emptyState?: ReactNode;
  /** 把这句作者的话再发一次；不传就不给「重新生成」（例如 AI 正在跑）。 */
  onRegenerate?: (userText: string) => void;
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
  // 思考过程排在这一轮回答的上面（先想、后答）；回答还没出现时排在最后。同一个 key 在
  // 父节点里换位置只会移动节点，折叠面板的手动开合不会因为回答出现而重置。
  const process =
    agentRun && hasProcess(agentRun) ? (
      <div
        key={`agent-run-process:${agentRun.id}`}
        className="animate-slide-up-fade"
        data-testid="agent-run-process"
      >
        <AgentStepsPanel run={agentRun} />
      </div>
    ) : null;
  const replyIndex = process
    ? messages.findIndex((message) => message.stream?.runId === agentRun?.id)
    : -1;
  const lastAssistant = messages.reduce(
    (found, message, index) => (message.role === 'assistant' ? index : found),
    -1,
  );
  const regenerateFrom =
    lastAssistant > 0
      ? messages
          .slice(0, lastAssistant)
          .reverse()
          .find((message) => message.role === 'user')
      : undefined;
  const items: ReactNode[] = [];
  messages.forEach((message, index) => {
    if (index === replyIndex) items.push(process);
    items.push(
      <MessageItem
        key={message.id ?? messageKey(message) + ':' + index}
        message={message}
        onRegenerate={
          index === lastAssistant && regenerateFrom && onRegenerate
            ? () => onRegenerate(regenerateFrom.content)
            : undefined
        }
      />,
    );
  });
  if (process && replyIndex < 0) items.push(process);
  const content =
    messages.length === 0 ? (
      emptyState ? (
        <div className={`${CHAT_COLUMN} flex flex-col gap-6 px-5 py-6`}>{emptyState}</div>
      ) : null
    ) : (
      <div className={`${CHAT_COLUMN} flex flex-col gap-6 px-5 py-6`}>
        {items}
        {agentRun &&
          agentRun.steps.length > 0 &&
          shouldShowAgentRunRecovery(agentRun.status, agentRunRecovery) && (
            <AgentRunRecoveryPanel recovery={agentRunRecovery} />
          )}
      </div>
    );
  return (
    // 通知栈据这一栏挪到它左边（编辑区右下角）；对话占满窗口时以这条底边为地板，避开下面的输入框。
    <div className="relative min-h-0 flex-1" data-toast-floor="">
      <div
        ref={scrollRef}
        // 可聚焦是为了能用键盘滚动；鼠标点进来不该给整栏套一圈紫框（上下两条紫杠）。
        className="h-full min-h-0 overflow-y-auto outline-none [scrollbar-gutter:stable]"
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
        <PlainButton
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-agent/40 bg-surface px-3 py-1.5 text-xs text-foreground shadow-dropdown transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent"
          data-testid="message-list-new-content"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (document.activeElement === event.currentTarget) scrollRef.current?.focus();
            jumpToLatest();
          }}
        >
          有新内容 · 回到底部
        </PlainButton>
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
 * Composer 上方的操作条：要作者拍板（权限、补丁）时是就地的编号选项；暂停时是一行「已暂停」。
 * 跑着时没有操作条——进度与用时在思考过程那一行，停止是输入框右下角那颗键。
 */
export function RunActionBar({
  run,
  controls,
  recovery,
  resumePending = false,
  onTypeAhead,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
  recovery?: AgentRunRecoveryDisplay | null;
  resumePending?: boolean;
  /** 选项有焦点时作者开始打字：把焦点还给输入框（免得回车误选了「接受」）。 */
  onTypeAhead?: () => void;
}) {
  // 停止是破坏性终态动作：第一次点击只进入待确认，再点才执行；超时/失焦/划走都取消。
  const [stopConfirmArmed, setStopConfirmArmed] = useState(false);
  // 点「接受」后编辑器要先拍快照再写盘，要几秒：就地显示正在写，免得作者以为没点上又连点。
  const [acceptingPatchId, setAcceptingPatchId] = useState<string | null>(null);
  useEffect(() => {
    if (!acceptingPatchId) return;
    const settle = (event: Event) => {
      if ((event as CustomEvent<AuthorLoopResult>).detail?.action === 'revision_accepted')
        setAcceptingPatchId(null);
    };
    // 编辑器那边被别的操作顶掉时不会回报：最多等一分钟就把选项还给作者。
    const timer = setTimeout(() => setAcceptingPatchId(null), 60_000);
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, settle);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, settle);
    };
  }, [acceptingPatchId]);
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
  // 却不清掉待确认补丁（放弃应走拒绝），故这里只给接受 / 拒绝，不给破坏性停止。
  const awaitingConfirm = run.status === 'waiting' && !waitingForPermission;
  // 暂停态给「恢复」出口（不再是死胡同），并保留「停止」；停止是终态、由轻状态条中性收尾。
  const isPaused = run.status === 'paused';
  // 终态只留轻状态/回复收尾，不再渲染没有动作的空操作条。
  const isTerminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'stopped';
  if (isTerminal && !run.deliveryUnknown) return null;

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

  const stopButton = (
    <Button
      size="compact"
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
  );

  if (run.deliveryUnknown)
    return (
      <div className="px-3 py-1.5" data-testid="run-action-bar">
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-xs text-warning" data-testid="run-action-status">
            本轮结果未知；连接结束不代表执行失败。请核对原运行，不会自动重放。
          </span>
          <Button
            size="compact"
            variant="ghost"
            onClick={controls.onReconcileRun}
            data-testid="run-reconcile"
          >
            核对状态
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={controls.onPauseRun}
            data-testid="run-pause"
          >
            请求暂停
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={handleStopClick}
            onBlur={cancelStopConfirm}
            data-testid="run-stop"
          >
            {stopConfirmArmed ? '确认停止' : '请求停止'}
          </Button>
        </div>
      </div>
    );

  // 要作者拍板的两种：就地给一组编号选项（不弹居中窗口），一次只问一件；
  // key 跟着这件事走，下一件出来时重新选，不沿用上一件的高亮。
  if (waitingForPermission || awaitingConfirm) {
    const permission = run.steps.find((step) => step.id === 'permission-required');
    const approval = run.steps.find((step) => step.id === 'approval');
    const target = approval?.filePath?.split(/[\\/]/).pop();
    return (
      <div className="px-1.5 py-1.5" data-testid="run-action-bar">
        <div className="flex flex-col gap-1">
          {waitingForPermission ? (
            <DecisionChoices
              key={`${run.id}:permission`}
              title="等待你确认：允许 AI 执行这一步吗？"
              detail={permission?.detail}
              onTypeAhead={onTypeAhead}
              choices={[
                {
                  label: '允许',
                  testid: 'run-approve-permission',
                  onSelect: controls.onApprovePermission,
                },
                {
                  label: '不允许',
                  testid: 'run-deny-permission',
                  onSelect: controls.onDenyPermission,
                },
              ]}
            />
          ) : acceptingPatchId !== null && acceptingPatchId === approval?.patchId ? (
            <div
              role="status"
              className="px-2 py-1 text-xs text-muted"
              data-testid="run-accept-writing"
            >
              {target ? `正在写进文件（${target}）…` : '正在写进文件…'}
            </div>
          ) : (
            <DecisionChoices
              key={`${run.id}:patch:${approval?.patchId ?? ''}`}
              title="AI 修订已生成，要写进文件吗？"
              detail={
                target
                  ? `对比在编辑器里（${target}），看完再选；逐块接受、存成旁注在编辑器底部。`
                  : '对比在编辑器里，看完再选。'
              }
              onTypeAhead={onTypeAhead}
              choices={[
                {
                  label: '接受，写进文件',
                  testid: 'run-accept-patch',
                  onSelect: () => {
                    if (controls.onAcceptPatch?.() === 'accepted')
                      setAcceptingPatchId(approval?.patchId ?? null);
                  },
                },
                {
                  label: '拒绝',
                  testid: 'run-reject-patch',
                  onSelect: () => controls.onRejectPatch?.(''),
                },
                {
                  label: '拒绝，并告诉 AI 怎么改',
                  testid: 'run-reject-explain',
                  needsText: {
                    placeholder: '说说该怎么改，回车发出',
                    submitLabel: '否掉并重来',
                    inputTestid: 'run-reject-input',
                    submitTestid: 'run-reject-confirm',
                  },
                  onSelect: (text) => controls.onRejectPatch?.(text ?? ''),
                },
              ]}
            />
          )}
          {waitingForPermission && <div className="flex justify-end px-2">{stopButton}</div>}
        </div>
      </div>
    );
  }

  if (!isPaused) return null;
  const resume = recovery?.checkpointResume;
  // 暂停是一行字加三颗键：恢复的前提说明放在悬停提示里，不再在条上、卡片上各写一遍。
  return (
    <div className="px-3 py-0.5" data-testid="run-action-bar">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <span
          className="min-w-0 flex-1 text-xs font-medium text-muted"
          role="status"
          title={resume?.message}
          data-testid="run-action-status"
        >
          已暂停
        </span>
        <Button
          size="compact"
          variant="primary"
          className={runActionButtonClass}
          onClick={controls.onResumeRun}
          disabled={resumePending || resume?.canResume === false}
          title={resume?.message ?? '恢复本轮'}
          data-testid="run-resume"
        >
          恢复
        </Button>
        {resume && controls.onReconcileRun && (
          <Button
            size="compact"
            variant="ghost"
            className={runActionButtonClass}
            onClick={controls.onReconcileRun}
            data-testid="run-reconcile"
            title="只读取本轮状态，不重新执行"
          >
            核对状态
          </Button>
        )}
        {stopButton}
      </div>
    </div>
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

export const MessageItem = memo(function MessageItem({
  message,
  onRegenerate,
}: {
  message: Message;
  onRegenerate?: () => void;
}) {
  if (message.role === 'user') {
    return (
      <div
        className="group flex animate-slide-up-fade flex-col items-end"
        data-testid="user-message-row"
      >
        <div
          className="sf-bubble-user max-w-[85%] bg-elevated px-4 py-3 text-sm leading-6 text-foreground"
          data-testid="user-message"
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {/* 自己发的话也能复制；鼠标移上来才出现，不给每条消息都挂一排键。 */}
        <MessageActions
          content={message.content}
          copiedToast="已复制"
          className={revealOnHover()}
        />
      </div>
    );
  }

  return (
    <article
      className="max-w-[760px] animate-slide-up-fade text-sm leading-7 text-foreground"
      data-testid="assistant-message"
    >
      <div className="py-1">
        <AssistantMarkdown
          content={message.content}
          streaming={message.stream?.phase === 'streaming'}
        />
        {message.stream && message.stream.phase !== 'complete' && (
          <StreamPhase phase={message.stream.phase} />
        )}
        {message.stream?.detail && (
          <p className="mt-1 text-xs text-muted">{message.stream.detail}</p>
        )}
        {(!message.stream || message.stream.phase === 'complete') && message.content.trim() && (
          <MessageActions content={message.content} onRegenerate={onRegenerate} />
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
      <div className={`${CHAT_COLUMN} flex items-center gap-3`}>
        <div className="min-w-0 flex-1 truncate text-xs text-muted" title={text}>
          {text}
        </div>
        {retryVisible && (
          <Button size="xs" variant="secondary" onClick={onRetry}>
            重试本轮
          </Button>
        )}
      </div>
    </div>
  );
}
