import type { ProjectReader } from '../readPort';
import type { SkillPlugin } from './conversationSkills';
import { resolveEnabledPlugins } from './plugins';
import type { SecretContext } from './redaction';
import { loadWritingSkills, type WritingSkill } from './writingSkills';

/**
 * 章纲与起草能用的写法：作品「写法/」里的（plugin 为 null，path 是项目相对路径），
 * 和作品启用的插件里的（path 是插件内路径）。
 */
export type AvailableWritingStyle = WritingSkill & { readonly plugin: SkillPlugin | null };

/** 所有启用插件的写法合计最多带几份。 */
export const PLUGIN_STYLES_MAX = 20;

/**
 * 作品写法在前（规则同 {@link loadWritingSkills}），再按启用顺序接插件写法（每个插件内按路径序，
 * 合计最多 {@link PLUGIN_STYLES_MAX} 份）；名字和已收的重了就丢，所以作品优先、先启用的插件优先。
 * 没给插件库或作品没启用插件时，结果就是作品写法。
 */
export async function loadAvailableWritingStyles(
  reader: ProjectReader,
  projectRoot: string,
  libraryRoot: string | null,
  secrets: SecretContext,
): Promise<AvailableWritingStyle[]> {
  const styles: AvailableWritingStyle[] = (
    await loadWritingSkills(reader, projectRoot, secrets)
  ).map((style) => ({ ...style, plugin: null }));
  if (!libraryRoot || !projectRoot) return styles;
  const { plugins } = await resolveEnabledPlugins(reader, projectRoot, libraryRoot, secrets);
  const taken = new Set(styles.map((style) => style.name));
  let added = 0;
  for (const plugin of plugins)
    for (const style of plugin.styles) {
      if (added >= PLUGIN_STYLES_MAX) return styles;
      if (taken.has(style.name)) continue;
      taken.add(style.name);
      styles.push({ ...style, plugin: { id: plugin.id, root: plugin.root } });
      added += 1;
    }
  return styles;
}

/** 来源签名里写法的键：作品写法是项目相对路径，插件写法是 `plugin:<插件id>/<插件内路径>`。 */
export const writingStyleSourceKey = (style: AvailableWritingStyle): string =>
  style.plugin ? `plugin:${style.plugin.id}/${style.path}` : style.path;
