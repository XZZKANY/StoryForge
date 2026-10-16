import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from './tauri-env';

/**
 * 退出握手的前端一道闸：宿主广播 `storyforge:host-closing` 时回一声「已停手」，Rust 才不必等满期限。
 * 写回交付票据另由 `native-delivery` 收结；回声失败也不阻塞，宿主的期限独立生效。
 */
export function useAcknowledgeHostClosing() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('storyforge:host-closing', () => {
      void invoke('acknowledge_host_closing').catch(() => {});
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
