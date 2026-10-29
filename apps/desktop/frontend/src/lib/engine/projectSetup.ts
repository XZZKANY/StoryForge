import { projectSetupFacts, type ProjectSetupFacts } from '@storyforge/engine';
import { platform } from './assistant';
import { nativeProjectReader } from './reader';

/** 有没有正文、立项文件缺哪几类：与对话每轮的立项检查同一个读口、同一套判断。 */
export function inspectEngineProjectSetup(projectRoot: string): Promise<ProjectSetupFacts | null> {
  return projectSetupFacts(nativeProjectReader, projectRoot, platform());
}
