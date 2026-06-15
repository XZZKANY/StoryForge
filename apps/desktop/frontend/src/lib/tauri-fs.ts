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

export class TauriFileSystem {
  static async readFile(path: string): Promise<string> {
    assertTauriRuntime('TauriFileSystem.readFile');
    return await invoke<string>('read_file', { path });
  }

  static async writeFile(path: string, content: string): Promise<void> {
    assertTauriRuntime('TauriFileSystem.writeFile');
    await invoke('write_file', { path, content });
  }

  static async listDir(path: string, recursive = false): Promise<FileEntry[]> {
    assertTauriRuntime('TauriFileSystem.listDir');
    return await invoke<FileEntry[]>('list_dir', { path, recursive });
  }

  static async deletePath(path: string, recursive = false): Promise<void> {
    assertTauriRuntime('TauriFileSystem.deletePath');
    await invoke('delete_path', { path, recursive });
  }

  static async createDir(path: string, recursive = true): Promise<void> {
    assertTauriRuntime('TauriFileSystem.createDir');
    await invoke('create_dir', { path, recursive });
  }

  static async renamePath(from: string, to: string): Promise<void> {
    assertTauriRuntime('TauriFileSystem.renamePath');
    await invoke('rename_path', { from, to });
  }

  static async pathExists(path: string): Promise<boolean> {
    assertTauriRuntime('TauriFileSystem.pathExists');
    return await invoke<boolean>('path_exists', { path });
  }

  static async getFileInfo(path: string): Promise<FileEntry> {
    assertTauriRuntime('TauriFileSystem.getFileInfo');
    return await invoke<FileEntry>('get_file_info', { path });
  }

  static async watchFile(
    path: string,
    callback: (event: FileChangeEvent) => void
  ): Promise<() => void> {
    assertTauriRuntime('TauriFileSystem.watchFile');
    const unlisten = await listen<FileChangeEvent>('file-change', (event) => {
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
