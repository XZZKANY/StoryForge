/** 技能：作品根 `技能/` 下一个技能一份 Markdown；对话每轮只带目录，AI 用得上时自己读全文。 */
import { resolveProjectRelativePath } from '../project-context';

export type ConversationSkillItem = {
  /** 作品技能是项目相对路径（posix），插件技能是插件内路径。 */
  path: string;
  name: string;
  when: string;
  /** 出自哪个插件（插件 id）；作品自己的技能为 null。 */
  plugin: string | null;
  /** 在编辑器打开用的绝对路径；插件技能不在作品里，为 null。 */
  filePath: string | null;
};

/** 读不出的作品引擎当没有技能，这里同样返回空表。 */
export async function loadConversationSkills(
  projectRoot: string,
): Promise<ConversationSkillItem[]> {
  const raw = await (
    await import('../engine/conversationSkills')
  ).listEngineConversationSkills(projectRoot);
  return raw.flatMap((skill): ConversationSkillItem[] => {
    const base = { path: skill.path, name: skill.name, when: skill.when };
    if (skill.plugin) return [{ ...base, plugin: skill.plugin.id, filePath: null }];
    const filePath = resolveProjectRelativePath(projectRoot, skill.path);
    return filePath === null ? [] : [{ ...base, plugin: null, filePath }];
  });
}
