import { AGENT_ROLE_SUGGESTIONS } from '../../lib/agent-roles';
import { basename } from '../app/helpers';
import { ArrowUp, Plus } from '../icons/shell-icons';
import { roleMentionQuery } from './display-utils';

function PauseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="2" width="2.5" height="8" rx="1" fill="currentColor" />
      <rect x="7" y="2" width="2.5" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

export function ComposerBox({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onPauseRun,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPauseRun?: () => void;
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
            busy={busy}
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            onAddContext={onAddContext}
            onTogglePinnedContext={onTogglePinnedContext}
            onChange={onChange}
            onSubmit={onSubmit}
            onPauseRun={onPauseRun}
          />
        </form>
      </div>
    </div>
  );
}

export function ComposerSurface({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  onAddContext,
  onTogglePinnedContext,
  onPauseRun,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext?: (path: string) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onPauseRun?: () => void;
}) {
  const canSubmit = value.trim() && !disabled && !busy;
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
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-surface shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-shadow focus-within:border-agent/60 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
      {roleSuggestions.length > 0 && !disabled && !busy && (
        <div
          className="absolute bottom-full left-2 z-10 mb-1.5 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-md border border-border bg-panel px-2 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
          data-testid="agent-role-suggestions"
        >
          {roleSuggestions.map((item) => (
            <button
              key={item.mention}
              type="button"
              className="h-7 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground"
              onClick={() => insertRoleMention(item.mention)}
              data-testid="agent-role-suggestion"
              data-role-name={item.roleName}
            >
              {item.mention}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || busy}
        rows={2}
        className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 pb-1.5 pt-2.5 text-[13px] leading-6 text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={
          disabled ? '打开项目后即可使用 StoryForge' : '输入想法、问题，或 @剧情 @人物 点名角色...'
        }
        aria-label="给 StoryForge 发送消息"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
          }
        }}
      />
      {/* 单层悬浮舱工具条：上下文（＋挂载 / @焦点软引用 / 硬引用标签）在左，发送在右，柔虚线分隔 */}
      <div className="flex items-center gap-1.5 border-t border-dashed border-border/50 px-2.5 py-1.5 text-[11px] text-subtle">
        <button
          type="button"
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-elevated hover:text-foreground"
          title="挂载文件为常驻上下文"
          onClick={onAddContext}
        >
          <Plus size={14} strokeWidth={1.7} />
        </button>
        {focusPinnable ? (
          <button
            type="button"
            className="group/focus inline-flex min-w-0 flex-shrink items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-elevated hover:text-foreground"
            title={`${currentFileLabel} · 点击钉为常驻上下文`}
            onClick={() => onTogglePinnedContext?.(currentFileLabel as string)}
          >
            <span className="font-semibold text-agent">@</span>
            <span className="max-w-[120px] truncate">{basename(currentFileLabel as string)}</span>
            <span className="hidden text-[10px] text-subtle group-hover/focus:inline">钉住</span>
          </button>
        ) : (
          <span
            className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted"
            title="当前编辑焦点（随聚焦页签漂移）"
          >
            <span className="font-semibold text-agent">@</span>
            <span className="max-w-[130px] truncate">
              {currentFileLabel ? basename(currentFileLabel) : '当前文件'}
            </span>
          </span>
        )}
        {visiblePins.map((path) => (
          <span
            key={path}
            className="group/pin inline-flex max-w-[120px] flex-shrink-0 items-center gap-1 rounded bg-elevated px-1.5 py-0.5 text-muted"
            title={path}
          >
            <span className="truncate">{basename(path)}</span>
            {onTogglePinnedContext && (
              <button
                type="button"
                className="hidden flex-shrink-0 leading-none text-subtle transition-colors hover:text-foreground group-hover/pin:inline-flex"
                title="移除该常驻上下文"
                onClick={() => onTogglePinnedContext(path)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {overflowPins.length > 0 && (
          <span
            className="flex-shrink-0 rounded bg-elevated px-1.5 py-0.5 text-subtle"
            title={overflowPins.map(basename).join('、')}
          >
            +{overflowPins.length}
          </span>
        )}
        <span className="ml-auto min-w-0 flex-shrink truncate text-subtle">编辑模式</span>
        {busy && onPauseRun ? (
          <button
            type="button"
            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md bg-elevated text-foreground transition-colors hover:bg-agent hover:text-white"
            title="暂停 AgentRun"
            onClick={onPauseRun}
            data-testid="composer-pause-run"
          >
            <PauseGlyph />
          </button>
        ) : (
          <button
            type={onSubmit ? 'button' : 'submit'}
            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md bg-elevated text-muted transition-colors hover:text-foreground group-focus-within:bg-agent group-focus-within:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="发送"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            <ArrowUp size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
