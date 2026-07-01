import { TauriFileSystem } from '../tauri-fs';
import { normalizeRoot } from './path';
import type { StoryProjectInitializationPlan } from './types';

const STORY_DIRS = ['正文', '大纲', '人物', '设定', '世界观', '时间线', '伏笔'];

export const SAMPLE_STORY_PROJECT_NAME = 'StoryForge 示例项目';

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

export function sampleStoryProjectPath(parentPath: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return `${normalizeRoot(parentPath)}${separator}${SAMPLE_STORY_PROJECT_NAME}`;
}

export function buildSampleStoryProjectFiles(
  projectPath: string,
): Array<{ path: string; content: string }> {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return [
    {
      path: `${projectPath}${separator}大纲${separator}总纲.md`,
      content: [
        '# 总纲',
        '',
        '## 核心钩子',
        '一个新作者用 StoryForge 桌面版把零散灵感整理成可持续连载的开篇。',
        '',
        '## 当前目标',
        '- 在正文里写出第一章的冲突。',
        '- 让对话 agent 帮忙审稿、提出改法，再确认写回。',
      ].join('\n'),
    },
    {
      path: `${projectPath}${separator}人物${separator}主角.md`,
      content: [
        '# 主角',
        '',
        '- 外在目标：完成第一份能被读者追下去的稿子。',
        '- 内在压力：害怕每一次修改都会把故事改散。',
        '- 可用冲突：想控制一切，又需要接受协作。',
      ].join('\n'),
    },
    {
      path: `${projectPath}${separator}正文${separator}第01章.md`,
      content: [
        '# 第01章',
        '',
        '凌晨两点，屏幕上的光把房间切成两半。',
        '',
        '她盯着空白文档，终于在第一行敲下：故事从一个不肯睡觉的人开始。',
        '',
        '然后她停住了。真正的问题不是不会写，而是不知道下一句该交给谁来接。',
      ].join('\n'),
    },
  ];
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

async function writeIfMissing(path: string, content: string): Promise<void> {
  const exists = await TauriFileSystem.pathExists(path);
  if (!exists) {
    await TauriFileSystem.writeFile(path, content);
  }
}

export async function createSampleStoryProject(parentPath: string): Promise<string> {
  const projectPath = sampleStoryProjectPath(parentPath);
  await TauriFileSystem.createDir(projectPath, true);
  await initializeStoryProject(projectPath);

  for (const file of buildSampleStoryProjectFiles(projectPath)) {
    await writeIfMissing(file.path, file.content);
  }

  return projectPath;
}
