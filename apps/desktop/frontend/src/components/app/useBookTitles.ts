/**
 * 作品库与文件树顶部显示的书名：读各作品的 `.storyforge/book.json`，作者起过名就用书名，
 * 没起名或读不到就用文件夹名（与总览同一条规则）。作品资料写盘后跟着重读。
 */
import { useState } from 'react';

import { useAsyncEffect } from '../../lib/async-guards';
import { bookProfilePath, displayBookTitle, parseBookProfile } from '../../lib/book-profile';
import { FS_MUTATION_EVENT, TauriFileSystem } from '../../lib/tauri-fs';
import { basename } from './helpers';

async function readTitle(projectPath: string): Promise<string> {
  try {
    const raw = await TauriFileSystem.readProjectFile(projectPath, bookProfilePath(projectPath));
    return displayBookTitle(parseBookProfile(raw), projectPath);
  } catch {
    return basename(projectPath);
  }
}

export function useBookTitles(projectPaths: readonly string[]): (projectPath: string) => string {
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const key = projectPaths.join('\u0000');
  useAsyncEffect(
    (isCurrent) => {
      const paths = key ? key.split('\u0000') : [];
      const load = () =>
        void Promise.all(paths.map(async (path) => [path, await readTitle(path)] as const)).then(
          (entries) => {
            if (isCurrent()) setTitles(new Map(entries));
          },
        );
      load();
      const onMutation = (event: Event) => {
        const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? '';
        if (!path || /[\\/]\.storyforge[\\/]book\.json$/i.test(path)) load();
      };
      window.addEventListener(FS_MUTATION_EVENT, onMutation);
      return () => {
        window.removeEventListener(FS_MUTATION_EVENT, onMutation);
      };
    },
    [key],
  );
  return (projectPath) => titles.get(projectPath) ?? basename(projectPath);
}
