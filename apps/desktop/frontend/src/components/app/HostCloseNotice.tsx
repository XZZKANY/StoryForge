import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../../lib/tauri-env';

/** Fixed diagnostic counts never imply settlement of an unknown operation. */
export function HostCloseNotice() {
  const [message, setMessage] = useState<string | null>(null);
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
        // 两个计数都为 0：退出时没有在途的写回，磁盘上不可能有状态不明的写入，没什么可核对的。
        const pending = (row.deliveryTickets as number) + (row.activeCommands as number);
        if (pending === 0) return;
        setMessage(
          `上次关闭时还有 ${pending} 个写回操作没确认完成。请打开最近改过的文件核对内容；StoryForge 不会自动重做这些操作。`,
        );
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            '没读到上次关闭时的记录，请核对最近改过的文件；StoryForge 不会自动重做任何操作。',
          );
      });
    return () => {
      disposed = true;
    };
  }, []);
  return message ? (
    <aside role="status" className="border-b border-border bg-panel px-4 py-2 text-sm">
      {message}
    </aside>
  ) : null;
}
