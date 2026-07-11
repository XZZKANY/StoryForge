import assert from 'node:assert/strict';
import { test } from 'vitest';

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

function withMockWindow(mockFs: NonNullable<Window['__STORYFORGE_MOCK_FS__']>, run: () => Promise<void>) {
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
      await TauriFileSystem.writeFile(
        'D:\\Book',
        'D:\\Book\\正文\\第二章.md',
        '正文',
      );
      assert.equal((await TauriFileSystem.listDir('D:\\Book', true)).length, 2);
      assert.equal(listCalls, 2);
    },
  );
});
