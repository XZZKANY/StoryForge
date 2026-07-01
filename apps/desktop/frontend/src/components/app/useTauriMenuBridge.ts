import { useEffect, useRef, useState } from 'react';
import { probeApiRuntimeHealth } from '../../lib/api-client';
import { isTauriRuntime } from '../../lib/tauri-env';

export function useTauriMenuBridge({
  onOpenProject,
  onNewFile,
  onToggleSidebar,
  onRestoreFullLayout,
}: {
  onOpenProject: () => void;
  onNewFile: () => void;
  onToggleSidebar: () => void;
  onRestoreFullLayout: () => void;
}) {
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const [tauriMenuReady, setTauriMenuReady] = useState(false);
  const [tauriMenuError, setTauriMenuError] = useState('');
  const [smokeApiReady, setSmokeApiReady] = useState(false);
  const callbacksRef = useRef({
    onOpenProject,
    onNewFile,
    onToggleSidebar,
    onRestoreFullLayout,
  });

  useEffect(() => {
    callbacksRef.current = {
      onOpenProject,
      onNewFile,
      onToggleSidebar,
      onRestoreFullLayout,
    };
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
          await listen('menu:open-project', () => void callbacksRef.current.onOpenProject()),
        );
        unlistenFns.push(
          await listen('menu:new-file', () => void callbacksRef.current.onNewFile()),
        );
        unlistenFns.push(
          await listen('menu:save', () => document.getElementById('editor-save-btn')?.click()),
        );
        unlistenFns.push(
          await listen('menu:close', () => document.getElementById('editor-close-btn')?.click()),
        );
        unlistenFns.push(
          await listen('menu:toggle-sidebar', () => {
            callbacksRef.current.onToggleSidebar();
          }),
        );
        unlistenFns.push(
          await listen('smoke:reset-panels', () => callbacksRef.current.onRestoreFullLayout()),
        );

        setTauriMenuError('');
        setTauriMenuReady(true);
      } catch (error) {
        setTauriMenuError(
          error instanceof Error ? error.message : 'Failed to register Tauri menu listeners',
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
