/**
 * 顶部窗口菜单栏：模拟原生窗口控制（拖拽/最小化/最大化/关闭）。
 * 从 App.tsx 抽出。
 */
import { isTauriRuntime } from '../../lib/tauri-env';

export function WindowMenu({
  onOpenProject: _onOpenProject,
  onNewFile: _onNewFile,
}: {
  activeProject: string | null;
  onOpenProject: () => void;
  onNewFile: (projectPath?: string) => void;
}) {
  const runWindowAction = async (action: 'drag' | 'minimize' | 'maximize' | 'close') => {
    if (!isTauriRuntime()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      if (action === 'drag') await appWindow.startDragging();
      if (action === 'minimize') await appWindow.minimize();
      if (action === 'maximize') await appWindow.toggleMaximize();
      if (action === 'close') await appWindow.close();
    } catch (error) {
      console.error('窗口操作失败', error);
    }
  };

  return (
    <header
      className="h-9 flex-shrink-0 border-b border-border bg-panel flex items-center px-2 text-[13px]"
      onDoubleClick={() => void runWindowAction('maximize')}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button')) return;
        void runWindowAction('drag');
      }}
    >
      <img src="/favicon.png" alt="" className="mr-2 h-4 w-4 flex-shrink-0" draggable={false} />
      <span className="mr-6">文件</span>
      <span className="mr-6">编辑</span>
      <span className="mr-6">视图</span>
      <span className="mr-4">帮助</span>

      <div className="ml-auto flex h-full items-center text-foreground">
        <button
          className="flex h-full w-11 items-center justify-center hover:bg-elevated hover:text-foreground"
          onClick={() => void runWindowAction('minimize')}
          title="最小化"
        >
          −
        </button>
        <button
          className="flex h-full w-11 items-center justify-center hover:bg-elevated hover:text-foreground"
          onClick={() => void runWindowAction('maximize')}
          title="最大化"
        >
          □
        </button>
        <button
          className="flex h-full w-11 items-center justify-center text-lg leading-none hover:bg-error hover:text-foreground"
          onClick={() => void runWindowAction('close')}
          title="关闭"
        >
          ×
        </button>
      </div>
    </header>
  );
}
