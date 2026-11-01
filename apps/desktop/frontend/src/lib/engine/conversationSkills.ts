import { loadAvailableSkills, type SkillPlugin } from '@storyforge/engine';
import { pluginLibraryDir } from '../host/plugin-library';
import { nativeProjectReader } from './reader';
import { engineSecrets } from './store';

export type EngineConversationSkill = {
  /** 作品技能是项目相对路径（posix），插件技能是插件内路径。 */
  path: string;
  name: string;
  when: string;
  plugin: SkillPlugin | null;
};

/** 用对话每轮读技能目录的同一个读口和同一套截断、脱敏：面板列的就是模型看到的。 */
export async function listEngineConversationSkills(
  projectRoot: string,
): Promise<EngineConversationSkill[]> {
  // WebView 里能脱敏的只有占位串；技能目录不该因为模型配置读不出而打不开。
  const [secrets, libraryRoot] = await Promise.all([
    engineSecrets().catch(() => ({ values: [] })),
    pluginLibraryDir().catch(() => null),
  ]);
  const skills = await loadAvailableSkills(nativeProjectReader, projectRoot, libraryRoot, secrets);
  return skills.map(({ path, name, when, plugin }) => ({ path, name, when, plugin }));
}
