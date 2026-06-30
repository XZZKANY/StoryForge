import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

export type ComposerLayoutMode = 'full' | 'panel' | 'floating';

type DynamicIDELayoutProps = {
  sidebar: ReactNode;
  composerPanel: ReactNode;
  floatingComposer: ReactNode;
  rightPanel: ReactNode;
  rightPanelVisible: boolean;
  composerMode: ComposerLayoutMode;
  onComposerModeChange: (mode: ComposerLayoutMode) => void;
  initialComposerWidth?: number;
  minComposerWidth?: number;
  minRightWidth?: number;
  floatingThreshold?: number;
};

export function DynamicIDELayout({
  sidebar,
  composerPanel,
  floatingComposer,
  rightPanel,
  rightPanelVisible,
  composerMode,
  onComposerModeChange,
  initialComposerWidth = 420,
  minComposerWidth = 360,
  minRightWidth = 300,
  floatingThreshold = 360,
}: DynamicIDELayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [composerWidth, setComposerWidth] = useState(initialComposerWidth);
  const [mainWidth, setMainWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const resizerWidth = 4;
  const splitMinWidth = minComposerWidth + resizerWidth + minRightWidth;
  const collapseThreshold = Math.max(floatingThreshold, minComposerWidth);

  const clampComposerWidth = useCallback(
    (nextWidth: number, availableWidth = mainWidth) => {
      const measuredWidth = availableWidth || mainRef.current?.getBoundingClientRect().width || 0;
      const maxComposerWidth = Math.max(
        minComposerWidth,
        measuredWidth - minRightWidth - resizerWidth,
      );
      return Math.min(Math.max(nextWidth, minComposerWidth), maxComposerWidth);
    },
    [mainWidth, minComposerWidth, minRightWidth, resizerWidth],
  );

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const updateMainWidth = () => {
      setMainWidth(main.getBoundingClientRect().width);
    };

    updateMainWidth();
    const resizeObserver = new ResizeObserver(updateMainWidth);
    resizeObserver.observe(main);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (composerMode === 'panel') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 布局/模式变化时夹紧 composer 宽度，React18 合法模式
      setComposerWidth((width) => clampComposerWidth(width));
    }
  }, [composerMode, clampComposerWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const resize = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const rawWidth = dragState.startWidth + event.clientX - dragState.startX;
      if (rawWidth <= collapseThreshold) {
        dragStateRef.current = null;
        setIsDragging(false);
        onComposerModeChange('floating');
        return;
      }

      setComposerWidth(clampComposerWidth(rawWidth));
    };

    const stopResize = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isDragging, collapseThreshold, onComposerModeChange, clampComposerWidth]);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!rightPanelVisible || composerMode !== 'panel' || mainWidth < splitMinWidth) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { startX: event.clientX, startWidth: composerWidth };
    setIsDragging(true);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const effectiveComposerMode =
    composerMode === 'panel' && mainWidth > 0 && mainWidth < splitMinWidth
      ? 'floating'
      : composerMode;
  const layoutState = !rightPanelVisible
    ? 'conversation-full'
    : effectiveComposerMode === 'floating'
      ? 'editor-floating'
      : 'split';

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-[258px] flex-shrink-0 border-r border-border bg-panel">{sidebar}</aside>

      <main
        ref={mainRef}
        className="relative flex flex-1 min-w-0 bg-background"
        data-testid="dynamic-ide-layout"
        data-layout-state={layoutState}
      >
        {!rightPanelVisible ? (
          <section className="flex-1 min-w-0">{composerPanel}</section>
        ) : effectiveComposerMode === 'floating' ? (
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">{rightPanel}</div>
            <div className="flex-shrink-0 border-t border-border bg-background/95 px-8 py-4">
              <div className="mx-auto w-full max-w-[610px]">{floatingComposer}</div>
            </div>
          </section>
        ) : (
          <>
            <section
              className="min-w-0 flex-shrink-0 border-r border-border bg-background"
              style={{ width: composerWidth }}
            >
              {composerPanel}
            </section>
            <div
              role="separator"
              aria-orientation="vertical"
              data-testid="main-resizer"
              className={`group relative w-1 flex-shrink-0 cursor-col-resize bg-panel ${
                isDragging ? 'bg-accent' : 'hover:bg-elevated'
              }`}
              style={{ touchAction: 'none' }}
              onPointerDown={beginResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onDoubleClick={() => onComposerModeChange('floating')}
              title="拖拽调整面板宽度，双击最大化编辑器"
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent" />
            </div>
            <section className="flex-1 min-w-[300px] bg-background">{rightPanel}</section>
          </>
        )}
      </main>
    </div>
  );
}
