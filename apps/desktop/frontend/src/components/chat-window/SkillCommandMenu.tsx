import { WRITE_BATCH_COMMAND_NAME } from '@storyforge/project-core';

import { WRITE_BATCH_MENU_HINT, type SlashMenu } from './slash-menu';
import type { ConversationSkillsView } from './useConversationSkills';

export const SKILL_COMMAND_MENU_ID = 'composer-skill-commands';

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
            view.status === 'ready' && items.length === 0 && !menu.command
            ? `没有叫「${query}」的技能。`
            : null;
  const skillsShown = note !== null || items.length > 0;
  return (
    <div
      className="absolute bottom-full left-2 z-10 mb-1.5 w-[320px] max-w-[calc(100%-1rem)] animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-dropdown"
      data-testid="skill-command-menu"
    >
      {menu.command && (
        <div
          role="listbox"
          aria-label="指令"
          className={skillsShown ? 'mb-1 border-b border-border pb-1' : undefined}
        >
          <button
            id={`${SKILL_COMMAND_MENU_ID}-command`}
            type="button"
            role="option"
            aria-selected={activeIndex === 0}
            tabIndex={-1}
            // 不抢输入框的焦点：点完接着打字。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(WRITE_BATCH_COMMAND_NAME)}
            className={`${OPTION_CLASS} hover:bg-elevated ${activeIndex === 0 ? 'bg-elevated' : ''}`}
            data-testid="slash-command-option"
          >
            <span className="block max-w-full truncate text-xs text-foreground">
              /{WRITE_BATCH_COMMAND_NAME}
            </span>
            <span className="mt-0.5 block max-w-full text-2xs leading-snug text-subtle">
              {WRITE_BATCH_MENU_HINT}
            </span>
          </button>
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
          <div
            id={SKILL_COMMAND_MENU_ID}
            role="listbox"
            aria-label="技能"
            className="max-h-60 overflow-y-auto"
          >
            {items.map(({ skill, conflict, pick }, index) => (
              <button
                key={`${skill.plugin ?? ''}:${skill.path}`}
                id={`${SKILL_COMMAND_MENU_ID}-${index}`}
                type="button"
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
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
