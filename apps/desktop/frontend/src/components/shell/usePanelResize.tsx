/**
 * 侧栏 / 对话栏共用的拖拽把手：指针拖动、方向键微调（Shift 加速）、Home / End 到两端、
 * Enter 或双击复位（回到默认比例）。拖动中的宽度只放组件本地——每帧写设置会把
 * localStorage 刷爆——松手才交给调用方落成偏好。
 *
 * edge 是把手所在的面板边：侧栏在右缘（往右拖变宽），对话栏在左缘（往左拖变宽）。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type PanelResizeOptions = {
  /** 当前显示宽度（已按窗口换算、夹好限）。 */
  width: number;
  min: number;
  /** 此刻能拖到的最宽，随窗口和另一栏变化。 */
  max: number;
  edge: 'left' | 'right';
  controlsId: string;
  label: string;
  testId: string;
  onCommit: (width: number) => void;
  onReset: () => void;
};

export function usePanelResize({
  width,
  min,
  max,
  edge,
  controlsId,
  label,
  testId,
  onCommit,
  onReset,
}: PanelResizeOptions) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const limit = Math.max(min, max);
  const clamp = (px: number) => Math.min(Math.max(Math.round(px), min), limit);
  const displayWidth = clamp(dragWidth ?? width);
  const direction = edge === 'right' ? 1 : -1;
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopRef.current?.();
    const startX = event.clientX;
    const startWidth = displayWidth;
    setDragWidth(startWidth);
    const widthAt = (clientX: number) => clamp(startWidth + direction * (clientX - startX));
    const onMove = (move: PointerEvent) => setDragWidth(widthAt(move.clientX));
    const onUp = (up: PointerEvent) => {
      stopRef.current?.();
      setDragWidth(null);
      onCommit(widthAt(up.clientX));
    };
    const onCancel = () => {
      stopRef.current?.();
      setDragWidth(null);
    };
    stopRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stopRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const handle = (
    <div
      className={`sf-panel-resize absolute inset-y-0 ${edge === 'right' ? 'right-0' : 'left-0'} z-20 w-[7px] cursor-col-resize`}
      data-testid={testId}
      data-resizing={dragWidth !== null}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controlsId}
      aria-valuemin={min}
      aria-valuemax={limit}
      aria-valuenow={displayWidth}
      aria-valuetext={`${displayWidth} 像素`}
      title="拖动或左右方向键调整宽度 · Shift 加速 · Enter / 双击复位"
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const step = (event.shiftKey ? 50 : 10) * direction;
        switch (event.key) {
          case 'ArrowLeft':
            onCommit(clamp(displayWidth - step));
            break;
          case 'ArrowRight':
            onCommit(clamp(displayWidth + step));
            break;
          case 'Home':
            onCommit(min);
            break;
          case 'End':
            onCommit(limit);
            break;
          case 'Enter':
            onReset();
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={startResize}
      onDoubleClick={onReset}
    />
  );

  return { displayWidth, handle };
}
