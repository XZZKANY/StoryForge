/**
 * 可调整宽度的面板组件
 * 宽度受控于父级（defaultWidth 即当前生效宽度），拖拽时通过 onWidthChange 回传，
 * 父级持久化后再回传——保证重启从 localStorage 恢复的宽度能正确反映到视图。
 */

import { useState, useRef, useEffect, ReactNode } from 'react';

type ResizablePanelProps = {
  children: ReactNode;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  position: 'left' | 'right'; // 面板在左侧还是右侧
};

export function ResizablePanel({
  children,
  defaultWidth,
  minWidth,
  maxWidth,
  onWidthChange,
  position,
}: ResizablePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = defaultWidth;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta =
        position === 'left' ? e.clientX - startXRef.current : startXRef.current - e.clientX;

      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));

      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidth, onWidthChange, position]);

  return (
    <div style={{ width: `${defaultWidth}px` }} className="relative flex-shrink-0">
      {children}

      {/* 拖拽手柄：透明命中区加宽，hover/拖拽时显示 accent 高亮线 */}
      <div
        onMouseDown={handleMouseDown}
        aria-label="拖拽调整面板宽度"
        className={`
          group absolute top-0 h-full w-2 z-20 cursor-col-resize
          ${position === 'left' ? '-right-1' : '-left-1'}
        `}
      >
        <div
          className={`
            absolute top-0 h-full w-px transition-colors duration-150
            ${position === 'left' ? 'right-1' : 'left-1'}
            ${isDragging ? 'bg-accent w-0.5' : 'bg-transparent group-hover:bg-accent/60'}
          `}
        />
      </div>
    </div>
  );
}
