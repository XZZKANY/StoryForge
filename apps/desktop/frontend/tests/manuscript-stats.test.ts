import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { scanManuscriptTotals } from '../src/lib/manuscript-stats';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

type MockEntry = { path: string; content?: string };

const ROOT = 'D:\\连载\\末世吞噬';

function entry(relativePath: string) {
  const path = `${ROOT}\\${relativePath}`;
  const name = relativePath.split('\\').pop() ?? relativePath;
  return {
    path,
    name,
    isDir: false,
    extension: name.includes('.') ? (name.split('.').pop() ?? '') : '',
    modified: 0,
    size: 0,
  };
}

function installMockFs(files: MockEntry[], unreadable: string[] = []) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __STORYFORGE_MOCK_FS__: {
        listDir: () => files.map((file) => entry(file.path)),
        readFile: (path: string) => {
          if (unreadable.some((suffix) => path.endsWith(suffix))) {
            return Promise.reject(new Error('EACCES'));
          }
          const match = files.find((file) => path.endsWith(file.path));
          return Promise.resolve(match?.content ?? '');
        },
      },
    },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

afterEach(() => {
  invalidateFileSystemCache();
});

test('全书统计只数「正文」目录下的章节，设定/人物不计进章数与总字数', async () => {
  const restore = installMockFs([
    { path: '正文\\第001章.md', content: '第一章\n\n他睁开眼。' },
    { path: '正文\\第002章.md', content: '第二章\n\n楼道里全是灰。' },
    { path: '人物\\主角.md', content: '姓名：陈默，年龄二十七岁，退伍。' },
    { path: '设定\\系统.md', content: '吞噬值上限一百。' },
  ]);
  try {
    const totals = await scanManuscriptTotals(ROOT);
    assert.equal(totals.chapters, 2);
    // 「第一章」3 +「他睁开眼。」5 = 8；「第二章」3 +「楼道里全是灰。」7 = 10
    assert.equal(totals.chars, 18);
    assert.equal(totals.unreadable, 0);
  } finally {
    restore();
  }
});

test('读不出的章节如实报数，不当 0 字混进总和', async () => {
  const restore = installMockFs(
    [
      { path: '正文\\第001章.md', content: '他睁开眼。' },
      { path: '正文\\第002章.md', content: '不该被读到' },
    ],
    ['第002章.md'],
  );
  try {
    const totals = await scanManuscriptTotals(ROOT);
    assert.equal(totals.chapters, 2);
    assert.equal(totals.chars, 5);
    assert.equal(totals.unreadable, 1);
  } finally {
    restore();
  }
});

test('空项目返回零章零字而不是抛错', async () => {
  const restore = installMockFs([]);
  try {
    assert.deepEqual(await scanManuscriptTotals(ROOT), {
      chapters: 0,
      chars: 0,
      unreadable: 0,
    });
  } finally {
    restore();
  }
});
