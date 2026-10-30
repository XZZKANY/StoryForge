import { invoke } from '@tauri-apps/api/core';

import { assertTauriRuntime } from './tauri-env';

/** 暂存里收下的一个文本文件；path 相对所选文件夹、用「/」分隔。 */
export type StagedPluginFile = {
  path: string;
  bytes: number;
};

/** 没收下的文件与原因（给作者看的中文）。 */
export type SkippedPluginFile = {
  path: string;
  reason: string;
};

/** 一次从文件夹导入的暂存；stageRoot 是暂存副本的绝对路径，预览时拿它当根去读。 */
export type StagedPluginImport = {
  stageId: string;
  stageRoot: string;
  files: StagedPluginFile[];
  skipped: SkippedPluginFile[];
};

/** 插件库根目录的绝对路径（不存在会先建好）。 */
export async function pluginLibraryDir(): Promise<string> {
  assertTauriRuntime('plugin_library_dir');
  return await invoke<string>('plugin_library_dir');
}

/** 把一个文件夹里的文本文件复制进暂存；会先清掉上一次没确认的暂存。 */
export async function stagePluginImport(source: string): Promise<StagedPluginImport> {
  assertTauriRuntime('plugin_stage_import');
  return await invoke<StagedPluginImport>('plugin_stage_import', { source });
}

/** 把暂存装进插件库，返回装好后的绝对路径；同名旧插件挪进库里的回收目录。 */
export async function commitPluginImport(stageId: string, name: string): Promise<string> {
  assertTauriRuntime('plugin_commit_import');
  return await invoke<string>('plugin_commit_import', { stageId, name });
}

export async function discardPluginImport(stageId: string): Promise<void> {
  assertTauriRuntime('plugin_discard_import');
  await invoke('plugin_discard_import', { stageId });
}

/** 从插件库移除：挪进回收目录，不直接删。 */
export async function removePlugin(name: string): Promise<void> {
  assertTauriRuntime('plugin_remove');
  await invoke('plugin_remove', { name });
}
