/**
 * 装机 WebView2 的浏览器默认行为护栏：F5 / Ctrl+R 会整页刷新前端，Monaco
 * 未保存稿直接丢；壳子区域右键会弹出浏览器默认菜单。仅生产构建安装（dev
 * 保留刷新 / devtools 工作流），入口在 main.tsx。
 */

export function isReloadShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>,
): boolean {
  if (event.key === 'F5') return true;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r';
}

/** 输入类目标保留原生右键菜单（复制/粘贴/拼写）；Monaco 自带菜单自行 preventDefault，不受影响。 */
export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, [contenteditable]') !== null;
}

export function installBrowserGuards(win: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isReloadShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    if (!allowsNativeContextMenu(event.target)) event.preventDefault();
  };
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('contextmenu', onContextMenu);
  return () => {
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('contextmenu', onContextMenu);
  };
}
