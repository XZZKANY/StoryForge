import { invoke } from '@tauri-apps/api/core';
import { assertTauriRuntime } from '../../../lib/tauri-env';

const LS_ROOT_KEY = 'storyforge-publish-data-root';

/** 真机：app config/publish；非 Tauri：localStorage 虚拟根。 */
export async function getPublishDataDir(): Promise<string> {
  try {
    assertTauriRuntime('getPublishDataDir');
    return await invoke<string>('get_publish_data_dir');
  } catch {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(LS_ROOT_KEY);
      if (existing) return existing;
      const root = 'local://storyforge-publish';
      localStorage.setItem(LS_ROOT_KEY, root);
      return root;
    }
    return 'local://storyforge-publish';
  }
}

export function publishSettingsPath(root: string): string {
  return joinPublish(root, 'settings.json');
}

export function publishAccountsPath(root: string): string {
  return joinPublish(root, 'accounts.json');
}

export function publishLibraryPath(root: string): string {
  return joinPublish(root, 'library.json');
}

export function publishQuotaPath(root: string, yearMonth: string): string {
  return joinPublish(root, `quota/${yearMonth}.json`);
}

export function projectPublishJsonPath(projectPath: string): string {
  return joinProject(projectPath, '.storyforge/publish.json');
}

export function projectOpenPackDir(projectPath: string): string {
  return joinProject(projectPath, '.storyforge/open-pack');
}

function joinPublish(root: string, rel: string): string {
  if (root.startsWith('local://')) return `${root}/${rel.replace(/\\/g, '/')}`;
  const base = root.replace(/[/\\]+$/, '');
  return `${base}/${rel}`.replace(/\\/g, '/');
}

function joinProject(projectPath: string, rel: string): string {
  const base = projectPath.replace(/[/\\]+$/, '');
  return `${base}/${rel}`.replace(/\\/g, '/');
}

export function normalizeProjectKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
