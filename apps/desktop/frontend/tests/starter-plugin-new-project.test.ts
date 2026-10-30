import { serializePluginsFile, STARTER_PLUGIN_NAME } from '@storyforge/project-core';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  createNewBookProject,
  createSampleStoryProject,
  enableStarterPlugin,
  initializeStoryProject,
} from '../src/lib/project/initialize';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    pathExists: vi.fn(),
    createDir: vi.fn(),
    writeFile: vi.fn(),
  },
}));
vi.mock('@tauri-apps/api/path', () => ({ documentDir: async () => 'D:\\文档' }));

const ENABLED = serializePluginsFile([STARTER_PLUGIN_NAME]);
const pluginsWrites = () =>
  vi
    .mocked(TauriFileSystem.writeFile)
    .mock.calls.filter(([, path]) => path.endsWith('\\.storyforge\\plugins.json'));

let existing: Set<string>;

beforeEach(() => {
  vi.resetAllMocks();
  existing = new Set();
  vi.mocked(TauriFileSystem.pathExists).mockImplementation(async (path) => existing.has(path));
  vi.mocked(TauriFileSystem.createDir).mockResolvedValue(undefined);
  vi.mocked(TauriFileSystem.writeFile).mockResolvedValue(undefined);
});

test('发送即开书：新作品的插件启用文件只写起书基础包', async () => {
  const { projectPath } = await createNewBookProject('雾港回声\n第二行');
  expect(projectPath).toBe('D:\\文档\\StoryForge\\雾港回声');
  expect(TauriFileSystem.createDir).toHaveBeenCalledWith(
    projectPath,
    `${projectPath}\\.storyforge`,
    true,
  );
  expect(pluginsWrites()).toEqual([
    [projectPath, `${projectPath}\\.storyforge\\plugins.json`, ENABLED],
  ]);
});

test('示例作品：写启用文件；示例作品里已有启用文件时不覆盖', async () => {
  const projectPath = await createSampleStoryProject('D:\\书库');
  expect(pluginsWrites()).toEqual([
    [projectPath, `${projectPath}\\.storyforge\\plugins.json`, ENABLED],
  ]);

  vi.mocked(TauriFileSystem.writeFile).mockClear();
  existing.add(`${projectPath}\\.storyforge\\plugins.json`);
  await createSampleStoryProject('D:\\书库');
  expect(pluginsWrites()).toEqual([]);
});

test('已有启用文件绝不覆盖（作者取消勾选过也一样）', async () => {
  const root = 'D:\\书库\\雾港回声';
  existing.add(`${root}\\.storyforge\\plugins.json`);
  await enableStarterPlugin(root);
  expect(TauriFileSystem.writeFile).not.toHaveBeenCalled();
});

test('给已有文件夹补骨架不替作者启用插件', async () => {
  await initializeStoryProject('D:\\书库\\旧书');
  expect(pluginsWrites()).toEqual([]);
});
