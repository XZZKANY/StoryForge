import {
  PLUGINS_FILE,
  PROJECT_GUIDE_MARKDOWN,
  PROJECT_GUIDE_RELATIVE_PATH,
  serializePluginsFile,
  STARTER_PLUGIN_NAME,
} from '@storyforge/project-core';
import { bookProfilePath, emptyBookProfile, serializeBookProfile } from '../book-profile';
import { TauriFileSystem } from '../tauri-fs';
import { normalizeRoot } from './path';
import type { StoryProjectInitializationPlan } from './types';

const STORY_DIRS = ['正文', '大纲', '人物', '设定', '世界观', '时间线', '伏笔'];

export const SAMPLE_STORY_PROJECT_NAME = 'StoryForge 示例作品';

export function buildStoryProjectInitializationPlan(
  projectPath: string,
): StoryProjectInitializationPlan {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const root = normalizeRoot(projectPath);
  const readmePath = `${root}${separator}${PROJECT_GUIDE_RELATIVE_PATH.split('/').join(separator)}`;
  return {
    directories: STORY_DIRS.map((dir) => `${root}${separator}${dir}`),
    readmePath,
    readmeContent: PROJECT_GUIDE_MARKDOWN,
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
        '- 让对话 AI 帮忙审稿、提出改法，再确认写进文件。',
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
    await TauriFileSystem.createDir(projectPath, dir, true);
  }

  const readmePath = plan.readmePath;
  const exists = await TauriFileSystem.projectPathExists(projectPath, readmePath);
  if (!exists) {
    await TauriFileSystem.writeFile(projectPath, readmePath, plan.readmeContent);
  }
}

async function writeIfMissing(projectPath: string, path: string, content: string): Promise<void> {
  const exists = await TauriFileSystem.projectPathExists(projectPath, path);
  if (!exists) {
    await TauriFileSystem.writeFile(projectPath, path, content);
  }
}

/**
 * 新建作品默认启用自带的起书基础包；已有启用文件就不动。
 * 只给真正新建作品的入口用——initializeStoryProject 也给已有文件夹补骨架，那里不该替作者启用。
 */
export async function enableStarterPlugin(projectPath: string): Promise<void> {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const file = `${normalizeRoot(projectPath)}${separator}${PLUGINS_FILE.split('/').join(separator)}`;
  await TauriFileSystem.createDir(projectPath, file.slice(0, file.lastIndexOf(separator)), true);
  await writeIfMissing(projectPath, file, serializePluginsFile([STARTER_PLUGIN_NAME]));
}

export async function createSampleStoryProject(parentPath: string): Promise<string> {
  const projectPath = sampleStoryProjectPath(parentPath);
  await TauriFileSystem.createDir(parentPath, projectPath, true);
  await initializeStoryProject(projectPath);

  for (const file of buildSampleStoryProjectFiles(projectPath)) {
    await writeIfMissing(projectPath, file.path, file.content);
  }
  await enableStarterPlugin(projectPath);

  return projectPath;
}

/** Q1 发送即开书：从首句灵感推导一个文件系统安全的书名，非法字符剔除、截断，空则回落。 */
export function deriveNewBookName(prompt: string): string {
  const firstLine = (prompt.split('\n')[0] ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return firstLine.slice(0, 16).trim() || '未命名新书';
}

async function resolveFreeChildPath(parentPath: string, name: string): Promise<string> {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  const base = `${normalizeRoot(parentPath)}${separator}${name}`;
  // 与随后建目录同一个围栏：书库目录当根，候选书名都是它的直接子目录。
  if (!(await TauriFileSystem.projectPathExists(parentPath, base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await TauriFileSystem.projectPathExists(parentPath, candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Q1 发送即开书：在默认书库目录 <文档>/StoryForge/ 下自动建项目骨架，
 * 把首句灵感落进 灵感.md，返回项目路径与种子文件路径。
 * 建骨架是显式动作产物（作者主动开书），正文写回仍走 proposed patch——写回红线不破。
 * 目录以后可迁（作者另存 / 打开其他目录）。
 */
export async function createNewBookProject(
  prompt: string,
): Promise<{ projectPath: string; seedFilePath: string }> {
  const { documentDir } = await import('@tauri-apps/api/path');
  const docs = normalizeRoot(await documentDir());
  const separator = docs.includes('\\') ? '\\' : '/';
  const booksRoot = `${docs}${separator}StoryForge`;
  await TauriFileSystem.createDir(docs, booksRoot, true);
  const projectPath = await resolveFreeChildPath(booksRoot, deriveNewBookName(prompt));
  await TauriFileSystem.createDir(booksRoot, projectPath, true);
  await initializeStoryProject(projectPath);
  const seedFilePath = `${projectPath}${separator}灵感.md`;
  await writeIfMissing(projectPath, seedFilePath, ['# 灵感', '', prompt.trim(), ''].join('\n'));
  await writeBookProfileSeed(projectPath, prompt);
  await enableStarterPlugin(projectPath);
  return { projectPath, seedFilePath };
}

/**
 * 开书那一句同时落进作品档案的简介：作者点开左栏「作品」时不该是一张全空的表，
 * 他刚刚才说过这本书是什么。书名留空——空即回落到目录名，作者改目录名它自己会跟上。
 */
async function writeBookProfileSeed(projectPath: string, prompt: string): Promise<void> {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  await TauriFileSystem.createDir(projectPath, `${projectPath}${separator}.storyforge`, true);
  await writeIfMissing(
    projectPath,
    bookProfilePath(projectPath),
    serializeBookProfile({ ...emptyBookProfile(), synopsis: prompt.trim() }),
  );
}
