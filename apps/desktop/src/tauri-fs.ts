/**
 * Tauri 文件系统 API 适配层
 * 提供类型安全的文件操作接口
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 文件条目信息
 */
export interface FileEntry {
  /** 文件名 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否为目录 */
  isDir: boolean;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间（Unix 时间戳，秒） */
  modified: number;
  /** 文件扩展名 */
  extension?: string;
}

/**
 * 文件变化事件
 */
export interface FileChangeEvent {
  /** 事件类型：created, modified, removed */
  kind: 'created' | 'modified' | 'removed' | 'unknown';
  /** 变化的文件路径列表 */
  paths: string[];
}

/**
 * Tauri 文件系统 API
 */
export class TauriFileSystem {
  /**
   * 读取文件内容
   */
  static async readFile(path: string): Promise<string> {
    return await invoke<string>('read_file', { path });
  }

  /**
   * 写入文件内容
   */
  static async writeFile(path: string, content: string): Promise<void> {
    await invoke('write_file', { path, content });
  }

  /**
   * 列出目录内容
   * @param path 目录路径
   * @param recursive 是否递归列出子目录（默认 false）
   */
  static async listDir(path: string, recursive = false): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>('list_dir', { path, recursive });
  }

  /**
   * 删除文件或目录
   * @param path 路径
   * @param recursive 如果是目录，是否递归删除（默认 false）
   */
  static async deletePath(path: string, recursive = false): Promise<void> {
    await invoke('delete_path', { path, recursive });
  }

  /**
   * 创建目录
   * @param path 目录路径
   * @param recursive 是否递归创建父目录（默认 true）
   */
  static async createDir(path: string, recursive = true): Promise<void> {
    await invoke('create_dir', { path, recursive });
  }

  /**
   * 重命名/移动文件或目录
   */
  static async renamePath(from: string, to: string): Promise<void> {
    await invoke('rename_path', { from, to });
  }

  /**
   * 检查路径是否存在
   */
  static async pathExists(path: string): Promise<boolean> {
    return await invoke<boolean>('path_exists', { path });
  }

  /**
   * 获取文件信息
   */
  static async getFileInfo(path: string): Promise<FileEntry> {
    return await invoke<FileEntry>('get_file_info', { path });
  }

  /**
   * 启动文件监听
   * @param path 要监听的路径（会递归监听子目录）
   * @param callback 文件变化时的回调函数
   * @returns 取消监听的函数
   */
  static async watchFile(
    path: string,
    callback: (event: FileChangeEvent) => void
  ): Promise<() => void> {
    // 监听文件变化事件
    const unlisten = await listen<FileChangeEvent>('file-change', (event) => {
      callback(event.payload);
    });

    // 启动监听
    await invoke('watch_file', { path });

    // 返回取消监听函数
    return unlisten;
  }

  /**
   * 停止所有文件监听
   */
  static async stopWatching(): Promise<void> {
    await invoke('stop_watching');
  }
}

/**
 * 文件路径工具
 */
export class PathUtils {
  /**
   * 获取文件名（包含扩展名）
   */
  static basename(path: string): string {
    return path.split(/[/\\]/).pop() || '';
  }

  /**
   * 获取目录路径
   */
  static dirname(path: string): string {
    return path.split(/[/\\]/).slice(0, -1).join('/') || '/';
  }

  /**
   * 获取文件扩展名（不包含点）
   */
  static extname(path: string): string {
    const name = this.basename(path);
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.slice(lastDot + 1) : '';
  }

  /**
   * 拼接路径
   */
  static join(...parts: string[]): string {
    return parts
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/\\/g, '/');
  }

  /**
   * 规范化路径（统一使用正斜杠）
   */
  static normalize(path: string): string {
    return path.replace(/\\/g, '/');
  }

  /**
   * 判断是否为绝对路径
   */
  static isAbsolute(path: string): boolean {
    return /^[a-zA-Z]:/.test(path) || path.startsWith('/');
  }
}

/**
 * 错误处理工具
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'FileSystemError';
  }

  static isNotFound(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('不存在') || error.message.includes('not found'))
    );
  }

  static isPermissionDenied(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('权限') || error.message.includes('permission'))
    );
  }
}
