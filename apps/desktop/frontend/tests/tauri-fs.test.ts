import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => undefined),
}));

import { invalidateFileSystemCache, TauriFileSystem, type FileEntry } from '../src/lib/tauri-fs';

function entry(name: string, path: string): FileEntry {
  return {
    name,
    path,
    isDir: false,
    size: 1,
    modified: 1,
    extension: name.split('.').pop(),
  };
}

function withMockWindow(
  mockFs: NonNullable<Window['__STORYFORGE_MOCK_FS__']>,
  run: () => Promise<void>,
) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __STORYFORGE_MOCK_FS__: mockFs,
    },
  });

  return run().finally(() => {
    invalidateFileSystemCache();
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
}

test('listProjectDir coalesces concurrent recursive scans for the same project', async () => {
  let calls = 0;
  await withMockWindow(
    {
      async listDir() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [entry('第一章.md', 'D:\\Book\\正文\\第一章.md')];
      },
    },
    async () => {
      const [first, second] = await Promise.all([
        TauriFileSystem.listProjectDir('D:\\Book', 'D:\\Book', true),
        TauriFileSystem.listProjectDir('D:\\Book', 'D:\\Book', true),
      ]);

      assert.equal(calls, 1);
      assert.deepEqual(first, second);
    },
  );
});

test('writeFile invalidates cached directory scans', async () => {
  let listCalls = 0;
  await withMockWindow(
    {
      listDir() {
        listCalls += 1;
        return listCalls === 1
          ? [entry('第一章.md', 'D:\\Book\\正文\\第一章.md')]
          : [
              entry('第一章.md', 'D:\\Book\\正文\\第一章.md'),
              entry('第二章.md', 'D:\\Book\\正文\\第二章.md'),
            ];
      },
      writeFile() {},
    },
    async () => {
      assert.equal((await TauriFileSystem.listProjectDir('D:\\Book', 'D:\\Book', true)).length, 1);
      assert.equal((await TauriFileSystem.listProjectDir('D:\\Book', 'D:\\Book', true)).length, 1);
      await TauriFileSystem.writeFile('D:\\Book', 'D:\\Book\\正文\\第二章.md', '正文');
      assert.equal((await TauriFileSystem.listProjectDir('D:\\Book', 'D:\\Book', true)).length, 2);
      assert.equal(listCalls, 2);
    },
  );
});

test('conditional native write sends the raw disk baseline, including missing and empty', async () => {
  vi.mocked(invoke).mockClear();
  for (const expected of [
    { kind: 'missing' },
    { kind: 'content', content: '' },
    { kind: 'content', content: 'a\r\nb' },
  ] as const) {
    await TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/chapter.md', 'new', expected);
    assert.deepEqual(vi.mocked(invoke).mock.calls.at(-1), [
      'write_file_if_unchanged',
      {
        projectRoot: 'D:/Book',
        path: 'D:/Book/chapter.md',
        content: 'new',
        expected,
      },
    ]);
  }
});

test('browser fixtures never bypass missing/content comparisons', async () => {
  let content: string | undefined;
  let writes = 0;
  await withMockWindow(
    {
      pathExists: () => content !== undefined,
      readFile: () => {
        if (content === undefined) throw new Error('missing');
        return content;
      },
      writeFile: (_path, value) => {
        content = value;
        writes += 1;
      },
    },
    async () => {
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', {
          kind: 'content',
          content: '',
        }),
        /磁盘内容已变化/,
      );
      await TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', '', {
        kind: 'missing',
      });
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', { kind: 'missing' }),
        /磁盘内容已变化/,
      );
      await TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', {
        kind: 'content',
        content: '',
      });
      assert.equal(content, 'new');
      assert.equal(writes, 2);
    },
  );
});

test('conditional conflict invalidates stale directory cache without an unconditional write', async () => {
  let lists = 0;
  let writes = 0;
  await withMockWindow(
    {
      listDir: () => {
        lists += 1;
        return [];
      },
      pathExists: () => true,
      readFile: () => 'external',
      writeFile: () => {
        writes += 1;
      },
    },
    async () => {
      await TauriFileSystem.listProjectDir('D:/Book', 'D:/Book', true);
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', {
          kind: 'content',
          content: 'old',
        }),
      );
      await TauriFileSystem.listProjectDir('D:/Book', 'D:/Book', true);
      assert.equal(lists, 2);
      assert.equal(writes, 0);
    },
  );
});

test('incomplete mock capability fails closed instead of falling back to writeFile', async () => {
  let writes = 0;
  await withMockWindow(
    {
      writeFile: () => {
        writes += 1;
      },
    },
    async () => {
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', { kind: 'missing' }),
        /缺少磁盘基线/,
      );
      assert.equal(writes, 0);
    },
  );
});

test('readProjectFile 带上作品根，走宿主带围栏的 read_project_file', async () => {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValueOnce('正文');
  assert.equal(await TauriFileSystem.readProjectFile('D:/Book', 'D:/Book/a.md'), '正文');
  assert.deepEqual(vi.mocked(invoke).mock.calls.at(-1), [
    'read_project_file',
    { projectRoot: 'D:/Book', path: 'D:/Book/a.md' },
  ]);
});

test('listProjectDir 的缓存按作品根分开：同一路径换个作品根要重新问宿主', async () => {
  let calls = 0;
  await withMockWindow(
    {
      listDir() {
        calls += 1;
        return [];
      },
    },
    async () => {
      await TauriFileSystem.listProjectDir('D:/Book', 'D:/Book/正文');
      await TauriFileSystem.listProjectDir('D:/Book', 'D:/Book/正文');
      await TauriFileSystem.listProjectDir('D:/Other', 'D:/Book/正文');
      assert.equal(calls, 2);
    },
  );
});

test('列目录、查存在带上作品根，走宿主带围栏的命令；作品文件夹另有专用命令', async () => {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);
  await TauriFileSystem.listProjectDir('D:/Fenced', 'D:/Fenced/正文', true);
  assert.equal(await TauriFileSystem.projectPathExists('D:/Fenced', 'D:/Fenced/a.md'), true);
  assert.equal(await TauriFileSystem.projectFolderExists('D:/Fenced'), true);
  assert.deepEqual(vi.mocked(invoke).mock.calls, [
    ['list_project_dir', { projectRoot: 'D:/Fenced', path: 'D:/Fenced/正文', recursive: true }],
    ['project_path_exists', { projectRoot: 'D:/Fenced', path: 'D:/Fenced/a.md' }],
    ['project_folder_exists', { path: 'D:/Fenced' }],
  ]);
});

function sourceFiles(): Array<{ name: string; text: string }> {
  return (readdirSync('src', { recursive: true }) as string[])
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => ({
      name: name.split(sep).join('/'),
      text: readFileSync(join('src', name), 'utf8'),
    }));
}

test('列目录、查存在只留带作品根的口子：没有 listDir / pathExists，也不再调宿主的 list_dir / path_exists', () => {
  assert.equal(Reflect.has(TauriFileSystem, 'listDir'), false);
  assert.equal(Reflect.has(TauriFileSystem, 'pathExists'), false);
  const offenders = sourceFiles()
    .filter(({ text }) => /['"`](list_dir|path_exists)['"`]/.test(text))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

// 作品之外合法的存在性检查只有一种：打开作品前核对作品文件夹还在不在。别处一律用 projectPathExists。
const PROJECT_FOLDER_EXISTS_CALLERS = [
  'components/app/useProjectWorkspace.ts',
  'components/app/useSessionRestore.ts',
  'lib/tauri-fs.ts',
];

test('projectFolderExists 只在打开作品前核对作品文件夹的地方用', () => {
  const callers = sourceFiles()
    .filter(({ text }) => /projectFolderExists|['"`]project_folder_exists['"`]/.test(text))
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(callers, PROJECT_FOLDER_EXISTS_CALLERS);
});

test('前端读作品文件只留 readProjectFile 一个口子：没有 readFile，也不再调宿主的 read_file', () => {
  assert.equal(Reflect.has(TauriFileSystem, 'readFile'), false);
  const offenders = (readdirSync('src', { recursive: true }) as string[])
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => /['"`]read_file['"`]/.test(readFileSync(join('src', name), 'utf8')));
  assert.deepEqual(offenders, []);
});
