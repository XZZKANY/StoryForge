/**
 * Tauri 文件系统 API 适配层
 */

import { invoke } from '@tauri-apps/api/core';
import type { FileEntry } from '@storyforge/project-core';
import {
  DiskDriftError,
  HostFileError,
  ProjectFileMissingError,
  ProjectPathOutsideError,
} from './host-file-errors';
import { assertTauriRuntime } from './tauri-env';
import {
  decodeWritebackIdentity,
  decodeWritebackReceipt,
  type WritebackIdentity,
  type WritebackReceipt,
  type WritebackRequest,
} from './writeback-receipt-types';
import {
  createFixtureAudit,
  inspectFixtureReceipt,
  readFixtureAudit,
  writeFixtureReceipt,
} from './writeback-receipt-fixture';

export type { FileEntry } from '@storyforge/project-core';

// Raw disk state from the last successful load/write, never a normalized editor buffer.
export type DiskBaseline =
  | { readonly kind: 'missing' }
  | { readonly kind: 'content'; readonly content: string };

/**
 * 本地文件系统被本进程改动（写入/新建/删除/改名）后广播。
 * 资源树等派生视图监听此事件重新拉取——补丁写回、Agent 起草新文件后立即刷新，
 * 不再依赖视图切换重挂载或 5s 缓存过期才「过一会」显示。
 */
export const FS_MUTATION_EVENT = 'storyforge:fs-mutation';

function emitFsMutation(path?: string): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent<{ path?: string }>(FS_MUTATION_EVENT, { detail: { path } }),
    );
  }
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

// 作品根也进键：同一路径换个作品根，宿主的围栏结论可能不同。失效按第二段（路径）匹配。
function listDirCacheKey(projectRoot: string, path: string, recursive: boolean): string {
  return `${recursive ? 'recursive' : 'direct'}\u0000${normalizeFsPath(path)}\u0000${normalizeFsPath(projectRoot)}`;
}

function cloneEntries(entries: FileEntry[]): FileEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function invalidateListDirCache(changedPath?: string): void {
  fsCacheVersion += 1;
  pendingListDirReads.clear();
  if (!changedPath) {
    listDirCache.clear();
    emitFsMutation();
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
  emitFsMutation(changedPath);
}

export function invalidateFileSystemCache(path?: string): void {
  invalidateListDirCache(path);
}

// 读作品文件、按基线写入两类命令报 `{ kind, message }`，照引擎读作品口（lib/engine/reader.ts）
// 的做法按 kind 翻成错误类；浏览器替身也按同一形状报。
function hostFileFailure(error: unknown): unknown {
  if (typeof error === 'string') return new HostFileError(error);
  if (error === null || typeof error !== 'object' || error instanceof Error) return error;
  const { kind, message } = error as { kind?: unknown; message?: unknown };
  if (typeof message === 'string') {
    if (kind === 'missing') return new ProjectFileMissingError(message);
    if (kind === 'outside-project') return new ProjectPathOutsideError(message);
    if (kind === 'drift') return new DiskDriftError(message);
    if (kind === 'io') return new HostFileError(message);
  }
  return Object.assign(new TypeError('Invalid Native file error'), { cause: error });
}

export class TauriFileSystem {
  static async readProjectFile(projectRoot: string, path: string): Promise<string> {
    const mock = mockFs();
    try {
      if (mock?.readFile) return await mock.readFile(path);
      assertTauriRuntime('TauriFileSystem.readProjectFile');
      return await invoke<string>('read_project_file', { projectRoot, path });
    } catch (error) {
      throw hostFileFailure(error);
    }
  }

  static async writeFile(
    projectRoot: string,
    path: string,
    content: string,
    deliveryTicket?: string,
  ): Promise<void> {
    const mock = mockFs();
    try {
      if (mock?.writeFile) return await mock.writeFile(path, content);
      assertTauriRuntime('TauriFileSystem.writeFile');
      await invoke('write_file', {
        ...(deliveryTicket ? { deliveryTicket } : {}),
        projectRoot,
        path,
        content,
      });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async writeFileIfUnchanged(
    projectRoot: string,
    path: string,
    content: string,
    expected: DiskBaseline,
    deliveryTicket?: string,
  ): Promise<void> {
    const mock = mockFs();
    try {
      if (mock) {
        // Browser fixtures emulate the comparison, not native atomic replacement.
        // Never silently fall back to an unconditional mock write.
        if (!mock.pathExists || !mock.readFile || !mock.writeFile)
          throw new Error('测试文件系统缺少磁盘基线检查能力');
        const exists = await mock.pathExists(path);
        const current = exists ? await mock.readFile(path) : null;
        const matches =
          expected.kind === 'missing' ? !exists : exists && current === expected.content;
        if (!matches) throw new DiskDriftError('磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突');
        await mock.writeFile(path, content);
        return;
      }
      assertTauriRuntime('TauriFileSystem.writeFileIfUnchanged');
      await invoke('write_file_if_unchanged', {
        ...(deliveryTicket ? { deliveryTicket } : {}),
        projectRoot,
        path,
        content,
        expected,
      });
    } catch (error) {
      throw hostFileFailure(error);
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async describeWritebackOperation(
    projectRoot: string,
    request: WritebackRequest,
  ): Promise<WritebackIdentity> {
    // Browser file fixtures cannot prove the host's canonical operation identity.
    if (mockFs()) throw new Error('测试文件系统不支持原生写入身份描述');
    assertTauriRuntime('TauriFileSystem.describeWritebackOperation');
    return decodeWritebackIdentity(
      await invoke<unknown>('describe_writeback_operation', { projectRoot, request }),
    );
  }

  static async inspectWritebackReceipt(
    projectRoot: string,
    request: WritebackRequest,
  ): Promise<WritebackReceipt | null> {
    const mock = mockFs();
    if (mock) return inspectFixtureReceipt(mock, projectRoot, request);
    assertTauriRuntime('TauriFileSystem.inspectWritebackReceipt');
    const result = await invoke<unknown>('inspect_writeback_receipt', { projectRoot, request });
    return result === null ? null : decodeWritebackReceipt(result);
  }

  /** 只修复已应用写回的可弃缓存，不接受正文基线也不触发正文写入。 */
  static async repairWritebackCanonCache(
    projectRoot: string,
    request: WritebackRequest,
  ): Promise<WritebackReceipt> {
    if (mockFs()) throw new Error('测试文件系统不支持原生缓存修复');
    assertTauriRuntime('TauriFileSystem.repairWritebackCanonCache');
    return decodeWritebackReceipt(
      await invoke<unknown>('repair_writeback_canon_cache', { projectRoot, request }),
    );
  }

  static async writeFileWithReceipt(
    projectRoot: string,
    request: WritebackRequest,
    expected: DiskBaseline,
    checkpointTimestamp: number | null,
    deliveryTicket?: string,
  ): Promise<WritebackReceipt> {
    try {
      const mock = mockFs();
      if (mock)
        return await writeFixtureReceipt(
          mock,
          projectRoot,
          request,
          expected,
          checkpointTimestamp,
          () => this.writeFileIfUnchanged(projectRoot, request.path, request.content, expected),
        );
      assertTauriRuntime('TauriFileSystem.writeFileWithReceipt');
      return decodeWritebackReceipt(
        await invoke<unknown>('write_file_with_receipt', {
          ...(deliveryTicket ? { deliveryTicket } : {}),
          projectRoot,
          request,
          expected,
          checkpointTimestamp,
        }),
      );
    } catch (error) {
      throw hostFileFailure(error);
    } finally {
      invalidateListDirCache(request.path);
    }
  }

  /** Locate by Native operation identity, never by a caller-supplied audit path. */
  static async readWritebackAudit(
    projectRoot: string,
    request: WritebackRequest,
  ): Promise<{ operationId: string; content: string } | null> {
    const mock = mockFs();
    if (mock) return readFixtureAudit(mock, projectRoot, request);
    const { operationId } = await this.describeWritebackOperation(projectRoot, request);
    const separator = projectRoot.includes('\\') ? '\\' : '/';
    const path = [
      projectRoot.replace(/[/\\]+$/, ''),
      '.storyforge',
      'author-loop',
      `${operationId}.md`,
    ].join(separator);
    return (await this.projectPathExists(projectRoot, path))
      ? { operationId, content: await this.readProjectFile(projectRoot, path) }
      : null;
  }

  static async createWritebackAudit(
    projectRoot: string,
    operationId: string,
    content: string,
    deliveryTicket?: string,
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(operationId)) throw new Error('写入审计 operationId 无效');
    const mock = mockFs();
    if (mock) return createFixtureAudit(mock, projectRoot, operationId, content);
    assertTauriRuntime('TauriFileSystem.createWritebackAudit');
    await invoke('create_writeback_audit', {
      ...(deliveryTicket ? { deliveryTicket } : {}),
      projectRoot,
      operationId,
      content,
    });
    invalidateListDirCache(projectRoot);
  }

  /** 列作品内的目录（作品根本身也能列）；作品外的路径宿主直接拒绝。 */
  static async listProjectDir(
    projectRoot: string,
    path: string,
    recursive = false,
  ): Promise<FileEntry[]> {
    const cacheKey = listDirCacheKey(projectRoot, path, recursive);
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
      assertTauriRuntime('TauriFileSystem.listProjectDir');
      return await invoke<FileEntry[]>('list_project_dir', { projectRoot, path, recursive });
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

  static async deletePath(
    projectRoot: string,
    path: string,
    recursive = false,
    deliveryTicket?: string,
  ): Promise<void> {
    try {
      assertTauriRuntime('TauriFileSystem.deletePath');
      await invoke('delete_path', {
        ...(deliveryTicket ? { deliveryTicket } : {}),
        projectRoot,
        path,
        recursive,
      });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async createDir(projectRoot: string, path: string, recursive = true): Promise<void> {
    const mock = mockFs();
    try {
      if (mock?.createDir) return await mock.createDir(path, recursive);
      assertTauriRuntime('TauriFileSystem.createDir');
      await invoke('create_dir', { projectRoot, path, recursive });
    } finally {
      invalidateListDirCache(path);
    }
  }

  static async renamePath(projectRoot: string, from: string, to: string): Promise<void> {
    try {
      assertTauriRuntime('TauriFileSystem.renamePath');
      await invoke('rename_path', { projectRoot, from, to });
    } finally {
      invalidateListDirCache(from);
      invalidateListDirCache(to);
    }
  }

  /** 在系统文件管理器里选中项目内的这个文件或文件夹（只读，宿主会核对路径在项目内）。 */
  static async revealInFileManager(projectRoot: string, path: string): Promise<void> {
    assertTauriRuntime('TauriFileSystem.revealInFileManager');
    await invoke('reveal_in_file_manager', { projectRoot, path });
  }

  /** 作品内的路径在不在；作品外的路径宿主直接报错，不回答在不在。 */
  static async projectPathExists(projectRoot: string, path: string): Promise<boolean> {
    const mock = mockFs();
    if (mock?.pathExists) return await mock.pathExists(path);
    assertTauriRuntime('TauriFileSystem.projectPathExists');
    return await invoke<boolean>('project_path_exists', { projectRoot, path });
  }

  /**
   * 打开作品前核对作品文件夹还在不在（最近作品、恢复上次现场），只回答「是不是一个现存的文件夹」。
   * 作品里的路径一律用 projectPathExists；允许调它的文件列在 tests/tauri-fs.test.ts。
   */
  static async projectFolderExists(path: string): Promise<boolean> {
    const mock = mockFs();
    if (mock?.pathExists) return await mock.pathExists(path);
    assertTauriRuntime('TauriFileSystem.projectFolderExists');
    return await invoke<boolean>('project_folder_exists', { path });
  }
}
