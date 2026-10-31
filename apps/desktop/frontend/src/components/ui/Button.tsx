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
