export type AnchorRect = { left: number; right: number; top: number; bottom: number };
/**
 * 浮层贴着触发它的元素摆。给了 column（触发元素所在的那一栏）时，放得下就留在这一栏里：
 * 不伸进隔壁栏压正文或对话，也不往上顶进标题栏盖住窗口按钮；放不下才按整个窗口算。
 * 横竖两个方向分开判断。
 */
export function placeFloating(
  anchor: AnchorRect,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  side: 'top' | 'bottom' = 'bottom',
  align: 'start' | 'end' = 'start',
  column?: AnchorRect,
) {
  const padding = 8,
    gap = 6;
  const maxWidth = Math.max(0, viewport.width - padding * 2),
    maxHeight = Math.max(0, viewport.height - padding * 2);
  const w = Math.min(width, maxWidth),
    h = Math.min(height, maxHeight);
  const whole = { left: 0, right: viewport.width, top: 0, bottom: viewport.height };
  const room = (area: AnchorRect) => ({
    below: area.bottom - anchor.bottom - gap - padding,
    above: anchor.top - area.top - gap - padding,
  });
  const xArea = column && w <= column.right - column.left - padding * 2 ? column : whole;
  const inColumn = column && room(column);
  const yArea = column && inColumn && (inColumn.below >= h || inColumn.above >= h) ? column : whole;
  const { below, above } = room(yArea);
  const top = side === 'top' ? above >= h || above >= below : below < h && above > below;
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(n, Math.max(min, max)));
  return {
    left: clamp(
      align === 'end' ? anchor.right - w : anchor.left,
      xArea.left + padding,
      xArea.right - w - padding,
    ),
    top: clamp(
      top ? anchor.top - gap - h : anchor.bottom + gap,
      yArea.top + padding,
      yArea.bottom - h - padding,
    ),
    maxWidth,
    maxHeight,
  };
}
