import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => undefined),
}));

import {
  DiskDriftError,
  HostFileError,
  ProjectFileMissingError,
  ProjectPathOutsideError,
} from '../src/lib/host-file-errors';
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
        (error) => error instanceof DiskDriftError && /磁盘内容已变化/.test(error.message),
      );
      await TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', '', {
        kind: 'missing',
      });
      await assert.rejects(
        TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', { kind: 'missing' }),
        (error) => error instanceof DiskDriftError && /磁盘内容已变化/.test(error.message),
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

async function readFailure(failure: unknown): Promise<unknown> {
  vi.mocked(invoke).mockRejectedValueOnce(failure);
  return await TauriFileSystem.readProjectFile('D:/Book', 'D:/Book/a.md').then(
    () => assert.fail('读取应当失败'),
    (error: unknown) => error,
  );
}

test('宿主读作品文件报的 { kind, message } 按 kind 翻成错误类，message 与 String(error) 都是宿主原文', async () => {
  const cases = [
    ['missing', '作品文件不存在: D:/Book/.storyforge/book.json', ProjectFileMissingError],
    ['outside-project', '路径不在当前作品内: D:/Other/a.md', ProjectPathOutsideError],
    // 中文 Windows 下作品目录没了，系统原话里有「找不到」：仍是 io，不能当成文件还没建。
    ['io', '无法解析作品目录 D:/Book: 系统找不到指定的路径。 (os error 3)', HostFileError],
  ] as const;
  for (const [kind, message, ErrorClass] of cases) {
    const error = await readFailure({ kind, message });
    assert.ok(error instanceof ErrorClass, kind);
    assert.equal(error instanceof ProjectFileMissingError, kind === 'missing', kind);
    assert.equal(error.message, message);
    assert.equal(String(error), message);
  }
});

test('认不出的宿主报错不硬套类别；字符串报错照旧带原文', async () => {
  for (const failure of [{ kind: 'missing' }, { kind: 'gone', message: 'x' }, { message: 'x' }]) {
    const error = await readFailure(failure);
    assert.ok(error instanceof TypeError, JSON.stringify(failure));
    assert.equal(error.message, 'Invalid Native file error');
    assert.equal((error as { cause?: unknown }).cause, failure);
  }
  const error = await readFailure('invalid args `path` for command `read_project_file`');
  assert.ok(error instanceof HostFileError);
  assert.equal(error instanceof ProjectFileMissingError, false);
  assert.equal(String(error), 'invalid args `path` for command `read_project_file`');
});

test('按基线写入、带回执写入的漂移拒写都翻成 DiskDriftError', async () => {
  const drift = {
    kind: 'drift',
    message: '磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: D:/Book/a.md',
  };
  const isDrift = (error: unknown) =>
    error instanceof DiskDriftError && error.message === drift.message;
  vi.mocked(invoke).mockRejectedValueOnce(drift);
  await assert.rejects(
    TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', { kind: 'missing' }),
    isDrift,
  );
  vi.mocked(invoke).mockRejectedValueOnce(drift);
  await assert.rejects(
    TauriFileSystem.writeFileWithReceipt(
      'D:/Book',
      { operationKey: 'patch-1:whole', source: '[]', path: 'D:/Book/a.md', content: 'new' },
      { kind: 'content', content: 'old' },
      null,
    ),
    isDrift,
  );
  vi.mocked(invoke).mockRejectedValueOnce({ kind: 'io', message: '无法写入文件: 拒绝访问。' });
  await assert.rejects(
    TauriFileSystem.writeFileIfUnchanged('D:/Book', 'D:/Book/a.md', 'new', { kind: 'missing' }),
    (error) => error instanceof HostFileError && !(error instanceof DiskDriftError),
  );
});

test('浏览器替身按宿主同一形状报「文件还没有」', async () => {
  await withMockWindow(
    {
      readFile: (path) => {
        throw { kind: 'missing', message: `作品文件不存在: ${path}` };
      },
    },
    async () => {
      await assert.rejects(
        TauriFileSystem.readProjectFile('D:/Book', 'D:/Book/a.md'),
        ProjectFileMissingError,
      );
    },
  );
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

// 宿主报错只按 lib/host-file-errors 的类判断，写入回执的失败原因只按 detailKind 判断。扫的是把这些字
// 放进正则或 includes / startsWith 之类的写法；确有必要的写进白名单（键是「文件:去掉缩进的那一行」，值写原因）。
const HOST_ERROR_WORDS = String.raw`(?:不存在|找不到|内容已变化|派生缓存未失效|not found|no such file|enoent)`;
const QUOTE = String.raw`['"\x60]`;
const HOST_ERROR_TEXT_MATCHES = [
  new RegExp(
    String.raw`\.(?:includes|startsWith|endsWith|indexOf|match|search)\(\s*${QUOTE}[^'"\x60\n]*${HOST_ERROR_WORDS}`,
    'i',
  ),
  new RegExp(String.raw`/[^/\n]*${HOST_ERROR_WORDS}[^/\n]*/[dgimsuy]*\s*\.(?:test|exec)\(`, 'i'),
  new RegExp(String.raw`\.(?:match|search|replace|split)\(\s*/[^/\n]*${HOST_ERROR_WORDS}`, 'i'),
  new RegExp(String.raw`RegExp\(\s*${QUOTE}[^'"\x60\n]*${HOST_ERROR_WORDS}`, 'i'),
];
const OLD_RECEIPT_COMPAT = '加 detailKind 之前写下的回执只有文字，读回执的唯一入口按旧前缀认一次';
const HOST_ERROR_TEXT_MATCH_ALLOWED = new Map<string, string>([
  [
    "lib/writeback-receipt-types.ts:if (detail.startsWith('canon 派生缓存未失效: ')) return 'canon-cache-stale';",
    OLD_RECEIPT_COMPAT,
  ],
  [
    "lib/writeback-receipt-types.ts:if (detail.startsWith('磁盘内容已变化，已拒绝覆盖')) return 'drift';",
    OLD_RECEIPT_COMPAT,
  ],
]);

test('前端不靠宿主报错的文字做判断', () => {
  const offenders = sourceFiles().flatMap(({ name, text }) =>
    text
      .split('\n')
      .flatMap((line, index) =>
        HOST_ERROR_TEXT_MATCHES.some((pattern) => pattern.test(line)) &&
        !HOST_ERROR_TEXT_MATCH_ALLOWED.has(`${name}:${line.trim()}`)
          ? [`${name}:${index + 1}`]
          : [],
      ),
  );
  assert.deepEqual(offenders, []);
});

test('前端读作品文件只留 readProjectFile 一个口子：没有 readFile，也不再调宿主的 read_file', () => {
  assert.equal(Reflect.has(TauriFileSystem, 'readFile'), false);
  const offenders = (readdirSync('src', { recursive: true }) as string[])
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => /['"`]read_file['"`]/.test(readFileSync(join('src', name), 'utf8')));
  assert.deepEqual(offenders, []);
});
