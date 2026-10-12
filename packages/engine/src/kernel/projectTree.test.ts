import { expect, it } from 'vitest';
import {
  ProjectReadError,
  type ProjectPathMetadata,
  type ProjectReader,
  type RawProjectDirectory,
} from '../readPort';
import { ProjectTreeError, scanProjectFiles } from './projectTree';

const root = 'D:/synthetic-book';
const visible = (path: string) =>
  path === '.' || !path.split('/').some((part) => part.startsWith('.'));
const metadata = (kind: 'file' | 'directory'): ProjectPathMetadata => ({
  entryKind: kind,
  targetKind: kind,
  isReparsePoint: false,
  sizeBytes: kind === 'file' ? 12 : 0,
});

function memoryReader(options: {
  directories: Record<string, string[] | ProjectReadError | RawProjectDirectory>;
  metadata?: Record<string, ProjectPathMetadata | ProjectReadError | TypeError>;
  targets?: Record<string, string | ProjectReadError>;
}) {
  const trace: { operation: string; path: string; remaining?: number }[] = [];
  const reader: ProjectReader = {
    async resolveProjectPath(_root, path) {
      expect(_root).toBe(root);
      trace.push({ operation: 'resolve', path });
      const target = options.targets?.[path] ?? path;
      if (target instanceof Error) throw target;
      return { relativePath: path, resolvedRelativePath: target };
    },
    async inspectProjectPath(_root, path) {
      expect(_root).toBe(root);
      trace.push({ operation: 'inspect', path });
      const info =
        options.metadata?.[path] ?? metadata(path in options.directories ? 'directory' : 'file');
      if (info instanceof Error) throw info;
      return info;
    },
    async readProjectDirectory(_root, path, remaining) {
      expect(_root).toBe(root);
      trace.push({ operation: 'directory', path, remaining });
      const directory = options.directories[path];
      if (directory instanceof Error) throw directory;
      if (!directory) throw new ProjectReadError('synthetic missing directory');
      if (!Array.isArray(directory)) return directory;
      return {
        names: directory.slice(0, remaining + 1),
        exceeded: directory.length > remaining,
        terminalError: null,
      };
    },
    async readProjectBytes() {
      throw new TypeError('Traversal must not read file content');
    },
  };
  return { reader, trace };
}

it('filters both alias roles before inspecting metadata, skips directory links, and retains file alias identity', async () => {
  const { reader, trace } = memoryReader({
    directories: {
      '.': ['.hidden', 'outside.md', 'hidden-target.md', 'alias.md', 'real.md', 'junction', '正文'],
      正文: ['𠀀.md', '\ue000.md'],
    },
    targets: {
      'outside.md': new ProjectReadError('outside'),
      'hidden-target.md': '.hidden/real.md',
      'alias.md': 'real.md',
      junction: '正文',
    },
    metadata: {
      'alias.md': { ...metadata('file'), entryKind: 'symlink', isReparsePoint: true },
      junction: { ...metadata('directory'), isReparsePoint: true },
      'hidden-target.md': new TypeError('Must not eagerly inspect an invisible target'),
    },
  });
  expect(await scanProjectFiles(reader, root, { visible })).toEqual([
    'alias.md',
    'real.md',
    '正文/\ue000.md',
    '正文/𠀀.md',
  ]);
  expect(
    trace.filter((event) => event.operation === 'inspect').map((event) => event.path),
  ).not.toContain('hidden-target.md');
  expect(trace.some((event) => event.operation === 'resolve' && event.path === '.hidden')).toBe(
    false,
  );
  expect(trace.some((event) => event.operation === 'directory' && event.path === 'junction')).toBe(
    false,
  );
});

it('rechecks a queued directory and skips a replaced directory alias before opening it', async () => {
  const { reader, trace } = memoryReader({ directories: { '.': ['正文'], 正文: ['never.md'] } });
  const inspect = reader.inspectProjectPath;
  let inspections = 0;
  reader.inspectProjectPath = async (_root, path) => {
    const info = await inspect(_root, path);
    return { ...info, isReparsePoint: ++inspections > 1 };
  };
  expect(await scanProjectFiles(reader, root, { visible })).toEqual([]);
  expect(
    trace.filter((event) => event.operation === 'directory').map((event) => event.path),
  ).toEqual(['.']);
});

it.each([
  ['depth', metadata('directory'), '项目目录超过最大遍历深度，请缩小范围。'],
  [
    'metadata',
    new ProjectReadError('early metadata failure'),
    '项目目录无法完整遍历，请检查权限或文件是否已移动。',
  ],
] as const)('an early %s error wins over a late iterator failure', async (_name, info, message) => {
  const { reader, trace } = memoryReader({
    directories: {
      '.': { names: ['early'], exceeded: false, terminalError: 'late iterator failure' },
    },
    metadata: { early: info },
  });
  await expect(
    scanProjectFiles(reader, root, { visible, maxDepth: 0, explicitFiles: ['explicit.md'] }),
  ).rejects.toThrow(message);
  expect(trace.some((event) => event.path === 'explicit.md')).toBe(false);
});

it('an early depth error wins over a later budget sentinel', async () => {
  const { reader } = memoryReader({ directories: { '.': ['early', 'sentinel'], early: [] } });
  await expect(
    scanProjectFiles(reader, root, { visible, maxEntries: 1, maxDepth: 0 }),
  ).rejects.toThrow('项目目录超过最大遍历深度，请缩小范围。');
});

it('counts hidden raw entries before visibility and shares the remaining budget across directories', async () => {
  const { reader, trace } = memoryReader({
    directories: { '.': ['正文'], 正文: ['.hidden1', '.hidden2', 'never.md'] },
  });
  await expect(scanProjectFiles(reader, root, { visible, maxEntries: 2 })).rejects.toThrow(
    '项目目录项超过遍历预算，请缩小范围。',
  );
  expect(trace.filter((event) => event.operation === 'directory')).toEqual([
    { operation: 'directory', path: '.', remaining: 2 },
    { operation: 'directory', path: '正文', remaining: 1 },
  ]);
  expect(trace.some((event) => event.path.endsWith('never.md'))).toBe(false);
});

const zeroBudgetCases: { directory: string[] | RawProjectDirectory; message: string | null }[] = [
  { directory: [], message: null },
  { directory: ['.hidden'], message: '项目目录项超过遍历预算，请缩小范围。' },
  {
    directory: { names: [], exceeded: false, terminalError: 'iteration failure' },
    message: '项目目录无法完整遍历，请检查权限或文件是否已移动。',
  },
];
it.each(zeroBudgetCases)(
  'zero remaining budget still distinguishes EOF, sentinel, and iterator failure',
  async ({ directory, message }) => {
    const { reader } = memoryReader({ directories: { '.': directory } });
    const result = scanProjectFiles(reader, root, { visible, maxEntries: 0 });
    if (message === null) expect(await result).toEqual([]);
    else await expect(result).rejects.toThrow(message);
  },
);

it('does not turn exhausted-with-iterator-error into a fabricated budget sentinel', async () => {
  const { reader } = memoryReader({
    directories: {
      '.': { names: ['first.md'], exceeded: false, terminalError: 'iteration failure' },
    },
  });
  await expect(scanProjectFiles(reader, root, { visible, maxEntries: 1 })).rejects.toThrow(
    '项目目录无法完整遍历，请检查权限或文件是否已移动。',
  );
});

it('allows exactly 64 directory levels but rejects a 65th eligible descent', async () => {
  const directories: Record<string, string[]> = { '.': ['d'] };
  let path = 'd';
  for (let depth = 1; depth < 64; depth += 1) {
    directories[path] = ['d'];
    path += '/d';
  }
  directories[path] = ['chapter.md'];
  expect(await scanProjectFiles(memoryReader({ directories }).reader, root, { visible })).toEqual([
    `${path}/chapter.md`,
  ]);
  directories[path] = ['d'];
  directories[`${path}/d`] = [];
  await expect(
    scanProjectFiles(memoryReader({ directories }).reader, root, { visible }),
  ).rejects.toThrow('项目目录超过最大遍历深度，请缩小范围。');
});

it('20,000 filtered raw names are complete; name 20,001 fails rather than returning a partial list', async () => {
  const names = Array.from({ length: 20_000 }, (_, i) => `.hidden${i}`);
  expect(
    await scanProjectFiles(memoryReader({ directories: { '.': names } }).reader, root, { visible }),
  ).toEqual([]);
  names.push('.sentinel');
  await expect(
    scanProjectFiles(memoryReader({ directories: { '.': names } }).reader, root, { visible }),
  ).rejects.toThrow(ProjectTreeError);
});

it('processes explicit files only after complete traversal and only within scope', async () => {
  const { reader } = memoryReader({ directories: { '.': [], 正文: [] } });
  expect(
    await scanProjectFiles(reader, root, {
      visible,
      scope: '正文',
      explicitFiles: ['正文/explicit.md', 'elsewhere.md'],
    }),
  ).toEqual(['正文/explicit.md']);
});

it('programming and invalid-transport errors are not optional filesystem failures', async () => {
  const { reader } = memoryReader({
    directories: { '.': ['broken.md'] },
    metadata: { 'broken.md': new TypeError('invalid DTO') },
  });
  await expect(scanProjectFiles(reader, root, { visible })).rejects.toThrow(TypeError);
});
