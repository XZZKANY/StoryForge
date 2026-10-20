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

/**
 * 判断快捷键是否从文本输入上下文发出。
 *
 * 壳层快捷键（切换栏位/布局）不能抢走 input、textarea、select 或 contenteditable
 * 的组合键；这里复用右键菜单护栏的目标判定，确保嵌套在可编辑节点里的子节点
 * （例如富文本里的 span）也能识别。普通按钮和壳层容器不属于输入上下文。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable]') !== null;
}

/** 输入类目标保留原生右键菜单（复制/粘贴/拼写）；Monaco 自带菜单自行 preventDefault，不受影响。 */
export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  return isEditableTarget(target);
}

/**
 * Monaco 0.52 的同词高亮把光标移动 / 编辑器聚焦排进一个 50 ms 的 Delayer，trigger() 返回的
 * promise 没人接；这 50 ms 内编辑器被销毁或换模型，Delayer 以取消错误拒绝它，成了未处理的
 * 拒绝（控制台报「Canceled」）。Monaco 自己的 onUnexpectedError 本来就忽略取消，这里按它的
 * isCancellationError 同一判定只认这一种，别的拒绝照常报。
 */
export function isMonacoCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'Canceled' && reason.message === 'Canceled';
}

/** 开发与装机都要装（入口在 main.tsx）；返回卸载函数。 */
export function installMonacoCancellationGuard(win: Window = window): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isMonacoCancellation(event.reason)) event.preventDefault();
  };
  win.addEventListener('unhandledrejection', onRejection);
  return () => win.removeEventListener('unhandledrejection', onRejection);
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
