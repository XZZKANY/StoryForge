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
  // 窗口材质的实际结果由 Rust 侧 apply_mica 的真 Result 决定（见 main.rs
  // apply_window_material）。非桌面运行时 / Win10 / apply 失败都停在 none，
  // 此时 CSS 的透明画布整块不启用，观感与改前逐像素一致。
  const [windowEffect, setWindowEffect] = useState<'mica' | 'none'>('none');
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

      // 材质在 setup 里就挂好了，用 command 读结果而不是 listen 事件：
      // setup 早于前端挂监听，emit 会丢（smoke:reset-panels 就是这个坑的活体标本）。
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{ effect: string }>('get_window_effect_status');
        if (!isCancelled && status?.effect === 'mica') setWindowEffect('mica');
      } catch {
        // 拿不到就当没生效——保持不透明底，不影响任何既有行为
      }

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
      setWindowEffect('none');
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
    windowEffect,
  };
}
