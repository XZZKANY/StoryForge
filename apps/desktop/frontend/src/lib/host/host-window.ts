import { isTauriRuntime } from './tauri-env';

export type WindowAction = 'drag' | 'minimize' | 'maximize' | 'close';

/** 自绘标题栏的窗控；不在宿主里什么都不做，失败只记日志。 */
export async function runWindowAction(action: WindowAction): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    if (action === 'drag') {
      // Windows 不允许拖动最大化窗口（startDragging 静默无效）：先还原再拖，对齐原生手感。
      if (await appWindow.isMaximized()) await appWindow.unmaximize();
      await appWindow.startDragging();
    }
    if (action === 'minimize') await appWindow.minimize();
    if (action === 'maximize') await appWindow.toggleMaximize();
    if (action === 'close') await appWindow.close();
  } catch (error) {
    console.error('窗口操作失败', error);
  }
}
