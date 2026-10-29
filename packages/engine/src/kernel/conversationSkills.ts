import { CONVERSATION_SKILL_DIR } from '@storyforge/project-core';
import type { ProjectReader } from '../readPort';
import type { SecretContext } from './redaction';
import { loadWritingSkills } from './writingSkills';

export type ConversationSkill = {
  /** 项目相对路径（posix）。 */
  readonly path: string;
  readonly name: string;
  readonly when: string;
};

/**
 * 作品根 `技能/` 下的技能（按路径序，最多 20 份）：头部格式与 `写法/` 同一套，名字、什么时候用都已脱敏截断；
 * 正文不给，模型用得上时自己读。每次重读不缓存，读不出当没有。
 */
export async function loadConversationSkills(
  reader: ProjectReader,
  root: string,
  secrets: SecretContext,
): Promise<ConversationSkill[]> {
  const skills = await loadWritingSkills(reader, root, secrets, CONVERSATION_SKILL_DIR);
  return skills.map(({ path, name, when }) => ({ path, name, when }));
}

/** 对话每轮系统消息里的技能目录；作品里没有技能时为 null（不加这一段）。 */
export function conversationSkillsBlock(skills: readonly ConversationSkill[]): string | null {
  if (!skills.length) return null;
  return [
    '[技能 · 作者定的]',
    `作者在「${CONVERSATION_SKILL_DIR}/」里为这本书定的流程和口径。判断这一轮用得上哪份，先用 fs_read 读全文再照做；用不上的别读。` +
      '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。',
    ...skills.map((skill) => `- ${skill.name}（${skill.path}）：${skill.when}`),
  ].join('\n');
}
