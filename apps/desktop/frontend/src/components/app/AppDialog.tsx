import { useCallback, useEffect, useRef, useState } from 'react';

type DialogBase = {
  title: string;
  message: string;
  // mono=true 时正文用等宽字体：给快捷键速查这类靠空格对齐的两列内容排版（比例字体下会错位）。
  mono?: boolean;
};

type AlertDialog = DialogBase & {
  kind: 'alert';
  confirmLabel: string;
  resolve: () => void;
};

type ConfirmDialog = DialogBase & {
  kind: 'confirm';
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'default' | 'danger';
  resolve: (value: boolean) => void;
};

type PromptDialog = DialogBase & {
  kind: 'prompt';
  confirmLabel: string;
  cancelLabel: string;
  defaultValue: string;
  value: string;
  resolve: (value: string | null) => void;
};

/**
 * 三选一及以上：confirm 只有「确认 / 取消」两格，表达不了「保存 / 放弃 / 继续编辑」。
 * 取消（Esc / 点取消）resolve 成 null，与 prompt 一致。
 */
type ChoiceDialog = DialogBase & {
  kind: 'choice';
  choices: ReadonlyArray<{ id: string; label: string; tone?: 'default' | 'danger' }>;
  cancelLabel: string;
  resolve: (value: string | null) => void;
};

export type AppDialogState = AlertDialog | ConfirmDialog | PromptDialog | ChoiceDialog;

export function useAppDialog() {
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const dialogRef = useRef<AppDialogState | null>(null);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const alert = useCallback(
    (options: { title: string; message: string; confirmLabel?: string; mono?: boolean }) =>
      new Promise<void>((resolve) => {
        setDialog({
          kind: 'alert',
          title: options.title,
          message: options.message,
          mono: options.mono,
          confirmLabel: options.confirmLabel ?? '知道了',
          resolve,
        });
      }),
    [],
  );

  const confirm = useCallback(
    (options: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: 'default' | 'danger';
    }) =>
      new Promise<boolean>((resolve) => {
        setDialog({
          kind: 'confirm',
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '确认',
          cancelLabel: options.cancelLabel ?? '取消',
          tone: options.tone,
          resolve,
        });
      }),
    [],
  );

  const choose = useCallback(
    (options: {
      title: string;
      message: string;
      choices: ReadonlyArray<{ id: string; label: string; tone?: 'default' | 'danger' }>;
      cancelLabel?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        setDialog({
          kind: 'choice',
          title: options.title,
          message: options.message,
          choices: options.choices,
          cancelLabel: options.cancelLabel ?? '取消',
          resolve,
        });
      }),
    [],
  );

  const prompt = useCallback(
    (options: {
      title: string;
      message: string;
      defaultValue?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        const defaultValue = options.defaultValue ?? '';
        setDialog({
          kind: 'prompt',
          title: options.title,
          message: options.message,
          defaultValue,
          value: defaultValue,
          confirmLabel: options.confirmLabel ?? '确认',
          cancelLabel: options.cancelLabel ?? '取消',
          resolve,
        });
      }),
    [],
  );

  const closeDialog = useCallback((result?: boolean | string | null) => {
    const current = dialogRef.current;
    if (!current) return;
    dialogRef.current = null;
    setDialog(null);
    if (current.kind === 'alert') current.resolve();
    if (current.kind === 'confirm') current.resolve(result === true);
    if (current.kind === 'prompt') current.resolve(typeof result === 'string' ? result : null);
    if (current.kind === 'choice') current.resolve(typeof result === 'string' ? result : null);
  }, []);

  const updatePromptValue = useCallback((value: string) => {
    setDialog((current) => (current?.kind === 'prompt' ? { ...current, value } : current));
  }, []);

  return {
    alert,
    choose,
    confirm,
    dialog,
    prompt,
    closeDialog,
    updatePromptValue,
  };
}

export type AppDialogApi = Pick<
  ReturnType<typeof useAppDialog>,
  'alert' | 'choose' | 'confirm' | 'prompt'
>;

export function AppDialogHost({
  dialog,
  onClose,
  onPromptValueChange,
}: {
  dialog: AppDialogState | null;
  onClose: (result?: boolean | string | null) => void;
  onPromptValueChange: (value: string) => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (dialog.kind === 'alert') onClose();
      else if (dialog.kind === 'confirm') onClose(false);
      else onClose(null);
      // choice / prompt 的 null 语义一致：等同点「取消」，不做任何动作。
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, onClose]);

  // 打开时把焦点送进弹窗（prompt 聚焦输入框，其余聚焦主按钮 → 原生 Enter/Space 即确认）。
  useEffect(() => {
    if (dialog && dialog.kind !== 'prompt') primaryRef.current?.focus();
  }, [dialog]);

  if (!dialog) return null;
  const isPrompt = dialog.kind === 'prompt';
  const isConfirm = dialog.kind === 'confirm';
  const isChoice = dialog.kind === 'choice';
  const primaryClass =
    isConfirm && dialog.tone === 'danger'
      ? 'bg-error text-accent-foreground hover:bg-error/90'
      : 'bg-accent text-accent-foreground hover:bg-accent/90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-4"
      role="presentation"
      data-testid="app-dialog-backdrop"
    >
      <section
        ref={sectionRef}
        aria-modal="true"
        role="dialog"
        aria-labelledby="app-dialog-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-md border border-border bg-panel p-4 shadow-[var(--shadow-dialog)]"
        data-testid="app-dialog"
        data-dialog-kind={dialog.kind}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          // 焦点陷阱：Tab 在弹窗内环绕，不外逃到背景。
          const focusables = sectionRef.current?.querySelectorAll<HTMLElement>(
            'button, input, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusables || focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id="app-dialog-title" className="text-sm font-semibold text-foreground">
          {dialog.title}
        </h2>
        <p
          className={`mt-2 min-h-0 overflow-y-auto break-words whitespace-pre-wrap text-sm leading-6 text-muted ${
            dialog.mono ? 'font-mono' : ''
          }`}
          data-testid="app-dialog-message"
        >
          {dialog.message}
        </p>
        {isPrompt && (
          <input
            autoFocus
            className="mt-4 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground outline-none focus:border-accent"
            data-testid="app-dialog-input"
            value={dialog.value}
            onChange={(event) => onPromptValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onClose(dialog.value);
            }}
          />
        )}
        <div
          className="mt-5 flex shrink-0 flex-wrap justify-end gap-2"
          data-testid="app-dialog-actions"
        >
          {(isConfirm || isPrompt || isChoice) && (
            <button
              type="button"
              className="h-8 rounded-md border border-border-strong px-3 text-xs text-foreground hover:bg-elevated"
              onClick={() => onClose(isConfirm ? false : null)}
            >
              {dialog.cancelLabel}
            </button>
          )}
          {isChoice ? (
            dialog.choices.map((choice, index) => (
              <button
                // 首个选项是主动作：拿 primaryRef 才能继承既有的「打开即聚焦 → Enter 确认」。
                ref={index === 0 ? primaryRef : undefined}
                key={choice.id}
                type="button"
                className={`h-8 rounded-md px-3 text-xs ${
                  choice.tone === 'danger'
                    ? 'border border-error/60 text-error hover:bg-error/10'
                    : index === 0
                      ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                      : 'border border-border-strong text-foreground hover:bg-elevated'
                }`}
                onClick={() => onClose(choice.id)}
                data-testid={index === 0 ? 'app-dialog-primary' : `app-dialog-choice-${choice.id}`}
              >
                {choice.label}
              </button>
            ))
          ) : (
            <button
              ref={primaryRef}
              type="button"
              className={`h-8 rounded-md px-3 text-xs ${primaryClass}`}
              onClick={() => onClose(isPrompt ? dialog.value : true)}
              data-testid="app-dialog-primary"
            >
              {dialog.confirmLabel}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
