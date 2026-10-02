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
        setMessage(
          `上次退出未确认完整结算（交付 ${row.deliveryTickets}，原生命令 ${row.activeCommands}）。请只读核对原运行；未知结果不会自动重放。`,
        );
      })
      .catch(() => {
        if (!disposed) setMessage('上次退出诊断无法读取，请核对原运行；不会自动重放。');
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
