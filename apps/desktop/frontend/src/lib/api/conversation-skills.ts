/** 技能：作品根 `技能/` 下一个技能一份 Markdown；对话每轮只带目录，AI 用得上时自己读全文。 */
import { resolveProjectRelativePath } from '../project-context';

export type ConversationSkillItem = {
  /** 项目相对路径（posix）。 */
  path: string;
  name: string;
  when: string;
  /** 在编辑器打开用的绝对路径。 */
  filePath: string;
};

/** 读不出的作品引擎当没有技能，这里同样返回空表。 */
export async function loadConversationSkills(
  projectRoot: string,
): Promise<ConversationSkillItem[]> {
  const raw = await (
    await import('../engine/conversationSkills')
  ).listEngineConversationSkills(projectRoot);
  return raw.flatMap((skill) => {
    const filePath = resolveProjectRelativePath(projectRoot, skill.path);
    return filePath === null
      ? []
      : [{ path: skill.path, name: skill.name, when: skill.when, filePath }];
  });
}
