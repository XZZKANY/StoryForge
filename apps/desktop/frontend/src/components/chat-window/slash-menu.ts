import { isWriteBatchCommandWord, WRITE_BATCH_COMMAND_NAME } from '@storyforge/project-core';

import type { ConversationSkillItem } from '../../lib/api/conversation-skills';
import { matchSkillCommands } from './display-utils';

export const WRITE_BATCH_MENU_HINT = '批量写章：/写 4-10，写完直接写进文件，最后统一审';
export const REVISION_BATCH_COMMAND_NAME = '改';
export const REVISION_BATCH_MENU_HINT = '连续修改：/改 1-7 把世界规则融入情节，逐章保存后继续';

export type SlashMenuCommand = { name: string; hint: string; pick: number };
const COMMANDS = [
  { name: WRITE_BATCH_COMMAND_NAME, hint: WRITE_BATCH_MENU_HINT, aliases: ['goal'] },
  { name: REVISION_BATCH_COMMAND_NAME, hint: REVISION_BATCH_MENU_HINT, aliases: [] },
];

export type SlashMenuSkill = {
  skill: ConversationSkillItem;
  /** 与指令重名：照列但不能选。 */
  conflict: boolean;
  /** 在 picks 里的位置；不能选的为 null。 */
  pick: number | null;
};

export type SlashMenu = {
  /** 内置指令排在技能上面，顺序与 picks 一致。 */
  commands: SlashMenuCommand[];
  skills: SlashMenuSkill[];
  /** 能选的名字，按显示顺序（方向键在这里面走）。 */
  picks: string[];
};

/** 指令只能是消息开头的第一个点名；名字和别名都按前缀筛选。 */
function commandMatches(value: string, query: string, command: (typeof COMMANDS)[number]): boolean {
  if (/\s/.test(value.trim())) return false;
  const needle = query.trim().toLowerCase();
  return [command.name, ...command.aliases].some((name) => name.startsWith(needle));
}

/** `/` 菜单列什么：指令在上，技能在下；与内置指令重名的技能标出来、不能选。 */
export function slashMenu(
  value: string,
  query: string | null,
  skills: readonly ConversationSkillItem[],
): SlashMenu {
  if (query === null) return { commands: [], skills: [], picks: [] };
  const commands = COMMANDS.filter((command) => commandMatches(value, query, command)).map(
    ({ name, hint }, pick) => ({ name, hint, pick }),
  );
  const picks = commands.map((command) => command.name);
  const listed = matchSkillCommands(skills, query).map((skill): SlashMenuSkill => {
    const conflict =
      isWriteBatchCommandWord(skill.name) || skill.name === REVISION_BATCH_COMMAND_NAME;
    if (conflict) return { skill, conflict, pick: null };
    picks.push(skill.name);
    return { skill, conflict, pick: picks.length - 1 };
  });
  return { commands, skills: listed, picks };
}
