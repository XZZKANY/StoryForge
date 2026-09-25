import { beforeEach, expect, test, vi } from 'vitest';
import { createBlankStoryProject, blankStoryProjectPath } from '../src/lib/project/create';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    pathExists: vi.fn(),
    createDir: vi.fn(),
    writeFile: vi.fn(),
    deletePath: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(TauriFileSystem.pathExists).mockResolvedValue(false);
  vi.mocked(TauriFileSystem.createDir).mockResolvedValue(undefined);
  vi.mocked(TauriFileSystem.writeFile).mockResolvedValue(undefined);
});

test('creates only a blank canonical structure and the explicitly named book profile', async () => {
  const root = await createBlankStoryProject('D:/Books/', '雾港回声');
  expect(root).toBe('D:/Books/雾港回声');
  expect(TauriFileSystem.createDir).toHaveBeenNthCalledWith(1, 'D:/Books/', root, false);
  expect(
    vi
      .mocked(TauriFileSystem.createDir)
      .mock.calls.slice(1)
      .every(([owner, path]) => owner === root && path.startsWith(root + '/')),
  ).toBe(true);
  const writes = vi.mocked(TauriFileSystem.writeFile).mock.calls;
  expect(writes.map(([, path]) => path)).toEqual([
    root + '/大纲/项目说明.md',
    root + '/.storyforge/book.json',
  ]);
  expect(writes.every(([owner]) => owner === root)).toBe(true);
  expect(JSON.parse(writes[1][2])).toEqual({
    version: 1,
    title: '雾港回声',
    synopsis: '',
    tags: [],
    cover: null,
    wordGoal: 0,
  });
});

test.each([
  '',
  ' ',
  '.',
  '..',
  'name.',
  'name ',
  ' name',
  'a/b',
  'a\\b',
  'a:b',
  'a?',
  'a*',
  'a<',
  'a>',
  'a|',
  'a"',
  'a\n',
  'a\u0000',
  'a\u007f',
  'CON',
  'CON .txt',
  'con.txt',
  'NUL',
  'AUX',
  'PRN',
  'COM1',
  'LPT9',
  'COM¹',
  'CONIN$',
  'CONOUT$',
  'a'.repeat(256),
])('rejects illegal Windows child name %j before touching the filesystem', async (title) => {
  await expect(createBlankStoryProject('D:/Books', title)).rejects.toThrow();
  expect(TauriFileSystem.pathExists).not.toHaveBeenCalled();
  expect(TauriFileSystem.createDir).not.toHaveBeenCalled();
});

test('previews root and UNC paths without changing the author title', () => {
  expect(blankStoryProjectPath('D:\\', '第一本')).toBe('D:\\第一本');
  expect(blankStoryProjectPath('\\\\server\\books\\', '第一本')).toBe('\\\\server\\books\\第一本');
});

test.each(['', 'Books', 'D:Books', 'D:/Books/../Other'])(
  'rejects unselected or nonabsolute parent %j before filesystem mutation',
  async (parent) => {
    await expect(createBlankStoryProject(parent, '第一本')).rejects.toThrow();
    expect(TauriFileSystem.createDir).not.toHaveBeenCalled();
  },
);

test('refuses an existing directory without reusing it or overwriting any file', async () => {
  vi.mocked(TauriFileSystem.pathExists).mockResolvedValue(true);
  await expect(createBlankStoryProject('D:/Books', '第一本')).rejects.toThrow('已存在');
  expect(TauriFileSystem.createDir).not.toHaveBeenCalled();
  expect(TauriFileSystem.writeFile).not.toHaveBeenCalled();
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
});

test('a racing root mkdir failure never initializes or removes the other creator directory', async () => {
  vi.mocked(TauriFileSystem.createDir).mockRejectedValueOnce(new Error('AlreadyExists'));
  await expect(createBlankStoryProject('D:/Books', '第一本')).rejects.toThrow('AlreadyExists');
  expect(TauriFileSystem.createDir).toHaveBeenCalledExactlyOnceWith(
    'D:/Books',
    'D:/Books/第一本',
    false,
  );
  expect(TauriFileSystem.writeFile).not.toHaveBeenCalled();
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
});

test('reports partial creation with its actual path and keeps it for author inspection', async () => {
  vi.mocked(TauriFileSystem.writeFile).mockRejectedValueOnce(new Error('disk full'));
  await expect(createBlankStoryProject('D:/Books', '第一本')).rejects.toThrow(
    /D:\/Books\/第一本.*已创建[\s\S]*disk full/,
  );
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
});

test('concurrent same-name creation has a single root claim and only the winner initializes', async () => {
  let claimed = false;
  vi.mocked(TauriFileSystem.createDir).mockImplementation(async (_owner, _path, recursive) => {
    if (recursive) return;
    if (claimed) throw new Error('AlreadyExists');
    claimed = true;
  });
  const results = await Promise.allSettled([
    createBlankStoryProject('D:/Books', '第一本'),
    createBlankStoryProject('D:/Books', '第一本'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(TauriFileSystem.writeFile).toHaveBeenCalledTimes(2);
  expect(TauriFileSystem.deletePath).not.toHaveBeenCalled();
});
