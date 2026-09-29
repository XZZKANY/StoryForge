import { useEffect, useId, useRef, useState, type ReactNode, type HTMLAttributes } from 'react';
import { FloatingSurface } from './FloatingSurface';
export function Tooltip({
  content,
  children,
  delay = 400,
  className = '',
}: {
  content: string;
  delay?: number;
  className?: string;
  children: (props: HTMLAttributes<HTMLElement>) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      ref={triggerRef}
      className={`sf-tooltip-anchor ${className}`}
      onMouseEnter={() => {
        cancel();
        timer.current = setTimeout(() => setOpen(true), delay);
      }}
      onMouseLeave={() => {
        cancel();
        timer.current = setTimeout(close, 120);
      }}
      onFocus={() => {
        cancel();
        setOpen(true);
      }}
      onBlur={close}
      onPointerDown={close}
    >
      {children({ 'aria-describedby': open ? id : undefined })}
      {open && (
        <FloatingSurface
          id={id}
          role="tooltip"
          triggerRef={triggerRef}
          side="top"
          onDismiss={close}
          onMouseEnter={cancel}
          onMouseLeave={close}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-dropdown"
        >
          {content}
        </FloatingSurface>
      )}
    </span>
  );
}
