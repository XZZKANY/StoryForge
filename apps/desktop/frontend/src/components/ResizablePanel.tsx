/**
 * 可调整宽度的面板组件
 * 支持拖拽手柄调整宽度
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
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = position === 'left'
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;

      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, startWidthRef.current + delta)
      );

      setWidth(newWidth);
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidth, onWidthChange, position, width]);

  return (
    <div
      ref={panelRef}
      style={{ width: `${width}px` }}
      className="relative flex-shrink-0 transition-none"
    >
      {children}

      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          absolute top-0 h-full w-1
          ${position === 'left' ? 'right-0' : 'left-0'}
          cursor-col-resize
          hover:bg-accent
          ${isDragging ? 'bg-accent' : 'bg-transparent'}
          transition-colors duration-150
          z-20
        `}
        aria-label="拖拽调整面板宽度"
      >
        {/* 拖拽时的视觉反馈 */}
        {isDragging && (
          <div className="absolute inset-0 bg-accent opacity-20" />
        )}
      </div>

      {/* 拖拽区域扩大（便于鼠标捕获） */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          absolute top-0 h-full w-3
          ${position === 'left' ? '-right-1' : '-left-1'}
          cursor-col-resize
          opacity-0
          hover:opacity-100
          z-10
        `}
        style={{ pointerEvents: isDragging ? 'auto' : 'auto' }}
      />
    </div>
  );
}
