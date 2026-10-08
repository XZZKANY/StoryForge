import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { buildProjectIndexFromEntries } from '../src/lib/project/index';
import { selectContextBundleFiles } from '../src/lib/project/context-bundle';
import fixtures from './context-order-python-fixtures.json';

const root = '/review-novel';
function indexFor(paths: string[]) {
  return buildProjectIndexFromEntries(
    root,
    paths.map((path) => ({
      name: path.split('/').at(-1)!,
      path: `${root}/${path}`,
      isDir: false,
      size: 20,
      modified: 1,
      extension: path.split('.').at(-1),
    })),
  );
}

// Oracle fixture is produced with Python sorted(), independently of JS collation.
for (const fixture of fixtures) {
  for (const reverse of [false, true]) {
    test(`previous-chapter seat follows Python order: ${fixture.name}, reverse=${reverse}`, () => {
      const paths = reverse ? [...fixture.ordered].reverse() : fixture.ordered;
      const index = indexFor(paths);
      for (let i = 1; i < fixture.ordered.length; i += 1) {
        const selected = selectContextBundleFiles({
          index,
          currentFile: `${root}/${fixture.ordered[i]}`,
          maxFiles: 1,
        });
        assert.deepEqual(
          selected.files.map((file) => file.relativePath),
          [fixture.ordered[i - 1]],
        );
      }
    });
  }
}

test('non-manuscript and hidden files do not become reading-order predecessors', () => {
  const index = indexFor([
    '正文/A.md',
    '正文/a.md',
    '正文/b.md',
    '人物/a.md',
    '设定/a.md',
    '导出/a.md',
    '质量/a.md',
    '.hidden/a.md',
    '正文/.hidden/a.md',
    '正文/a.txt',
  ]);
  const selection = selectContextBundleFiles({
    index,
    currentFile: `${root}/正文/b.md`,
    maxFiles: 1,
  });
  assert.deepEqual(
    selection.files.map((file) => file.relativePath),
    ['正文/a.md'],
  );
});

test('explicit pin retains its seat before previous chapter', () => {
  const index = indexFor(['正文/A.md', '正文/a.md', '正文/b.md', '设定/rules.md']);
  const selection = selectContextBundleFiles({
    index,
    currentFile: `${root}/正文/b.md`,
    maxFiles: 1,
    pinnedFiles: ['设定/rules.md'],
  });
  assert.deepEqual(
    selection.files.map((file) => file.relativePath),
    ['设定/rules.md'],
  );
});

test('draft predecessor is independent of a different host collation', () => {
  const index = indexFor(['正文/A.md', '正文/a.md', '正文/b.md']);
  const nativeCompare = String.prototype.localeCompare;
  const collator = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
    this: string,
    other: string,
  ) {
    return -nativeCompare.call(this, other);
  });
  try {
    const selection = selectContextBundleFiles({
      index,
      currentFile: `${root}/正文/b.md`,
      maxFiles: 1,
    });
    assert.deepEqual(
      selection.files.map((file) => file.relativePath),
      ['正文/a.md'],
    );
  } finally {
    collator.mockRestore();
  }
});
