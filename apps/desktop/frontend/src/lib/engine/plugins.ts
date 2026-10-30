import {
  describePlugin,
  listInstalledPlugins,
  readEnabledPluginNames,
  type PluginDescription,
} from '@storyforge/engine';
import { nativeProjectReader } from './reader';
import { engineSecrets } from './store';

// 与对话每轮读插件同一套脱敏；模型配置读不出时插件面板照样能打开。
const secrets = () => engineSecrets().catch(() => ({ values: [] }));

export async function listEnginePlugins(libraryRoot: string): Promise<PluginDescription[]> {
  return listInstalledPlugins(nativeProjectReader, libraryRoot, await secrets());
}

export async function describeEngineStagedPlugin(stageRoot: string): Promise<PluginDescription> {
  return describePlugin(nativeProjectReader, stageRoot, await secrets());
}

export async function readEngineEnabledPlugins(
  projectRoot: string,
): Promise<{ enabled: string[]; problem: string | null }> {
  return readEnabledPluginNames(nativeProjectReader, projectRoot);
}
