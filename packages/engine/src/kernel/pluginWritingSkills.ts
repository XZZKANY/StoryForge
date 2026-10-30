import type { ProjectReader } from '../readPort';
import type { SkillPlugin } from './conversationSkills';
import { resolveEnabledPlugins } from './plugins';
import type { SecretContext } from './redaction';
import { loadWritingSkills, WRITING_SKILL_INDEX_MAX, type WritingSkill } from './writingSkills';

/**
 * 写章能用的一份写法：作品「写法/」里的（plugin 为 null，path 是项目相对路径），
 * 和作品启用的插件里的（path 是插件内路径）。
 */
export type AvailableWritingSkill = WritingSkill & { readonly plugin: SkillPlugin | null };

/**
 * 作品写法在前（规则同 {@link loadWritingSkills}），再按启用顺序接插件写法（每个插件内按路径序），
 * 两边共用 {@link WRITING_SKILL_INDEX_MAX} 份的上限；名字和已收的重了就丢，所以作品优先、先启用的插件优先。
 * 没给插件库或作品没启用插件时，结果就是作品写法。
 */
export async function loadAvailableWritingSkills(
  reader: ProjectReader,
  projectRoot: string,
  libraryRoot: string | null,
  secrets: SecretContext,
): Promise<AvailableWritingSkill[]> {
  const skills: AvailableWritingSkill[] = (
    await loadWritingSkills(reader, projectRoot, secrets)
  ).map((skill) => ({ ...skill, plugin: null }));
  if (!libraryRoot || !projectRoot || skills.length >= WRITING_SKILL_INDEX_MAX) return skills;
  const { plugins } = await resolveEnabledPlugins(reader, projectRoot, libraryRoot, secrets);
  const taken = new Set(skills.map((skill) => skill.name));
  for (const plugin of plugins)
    for (const style of plugin.styles) {
      if (skills.length >= WRITING_SKILL_INDEX_MAX) return skills;
      if (taken.has(style.name)) continue;
      taken.add(style.name);
      skills.push({ ...style, plugin: { id: plugin.id, root: plugin.root } });
    }
  return skills;
}
