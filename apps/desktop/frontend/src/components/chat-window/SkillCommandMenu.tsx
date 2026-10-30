import type { ConversationSkillItem } from '../../lib/api/conversation-skills';
import type { ConversationSkillsView } from './useConversationSkills';

export const SKILL_COMMAND_MENU_ID = 'composer-skill-commands';

/** 输入框里打 `/` 弹出的技能列表：只负责显示，选哪一项、键盘怎么走由输入框管。 */
export function SkillCommandMenu({
  view,
  query,
  items,
  activeIndex,
  onPick,
}: {
  view: ConversationSkillsView;
  query: string;
  items: readonly ConversationSkillItem[];
  activeIndex: number;
  onPick: (name: string) => void;
}) {
  const note =
    view.status === 'loading'
      ? '正在读技能…'
      : view.status === 'error'
        ? `读不到技能：${view.message}`
        : view.status === 'ready' && view.skills.length === 0
          ? '这本书还没有技能。在对话头「上下文」里可以按模板新建。'
          : view.status === 'ready' && items.length === 0
            ? `没有叫「${query}」的技能。`
            : null;
  return (
    <div
      className="absolute bottom-full left-2 z-10 mb-1.5 w-[320px] max-w-[calc(100%-1rem)] animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-dropdown"
      data-testid="skill-command-menu"
    >
      <div className="px-2.5 pb-1 pt-0.5 text-3xs text-subtle">
        技能 · 点名后这一轮带全文 · ↑↓ 选，Enter 填入，Esc 关
      </div>
      {note !== null ? (
        <p
          className={`px-2.5 py-1.5 text-xs ${view.status === 'error' ? 'text-warning' : 'text-muted'}`}
          role={view.status === 'loading' ? 'status' : undefined}
          data-testid="skill-command-note"
        >
          {note}
        </p>
      ) : (
        <div
          id={SKILL_COMMAND_MENU_ID}
          role="listbox"
          aria-label="技能"
          className="max-h-60 overflow-y-auto"
        >
          {items.map((skill, index) => (
            <button
              key={`${skill.plugin ?? ''}:${skill.path}`}
              id={`${SKILL_COMMAND_MENU_ID}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              // 不抢输入框的焦点：点完接着打字。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(skill.name)}
              className={`flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-elevated ${index === activeIndex ? 'bg-elevated' : ''}`}
              title={skill.path}
              data-testid="skill-command-option"
            >
              <span className="block max-w-full truncate text-xs text-foreground">
                /{skill.name}
              </span>
              <span className="mt-0.5 block max-w-full truncate text-2xs leading-snug text-subtle">
                {skill.plugin !== null ? `插件「${skill.plugin}」 · ${skill.when}` : skill.when}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
