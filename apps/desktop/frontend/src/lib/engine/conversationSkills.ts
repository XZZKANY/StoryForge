import { loadConversationSkills, type ConversationSkill } from '@storyforge/engine';
import { nativeProjectReader } from './reader';
import { engineSecrets } from './store';

/** 用对话每轮读技能目录的同一个读口和同一套截断、脱敏：面板列的就是模型看到的。 */
export async function listEngineConversationSkills(
  projectRoot: string,
): Promise<ConversationSkill[]> {
  // WebView 里能脱敏的只有占位串；技能目录不该因为模型配置读不出而打不开。
  const secrets = await engineSecrets().catch(() => ({ values: [] }));
  return loadConversationSkills(nativeProjectReader, projectRoot, secrets);
}
