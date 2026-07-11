import type { ReactNode } from 'react';

export function AssistantPanelFrame({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`${visible ? 'flex' : 'hidden'} min-h-0 w-[384px] flex-shrink-0 flex-col overflow-hidden border-l border-border bg-panel`}
      data-testid="assistant-panel"
      hidden={!visible}
    >
      {children}
    </section>
  );
}
