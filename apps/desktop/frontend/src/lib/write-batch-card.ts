import { useSyncExternalStore } from 'react';

/**
 * 对话栏里那张 `/写` 批量写章确认卡开着没有。卡开着时，会直接发起写章的快捷按钮（「AI 起草下一章」、
 * 开场的「起草第 N 章」等）先藏起来，免得和这一批抢着写；卡关掉就恢复。只有常驻的对话窗口会写它。
 */
let open = false;
const listeners = new Set<() => void>();

export function setWriteBatchCardOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function isWriteBatchCardOpen(): boolean {
  return open;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWriteBatchCardOpen(): boolean {
  return useSyncExternalStore(subscribe, isWriteBatchCardOpen, () => false);
}
