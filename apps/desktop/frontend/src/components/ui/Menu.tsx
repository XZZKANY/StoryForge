import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { PlainButton } from './Button';

// 菜单项只留这一种写法：行高、字号、悬停与键盘焦点的底色、危险与禁用态在这里定一次。
// 菜单容器仍是 FloatingSurface（方向键在项之间移动、Esc 关闭都由它管）。
export type MenuItemProps = Omit<ComponentPropsWithoutRef<'button'>, 'role' | 'className'> & {
  icon?: ReactNode;
  /** 快捷键提示，等宽小字靠右。 */
  shortcut?: string;
  /** 靠右的次要信息（如更新时间），小字。 */
  hint?: string;
  danger?: boolean;
  /** 当前项（当前作品、当前会话）：前面打 ✓，文字常亮。 */
  current?: boolean;
  /** 同一行尾部的小操作（MenuItemAction）。给了就由整行承担悬停底色，悬停时露出这些操作。 */
  actions?: ReactNode;
};

export function MenuItem({
  icon,
  shortcut,
  hint,
  danger = false,
  current = false,
  actions,
  children,
  ...props
}: MenuItemProps) {
  const text = danger
    ? 'text-error'
    : current
      ? 'text-foreground'
      : `text-muted focus-visible:text-foreground ${
          actions ? 'group-hover:text-foreground' : 'enabled:hover:text-foreground'
        }`;
  const fill = danger
    ? 'enabled:hover:bg-error/10 focus-visible:bg-error/10'
    : 'enabled:hover:bg-elevated focus-visible:bg-elevated';
  const item = (
    <PlainButton
      {...props}
      role="menuitem"
      className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs disabled:opacity-50 ${text} ${
        actions ? 'min-w-0 flex-1' : `w-full ${fill}`
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">
        {current ? '✓ ' : ''}
        {children}
      </span>
      {hint && <span className="flex-shrink-0 text-3xs text-subtle">{hint}</span>}
      {shortcut && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{shortcut}</span>}
    </PlainButton>
  );
  if (!actions) return item;
  return (
    <div className="group flex w-full items-center gap-0.5 rounded-sm hover:bg-elevated has-[:focus-visible]:bg-elevated">
      {item}
      {actions}
    </div>
  );
}

export type MenuItemActionProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'role' | 'className' | 'children' | 'aria-label'
> & {
  /** 读屏名，如「改名：第 5 章节奏」；悬停提示不给 title 时也用它。 */
  label: string;
  icon: ReactNode;
};

/** 菜单行尾部的图标小操作（改名、移除）：平时隐藏，悬停整行或键盘移到这一行时出现。 */
export function MenuItemAction({ label, icon, title, ...props }: MenuItemActionProps) {
  return (
    <PlainButton
      {...props}
      role="menuitem"
      aria-label={label}
      title={title ?? label}
      className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-sm text-subtle opacity-0 transition-opacity hover:bg-surface hover:text-foreground focus-visible:bg-surface focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {icon}
    </PlainButton>
  );
}

/** 菜单里两组之间的分隔线。 */
export function MenuSeparator() {
  return <div role="separator" className="mx-1.5 my-1 h-px bg-border" />;
}
