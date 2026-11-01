import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export type ButtonSize = 'mini' | 'compact' | 'xs' | 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'agent' | 'agent-subtle';
export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    type = 'button',
    size = 'sm',
    variant = 'secondary',
    loading = false,
    loadingLabel,
    leadingIcon,
    trailingIcon,
    disabled,
    className = '',
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy'] || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : props['aria-label']}
      data-size={size}
      data-variant={variant}
      className={`sf-button ${className}`}
    >
      <span className="sf-button-content" style={loading ? { opacity: 0 } : undefined}>
        {leadingIcon && <span aria-hidden="true">{leadingIcon}</span>}
        {children}
        {trailingIcon && <span aria-hidden="true">{trailingIcon}</span>}
      </span>
      {loading && <Spinner className="sf-button-spinner" />}
    </button>
  );
});

export type IconButtonProps = Omit<
  ButtonProps,
  'children' | 'aria-label' | 'title' | 'leadingIcon' | 'trailingIcon'
> & {
  label: string;
  icon: ReactNode;
  tooltip?: string | false;
};
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip, variant = 'ghost', className = '', ...props },
  ref,
) {
  if (!label.trim()) throw new Error('IconButton requires a non-empty label');
  const render = (description?: string) => (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      aria-label={label}
      aria-describedby={
        [props['aria-describedby'], description].filter(Boolean).join(' ') || undefined
      }
      className={`sf-icon-button ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
    </Button>
  );
  return tooltip === false ? (
    render()
  ) : (
    <Tooltip content={tooltip ?? label} className={className}>
      {(description) => render(description['aria-describedby'])}
    </Tooltip>
  );
});

// 列表行、卡片、页签、树节点、文字链接各有自己的布局，不该长成按钮样子：
// 外观全由调用方的 className 定，这里只统一默认 type、焦点环与禁用光标（见 index.css 的 .sf-plain-button）。
export type PlainButtonProps = ComponentPropsWithoutRef<'button'>;
export const PlainButton = forwardRef<HTMLButtonElement, PlainButtonProps>(function PlainButton(
  { type = 'button', className, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={className ? `sf-plain-button ${className}` : 'sf-plain-button'}
    />
  );
});

const REVEAL_REST = { hidden: 'opacity-0', faint: 'opacity-40' };

/**
 * 悬停才出现的小操作（行尾的改 / 删 / ×、文件夹的新建）的显隐类名：悬停它所在的行（行要带 group 类），
 * 或键盘焦点落到它、落进同一行时显出来。行里认 :focus-visible 而不是 focus-within，
 * 鼠标点过留下的焦点不算，点过的那一行不会一直亮着。
 * faint 平时淡淡露着，默认 hidden 平时完全隐藏；套在按钮上或包着按钮的那层上都行。
 */
export function revealOnHover(rest: keyof typeof REVEAL_REST = 'hidden'): string {
  return `${REVEAL_REST[rest]} transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100`;
}
