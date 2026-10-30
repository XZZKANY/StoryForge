import { CONVERSATION_SKILL_DIR, invokedSkillNames } from '@storyforge/project-core';
import type { ProjectReader } from '../readPort';
import { resolveEnabledPlugins } from './plugins';
import { pythonStrip } from './pythonText';
import type { SecretContext } from './redaction';
import { loadWritingSkills, type WritingSkill } from './writingSkills';

export type ConversationSkill = {
  /** 项目相对路径（posix）。 */
  readonly path: string;
  readonly name: string;
  readonly when: string;
};

/** 技能出自哪个插件（插件库文件夹名与它的绝对路径）。 */
export type SkillPlugin = { readonly id: string; readonly root: string };

/**
 * 这一轮能用的技能：作品「技能/」里的（plugin 为 null，path 是项目相对路径），
 * 和作品启用的插件里的（path 是插件内路径）。
 */
export type AvailableSkill = WritingSkill & { readonly plugin: SkillPlugin | null };

/** 点名的技能单份带进对话的上限；再长就截掉，后面的让模型自己读。 */
export const INVOKED_SKILL_MAX_CHARS = 4_000;
/** 所有启用插件的技能合计最多带几份。 */
export const PLUGIN_SKILLS_MAX = 20;

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

/**
 * 作品技能在前（规则同 {@link loadConversationSkillSources}），再按启用顺序接插件技能（每个插件内按路径序，
 * 合计最多 {@link PLUGIN_SKILLS_MAX} 份）；名字和已收的重了就丢，所以作品优先、先启用的插件优先。
 * 没给插件库或作品没启用插件时，结果就是作品技能。
 */
export async function loadAvailableSkills(
  reader: ProjectReader,
  projectRoot: string,
  libraryRoot: string | null,
  secrets: SecretContext,
): Promise<AvailableSkill[]> {
  const skills: AvailableSkill[] = (
    await loadConversationSkillSources(reader, projectRoot, secrets)
  ).map((skill) => ({ ...skill, plugin: null }));
  if (!libraryRoot || !projectRoot) return skills;
  const { plugins } = await resolveEnabledPlugins(reader, projectRoot, libraryRoot, secrets);
  const taken = new Set(skills.map((skill) => skill.name));
  let added = 0;
  for (const plugin of plugins)
    for (const skill of plugin.skills) {
      if (added >= PLUGIN_SKILLS_MAX) return skills;
      if (taken.has(skill.name)) continue;
      taken.add(skill.name);
      skills.push({ ...skill, plugin: { id: plugin.id, root: plugin.root } });
      added += 1;
    }
  return skills;
}

/** 按名字找可用技能：先认原样，再认去掉首尾空白的；没有为 null。 */
export function findAvailableSkill(
  skills: readonly AvailableSkill[],
  name: string,
): AvailableSkill | null {
  const trimmed = pythonStrip(name);
  return (
    skills.find((skill) => skill.name === name) ??
    skills.find((skill) => skill.name === trimmed) ??
    null
  );
}

type MaybePluginSkill = { readonly plugin?: SkillPlugin | null };

/** 可用技能里有没有插件技能：有才把 skill_read 交给模型。 */
export const hasPluginSkills = (skills: readonly MaybePluginSkill[]): boolean =>
  skills.some((skill) => skill.plugin);

/** 对话每轮系统消息里的技能目录；没有可用技能时为 null（不加这一段）。 */
export function conversationSkillsBlock(
  skills: readonly (ConversationSkill & MaybePluginSkill)[],
): string | null {
  if (!skills.length) return null;
  const intro = hasPluginSkills(skills)
    ? `作者为这本书定的流程和口径（作品「${CONVERSATION_SKILL_DIR}/」里的，和作者启用的插件里的）。判断这一轮用得上哪份，先读全文再照做（作品里的用 fs_read，插件里的用 skill_read 按名字读）；用不上的别读。`
    : `作者在「${CONVERSATION_SKILL_DIR}/」里为这本书定的流程和口径。判断这一轮用得上哪份，先用 fs_read 读全文再照做；用不上的别读。`;
  return [
    '[技能 · 作者定的]',
    intro + '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。',
    ...skills.map((skill) =>
      skill.plugin
        ? `- ${skill.name}（插件「${skill.plugin.id}」）：${skill.when}`
        : `- ${skill.name}（${skill.path}）：${skill.when}`,
    ),
  ].join('\n');
}

/** 作者在消息开头用 `/技能名` 点名的那几份（按点名顺序）。 */
export function invokedConversationSkills<T extends WritingSkill>(
  skills: readonly T[],
  message: string,
): T[] {
  return invokedSkillNames(
    message,
    skills.map((skill) => skill.name),
  ).map((name) => skills.find((skill) => skill.name === name)!);
}

/** 点名技能的全文段：这一轮直接附上，不等模型自己去读；没点名时为 null（不加这一段）。 */
export function invokedSkillsBlock(
  skills: readonly (WritingSkill & MaybePluginSkill)[],
): string | null {
  if (!skills.length) return null;
  return [
    '[技能 · 作者这一轮点名]',
    '作者在消息开头用「/技能名」点名了下面的技能，这一轮照着做；全文已附在这里，不用再读。' +
      '起草、修订工具看不到这些技能，用得上时把要点写进给它们的 instruction。',
    ...skills.map((skill) => {
      const points = Array.from(skill.body);
      const more = skill.plugin ? '需要时用 skill_read 读' : `需要时用 fs_read 读 ${skill.path}`;
      const body =
        points.length > INVOKED_SKILL_MAX_CHARS
          ? `${points.slice(0, INVOKED_SKILL_MAX_CHARS).join('')}\n……（后面还有，${more}）`
          : skill.body;
      const source = skill.plugin ? `插件「${skill.plugin.id}」：${skill.path}` : skill.path;
      return `### ${skill.name}（${source}）\n${body}`;
    }),
  ].join('\n\n');
}
