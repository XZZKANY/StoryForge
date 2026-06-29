import { TauriFileSystem } from '../tauri-fs';
import { normalizeRoot } from './path';
import type { StoryProjectInitializationPlan } from './types';

const STORY_DIRS = ['正文', '大纲', '人物', '设定', '世界观', '时间线', '伏笔'];

export function buildStoryProjectInitializationPlan(
  projectPath: string,
): StoryProjectInitializationPlan {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const root = normalizeRoot(projectPath);
  const readmePath = `${root}${separator}大纲${separator}项目说明.md`;
  return {
    directories: STORY_DIRS.map((dir) => `${root}${separator}${dir}`),
    readmePath,
    readmeContent: [
      '# 项目说明',
      '',
      '- 大纲：存放总纲、章节节点、反转表。',
      '- 人物：存放角色小传、关系、成长线。',
      '- 设定：存放世界观、地点、物件、规则。',
      '- 世界观：存放世界底层规则、势力、历史和专有名词。',
      '- 时间线：存放事件顺序、回忆、伏笔兑现节点。',
      '- 伏笔：存放埋线、回收计划、读者预期管理。',
      '- 正文：存放章节正文。',
    ].join('\n'),
  };
}

export async function initializeStoryProject(projectPath: string): Promise<void> {
  const plan = buildStoryProjectInitializationPlan(projectPath);
  for (const dir of plan.directories) {
    await TauriFileSystem.createDir(dir, true);
  }

  const readmePath = plan.readmePath;
  const exists = await TauriFileSystem.pathExists(readmePath);
  if (!exists) {
    await TauriFileSystem.writeFile(readmePath, plan.readmeContent);
  }
}
