import { AGENT_ROLE_SUGGESTIONS } from '../../lib/agent-roles';
import { roleMentionQuery } from './display-utils';

export function ComposerBox({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  onAddContext,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-[#3A3A40] bg-[#18181B] px-4 py-3">
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
            onChange={onChange}
            onSubmit={onSubmit}
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
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const canSubmit = value.trim() && !disabled && !busy;
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
    <div className="relative min-h-[118px] rounded-xl border border-[#45454C] bg-[#2A2A30] shadow-[0_18px_64px_rgba(0,0,0,0.24)]">
      {roleSuggestions.length > 0 && !disabled && !busy && (
        <div
          className="absolute bottom-[108px] left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 rounded-md border border-[#3A3A40] bg-[#202024] px-2 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
          data-testid="agent-role-suggestions"
        >
          {roleSuggestions.map((item) => (
            <button
              key={item.mention}
              type="button"
              className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:border-[#7FB1FF] hover:bg-[#253044] hover:text-[#EAF2FF]"
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
        rows={3}
        className="h-[70px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-[#F1F1F2] outline-none placeholder:text-[#9A9AA2] disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="flex h-12 items-center gap-2 px-3 pb-3">
        <button
          type="button"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#333333] text-lg leading-none text-[#BDBDBD] transition-colors hover:bg-[#3D3D3D] hover:text-white"
          title="添加上下文"
          onClick={onAddContext}
        >
          +
        </button>
        <span className="max-w-[38%] truncate rounded-md border border-[#333333] px-2 py-1 text-xs text-[#BDBDBD]">
          @ {currentFileLabel ?? '当前文件'}
        </span>
        {explicitContextPaths.slice(-2).map((path) => (
          <span
            key={path}
            className="max-w-[22%] truncate rounded-md border border-[#333333] px-2 py-1 text-xs text-[#BDBDBD]"
            title={path}
          >
            @ {path}
          </span>
        ))}
        <span className="ml-auto min-w-0 truncate text-xs text-[#8F8F8F]">
          StoryForge · Claude · 编辑模式
        </span>
        <button
          type={onSubmit ? 'button' : 'submit'}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-sm text-[#111111] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          title="发送"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
