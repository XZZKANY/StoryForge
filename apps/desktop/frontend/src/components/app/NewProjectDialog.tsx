import { useEffect, useRef, type RefObject } from 'react';
import { FolderOpen } from 'lucide-react';
import type { NewProjectController } from './useNewProject';

type NewProjectDialogProps = {
  controller: NewProjectController;
  fallbackFocusRef?: RefObject<HTMLElement>;
};

function canRestoreFocus(element: Element | null | undefined): element is HTMLElement {
  if (
    !(element instanceof HTMLElement) ||
    !element.isConnected ||
    element === document.body ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function NewProjectDialog(props: NewProjectDialogProps) {
  return props.controller.isOpen ? <NewProjectDialogContent {...props} /> : null;
}

function NewProjectDialogContent({ controller, fallbackFocusRef }: NewProjectDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const locked = controller.busy || controller.choosingDirectory;
  const { shouldRestoreOpener } = controller;
  useEffect(() => {
    const opener = document.activeElement;
    const fallback = fallbackFocusRef?.current;
    inputRef.current?.focus();
    return () => {
      const target = shouldRestoreOpener() && canRestoreFocus(opener) ? opener : fallback;
      if (canRestoreFocus(target)) target.focus({ preventScroll: true });
    };
  }, [fallbackFocusRef, shouldRestoreOpener]);
  useEffect(() => {
    // Dirty-file confirmation owns focus while visible; return it after a rejection/failure.
    if (!locked && (!document.activeElement || document.activeElement === document.body))
      inputRef.current?.focus();
  }, [locked]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4"
      role="presentation"
    >
      <section
        ref={sectionRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-heading"
        aria-describedby="new-project-description"
        aria-busy={locked}
        data-testid="new-project-dialog"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[480px] overflow-y-auto rounded-xl border border-border bg-panel p-6 shadow-dialog"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) {
            if (event.key === 'Enter') event.preventDefault();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            controller.close();
          }
          if (event.key !== 'Tab') return;
          const focusables = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex]'),
          ).filter(
            (element) =>
              element.tabIndex >= 0 && !element.matches(':disabled') && canRestoreFocus(element),
          );
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id="new-project-heading" className="text-lg font-semibold text-foreground">
          新建作品
        </h2>
        <p id="new-project-description" className="mt-1 text-sm leading-6 text-muted">
          创建一个空白的本地作品，正文由你开始。
        </p>
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.create();
          }}
        >
          <div>
            <label
              htmlFor="new-project-title"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              书名
            </label>
            <input
              ref={inputRef}
              id="new-project-title"
              value={controller.title}
              onChange={(event) => controller.setTitle(event.target.value)}
              readOnly={locked}
              autoComplete="off"
              placeholder="为这部作品起个名字"
              aria-describedby={controller.error ? 'new-project-error' : undefined}
              className="h-10 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="new-project-parent"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              保存位置
            </label>
            <div className="flex gap-2">
              <input
                id="new-project-parent"
                value={controller.parentPath}
                readOnly
                placeholder="选择本地文件夹"
                title={controller.parentPath}
                className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-muted outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => void controller.chooseDirectory()}
                className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-border-strong px-3 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
              >
                <FolderOpen size={15} aria-hidden="true" />
                {controller.choosingDirectory ? '选择中…' : '选择文件夹'}
              </button>
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-3 text-xs leading-5 text-muted">
            <div>作品将保存在</div>
            <div
              data-testid="new-project-target"
              className="mt-1 break-all font-mono text-foreground"
            >
              {controller.targetPath || '填写书名并选择保存位置'}
            </div>
          </div>
          {controller.error && (
            <p
              id="new-project-error"
              role="alert"
              className="whitespace-pre-wrap break-words text-sm leading-6 text-error"
            >
              {controller.error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={locked}
              onClick={controller.close}
              className="h-9 rounded-md border border-border-strong px-4 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={locked || !controller.title || !controller.parentPath}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            >
              {controller.busy ? '创建中…' : '创建作品'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
