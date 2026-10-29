/** 立项事实（#462 立项检查同一套判断）：有没有正文、总纲 / 人物 / 世界规则缺哪几类。 */
import type { ProjectSetupFacts } from '@storyforge/engine';

export { SETUP_KINDS, setupKindOfPath } from '@storyforge/engine';
export type { ProjectSetupFacts, SetupKind } from '@storyforge/engine';

/** 读不出来时是 null，不当成空书。 */
export async function loadProjectSetupFacts(
  projectRoot: string,
): Promise<ProjectSetupFacts | null> {
  return (await import('../engine/projectSetup')).inspectEngineProjectSetup(projectRoot);
}
