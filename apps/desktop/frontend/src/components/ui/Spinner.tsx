import type { LucideIcon } from 'lucide-react';

export type SpinnerProps = {
  /** 边长（px）。 */
  size?: number;
  /** 给了就转这个图标（刷新按钮读取中），不给就画圈。 */
  icon?: LucideIcon;
  /** 只对 icon 有用：false 时图标静止，刷新按钮平时就是它。 */
  spinning?: boolean;
  strokeWidth?: number;
  /** 读屏文字。不给就是装饰：旁边的可见文字或外层 aria-busy 已经说明了状态。 */
  label?: string;
  className?: string;
};

/** 加载圈：颜色跟随 currentColor，降低动效时静止。 */
export function Spinner({
  size = 14,
  icon: Icon,
  spinning = true,
  strokeWidth,
  label,
  className = '',
}: SpinnerProps) {
  const visual = Icon ? (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={`${spinning ? 'animate-spin' : ''} ${className}`.trim()}
      aria-hidden="true"
    />
  ) : (
    <span
      className={`sf-spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
  if (!label) return visual;
  return (
    <span role="status" className="inline-flex items-center">
      {visual}
      <span className="sr-only">{label}</span>
    </span>
  );
}
