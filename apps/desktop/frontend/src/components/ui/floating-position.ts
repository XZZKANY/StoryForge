export type AnchorRect = { left: number; right: number; top: number; bottom: number };
export function placeFloating(
  anchor: AnchorRect,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  side: 'top' | 'bottom' = 'bottom',
  align: 'start' | 'end' = 'start',
) {
  const padding = 8,
    gap = 6;
  const maxWidth = Math.max(0, viewport.width - padding * 2),
    maxHeight = Math.max(0, viewport.height - padding * 2);
  const w = Math.min(width, maxWidth),
    h = Math.min(height, maxHeight);
  const below = viewport.height - anchor.bottom - gap - padding,
    above = anchor.top - gap - padding;
  const top = side === 'top' ? above >= h || above >= below : below < h && above > below;
  const clamp = (n: number, max: number) => Math.max(padding, Math.min(n, Math.max(padding, max)));
  return {
    left: clamp(align === 'end' ? anchor.right - w : anchor.left, viewport.width - w - padding),
    top: clamp(top ? anchor.top - gap - h : anchor.bottom + gap, viewport.height - h - padding),
    maxWidth,
    maxHeight,
  };
}
