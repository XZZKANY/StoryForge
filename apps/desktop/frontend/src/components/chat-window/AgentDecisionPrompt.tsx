import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, DialogSurface } from '../ui';

/** Presentation only: dismissing is neither rejection nor execution authority. */
export function AgentDecisionPrompt({
  decisionKey,
  active = true,
  title,
  onRequestOpen,
  children,
}: {
  decisionKey: string | null;
  active?: boolean;
  title: string;
  onRequestOpen?: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const deferRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(() => new Set());
  const [requested, setRequested] = useState<string | null>(null);
  const open =
    active && decisionKey !== null && (!deferred.has(decisionKey) || requested === decisionKey);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !open && active && decisionKey) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open, active, decisionKey]);
  const defer = () => {
    if (decisionKey) setDeferred((keys) => new Set([...keys, decisionKey]));
    setRequested(null);
  };
  return (
    <>
      {decisionKey && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 py-2 text-sm">
          <span className="min-w-0 text-muted">{title}</span>
          <Button
            ref={openerRef}
            size="xs"
            onClick={() => {
              setRequested(decisionKey);
              onRequestOpen?.();
            }}
            data-testid="agent-decision-open"
          >
            查看并决定
          </Button>
        </div>
      )}
      {/* Keep editable decision drafts mounted; a hidden Chat owns no modal layer. */}
      <div
        hidden={!open}
        className={
          open ? 'fixed inset-0 flex items-center justify-center bg-black/50 p-4' : 'hidden'
        }
        data-modal-backdrop=""
        data-testid="agent-decision-backdrop"
      >
        <DialogSurface
          open={open}
          onClose={defer}
          initialFocusRef={deferRef}
          fallbackFocusRef={openerRef}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="flex max-h-[calc(100vh-2rem)] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border bg-panel p-4 shadow-dialog"
          data-testid="agent-decision-dialog"
        >
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p id={descriptionId} className="mt-2 text-sm text-muted">
            这一步需要你明确选择。稍后处理只收起窗口，不会批准、拒绝或继续执行。
          </p>
          <div className="mt-3 min-h-0 overflow-y-auto">{children}</div>
          <div className="mt-4 flex shrink-0 justify-end">
            <Button ref={deferRef} onClick={defer} data-testid="agent-decision-defer">
              稍后处理
            </Button>
          </div>
        </DialogSurface>
      </div>
    </>
  );
}
