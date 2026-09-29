import { IconButton } from '../ui';
import { useCallback, useRef, type MutableRefObject } from 'react';
import { AGENT_ROLE_SUGGESTIONS } from '../../lib/agent-roles';
import { type AgentPermissionProfile } from '../../lib/agent-permission';
import { basename } from '../app/helpers';
import { ArrowUp, Plus } from '../icons/shell-icons';
import { roleMentionQuery } from './display-utils';
import { PermissionProfileSelector } from './PermissionProfileSelector';
import type { QueuedChatMessage } from './useChatSubmission';

export function ComposerBox({
  inputRef,
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  history,
  onAddContext,
  contextPickerOpen = false,
  onTogglePinnedContext,
  permissionProfile,
  onPermissionProfileChange,
  queuedMessages = [],
  onRemoveQueuedMessage,
}: {
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  history?: string[];
  onAddContext: () => void;
  contextPickerOpen?: boolean;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  permissionProfile: AgentPermissionProfile;
  onPermissionProfileChange: (profile: AgentPermissionProfile) => void;
  queuedMessages?: readonly QueuedChatMessage[];
  onRemoveQueuedMessage?: (id: number) => void;
}) {
  return (
    <div className="flex-shrink-0 p-3">
      <div className="mx-auto max-w-[800px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && value.trim()) onSubmit();
          }}
        >
          <ComposerSurface
            inputRef={inputRef}
            value={value}
            disabled={disabled}
            busy={busy}
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            history={history}
            onAddContext={onAddContext}
            contextPickerOpen={contextPickerOpen}
            onTogglePinnedContext={onTogglePinnedContext}
            onChange={onChange}
            onSubmit={onSubmit}
            permissionProfile={permissionProfile}
            onPermissionProfileChange={onPermissionProfileChange}
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
          />
        </form>
      </div>
    </div>
  );
}

export function ComposerSurface({
  inputRef,
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  history,
  onAddContext,
  contextPickerOpen = false,
  onTogglePinnedContext,
  permissionProfile,
  onPermissionProfileChange,
  queuedMessages = [],
  onRemoveQueuedMessage,
}: {
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  history?: string[];
  onAddContext: () => void;
  contextPickerOpen?: boolean;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  permissionProfile: AgentPermissionProfile;
  onPermissionProfileChange: (profile: AgentPermissionProfile) => void;
  queuedMessages?: readonly QueuedChatMessage[];
  onRemoveQueuedMessage?: (id: number) => void;
}) {
  // 运行中可保留一条待发；已有待发时继续提交仅提示，草稿不清空。
  const canSubmit = value.trim() && !disabled;
  // 方向键回溯已发送消息：游标为 null 表示在编辑当前草稿，
  // 数字表示正浏览 history[index]。draft 保留进入历史前的草稿，ArrowDown 越过最新即还原。
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachInput = useCallback(
    (element: HTMLTextAreaElement | null) => {
      textareaRef.current = element;
      if (inputRef) inputRef.current = element;
    },
    [inputRef],
  );
  const historyIndexRef = useRef<number | null>(null);
  const draftRef = useRef<string>('');

  const moveCaretToEnd = () => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  // 返回 true 表示本次按键已被历史回溯消费（需 preventDefault），false 交回默认光标行为。
  const recallHistory = (direction: 'prev' | 'next'): boolean => {
    const entries = history ?? [];
    if (entries.length === 0) return false;
    let index = historyIndexRef.current;
    if (direction === 'prev') {
      if (index === null) {
        draftRef.current = value;
        index = entries.length - 1;
      } else if (index > 0) {
        index -= 1;
      } else {
        return true; // 已到最旧，拦截但不改动
      }
      historyIndexRef.current = index;
      onChange(entries[index]);
      moveCaretToEnd();
      return true;
    }
    if (index === null) return false; // 不在历史中，ArrowDown 交回默认行为
    if (index < entries.length - 1) {
      index += 1;
      historyIndexRef.current = index;
      onChange(entries[index]);
    } else {
      historyIndexRef.current = null;
      onChange(draftRef.current);
    }
    moveCaretToEnd();
    return true;
  };

  // 硬引用超 3 枚收纳为 +N（悬停看全名）；焦点可钉时点击 @焦点即锁为硬引用。
  const visiblePins = explicitContextPaths.slice(0, 3);
  const overflowPins = explicitContextPaths.slice(3);
  const focusPinnable = Boolean(currentFileLabel) && Boolean(onTogglePinnedContext);
  const roleQuery = roleMentionQuery(value);
  const roleSuggestions =
    roleQuery === null
      ? []
      : AGENT_ROLE_SUGGESTIONS.filter((item) =>
          item.mention.toLowerCase().startsWith(roleQuery.toLowerCase()),
        );
  const insertRoleMention = (mention: string) => {
    const nextValue =
      roleQuery === null
        ? `${value}${value.endsWith(' ') || !value ? '' : ' '}${mention} `
        : value.replace(/@[^\s，。！？!?；;：:,、]*$/, `${mention} `);
    onChange(nextValue);
  };

  return (
    <div
      data-testid="composer-surface"
      className="sf-input-shell group relative flex min-w-0 flex-col overflow-visible rounded-xl border border-border bg-background shadow-sm transition-colors focus-within:border-accent/60"
    >
      {queuedMessages.length > 0 && (
        <section
          className="border-b border-border/60 bg-elevated/40 px-3 py-2"
          data-testid="composer-queued-messages"
          aria-label={`待发送消息 ${queuedMessages.length} 条`}
        >
          <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-3xs text-subtle">
            <span>待发送 · {queuedMessages.length} 条</span>
            <span>本轮结束并完成确认后发送</span>
          </div>
          <ul className="flex max-h-20 flex-col gap-0.5 overflow-y-auto">
            {queuedMessages.map((queued) => (
              <li key={queued.id} className="flex min-w-0 items-center gap-2 text-xs text-muted">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {queued.content}
                </span>
                {onRemoveQueuedMessage && (
                  <button
                    type="button"
                    className="-my-0.5 flex-shrink-0 rounded-sm px-1.5 py-0.5 text-3xs text-subtle transition-colors hover:bg-border hover:text-foreground"
                    aria-label={`取消待发送消息：${queued.content}`}
                    onClick={() => {
                      onRemoveQueuedMessage(queued.id);
                      textareaRef.current?.focus();
                    }}
                  >
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {roleSuggestions.length > 0 && !disabled && !busy && (
        <div
          className="absolute bottom-full left-2 z-10 mb-1.5 flex max-w-[calc(100%-1rem)] animate-fade-in flex-wrap gap-1.5 rounded-lg border border-border bg-surface px-2 py-2 shadow-dropdown"
          data-testid="agent-role-suggestions"
        >
          {roleSuggestions.map((item) => (
            <button
              key={item.mention}
              type="button"
              className="h-7 rounded-md border border-border-strong px-2.5 text-xs text-foreground transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground"
              onClick={() => insertRoleMention(item.mention)}
              data-testid="agent-role-suggestion"
              data-role-name={item.roleName}
            >
              {item.mention}
            </button>
          ))}
        </div>
      )}
      {(currentFileLabel || explicitContextPaths.length > 0) && (
        <div
          data-testid="composer-contexts"
          aria-label="本轮引用"
          className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto px-3 pt-3 text-xs"
        >
          {focusPinnable ? (
            <button
              type="button"
              className="group/focus inline-flex min-w-0 flex-shrink items-center gap-1 h-6 rounded-md px-2 text-muted transition-colors hover:bg-elevated hover:text-foreground"
              title={`${currentFileLabel} · 点击固定为参考`}
              disabled={disabled}
              onClick={() => onTogglePinnedContext?.(currentFileLabel as string)}
            >
              <span className="font-semibold text-agent">@</span>
              <span className="max-w-[120px] truncate">{basename(currentFileLabel as string)}</span>
              <span className="hidden text-3xs text-subtle group-hover/focus:inline">固定</span>
            </button>
          ) : currentFileLabel ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 h-6 rounded-md px-2 text-muted"
              title="当前编辑焦点（随聚焦页签漂移）"
            >
              <span className="font-semibold text-agent">@</span>
              <span className="max-w-[130px] truncate">{basename(currentFileLabel)}</span>
            </span>
          ) : null}
          {visiblePins.map((path) => (
            <span
              key={path}
              className="group/pin inline-flex max-w-[120px] flex-shrink-0 items-center gap-1 h-6 rounded-md bg-elevated px-2 text-muted"
              title={path}
            >
              <span className="truncate">{basename(path)}</span>
              {onTogglePinnedContext && (
                <button
                  type="button"
                  className="-m-0.5 inline-flex flex-shrink-0 p-0.5 leading-none text-subtle transition-colors hover:text-foreground"
                  title="取消固定"
                  aria-label={`取消固定参考：${path}`}
                  disabled={disabled}
                  onClick={() => onTogglePinnedContext(path)}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {overflowPins.length > 0 && (
            <button
              type="button"
              className="flex-shrink-0 h-6 rounded-md bg-elevated px-2 text-muted hover:text-foreground"
              title={overflowPins.join('、')}
              aria-label={`查看全部 ${explicitContextPaths.length} 个固定参考`}
              aria-expanded={contextPickerOpen}
              disabled={disabled}
              onClick={onAddContext}
            >
              +{overflowPins.length}
            </button>
          )}
        </div>
      )}
      <textarea
        ref={attachInput}
        value={value}
        onChange={(event) => {
          historyIndexRef.current = null; // 手动改动即退出历史回溯，回到实时草稿
          onChange(event.target.value);
        }}
        // 流式运行期间保持可编辑；单条待发槽位由 submission owner 同步保护。
        disabled={disabled}
        rows={2}
        className="sf-inner-input max-h-40 min-h-[72px] w-full resize-none bg-transparent px-3 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={disabled ? '打开项目后即可使用 StoryForge' : '输入想法，@ 提及角色'}
        aria-label="给 StoryForge 发送消息"
        onKeyDown={(event) => {
          // IME 组字期间（拼音选字）一律不拦截：Enter 上屏候选、方向键选候选都不应触发发送/回溯。
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            if (event.shiftKey) return; // Shift+Enter 换行
            // Enter 或 Ctrl/Cmd+Enter 均发送；busy 时交给 onSubmit 排队，不在此吞掉作者的字。
            event.preventDefault();
            if (disabled) return;
            historyIndexRef.current = null;
            onSubmit?.();
            return;
          }
          if (event.key === 'ArrowUp') {
            const el = event.currentTarget;
            if (el.selectionStart === 0 && el.selectionEnd === 0) {
              if (recallHistory('prev')) event.preventDefault();
            }
            return;
          }
          if (event.key === 'ArrowDown') {
            const el = event.currentTarget;
            if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
              if (recallHistory('next')) event.preventDefault();
            }
          }
        }}
      />
      <div
        data-testid="composer-toolbar"
        className="flex items-center gap-1 px-2 pb-2 text-xs text-muted"
      >
        <IconButton
          label="添加上下文"
          icon={<Plus size={16} strokeWidth={1.8} />}
          aria-expanded={contextPickerOpen}
          onClick={onAddContext}
          disabled={disabled}
        />
        <PermissionProfileSelector
          fitToComposer
          value={permissionProfile}
          onChange={onPermissionProfileChange}
          disabled={disabled}
          busy={busy}
        />
        <IconButton
          type={onSubmit ? 'button' : 'submit'}
          variant="primary"
          className="ml-auto"
          tooltip={busy ? '暂存为待发送消息' : '发送 · Enter（Shift+Enter 换行）'}
          label={busy ? '暂存为待发送消息' : '发送'}
          icon={<ArrowUp size={16} strokeWidth={2} />}
          aria-keyshortcuts="Enter"
          disabled={!canSubmit}
          onClick={onSubmit}
          data-testid="composer-submit"
        />
      </div>
    </div>
  );
}
