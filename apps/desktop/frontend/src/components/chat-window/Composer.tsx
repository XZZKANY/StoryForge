import { useLayoutEffect, useRef, useState } from 'react';
import { AGENT_ROLE_SUGGESTIONS } from '../../lib/agent-roles';
import { type AgentPermissionProfile } from '../../lib/agent-permission';
import { basename } from '../app/helpers';
import { ArrowUp, Plus, X } from '../icons/shell-icons';
import { roleMentionQuery } from './display-utils';
import { PermissionProfileSelector } from './PermissionProfileSelector';

export function ComposerBox({
  value,
  disabled,
  loading,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  history,
  onAddContext,
  onTogglePinnedContext,
  permissionProfile,
  onPermissionProfileChange,
}: {
  value: string;
  disabled: boolean;
  loading?: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  history?: string[];
  onAddContext: () => void;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  permissionProfile: AgentPermissionProfile;
  onPermissionProfileChange: (profile: AgentPermissionProfile) => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3">
      <div className="mx-auto max-w-[800px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ComposerSurface
            value={value}
            disabled={disabled}
            loading={loading}
            busy={busy}
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            history={history}
            onAddContext={onAddContext}
            onTogglePinnedContext={onTogglePinnedContext}
            onChange={onChange}
            onSubmit={onSubmit}
            permissionProfile={permissionProfile}
            onPermissionProfileChange={onPermissionProfileChange}
          />
        </form>
      </div>
    </div>
  );
}

export function ComposerSurface({
  value,
  disabled,
  loading,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  history,
  onAddContext,
  onTogglePinnedContext,
  permissionProfile,
  onPermissionProfileChange,
}: {
  value: string;
  disabled: boolean;
  loading?: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  history?: string[];
  onAddContext: () => void;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  permissionProfile: AgentPermissionProfile;
  onPermissionProfileChange: (profile: AgentPermissionProfile) => void;
}) {
  const canSubmit = value.trim() && !disabled && !busy;
  // 方向键回溯已发送消息：游标为 null 表示在编辑当前草稿，
  // 数字表示正浏览 history[index]。draft 保留进入历史前的草稿，ArrowDown 越过最新即还原。
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pinButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const historyIndexRef = useRef<number | null>(null);
  const draftRef = useRef<string>('');
  const [roleSuggestionIndex, setRoleSuggestionIndex] = useState(0);
  const [dismissedRoleValue, setDismissedRoleValue] = useState<string | null>(null);
  const [showAllPins, setShowAllPins] = useState(false);

  const [historyCaretRequest, setHistoryCaretRequest] = useState<{ value: string } | null>(null);
  const handledHistoryCaretRef = useRef<typeof historyCaretRequest>(null);
  useLayoutEffect(() => {
    if (!historyCaretRequest || handledHistoryCaretRef.current === historyCaretRequest) return;
    handledHistoryCaretRef.current = historyCaretRequest;
    const el = textareaRef.current;
    // Apply once with the history commit, never in a later frame that can overwrite a new selection.
    if (value !== historyCaretRequest.value || !el || el.disabled || document.activeElement !== el)
      return;
    el.setSelectionRange(value.length, value.length);
  }, [historyCaretRequest, value]);
  const applyHistoryValue = (nextValue: string) => {
    onChange(nextValue);
    setHistoryCaretRequest({ value: nextValue });
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
      applyHistoryValue(entries[index]);
      return true;
    }
    if (index === null) return false; // 不在历史中，ArrowDown 交回默认行为
    if (index < entries.length - 1) {
      index += 1;
      historyIndexRef.current = index;
      applyHistoryValue(entries[index]);
    } else {
      historyIndexRef.current = null;
      applyHistoryValue(draftRef.current);
    }
    return true;
  };

  // 默认收纳超过 3 枚的参考，展开后每项仍可独立管理。
  const visiblePins = showAllPins ? explicitContextPaths : explicitContextPaths.slice(0, 3);
  const overflowPins = explicitContextPaths.slice(3);
  const focusPinnable = Boolean(currentFileLabel) && Boolean(onTogglePinnedContext);
  const roleQuery = roleMentionQuery(value);
  const roleSuggestions =
    roleQuery === null
      ? []
      : AGENT_ROLE_SUGGESTIONS.filter((item) =>
          item.mention.toLowerCase().startsWith(roleQuery.toLowerCase()),
        );
  const showRoleSuggestions =
    roleSuggestions.length > 0 && !disabled && !busy && dismissedRoleValue !== value;
  const activeRoleSuggestion = roleSuggestions[roleSuggestionIndex] ?? roleSuggestions[0];
  const insertRoleMention = (mention: string) => {
    const nextValue =
      roleQuery === null
        ? `${value}${value.endsWith(' ') || !value ? '' : ' '}${mention} `
        : value.replace(/@[^\s，。！？!?；;：:,、]*$/, `${mention} `);
    historyIndexRef.current = null;
    onChange(nextValue);
    setRoleSuggestionIndex(0);
    textareaRef.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className="group relative flex flex-col overflow-visible rounded-xl border border-border/80 bg-surface transition-all focus-within:border-agent/60"
      style={{
        boxShadow: 'var(--shadow-composer)',
        transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
      }}
      onFocus={(e) => {
        if (e.currentTarget.contains(e.target as Node)) {
          e.currentTarget.style.boxShadow =
            'var(--shadow-composer-focus), 0 0 0 3px rgb(var(--agent) / 0.1)';
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          e.currentTarget.style.boxShadow = 'var(--shadow-composer)';
        }
      }}
    >
      {showRoleSuggestions && (
        <div
          className="absolute bottom-full left-2 z-10 mb-1.5 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-lg border border-border bg-surface px-2 py-2 shadow-[var(--shadow-dropdown)]"
          data-testid="agent-role-suggestions"
          id="agent-role-suggestions"
          role="listbox"
          aria-label="Agent 角色"
        >
          {roleSuggestions.map((item, index) => (
            <button
              key={item.mention}
              id={`agent-role-suggestion-${index}`}
              type="button"
              className="h-7 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground"
              onClick={() => insertRoleMention(item.mention)}
              data-testid="agent-role-suggestion"
              data-role-name={item.roleName}
              role="option"
              tabIndex={-1}
              aria-selected={index === roleSuggestionIndex}
            >
              {item.mention}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        data-testid="composer-input"
        value={value}
        onChange={(event) => {
          historyIndexRef.current = null; // 手动改动即退出历史回溯，回到实时草稿
          setRoleSuggestionIndex(0);
          setDismissedRoleValue(null);
          onChange(event.target.value);
        }}
        // 流式运行期间保持可编辑，作者能边等边预写下一轮；只禁「发送」（Enter 守卫 + 底排改暂停键）。
        disabled={disabled}
        rows={2}
        className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 pb-1.5 pt-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={
          loading
            ? '正在加载会话…'
            : disabled
              ? '打开项目后即可使用 StoryForge'
              : '输入想法、问题，或 @剧情 @人物 点名角色…'
        }
        aria-label="给 StoryForge 发送消息"
        aria-autocomplete="list"
        aria-controls={showRoleSuggestions ? 'agent-role-suggestions' : undefined}
        aria-expanded={showRoleSuggestions}
        aria-activedescendant={
          showRoleSuggestions
            ? `agent-role-suggestion-${Math.min(roleSuggestionIndex, roleSuggestions.length - 1)}`
            : undefined
        }
        onKeyDown={(event) => {
          // IME 组字期间（拼音选字）一律不拦截：Enter 上屏候选、方向键选候选都不应触发发送/回溯。
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape' && showRoleSuggestions) {
            event.preventDefault();
            event.stopPropagation();
            setDismissedRoleValue(value);
            return;
          }
          if (event.key === 'Enter') {
            if (event.shiftKey) return; // Shift+Enter 换行
            if (showRoleSuggestions && activeRoleSuggestion) {
              event.preventDefault();
              insertRoleMention(activeRoleSuggestion.mention);
              return;
            }
            // Enter 或 Ctrl/Cmd+Enter 均发送。
            event.preventDefault();
            if (disabled || busy) return; // 流式期间可继续预写，但 Enter 此刻不发送
            historyIndexRef.current = null;
            onSubmit?.();
            return;
          }
          // Modified arrows belong to native selection/navigation, not history or suggestions.
          if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
          if (event.key === 'ArrowUp') {
            if (showRoleSuggestions) {
              event.preventDefault();
              setRoleSuggestionIndex((index) =>
                index <= 0 ? roleSuggestions.length - 1 : index - 1,
              );
              return;
            }
            const el = event.currentTarget;
            if (el.selectionStart === 0 && el.selectionEnd === 0) {
              if (recallHistory('prev')) event.preventDefault();
            }
            return;
          }
          if (event.key === 'ArrowDown') {
            if (showRoleSuggestions) {
              event.preventDefault();
              setRoleSuggestionIndex((index) => (index + 1) % roleSuggestions.length);
              return;
            }
            const el = event.currentTarget;
            if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
              if (recallHistory('next')) event.preventDefault();
            }
          }
        }}
      />
      {/* 单层悬浮舱工具条：上下文（＋挂载 / @焦点软引用 / 硬引用标签）在左，发送在右，柔虚线分隔 */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-border/50 px-2.5 py-1.5 text-2xs text-subtle">
        <button
          type="button"
          title="固定当前文件为参考"
          aria-label="固定当前文件为参考"
          onClick={onAddContext}
          disabled={disabled}
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-sm text-subtle transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} strokeWidth={1.7} />
        </button>
        <PermissionProfileSelector
          value={permissionProfile}
          onChange={onPermissionProfileChange}
          disabled={disabled}
          busy={busy}
        />
        {focusPinnable ? (
          <button
            type="button"
            title={`${currentFileLabel} · 点击固定为参考`}
            aria-label={`固定当前文件为参考：${currentFileLabel}`}
            onClick={() => onTogglePinnedContext?.(currentFileLabel as string)}
            disabled={disabled}
            className="group/focus inline-flex min-w-0 flex-shrink items-center gap-1 rounded-sm px-1.5 py-0.5 text-muted transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="font-semibold text-agent">@</span>
            <span className="max-w-[120px] truncate">{basename(currentFileLabel as string)}</span>
            <span className="hidden text-3xs text-subtle group-hover/focus:inline group-focus-within/focus:inline">
              固定
            </span>
          </button>
        ) : (
          <span
            className="inline-flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-muted"
            title="当前编辑焦点（随聚焦页签漂移）"
          >
            <span className="font-semibold text-agent">@</span>
            <span className="max-w-[130px] truncate">
              {currentFileLabel ? basename(currentFileLabel) : '当前文件'}
            </span>
          </span>
        )}
        {visiblePins.map((path, index) => (
          <span
            key={path}
            className="group/pin inline-flex max-w-[120px] flex-shrink-0 items-center gap-1 rounded-sm bg-elevated px-1.5 py-0.5 text-muted"
            title={path}
          >
            <span className="truncate">{basename(path)}</span>
            {onTogglePinnedContext && (
              <button
                type="button"
                className="inline-flex flex-shrink-0 leading-none text-subtle transition-colors hover:text-foreground"
                title="取消固定"
                aria-label={`取消固定 ${basename(path)}`}
                disabled={disabled}
                ref={(button) => {
                  if (button) pinButtonRefs.current.set(path, button);
                  else pinButtonRefs.current.delete(path);
                }}
                onClick={(event) => {
                  if (document.activeElement === event.currentTarget) {
                    const nextPath = visiblePins[index + 1] ?? visiblePins[index - 1];
                    const nextButton = nextPath ? pinButtonRefs.current.get(nextPath) : null;
                    (nextButton ?? textareaRef.current)?.focus({ preventScroll: true });
                  }
                  onTogglePinnedContext(path);
                }}
              >
                <X size={11} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {overflowPins.length > 0 && (
          <button
            type="button"
            className="flex-shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 text-subtle hover:text-foreground"
            data-testid="composer-context-expand"
            aria-expanded={showAllPins}
            aria-label={
              showAllPins ? '收起更多固定参考' : `显示其余 ${overflowPins.length} 个固定参考`
            }
            title={overflowPins.map(basename).join('、')}
            onClick={() => setShowAllPins((current) => !current)}
          >
            {showAllPins ? '收起' : `+${overflowPins.length}`}
          </button>
        )}
        <button
          type={onSubmit ? 'button' : 'submit'}
          className="ml-auto flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md bg-elevated text-muted transition-colors hover:text-foreground group-focus-within:bg-agent group-focus-within:text-agent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title="发送"
          aria-label="发送"
          disabled={!canSubmit}
          onClick={onSubmit}
          data-testid="composer-submit"
        >
          <ArrowUp size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
