import { invoke } from '@tauri-apps/api/core';
import { TauriFileSystem } from '../../../lib/tauri-fs';
import { assertTauriRuntime } from '../../../lib/tauri-env';

const memory = new Map<string, string>();

function isLocalVirtual(path: string): boolean {
  return path.startsWith('local://');
}

/** path 为 getPublishDataDir 下的绝对路径，或 local:// 虚拟路径。 */
function toRelativeUnderPublish(absolutePath: string, root: string): string | null {
  const a = absolutePath.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (a === r) return '';
  if (a.startsWith(`${r}/`)) return a.slice(r.length + 1);
  return null;
}

let cachedRoot: string | null = null;

async function publishRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  try {
    assertTauriRuntime('publishRoot');
    cachedRoot = await invoke<string>('get_publish_data_dir');
    return cachedRoot;
  } catch {
    cachedRoot = 'local://storyforge-publish';
    return cachedRoot;
  }
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    if (isLocalVirtual(path)) {
      const raw =
        memory.get(path) ??
        (typeof localStorage !== 'undefined' ? localStorage.getItem(path) : null);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    }

    const root = await publishRoot();
    const rel = toRelativeUnderPublish(path, root);
    if (rel !== null) {
      try {
        assertTauriRuntime('read_publish_file');
        const exists = await invoke<boolean>('publish_file_exists', { relativePath: rel });
        if (!exists) return fallback;
        const raw = await invoke<string>('read_publish_file', { relativePath: rel });
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    }

    const exists = await TauriFileSystem.pathExists(path);
    if (!exists) return fallback;
    const raw = await TauriFileSystem.readFile(path);
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  if (isLocalVirtual(path)) {
    memory.set(path, raw);
    if (typeof localStorage !== 'undefined') localStorage.setItem(path, raw);
    return;
  }

  const root = await publishRoot();
  const rel = toRelativeUnderPublish(path, root);
  if (rel !== null) {
    assertTauriRuntime('write_publish_file');
    await invoke('write_publish_file', { relativePath: rel, content: raw });
    return;
  }

  throw new Error(`writeJsonFile 仅支持 publish 数据目录: ${path}`);
}

export async function writeProjectText(
  projectRoot: string,
  absolutePath: string,
  content: string,
): Promise<void> {
  await TauriFileSystem.writeFile(projectRoot, absolutePath.replace(/\\/g, '/'), content);
}

export async function readProjectText(absolutePath: string): Promise<string> {
  return TauriFileSystem.readFile(absolutePath);
}

export function __resetPublishMemoryStore(): void {
  memory.clear();
  cachedRoot = null;
}
