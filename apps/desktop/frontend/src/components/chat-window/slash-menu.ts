import { isWriteBatchCommandWord, WRITE_BATCH_COMMAND_NAME } from '@storyforge/project-core';

import type { ConversationSkillItem } from '../../lib/api/conversation-skills';
import { matchSkillCommands } from './display-utils';

export const WRITE_BATCH_MENU_HINT = '批量写章：/写 4-10，写完直接写进文件，最后统一审';

export type SlashMenuSkill = {
  skill: ConversationSkillItem;
  /** 与指令重名：照列但不能选。 */
  conflict: boolean;
  /** 在 picks 里的位置；不能选的为 null。 */
  pick: number | null;
};

export type SlashMenu = {
  /** 指令「写」那一行，排在技能上面。 */
  command: boolean;
  skills: SlashMenuSkill[];
  /** 能选的名字，按显示顺序（方向键在这里面走）。 */
  picks: string[];
};

/** 指令只能是消息开头的第一个点名；打的字要是「写」或 goal 的开头。 */
function commandMatches(value: string, query: string): boolean {
  if (/\s/.test(value.trim())) return false;
  const needle = query.trim().toLowerCase();
  return !needle || needle === WRITE_BATCH_COMMAND_NAME || 'goal'.startsWith(needle);
}

/** `/` 菜单列什么：指令在上，技能在下；叫「写」或 goal 的技能标出来、不能选。 */
export function slashMenu(
  value: string,
  query: string | null,
  skills: readonly ConversationSkillItem[],
): SlashMenu {
  if (query === null) return { command: false, skills: [], picks: [] };
  const command = commandMatches(value, query);
  const picks = command ? [WRITE_BATCH_COMMAND_NAME] : [];
  const listed = matchSkillCommands(skills, query).map((skill): SlashMenuSkill => {
    const conflict = isWriteBatchCommandWord(skill.name);
    if (conflict) return { skill, conflict, pick: null };
    picks.push(skill.name);
    return { skill, conflict, pick: picks.length - 1 };
  });
  return { command, skills: listed, picks };
}
