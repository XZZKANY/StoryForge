/**
 * 右侧工作台：文件树 + Monaco 编辑器，含文件树宽度拖拽。
 * 从 App.tsx 抽出。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { StoryNavigator } from '../StoryNavigator';
import { Editor } from '../Editor';
import type { AppDialogApi } from './AppDialog';

function CollapsedRail({
  testId,
  title,
  label,
  onClick,
}: {
  testId: string;
  title: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      title={title}
      className="group w-9 h-full flex-shrink-0 border-r border-border bg-panel text-muted hover:text-foreground hover:bg-elevated transition-colors flex flex-col items-center justify-start py-3 gap-2"
    >
      <span className="text-lg leading-none opacity-80 transition-opacity group-hover:opacity-100">
        ›
      </span>
      <span className="vertical-rl text-[12px] tracking-wide">{label}</span>
    </button>
  );
}

export function RightWorkspace({
  activeProject,
  currentFile,
  recentFiles,
  workspaceVisible,
  projectRefreshVersion,
  editorFontSize,
  autoSave,
  onFileSelect,
  onFileClose,
  onCloseWorkspace,
  onToggleWorkspace,
  onRestoreWorkspace,
  onExportCurrent,
  dialogs,
}: {
  activeProject: string | null;
  currentFile: string | null;
  recentFiles: string[];
  workspaceVisible: boolean;
  projectRefreshVersion: number;
  editorFontSize: number;
  autoSave: boolean;
  onFileSelect: (filePath: string) => void;
  onFileClose: () => void;
  onCloseWorkspace: () => void;
  onToggleWorkspace: () => void;
  onRestoreWorkspace: () => void;
  onExportCurrent: () => void;
  dialogs: AppDialogApi;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileTreeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [fileTreeWidth, setFileTreeWidth] = useState(288);
  const [isFileTreeDragging, setIsFileTreeDragging] = useState(false);
  const fileTreeMinWidth = 184;
  const fileTreeMaxWidth = 440;
  const editorMinWidth = 360;
  const fileTreeResizerWidth = 4;

  const clampFileTreeWidth = useCallback((nextWidth: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    const maxByContainer = containerWidth
      ? Math.max(fileTreeMinWidth, containerWidth - editorMinWidth - fileTreeResizerWidth)
      : fileTreeMaxWidth;
    const effectiveMax = Math.min(fileTreeMaxWidth, maxByContainer);
    return Math.min(Math.max(nextWidth, fileTreeMinWidth), effectiveMax);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 布局变化时按容器夹紧文件树宽度，React18 合法模式
    setFileTreeWidth((width) => clampFileTreeWidth(width));
  }, [clampFileTreeWidth, workspaceVisible]);

  useEffect(() => {
    if (!isFileTreeDragging) return;

    const resize = (event: PointerEvent) => {
      const dragState = fileTreeDragRef.current;
      if (!dragState) return;
      setFileTreeWidth(clampFileTreeWidth(dragState.startWidth + event.clientX - dragState.startX));
    };

    const stopResize = () => {
      fileTreeDragRef.current = null;
      setIsFileTreeDragging(false);
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [clampFileTreeWidth, isFileTreeDragging]);

  const beginFileTreeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    fileTreeDragRef.current = { startX: event.clientX, startWidth: fileTreeWidth };
    setIsFileTreeDragging(true);
  };

  const endFileTreeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (fileTreeDragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    fileTreeDragRef.current = null;
    setIsFileTreeDragging(false);
  };

  return (
    <div ref={containerRef} className="flex h-full min-w-0">
      {workspaceVisible ? (
        <section
          className="flex h-full flex-shrink-0 flex-col bg-panel"
          style={{ width: fileTreeWidth }}
          data-testid="file-tree-panel"
        >
          <div className="h-9 flex-shrink-0" aria-hidden="true" />
          <div className="flex min-h-0 flex-1 flex-col">
            <StoryNavigator
              projectPath={activeProject}
              currentFile={currentFile}
              refreshVersion={projectRefreshVersion}
              onFileSelect={onFileSelect}
            />
          </div>
          <div className="hidden" aria-hidden="true" data-recent-count={recentFiles.length} />
        </section>
      ) : (
        <CollapsedRail
          testId="expand-file-tree"
          label="文件"
          title="展开文件树"
          onClick={onRestoreWorkspace}
        />
      )}

      {workspaceVisible && (
        <div
          role="separator"
          aria-orientation="vertical"
          data-testid="file-tree-resizer"
          className={`group relative w-1 flex-shrink-0 cursor-col-resize bg-panel ${
            isFileTreeDragging ? 'bg-accent' : 'hover:bg-elevated'
          }`}
          style={{ touchAction: 'none' }}
          onPointerDown={beginFileTreeResize}
          onPointerUp={endFileTreeResize}
          onPointerCancel={endFileTreeResize}
          onDoubleClick={() => setFileTreeWidth(288)}
          title="拖拽调整文件树宽度，双击恢复默认宽度"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent" />
        </div>
      )}

      <section className="flex-1 min-w-0 bg-background" data-testid="editor-panel">
        <Editor
          projectPath={activeProject}
          filePath={currentFile}
          editorFontSize={editorFontSize}
          autoSave={autoSave}
          onClose={currentFile ? onFileClose : onCloseWorkspace}
          onToggleSidebar={onToggleWorkspace}
          sidebarVisible={workspaceVisible}
          onExportCurrent={onExportCurrent}
          dialogs={dialogs}
        />
      </section>
    </div>
  );
}

export function FloatingComposer({
  projectName,
  onRestore,
  onRestoreLayout,
  onFullConversation,
}: {
  projectName: string;
  onRestore: () => void;
  onRestoreLayout: () => void;
  onFullConversation: () => void;
}) {
  return (
    <div
      className="rounded-[22px] border border-border bg-panel/95 px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur"
      data-testid="floating-composer"
    >
      <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted">
        <button
          data-testid="expand-assistant"
          className="rounded-full border border-border px-3 py-1 hover:bg-elevated"
          onClick={onRestore}
          title="恢复左右分栏"
        >
          {projectName}⌄
        </button>
        <span className="rounded-full border border-border px-3 py-1">▱ 本地⌄</span>
        <button
          data-testid="restore-layout"
          className="ml-auto text-subtle hover:text-foreground"
          onClick={onRestoreLayout}
          title="恢复完整布局"
        >
          恢复布局
        </button>
        <button
          className="text-subtle hover:text-foreground"
          onClick={onFullConversation}
          title="回到完整对话"
        >
          还原对话
        </button>
      </div>
      <div className="flex h-10 items-center gap-3 rounded-[18px] border border-border bg-surface px-3">
        <span className="sf-icon-button rounded-full bg-elevated text-lg text-muted">+</span>
        <span className="min-w-0 flex-1 truncate text-sm text-subtle">
          输入内容，或 @ 引用文件上下文
        </span>
        <span className="text-sm text-foreground">StoryForge 助手 · 快速</span>
        <button
          className="sf-icon-button rounded-full bg-accent text-accent-foreground"
          title="发送"
        >
          ◖
        </button>
      </div>
    </div>
  );
}
