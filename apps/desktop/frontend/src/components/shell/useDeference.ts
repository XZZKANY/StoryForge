import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/**
 * 壳子退场（deference）：作者在中栏正文里连续敲字时，左右两栏后退一步（降不透明度、
 * 淡化描边），停笔或鼠标移回侧栏就回来。内容是主角，chrome 是配角。
 *
 * 与 useShellState 的 layoutMode 正交：那是离散的显示/隐藏（hidden + 卸载边界），
 * 这里是连续的观感强弱。刻意不碰 display/mount——右栏靠 hidden 保住会话状态，
 * 左栏五视图靠 CSS 互斥不卸载，退场只许动 opacity 与描边。
 */

/** 停笔多久把两栏请回来。短于此的换气不该让侧栏闪。 */
export const DEFERENCE_IDLE_MS = 1600;

/**
 * 只有中栏正文区的按键算「作者在写」。对话框、侧栏搜索框、设置弹窗里打字时
 * 那些面板正是作者在看的东西，让它们自己淡出等于打自己脸。
 */
export function isAuthorTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return Boolean((target as Element).closest('[data-testid="editor-panel"]'));
}

/** 修饰键单独按下不算在写字（Ctrl+K 唤起行间对话时不该让壳子退场）。 */
export function isTypingKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace';
}

export function useDeference(): boolean {
  const [deferred, setDeferred] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // 降低动效偏好：不做退场，避免把「安静」实现成「闪烁」。
    if (prefersReducedMotion()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!isTypingKey(event) || !isAuthorTypingTarget(event.target)) return;
      setDeferred(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setDeferred(false);
      }, DEFERENCE_IDLE_MS);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  return deferred;
}
