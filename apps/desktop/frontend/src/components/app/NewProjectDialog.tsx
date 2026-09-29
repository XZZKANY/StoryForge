import { Field, Input, DialogSurface, Button } from '../ui';

import { useEffect, useRef, type RefObject } from 'react';
import { FolderOpen } from 'lucide-react';
import type { NewProjectController } from './useNewProject';

type NewProjectDialogProps = {
  controller: NewProjectController;
  fallbackFocusRef?: RefObject<HTMLElement>;
};

export function NewProjectDialog(props: NewProjectDialogProps) {
  return props.controller.isOpen ? <NewProjectDialogContent {...props} /> : null;
}

function NewProjectDialogContent({ controller, fallbackFocusRef }: NewProjectDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = controller.busy || controller.choosingDirectory;
  const { shouldRestoreOpener } = controller;
  useEffect(() => {
    // Dirty-file confirmation owns focus while visible; return it after a rejection/failure.
    if (!locked && (!document.activeElement || document.activeElement === document.body))
      inputRef.current?.focus();
  }, [locked]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 animate-fade-in"
      role="presentation"
      data-modal-backdrop=""
    >
      <DialogSurface
        onClose={controller.close}
        initialFocusRef={inputRef}
        fallbackFocusRef={fallbackFocusRef}
        shouldRestoreOpener={shouldRestoreOpener}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-heading"
        aria-describedby="new-project-description"
        aria-busy={locked}
        data-testid="new-project-dialog"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[480px] overflow-y-auto rounded-xl border border-border bg-panel p-6 shadow-dialog animate-slide-up-fade"
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
          <Field
            id="new-project-title"
            label="书名"
            aria-describedby={controller.error ? 'new-project-error' : undefined}
          >
            {(control) => (
              <Input
                {...control}
                ref={inputRef}
                controlSize="lg"
                value={controller.title}
                onChange={(event) => controller.setTitle(event.target.value)}
                readOnly={locked}
                autoComplete="off"
                placeholder="为这部作品起个名字"
              />
            )}
          </Field>
          <Field id="new-project-parent" label="保存位置">
            {(control) => (
              <div className="flex gap-2">
                <Input
                  {...control}
                  controlSize="lg"
                  value={controller.parentPath}
                  readOnly
                  placeholder="选择本地文件夹"
                  title={controller.parentPath}
                  className="min-w-0 flex-1 text-muted"
                />
                <Button
                  size="lg"
                  disabled={locked}
                  loading={controller.choosingDirectory}
                  onClick={() => void controller.chooseDirectory()}
                  leadingIcon={<FolderOpen size={15} aria-hidden="true" />}
                >
                  {controller.choosingDirectory ? '选择中…' : '选择文件夹'}
                </Button>
              </div>
            )}
          </Field>
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
            <Button
              type="button"
              disabled={locked}
              onClick={controller.close}
              size="md"
              variant="secondary"
              className="text-sm"
            >
              取消
            </Button>
            <Button
              type="submit"
              loading={controller.busy}
              disabled={locked || !controller.title.trim() || !controller.parentPath}
              size="md"
              variant="primary"
              className="text-sm font-medium"
            >
              {controller.busy ? '创建中…' : '创建作品'}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </div>
  );
}
