import { afterEach, expect, test, vi } from 'vitest';
import {
  buildContextBundle,
  buildProjectIndexFromEntries,
  selectContextBundleFiles,
} from '../src/lib/project-context';
import { streamContinueProse } from '../src/lib/api/assistant';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

const ROOT = '/tmp/storyforge-context-order-fixture';
const entries = (paths: string[]) =>
  paths.map((relativePath) => ({
    path: `${ROOT}/${relativePath}`,
    name: relativePath.split('/').at(-1)!,
    isDir: false,
    isFile: true,
    extension: 'md',
    size: 100,
    modified: 0,
  }));

const orders = [
  ['Chinese volumes', ['正文/卷一/第001章.md', '正文/卷三/第001章.md', '正文/卷二/第001章.md']],
  ['case', ['正文/A.md', '正文/a.md', '正文/b.md']],
  ['digits and underscore', ['正文/第01章.md', '正文/第02章.md', '正文/第_01章.md']],
  ['supplementary Unicode', ['正文/\uE000.md', '正文/\u{10000}.md', '正文/\u{1F600}.md']],
] as const;

for (const [label, ordered] of orders) {
  test(`${label}: previous context follows backend Unicode codepoint path rank`, () => {
    const index = buildProjectIndexFromEntries(ROOT, entries([...ordered].reverse()));
    for (let i = 1; i < ordered.length; i += 1) {
      const selected = selectContextBundleFiles({
        index,
        currentFile: `${ROOT}/${ordered[i]}`,
        maxFiles: 1,
      });
      expect(selected.files.map((file) => file.relativePath)).toEqual([ordered[i - 1]]);
    }
  });
}

afterEach(() => {
  delete window.__STORYFORGE_MOCK_FS__;
  vi.unstubAllGlobals();
  invalidateFileSystemCache();
});

test('actual collected continuation request receives the canonical predecessor rather than a future volume', async () => {
  const paths = ['正文/卷一/第001章.md', '正文/卷三/第001章.md', '正文/卷二/第001章.md'];
  const content = [
    'CANONICAL_PREVIOUS：她还不知道铜钥匙的秘密。',
    'CURRENT：她推开了门。',
    'FUTURE_ONLY：她在下一卷才知道凶手。',
  ];
  const disk = new Map(paths.map((path, index) => [`${ROOT}/${path}`, content[index]]));
  window.__STORYFORGE_MOCK_FS__ = {
    listDir: () => entries(paths),
    readFile: (path) => disk.get(path) ?? '',
    writeFile: () => {
      throw new Error('read-only context test');
    },
  };
  invalidateFileSystemCache();
  const current = `${ROOT}/${paths[1]}`;
  const bundle = await buildContextBundle({ projectPath: ROOT, currentFile: current, maxFiles: 1 });
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        'event: done\ndata: {"text":"新的段落。","model":"controlled","assistant_session_id":1}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await streamContinueProse({
    projectRoot: ROOT,
    filePath: current,
    content: content[1],
    cursorLine: 1,
    contextBundle: bundle,
  });
  const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(
    request.context_bundle.files.map((file: { relative_path: string }) => file.relative_path),
  ).toEqual([paths[0]]);
  expect(JSON.stringify(request)).toContain('CANONICAL_PREVIOUS');
  expect(JSON.stringify(request)).not.toContain('FUTURE_ONLY');
});
