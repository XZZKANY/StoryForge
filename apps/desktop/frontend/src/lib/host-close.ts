import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from './tauri-env';
import { emitToast } from './toast';

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

/**
 * 上次退出若有写回没确认完成，打开时在右下角通知里提醒作者核对（只提醒，不自动重做）。
 * 两个计数都为 0 时退出时没有在途写回，磁盘上不可能有状态不明的写入，什么都不提示。
 * 要在挂着 ToastHost 的外壳之上调用：父组件的 effect 晚于子树，通知监听已经就位。
 */
export function useHostCloseNotice() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    void invoke<unknown>('read_host_close_diagnostic')
      .then((value) => {
        if (disposed || value === null) return;
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('invalid close diagnostic');
        const row = value as Record<string, unknown>;
        if (row.reason === 'close_confirmed') return;
        if (
          row.reason !== 'close_timeout_unsettled' ||
          !Number.isSafeInteger(row.deliveryTickets) ||
          !Number.isSafeInteger(row.activeCommands)
        )
          throw new Error('invalid close diagnostic');
        const pending = (row.deliveryTickets as number) + (row.activeCommands as number);
        if (pending === 0) return;
        emitToast(
          `上次关闭时还有 ${pending} 个写回操作没确认完成。请打开最近改过的文件核对内容；StoryForge 不会自动重做这些操作。`,
          { tone: 'error', durationMs: 15000 },
        );
      })
      .catch(() => {
        if (!disposed)
          emitToast(
            '没读到上次关闭时的记录，请核对最近改过的文件；StoryForge 不会自动重做任何操作。',
          );
      });
    return () => {
      disposed = true;
    };
  }, []);
}
