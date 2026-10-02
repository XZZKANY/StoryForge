import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import vectors from '../../src-tauri/test-fixtures/writeback-receipt-v1.json';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

beforeEach(() => {
  invalidateFileSystemCache();
  vi.mocked(invoke).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

for (const vector of vectors) {
  test(`describe projects the Native golden without admission: ${vector.relativePath}`, async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const entries = [
      { name: vector.relativePath, path: `/book/${vector.relativePath}`, isDir: false },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(entries).mockResolvedValueOnce(vector.identity);
    await TauriFileSystem.listDir('/book');
    const request = {
      operationKey: vector.operationKey,
      source: vector.source,
      path: `/book/${vector.relativePath}`,
      content: vector.content,
    };
    assert.deepEqual(
      await TauriFileSystem.describeWritebackOperation('/book', request),
      vector.identity,
    );
    assert.deepEqual(await TauriFileSystem.listDir('/book'), entries);
    assert.deepEqual(vi.mocked(invoke).mock.calls, [
      ['list_dir', { path: '/book', recursive: false }],
      ['describe_writeback_operation', { projectRoot: '/book', request }],
    ]);
    assert.equal(dispatchEvent.mock.calls.length, 0);
  });
}

const request = {
  operationKey: 'id:whole',
  source: 'source',
  path: '/book/chapter.md',
  content: 'new',
};
const identity = vectors[0].identity;
const invalid: [string, unknown][] = [
  ['null', null],
  ['array', []],
  ['missing field', { relativePath: 'chapter.md' }],
  ['invalid operation', { ...identity, operationId: 'fixture-1' }],
  ['null character', { ...identity, relativePath: 'a\0b' }],
  ['uppercase digest', { ...identity, fingerprint: 'A'.repeat(64) }],
  ...[
    '',
    '/chapter.md',
    '../chapter.md',
    './chapter.md',
    'a//b',
    'C:/book/chapter.md',
    'a\\b',
    'a/../b',
    'a/',
  ].map((relativePath): [string, unknown] => [
    relativePath || 'empty path',
    { ...identity, relativePath },
  ]),
  ['unexpected field', { ...identity, applied: true }],
];
test.each(invalid)('describe refuses malformed IPC: %s', async (_name, value) => {
  vi.mocked(invoke).mockResolvedValue(value);
  await assert.rejects(TauriFileSystem.describeWritebackOperation('/book', request), /身份/);
  assert.equal(vi.mocked(invoke).mock.calls.length, 1);
});

test('describe propagates unavailable native command without fallback', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('command unavailable'));
  await assert.rejects(
    TauriFileSystem.describeWritebackOperation('/book', request),
    /command unavailable/,
  );
  assert.equal(vi.mocked(invoke).mock.calls.length, 1);
});

test('browser fixture filesystem cannot impersonate Native identity capability', async () => {
  const writeFile = vi.fn();
  const readFile = vi.fn(() => 'old');
  vi.stubGlobal('window', { __STORYFORGE_MOCK_FS__: { writeFile, readFile } });
  await assert.rejects(TauriFileSystem.describeWritebackOperation('/book', request), /不支持/);
  assert.equal(vi.mocked(invoke).mock.calls.length, 0);
  assert.equal(writeFile.mock.calls.length, 0);
  assert.equal(readFile.mock.calls.length, 0);
});
