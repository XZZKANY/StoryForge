import { CONVERSATION_SKILL_DIR, invokedSkillNames } from '@storyforge/project-core';
import type { ProjectReader } from '../readPort';
import type { SecretContext } from './redaction';
import { loadWritingSkills, type WritingSkill } from './writingSkills';

export type ConversationSkill = {
  /** 项目相对路径（posix）。 */
  readonly path: string;
  readonly name: string;
  readonly when: string;
};

/** 点名的技能单份带进对话的上限；再长就截掉，后面的让模型自己读。 */
export const INVOKED_SKILL_MAX_CHARS = 4_000;

/**
 * 作品根 `技能/` 下的技能全文（按路径序，最多 20 份）：头部格式与 `写法/` 同一套，名字、什么时候用都已脱敏截断。
 * 每次重读不缓存，读不出当没有。
 */
export async function loadConversationSkillSources(
  reader: ProjectReader,
  root: string,
  secrets: SecretContext,
): Promise<WritingSkill[]> {
  return loadWritingSkills(reader, root, secrets, CONVERSATION_SKILL_DIR);
}

/** 同上，只给名字和什么时候用（正文不给，模型用得上时自己读）。 */
export async function loadConversationSkills(
  reader: ProjectReader,
  root: string,
  secrets: SecretContext,
): Promise<ConversationSkill[]> {
  const skills = await loadConversationSkillSources(reader, root, secrets);
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

/** 作者在消息开头用 `/技能名` 点名的那几份（按点名顺序）。 */
export function invokedConversationSkills(
  skills: readonly WritingSkill[],
  message: string,
): WritingSkill[] {
  return invokedSkillNames(
    message,
    skills.map((skill) => skill.name),
  ).map((name) => skills.find((skill) => skill.name === name)!);
}

/** 点名技能的全文段：这一轮直接附上，不等模型自己去读；没点名时为 null（不加这一段）。 */
export function invokedSkillsBlock(skills: readonly WritingSkill[]): string | null {
  if (!skills.length) return null;
  return [
    '[技能 · 作者这一轮点名]',
    '作者在消息开头用「/技能名」点名了下面的技能，这一轮照着做；全文已附在这里，不用再读。' +
      '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。',
    ...skills.map((skill) => {
      const points = Array.from(skill.body);
      const body =
        points.length > INVOKED_SKILL_MAX_CHARS
          ? `${points.slice(0, INVOKED_SKILL_MAX_CHARS).join('')}\n……（后面还有，需要时用 fs_read 读 ${skill.path}）`
          : skill.body;
      return `### ${skill.name}（${skill.path}）\n${body}`;
    }),
  ].join('\n\n');
}
