import { useEffect, useRef, useState } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api-client';
import { isTauriRuntime } from '../../lib/tauri-env';

/**
 * Tauri 事件通道就绪探针 + 冒烟复位钩子。
 *
 * 曾经这里挂着 6 个 `menu:*` 监听，但原生菜单从未装上（`main.rs` 只写了 `mod menu;`，
 * 既没调 `create_menu` 也没调 `set_menu`，且 `tauri.conf.json` 是 `decorations:false`，
 * Windows 下没有窗口框也就没有菜单栏）。那些监听永远等不到事件，其中两个还去点
 * `#editor-save-btn` / `#editor-close-btn` —— 这两个 id 在 Q3a 删掉编辑区工具行后就不存在了。
 * 本波连同 `src-tauri/src/menu.rs` 一起删除，键盘快捷键统一由 `App.tsx` 的 keydown 兑现。
 *
 * `tauriMenuReady` 这个名字被装机冒烟固化（`main.rs` 断言 `data-tauri-menu-ready`），
 * 故保留原名；它现在的含义是「Tauri 事件通道已跑通一次 listen 往返」。
 */
export function useTauriMenuBridge({ onRestoreFullLayout }: { onRestoreFullLayout: () => void }) {
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const [tauriMenuReady, setTauriMenuReady] = useState(false);
  const [tauriMenuError, setTauriMenuError] = useState('');
  const [smokeApiReady, setSmokeApiReady] = useState(false);
  const callbacksRef = useRef({ onRestoreFullLayout });

  useEffect(() => {
    callbacksRef.current = { onRestoreFullLayout };
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let isCancelled = false;
    const unlistenFns: Array<() => void> = [];

    const setSmokeReadyAttribute = (ready: boolean) => {
      const shell = document.querySelector('[data-testid="desktop-shell"]');
      shell?.setAttribute('data-smoke-api-ready', ready ? 'true' : 'false');
    };

    const probeRuntimeHealth = async () => {
      const health = await probeApiRuntimeHealth();
      if (isCancelled) return;
      const ready = health.status === 'ready';
      setSmokeApiReady(ready);
      setSmokeReadyAttribute(ready);
    };

    void probeRuntimeHealth().catch(() => {
      if (isCancelled) return;
      setSmokeApiReady(false);
      setSmokeReadyAttribute(false);
    });

    const registerMenuListeners = async () => {
      let listen: typeof import('@tauri-apps/api/event').listen;
      try {
        ({ listen } = await import('@tauri-apps/api/event'));
      } catch (error) {
        setTauriMenuError(
          error instanceof Error ? error.message : 'Failed to import Tauri event API',
        );
        return;
      }
      if (isCancelled) return;

      setIsDesktopRuntime(true);

      try {
        unlistenFns.push(
          await listen('smoke:reset-panels', () => callbacksRef.current.onRestoreFullLayout()),
        );

        setTauriMenuError('');
        setTauriMenuReady(true);
      } catch (error) {
        setTauriMenuError(
          error instanceof Error ? error.message : 'Failed to register Tauri event listeners',
        );
      }
    };

    void registerMenuListeners();

    return () => {
      isCancelled = true;
      setIsDesktopRuntime(false);
      setTauriMenuReady(false);
      setSmokeApiReady(false);
      setTauriMenuError('');
      setSmokeReadyAttribute(false);
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  return {
    isDesktopRuntime,
    tauriMenuReady,
    tauriMenuError,
    smokeApiReady,
  };
}
