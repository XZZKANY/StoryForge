/**
 * 顶栏：一条杠（brand-logo + 项目名 + 命令面板触发居中 + 窗控），干掉旧的假菜单栏。
 * 窗控复用原 WindowMenu 的 Tauri 窗口动作；整条可拖拽窗口。
 */
import { isTauriRuntime } from '../../lib/tauri-env';
import { Minus, Search, Square, X } from '../icons/shell-icons';

async function runWindowAction(action: 'drag' | 'minimize' | 'maximize' | 'close') {
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
}

export function Titlebar({
  projectName,
  onOpenPalette,
}: {
  projectName: string | null;
  onOpenPalette: () => void;
}) {
  return (
    <header
      className="flex h-9 flex-shrink-0 select-none items-center gap-3 border-b border-border bg-panel pl-3.5"
      data-testid="shell-titlebar"
      onDoubleClick={() => void runWindowAction('maximize')}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button')) return;
        void runWindowAction('drag');
      }}
    >
      <div className="flex min-w-[200px] items-center gap-2">
        <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated">
          <img
            src="/brand-logo.jpg"
            alt="StoryForge"
            className="h-full w-full object-cover"
            draggable={false}
          />
        </span>
        {projectName && (
          <span className="text-[12.5px] font-semibold text-foreground">{projectName}</span>
        )}
        <span className="text-[11px] text-subtle">StoryForge</span>
      </div>

      <button
        className="mx-auto flex h-6 w-[340px] max-w-[38vw] items-center justify-center gap-2 rounded-md border border-border/70 bg-surface text-[11.5px] text-subtle shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:border-border-strong/60 hover:bg-elevated"
        onClick={onOpenPalette}
        title="命令面板 · Ctrl+P"
      >
        <Search size={13} strokeWidth={1.6} />
        <span>搜索文件或命令</span>
        <kbd className="rounded border border-border px-1 font-mono text-[10px] text-subtle">
          Ctrl P
        </kbd>
      </button>

      <div className="flex min-w-[200px] justify-end">
        <button
          className="flex h-9 w-11 items-center justify-center text-muted hover:bg-elevated"
          onClick={() => void runWindowAction('minimize')}
          title="最小化"
        >
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button
          className="flex h-9 w-11 items-center justify-center text-muted hover:bg-elevated"
          onClick={() => void runWindowAction('maximize')}
          title="最大化"
        >
          <Square size={12} strokeWidth={1.6} />
        </button>
        <button
          className="flex h-9 w-11 items-center justify-center text-muted hover:bg-error hover:text-white"
          onClick={() => void runWindowAction('close')}
          title="关闭"
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}
