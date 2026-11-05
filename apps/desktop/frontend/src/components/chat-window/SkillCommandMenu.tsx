import type { SlashMenu } from './slash-menu';
import type { ConversationSkillsView } from './useConversationSkills';
import { PlainButton } from '../ui';

export const SKILL_COMMAND_MENU_ID = 'composer-skill-commands';

/** 键盘高亮的序号映射到真实 option；重名禁用行不占序号。 */
export function slashMenuOptionId(menu: SlashMenu, activeIndex: number): string | undefined {
  const command = menu.commands.find((item) => item.pick === activeIndex);
  if (command) return `${SKILL_COMMAND_MENU_ID}-command-${command.name}`;
  const skillIndex = menu.skills.findIndex((item) => item.pick === activeIndex);
  return skillIndex < 0 ? undefined : `${SKILL_COMMAND_MENU_ID}-${skillIndex}`;
}

const OPTION_CLASS =
  'flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors';

/** 输入框里打 `/` 弹出的列表：指令在上、技能在下。只负责显示，选哪一项、键盘怎么走由输入框管。 */
export function SkillCommandMenu({
  view,
  query,
  menu,
  activeIndex,
  onPick,
}: {
  view: ConversationSkillsView;
  query: string;
  menu: SlashMenu;
  /** 在 menu.picks 里的位置。 */
  activeIndex: number;
  onPick: (name: string) => void;
}) {
  const items = menu.skills;
  const note =
    view.status === 'loading'
      ? '正在读技能…'
      : view.status === 'error'
        ? `读不到技能：${view.message}`
        : view.status === 'ready' && view.skills.length === 0
          ? '这本书还没有技能。在对话头「上下文」里可以按模板新建。'
          : // 打的字对上了指令，就不再说「没有叫『写』的技能」。
            view.status === 'ready' && items.length === 0 && menu.commands.length === 0
            ? `没有叫「${query}」的技能。`
            : null;
  const skillsShown = note !== null || items.length > 0;
  return (
    <div
      className="absolute bottom-full left-2 z-10 mb-1.5 w-[320px] max-w-[calc(100%-1rem)] animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-dropdown"
      data-testid="skill-command-menu"
      id={SKILL_COMMAND_MENU_ID}
      role="listbox"
      aria-label="指令与技能"
    >
      {menu.commands.length > 0 && (
        <div className={skillsShown ? 'mb-1 border-b border-border pb-1' : undefined}>
          {menu.commands.map((command) => (
            <PlainButton
              key={command.name}
              id={`${SKILL_COMMAND_MENU_ID}-command-${command.name}`}
              role="option"
              aria-selected={activeIndex === command.pick}
              tabIndex={-1}
              // 不抢输入框的焦点：点完接着打字。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(command.name)}
              className={`${OPTION_CLASS} hover:bg-elevated ${activeIndex === command.pick ? 'bg-elevated' : ''}`}
              data-testid="slash-command-option"
            >
              <span className="block max-w-full truncate text-xs text-foreground">
                /{command.name}
              </span>
              <span className="mt-0.5 block max-w-full text-2xs leading-snug text-subtle">
                {command.hint}
              </span>
            </PlainButton>
          ))}
        </div>
      )}
      {skillsShown && (
        <div className="px-2.5 pb-1 pt-0.5 text-3xs text-subtle">
          技能 · 点名后这一轮带全文 · ↑↓ 选，Enter 填入，Esc 关
        </div>
      )}
      {note !== null ? (
        <p
          className={`px-2.5 py-1.5 text-xs ${view.status === 'error' ? 'text-warning' : 'text-muted'}`}
          role={view.status === 'loading' ? 'status' : undefined}
          data-testid="skill-command-note"
        >
          {note}
        </p>
      ) : (
        items.length > 0 && (
          <div className="max-h-60 overflow-y-auto">
            {items.map(({ skill, conflict, pick }, index) => (
              <PlainButton
                key={`${skill.plugin ?? ''}:${skill.path}`}
                id={`${SKILL_COMMAND_MENU_ID}-${index}`}
                role="option"
                aria-selected={pick !== null && pick === activeIndex}
                aria-disabled={conflict || undefined}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={conflict ? undefined : () => onPick(skill.name)}
                className={`${OPTION_CLASS} ${conflict ? 'cursor-not-allowed' : 'hover:bg-elevated'} ${pick !== null && pick === activeIndex ? 'bg-elevated' : ''}`}
                title={skill.path}
                data-testid="skill-command-option"
              >
                <span
                  className={`block max-w-full truncate text-xs ${conflict ? 'text-subtle' : 'text-foreground'}`}
                >
                  /{skill.name}
                </span>
                <span
                  className={`mt-0.5 block max-w-full text-2xs leading-snug ${conflict ? 'text-warning' : 'truncate text-subtle'}`}
                >
                  {conflict
                    ? `与指令重名，/${skill.name} 会当成指令；要点名它请改名`
                    : skill.plugin !== null
                      ? `插件「${skill.plugin}」 · ${skill.when}`
                      : skill.when}
                </span>
              </PlainButton>
            ))}
          </div>
        )
      )}
    </div>
  );
}
