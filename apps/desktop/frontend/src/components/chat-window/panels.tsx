import { Button, PlainButton, revealOnHover } from '../ui';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentStepsPanel, hasProcess } from './AgentStepsPanel';
import { AssistantMarkdown } from './AssistantMarkdown';
import { CHAT_COLUMN } from './column';
import { MessageActions } from './MessageActions';
import { shouldShowAgentRunRecovery, type AgentRunRecoveryDisplay } from './recovery';
import { StreamPhase } from './StreamPhase';
import type { AgentRun, Message } from './types';

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
