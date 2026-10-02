import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-env';

/** The ticket is ephemeral, project-bound, and spans ALL original delivery steps. */
export async function withNativeDelivery<T>(
  projectRoot: string,
  operation: (ticket?: string) => Promise<T>,
): Promise<T> {
  if (!isTauriRuntime()) return operation(); // Browser fixtures cannot prove Native admission.
  const ticket = await invoke<unknown>('begin_writeback_delivery', { projectRoot });
  if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket))
    throw new Error('Native 交付资格无效，已阻止写回');
  try {
    return await operation(ticket);
  } finally {
    await invoke('end_writeback_delivery', { deliveryTicket: ticket });
  }
}
