import assert from 'node:assert/strict';
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

test('listDir coalesces concurrent recursive scans for the same project', async () => {
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
        TauriFileSystem.listDir('D:\\Book', true),
        TauriFileSystem.listDir('D:\\Book', true),
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
      assert.equal((await TauriFileSystem.listDir('D:\\Book', true)).length, 1);
      assert.equal((await TauriFileSystem.listDir('D:\\Book', true)).length, 1);
      await TauriFileSystem.writeFile('D:\\Book', 'D:\\Book\\正文\\第二章.md', '正文');
      assert.equal((await TauriFileSystem.listDir('D:\\Book', true)).length, 2);
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
      await TauriFileSystem.listDir('D:/Book', true);
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', {
          kind: 'content',
          content: 'old',
        }),
      );
      await TauriFileSystem.listDir('D:/Book', true);
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
