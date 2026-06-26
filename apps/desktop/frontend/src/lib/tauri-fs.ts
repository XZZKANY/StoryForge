/**
 * Tauri 文件系统 API 适配层
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { assertTauriRuntime } from './tauri-env';

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  extension?: string;
}

export interface FileChangeEvent {
  kind: 'created' | 'modified' | 'removed' | 'unknown';
  paths: string[];
}

type SmokeFileSystem = {
  readFile?: (path: string) => Promise<string> | string;
  writeFile?: (path: string, content: string) => Promise<void> | void;
  listDir?: (path: string, recursive?: boolean) => Promise<FileEntry[]> | FileEntry[];
  createDir?: (path: string, recursive?: boolean) => Promise<void> | void;
  pathExists?: (path: string) => Promise<boolean> | boolean;
};

declare global {
  interface Window {
    __STORYFORGE_MOCK_FS__?: SmokeFileSystem;
  }
}

function mockFs(): SmokeFileSystem | null {
  return typeof window !== 'undefined' ? (window.__STORYFORGE_MOCK_FS__ ?? null) : null;
}

const LIST_DIR_CACHE_TTL_MS = 5000;

type ListDirCacheEntry = {
  createdAt: number;
  entries: FileEntry[];
};

const listDirCache = new Map<string, ListDirCacheEntry>();
const pendingListDirReads = new Map<string, Promise<FileEntry[]>>();
let fsCacheVersion = 0;

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function listDirCacheKey(path: string, recursive: boolean): string {
  return `${recursive ? 'recursive' : 'direct'}\u0000${normalizeFsPath(path)}`;
}

function cloneEntries(entries: FileEntry[]): FileEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function invalidateListDirCache(changedPath?: string): void {
  fsCacheVersion += 1;
  pendingListDirReads.clear();
  if (!changedPath) {
    listDirCache.clear();
    return;
  }

  const normalizedChangedPath = normalizeFsPath(changedPath);
  for (const key of listDirCache.keys()) {
    const cachedPath = key.split('\u0000')[1];
    if (
      cachedPath === normalizedChangedPath ||
      cachedPath.startsWith(`${normalizedChangedPath}/`) ||
      normalizedChangedPath.startsWith(`${cachedPath}/`)
    ) {
      listDirCache.delete(key);
    }
  }
}

export function invalidateFileSystemCache(path?: string): void {
  invalidateListDirCache(path);
}

export class TauriFileSystem {
  static async readFile(path: string): Promise<string> {
    const mock = mockFs();
    if (mock?.readFile) return await mock.readFile(path);
    assertTauriRuntime('TauriFileSystem.readFile');
    return await invoke<string>('read_file', { path });
  }

  static async writeFile(path: string, content: string): Promise<void> {
    const mock = mockFs();
    try {
      if (mock?.writeFile) return await mock.writeFile(path, content);
      assertTauriRuntime('TauriFileSystem.writeFile');
      await invoke('write_file', { path, content });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async listDir(path: string, recursive = false): Promise<FileEntry[]> {
    const cacheKey = listDirCacheKey(path, recursive);
    const cached = listDirCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < LIST_DIR_CACHE_TTL_MS) {
      return cloneEntries(cached.entries);
    }

    const pending = pendingListDirReads.get(cacheKey);
    if (pending) return cloneEntries(await pending);

    const mock = mockFs();
    const requestVersion = fsCacheVersion;
    const request = (async () => {
      if (mock?.listDir) return await mock.listDir(path, recursive);
      assertTauriRuntime('TauriFileSystem.listDir');
      return await invoke<FileEntry[]>('list_dir', { path, recursive });
    })();
    pendingListDirReads.set(cacheKey, request);
    try {
      const entries = await request;
      if (requestVersion === fsCacheVersion) {
        listDirCache.set(cacheKey, { createdAt: Date.now(), entries: cloneEntries(entries) });
      }
      return cloneEntries(entries);
    } finally {
      pendingListDirReads.delete(cacheKey);
    }
  }

  static async deletePath(path: string, recursive = false): Promise<void> {
    try {
      assertTauriRuntime('TauriFileSystem.deletePath');
      await invoke('delete_path', { path, recursive });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async createDir(path: string, recursive = true): Promise<void> {
    const mock = mockFs();
    try {
      if (mock?.createDir) return await mock.createDir(path, recursive);
      assertTauriRuntime('TauriFileSystem.createDir');
      await invoke('create_dir', { path, recursive });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async renamePath(from: string, to: string): Promise<void> {
    try {
      assertTauriRuntime('TauriFileSystem.renamePath');
      await invoke('rename_path', { from, to });
    } finally {
      invalidateListDirCache(from);
      invalidateListDirCache(to);
    }
  }

  static async pathExists(path: string): Promise<boolean> {
    const mock = mockFs();
    if (mock?.pathExists) return await mock.pathExists(path);
    assertTauriRuntime('TauriFileSystem.pathExists');
    return await invoke<boolean>('path_exists', { path });
  }

  static async getFileInfo(path: string): Promise<FileEntry> {
    assertTauriRuntime('TauriFileSystem.getFileInfo');
    return await invoke<FileEntry>('get_file_info', { path });
  }

  static async watchFile(
    path: string,
    callback: (event: FileChangeEvent) => void,
  ): Promise<() => void> {
    assertTauriRuntime('TauriFileSystem.watchFile');
    const unlisten = await listen<FileChangeEvent>('file-change', (event) => {
      for (const changedPath of event.payload.paths) {
        invalidateListDirCache(changedPath);
      }
      callback(event.payload);
    });

    await invoke('watch_file', { path });
    return unlisten;
  }

  static async stopWatching(): Promise<void> {
    assertTauriRuntime('TauriFileSystem.stopWatching');
    await invoke('stop_watching');
  }
}
