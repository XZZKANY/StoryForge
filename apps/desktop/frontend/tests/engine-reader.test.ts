import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ProjectReadError } from '@storyforge/engine';
import { nativeProjectReader } from '../src/lib/engine/reader';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

const root = 'D:/synthetic-book';
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('import does not invoke Native and raw reads bypass UI mocks and caches', async () => {
  expect(invoke).not.toHaveBeenCalled();
  const listDir = vi.fn(() => {
    throw new Error('UI mock must not service engine reads');
  });
  window.__STORYFORGE_MOCK_FS__ = { listDir };
  try {
    const response = {
      names: ['.git', 'node_modules', '正文'],
      exceeded: false,
      terminalError: null,
    };
    vi.mocked(invoke).mockResolvedValue(response);
    for (let i = 0; i < 2; i += 1) {
      expect(await nativeProjectReader.readProjectDirectory(root, '.', 3)).toEqual(response);
    }
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('read_engine_project_directory', {
      projectRoot: root,
      path: '.',
      remainingEntries: 3,
    });
    expect(listDir).not.toHaveBeenCalled();
  } finally {
    delete window.__STORYFORGE_MOCK_FS__;
  }
});

it('keeps original and resolved identity, raw nofollow metadata, and undecoded cap+1 bytes', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    relativePath: 'alias.md',
    resolvedRelativePath: '正文/real.md',
  });
  expect(await nativeProjectReader.resolveProjectPath(root, 'alias.md')).toEqual({
    relativePath: 'alias.md',
    resolvedRelativePath: '正文/real.md',
  });
  vi.mocked(invoke).mockResolvedValueOnce({
    entryKind: 'symlink',
    targetKind: 'file',
    isReparsePoint: true,
    sizeBytes: 3,
  });
  expect(await nativeProjectReader.inspectProjectPath(root, 'alias.md')).toEqual({
    entryKind: 'symlink',
    targetKind: 'file',
    isReparsePoint: true,
    sizeBytes: 3,
  });
  vi.mocked(invoke).mockResolvedValueOnce({ base64: '/wAN', bytesRead: 3, exceeded: true });
  expect(await nativeProjectReader.readProjectBytes(root, 'alias.md', 2)).toEqual({
    bytes: new Uint8Array([255, 0, 13]),
    exceeded: true,
  });
  expect(invoke).toHaveBeenLastCalledWith('read_engine_project_bytes', {
    projectRoot: root,
    path: 'alias.md',
    maxBytes: 2,
  });
});

it('does not raise a terminal iterator error before the kernel consumes its prefix', async () => {
  const response = { names: ['early'], exceeded: false, terminalError: 'controlled late failure' };
  vi.mocked(invoke).mockResolvedValue(response);
  expect(await nativeProjectReader.readProjectDirectory(root, '.', 1)).toEqual(response);
});

it.each([
  { names: ['sentinel', 'too-many'], exceeded: true, terminalError: null },
  { names: ['sentinel'], exceeded: false, terminalError: null },
  { names: ['sentinel'], exceeded: true, terminalError: 'cannot be after sentinel' },
  { names: ['../escape'], exceeded: true, terminalError: null },
  { names: [], exceeded: false },
])(
  'rejects a malformed directory DTO rather than disguising it as an optional read failure',
  async (response) => {
    vi.mocked(invoke).mockResolvedValue(response);
    await expect(nativeProjectReader.readProjectDirectory(root, '.', 0)).rejects.toThrow(TypeError);
  },
);

it.each([
  { base64: 'aGk=', bytesRead: 1, exceeded: false },
  { base64: 'aGk=', bytesRead: 2, exceeded: false },
  { base64: 'aGk=', bytesRead: 2, exceeded: true },
])('rejects inconsistent Native byte counters and caps', async (response) => {
  vi.mocked(invoke).mockResolvedValue(response);
  await expect(nativeProjectReader.readProjectBytes(root, 'file.md', 0)).rejects.toThrow(TypeError);
});

it('classifies only invoke rejection as an expected host read error', async () => {
  vi.mocked(invoke).mockRejectedValue('controlled permissions failure');
  await expect(nativeProjectReader.resolveProjectPath(root, '.')).rejects.toThrow(ProjectReadError);
  vi.mocked(invoke).mockResolvedValue({ relativePath: '../escape', resolvedRelativePath: '.' });
  await expect(nativeProjectReader.resolveProjectPath(root, '.')).rejects.toThrow(TypeError);
  expect(invoke).toHaveBeenCalledTimes(2);
});

// Binary octets must survive the same base64 boundary at the real reader budgets.
it.each([
  [0, 0],
  [256, 256],
  [512 * 1024 + 1, 512 * 1024],
  [2 * 1024 * 1024, 2 * 1024 * 1024],
  [2 * 1024 * 1024 + 1, 2 * 1024 * 1024],
])('preserves every octet for %i bytes at cap %i', async (length, cap) => {
  const block = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));
  const binary = block.repeat(Math.ceil(length / 256)).slice(0, length);
  vi.mocked(invoke).mockResolvedValue({
    base64: btoa(binary),
    bytesRead: length,
    exceeded: length > cap,
  });
  const result = await nativeProjectReader.readProjectBytes(root, 'binary.dat', cap);
  expect(result.bytes.length).toBe(length);
  expect(result.bytes.every((byte, index) => byte === index % 256)).toBe(true);
  expect(result.exceeded).toBe(length > cap);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('read_engine_project_bytes', {
    projectRoot: root,
    path: 'binary.dat',
    maxBytes: cap,
  });
});
it.each(['io', 'outside-project'] as const)(
  'preserves typed Native %s rejection without parsing messages',
  async (kind) => {
    vi.mocked(invoke).mockRejectedValue({ kind, message: 'synthetic host error' });
    await expect(nativeProjectReader.resolveProjectPath(root, '.')).rejects.toMatchObject({
      name: 'ProjectReadError',
      kind,
      message: 'synthetic host error',
    });
  },
);

it.each([{ kind: 'unknown', message: 'bad' }, { kind: 'io' }, { message: 'missing kind' }])(
  'rejects malformed Native failure DTO: %j',
  async (failure) => {
    vi.mocked(invoke).mockRejectedValue(failure);
    const result = nativeProjectReader.resolveProjectPath(root, '.');
    await expect(result).rejects.toThrow(TypeError);
    await expect(result).rejects.toHaveProperty('cause', failure);
    expect(invoke).toHaveBeenCalledTimes(1);
  },
);
