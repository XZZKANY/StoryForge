import { useEffect, useLayoutEffect, useRef } from 'react';
import { isTauriRuntime } from '../../lib/tauri-env';
import { emitToast } from '../../lib/toast';

/** Covers native close requests (titlebar and OS), not just one close button. */
export function useNativeCloseGuard(confirmClose: () => Promise<boolean>) {
  const confirmRef = useRef(confirmClose);
  useLayoutEffect(() => {
    confirmRef.current = confirmClose;
  }, [confirmClose]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let pending = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (disposed) return;
      const stop = await getCurrentWindow().onCloseRequested(async (event) => {
        if (disposed || pending) {
          event.preventDefault();
          return;
        }
        pending = true;
        try {
          // The Tauri API awaits this handler before destroying the window.
          if (!(await confirmRef.current()) || disposed) event.preventDefault();
        } catch {
          event.preventDefault();
          emitToast('无法完成退出检查，已保留窗口。请保存修改后重试。', { tone: 'error' });
        } finally {
          pending = false;
        }
      });
      if (disposed) stop();
      else unlisten = stop;
    })().catch(() => {
      if (!disposed) {
        emitToast('退出保护未能启用，请先保存修改再关闭窗口。', { tone: 'error' });
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
