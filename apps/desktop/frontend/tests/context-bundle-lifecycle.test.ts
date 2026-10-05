import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '@storyforge/project-core';

import { streamContinueProse } from '../src/lib/api/assistant';
import { loadInlineContinueContext } from '../src/lib/inline-continue-context';
import { buildContextBundle, invalidateContextBundleCache } from '../src/lib/project-context';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/tauri-fs';

const PROJECT = 'D:/Books/context-lifecycle';
const SOURCE = `${PROJECT}/设定/a.md`;
const OLD = 'OLD_SOURCE：铜钥匙。';
const NEW = 'NEW_SOURCE：银钥匙。';
const disk = new Map<string, string>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function entries(root = PROJECT): FileEntry[] {
  return [...disk.keys()]
    .filter((path) => path.startsWith(`${root}/`))
    .map((path) => ({
      path,
      name: path.split('/').at(-1) ?? '',
      isDir: false,
      isFile: true,
      extension: 'md',
      modified: 0,
      size: 100,
    }));
}

function readCurrent(path: string): string {
  const value = disk.get(path);
  if (value === undefined) throw new Error('fixture source unavailable');
  return value;
}

beforeEach(() => {
  disk.clear();
  disk.set(SOURCE, OLD);
  localStorage.clear();
  window.__STORYFORGE_MOCK_FS__ = {
    readFile: readCurrent,
    listDir: entries,
    writeFile: (path, content) => {
      disk.set(path, content);
    },
  };
  invalidateFileSystemCache();
});

afterEach(() => {
  delete window.__STORYFORGE_MOCK_FS__;
  vi.unstubAllGlobals();
  invalidateFileSystemCache();
});

function holdFirstRead() {
  const started = deferred<void>();
  const held = deferred<string>();
  let reads = 0;
  window.__STORYFORGE_MOCK_FS__!.readFile = (path) => {
    reads += 1;
    if (reads === 1) {
      started.resolve();
      return held.promise;
    }
    return readCurrent(path);
  };
  return { started, held, readCount: () => reads };
}

describe('context cache lifetime at actual collection/delivery boundaries', () => {
  it('save during collection refreshes the pending shortcut request before SSE delivery', async () => {
    const gate = holdFirstRead();
    const target = `${PROJECT}/正文/第02章.md`;
    const loading = loadInlineContinueContext(PROJECT, target);
    await gate.started.promise;
    await TauriFileSystem.writeFile(PROJECT, SOURCE, NEW);
    gate.held.resolve(OLD);
    const bundle = await loading;
    expect(bundle?.files[0].excerpt).toBe(NEW);
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          'event: done\ndata: {"text":"新段。","model":"fake","assistant_session_id":1}\n\n',
          {
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await streamContinueProse({
      projectRoot: PROJECT,
      filePath: target,
      content: '前文。',
      cursorLine: 1,
      contextBundle: bundle ?? undefined,
    });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.context_bundle.files[0].excerpt).toBe(NEW);
    expect(JSON.stringify(body)).not.toContain('OLD_SOURCE');
  });

  it('late old collection cannot overwrite a newer published cache', async () => {
    const gate = holdFirstRead();
    const loading = buildContextBundle({ projectPath: PROJECT, currentFile: null });
    await gate.started.promise;
    await TauriFileSystem.writeFile(PROJECT, SOURCE, NEW);
    const newer = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
    expect(newer.files[0].excerpt).toBe(NEW);
    gate.held.resolve(OLD);
    expect((await loading).files[0].excerpt).toBe(NEW);
    expect(
      (await buildContextBundle({ projectPath: PROJECT, currentFile: null })).files[0].excerpt,
    ).toBe(NEW);
  });

  it('retries the whole collection rather than mixing versions of different sources', async () => {
    const other = `${PROJECT}/设定/b.md`;
    disk.set(other, 'B_SOURCE');
    const started = deferred<void>();
    const held = deferred<string>();
    let paused = false;
    window.__STORYFORGE_MOCK_FS__!.readFile = (path) => {
      if (path === other && !paused) {
        paused = true;
        started.resolve();
        return held.promise;
      }
      return readCurrent(path);
    };
    const loading = buildContextBundle({ projectPath: PROJECT, currentFile: null });
    await started.promise;
    await TauriFileSystem.writeFile(PROJECT, SOURCE, NEW);
    held.resolve('B_SOURCE');
    const bundle = await loading;
    expect(bundle.files.map((file) => file.excerpt)).toEqual([NEW, 'B_SOURCE']);
  });

  it('deletion during index loading reports the pin as missing in the refreshed index', async () => {
    const started = deferred<void>();
    const held = deferred<FileEntry[]>();
    const oldEntries = entries();
    let lists = 0;
    window.__STORYFORGE_MOCK_FS__!.listDir = (root) => {
      lists += 1;
      if (lists === 1) {
        started.resolve();
        return held.promise;
      }
      return entries(root);
    };
    const loading = buildContextBundle({
      projectPath: PROJECT,
      currentFile: null,
      pinnedFiles: ['设定/a.md'],
    });
    await started.promise;
    disk.delete(SOURCE);
    invalidateFileSystemCache(SOURCE);
    held.resolve(oldEntries);
    const bundle = await loading;
    expect(bundle.files).toEqual([]);
    expect(bundle.summary.counts.setting).toBe(0);
    expect(bundle.budget?.missingPinnedFiles).toEqual(['设定/a.md']);
  });

  it('pin order is part of cache identity when pins compete for a limited seat', async () => {
    disk.set(`${PROJECT}/设定/b.md`, 'B_SOURCE');
    const options = { projectPath: PROJECT, currentFile: null, maxFiles: 1 };
    const first = await buildContextBundle({ ...options, pinnedFiles: ['设定/a.md', '设定/b.md'] });
    expect(first.files[0].relativePath).toBe('设定/a.md');
    const reordered = await buildContextBundle({
      ...options,
      pinnedFiles: ['设定/b.md', '设定/a.md'],
    });
    expect(reordered.files[0].relativePath).toBe('设定/b.md');
  });

  it('captures the requested pin order before an asynchronous index read', async () => {
    disk.set(`${PROJECT}/设定/b.md`, 'B_SOURCE');
    const started = deferred<void>();
    const held = deferred<FileEntry[]>();
    window.__STORYFORGE_MOCK_FS__!.listDir = () => {
      started.resolve();
      return held.promise;
    };
    const pins = ['设定/a.md'];
    const loading = buildContextBundle({
      projectPath: PROJECT,
      currentFile: null,
      maxFiles: 1,
      pinnedFiles: pins,
    });
    await started.promise;
    pins[0] = '设定/b.md';
    held.resolve(entries());
    expect((await loading).files[0].relativePath).toBe('设定/a.md');
  });

  it('refuses continued mutation after a bounded number of reads, without stale fallback', async () => {
    let reads = 0;
    window.__STORYFORGE_MOCK_FS__!.readFile = async (path) => {
      reads += 1;
      const value = readCurrent(path);
      await TauriFileSystem.writeFile(PROJECT, path, `${value} 改${reads}`);
      return value;
    };
    await expect(buildContextBundle({ projectPath: PROJECT, currentFile: null })).rejects.toThrow(
      '持续变化',
    );
    expect(reads).toBeLessThanOrEqual(3);
    window.__STORYFORGE_MOCK_FS__!.readFile = readCurrent;
    expect(
      (await buildContextBundle({ projectPath: PROJECT, currentFile: null })).files[0].excerpt,
    ).toBe(readCurrent(SOURCE));
  });

  it('an unrelated project mutation does not invalidate an in-flight collection', async () => {
    const gate = holdFirstRead();
    const loading = buildContextBundle({ projectPath: PROJECT, currentFile: null });
    await gate.started.promise;
    await TauriFileSystem.writeFile('D:/Books/unrelated', 'D:/Books/unrelated/设定/a.md', NEW);
    gate.held.resolve(OLD);
    expect((await loading).files[0].excerpt).toBe(OLD);
    expect(gate.readCount()).toBe(1);
  });

  it.each(['unknown', 'ancestor', 'windows-alias', 'explicit'])(
    '%s invalidation also fences collection that has not reached the cache yet',
    async (kind) => {
      const gate = holdFirstRead();
      const loading = buildContextBundle({ projectPath: PROJECT, currentFile: null });
      await gate.started.promise;
      disk.set(SOURCE, NEW);
      if (kind === 'unknown') invalidateFileSystemCache();
      else if (kind === 'ancestor') invalidateFileSystemCache('D:/Books');
      else if (kind === 'windows-alias')
        invalidateFileSystemCache(SOURCE.toUpperCase().replaceAll('/', '\\'));
      else invalidateContextBundleCache(PROJECT);
      gate.held.resolve(OLD);
      expect((await loading).files[0].excerpt).toBe(NEW);
      expect(gate.readCount()).toBe(2);
    },
  );
});
