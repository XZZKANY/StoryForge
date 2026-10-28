import { beforeEach, expect, it, vi } from 'vitest';
import { ProjectReadError, type ProjectReader } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';

const ROOT = 'D:\\book';
const FILE = '.storyforge/agent-instructions.md';
const fixture = vi.hoisted(() => ({ reader: null as unknown as ProjectReader }));

vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: {
    resolveProjectPath: (...args: Parameters<ProjectReader['resolveProjectPath']>) =>
      fixture.reader.resolveProjectPath(...args),
    inspectProjectPath: (...args: Parameters<ProjectReader['inspectProjectPath']>) =>
      fixture.reader.inspectProjectPath(...args),
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.reader.readProjectBytes(...args),
  },
}));

const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const load = async () =>
  (await import('../src/lib/api/author-instructions')).loadAuthorInstructions(ROOT);
const target = `${ROOT}\\.storyforge\\agent-instructions.md`;

beforeEach(() => {
  fixture.reader = memoryProject(ROOT, { '正文/第001章.md': file('正文') }).reader;
});

it('reports a missing file so the panel can offer to create it', async () => {
  expect(await load()).toEqual({ status: 'missing', filePath: target });
  fixture.reader = memoryProject(ROOT, { '.storyforge/book.json': file('{}') }).reader;
  expect(await load()).toEqual({ status: 'missing', filePath: target });
});

it('reports an existing file the engine would not deliver as unused, never as missing', async () => {
  fixture.reader = memoryProject(ROOT, { [FILE]: file('  \n\n') }).reader;
  expect(await load()).toEqual({ status: 'unused', filePath: target });
  // 读不了也不当「没有」：否则界面会给出「新建」去盖掉它。
  const project = memoryProject(ROOT, {});
  fixture.reader = {
    ...project.reader,
    resolveProjectPath: async (root, path) => {
      if (path === FILE) throw new ProjectReadError('outside', 'outside-project');
      return project.reader.resolveProjectPath(root, path);
    },
    inspectProjectPath: async (root, path) => {
      if (path === FILE) throw new ProjectReadError('outside', 'outside-project');
      return project.reader.inspectProjectPath(root, path);
    },
  };
  expect(await load()).toEqual({ status: 'unused', filePath: target });
});

it('shows what the model receives: char count and the first lines', async () => {
  fixture.reader = memoryProject(ROOT, {
    [FILE]: file(
      '# 长期规矩\r\n\r\n对话用简体中文。\r\n不改人名。\r\n别加小标题。\r\n结尾不总结。\r\n',
    ),
  }).reader;
  expect(await load()).toEqual({
    status: 'active',
    filePath: target,
    chars: 36,
    truncated: false,
    limit: 4000,
    preview: ['# 长期规矩', '对话用简体中文。', '不改人名。', '别加小标题。'],
  });
});

it('marks over-long instructions as truncated to the engine limit', async () => {
  fixture.reader = memoryProject(ROOT, {
    [FILE]: file(`最早的要求\n${'句'.repeat(5000)}\n最新的要求`),
  }).reader;
  const state = await load();
  expect(state).toMatchObject({ status: 'active', truncated: true, limit: 4000 });
  if (state.status !== 'active') throw new Error('expected active');
  expect(state.preview[0]).toMatch(/^句+$/);
  expect(state.preview.at(-1)).toBe('最新的要求');
});
