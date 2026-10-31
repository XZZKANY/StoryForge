import { useCallback, useEffect, useState, type RefObject } from 'react';

const STORAGE_KEY = 'storyforge:chat-side-rail';

/** 侧栏 18rem 加上至少 40rem 的对话栏；再窄就挤，内容回到输入框顶边的小条和对话头的浮窗。 */
export const CHAT_SIDE_RAIL_MIN_WIDTH = 1000;

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

/**
 * 对话占满中右且对话区够宽时，右边出侧栏（批量写章进度、参考资料、上下文）。作者收起后记在本机，
 * 下次还是收起的。
 */
export function useChatSideRail(rootRef: RefObject<HTMLElement | null>, chatLayout: boolean) {
  const [width, setWidth] = useState<number | null>(null);
  const [open, setOpen] = useState(readStoredOpen);
  useEffect(() => {
    const element = rootRef.current;
    if (!chatLayout || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootRef, chatLayout]);
  const toggle = useCallback(() => {
    setOpen((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? 'closed' : 'open');
      } catch {
        // localStorage 不可用时只记在这次打开里
      }
      return !value;
    });
  }, []);
  const available = chatLayout && width !== null && width >= CHAT_SIDE_RAIL_MIN_WIDTH;
  return { available, open, visible: available && open, toggle };
}

export type ChatSideRailState = ReturnType<typeof useChatSideRail>;
