import { useEffect, useLayoutEffect, useRef } from 'react';

import { normalizePathForMatch } from '../../lib/project/path';
import { WRITE_BATCH_TAB_EVENT, type WriteBatchTabRequest } from '../../lib/write-batch-tabs';
import type { EditorWorkspaceTabs } from './useEditorWorkspaceTabs';

type TabsView = Pick<
  EditorWorkspaceTabs,
  'openFiles' | 'previewFile' | 'dirtyFiles' | 'handleFileClose'
>;

/**
 * 批量写章期间只关调度器打开的页签：每章开写前记下目标页签开没开着，那时没开着、写完又没被改过的才关。
 * 作者原本开着的、写进去以后作者又动过的（有未保存修改）都不动。
 */
export function useWriteBatchTabs(tabs: TabsView): void {
  const latest = useRef(tabs);
  useLayoutEffect(() => {
    latest.current = tabs;
  });
  const openBefore = useRef(new Map<string, boolean>());
  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<WriteBatchTabRequest>).detail;
      if (!request?.filePath) return;
      const key = normalizePathForMatch(request.filePath);
      const { openFiles, previewFile, dirtyFiles, handleFileClose } = latest.current;
      const match = (path: string | null) => path !== null && normalizePathForMatch(path) === key;
      if (request.kind === 'before') {
        openBefore.current.set(key, openFiles.some(match) || match(previewFile));
        return;
      }
      const wasOpen = openBefore.current.get(key);
      openBefore.current.delete(key);
      if (wasOpen !== false) return;
      const tab = openFiles.find(match);
      if (tab && !dirtyFiles.has(tab)) void handleFileClose(tab);
    };
    window.addEventListener(WRITE_BATCH_TAB_EVENT, onRequest);
    return () => window.removeEventListener(WRITE_BATCH_TAB_EVENT, onRequest);
  }, []);
}
