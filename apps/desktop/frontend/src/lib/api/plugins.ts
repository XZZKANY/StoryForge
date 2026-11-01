/** 插件：装在本机插件库里，每本书在 `.storyforge/plugins.json` 里自己选用。 */
import type { PluginDescription } from '@storyforge/engine';
import { pluginLibraryDir } from '../host/plugin-library';

export type {
  PluginDescription,
  PluginEntry,
  PluginInstructions,
  PluginManifest,
} from '@storyforge/engine';

export type EnabledPlugins = { enabled: string[]; problem: string | null };

/** 列表里给作者看的插件名：显示名，缺就用清单里的名字，再缺用文件夹名。 */
export function pluginTitle(plugin: PluginDescription): string {
  return plugin.manifest?.displayName || plugin.manifest?.name || plugin.id;
}

/** 本机插件库里已装的插件，按文件夹名排序。 */
export async function listPlugins(): Promise<PluginDescription[]> {
  const libraryRoot = await pluginLibraryDir();
  return (await import('../engine/plugins')).listEnginePlugins(libraryRoot);
}

/** 预览一次导入的暂存；暂存文件夹名不是插件名，不比对。 */
export async function describeStagedPlugin(stageRoot: string): Promise<PluginDescription> {
  return (await import('../engine/plugins')).describeEngineStagedPlugin(stageRoot);
}

/** 作品启用了哪些插件；文件坏了 enabled 为空并带 problem。 */
export async function readEnabledPlugins(projectRoot: string): Promise<EnabledPlugins> {
  return (await import('../engine/plugins')).readEngineEnabledPlugins(projectRoot);
}
