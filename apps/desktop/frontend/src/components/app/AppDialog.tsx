import { useCallback, useEffect, useRef, useState } from 'react';

type DialogBase = {
  title: string;
  message: string;
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

export type AppDialogState = AlertDialog | ConfirmDialog | PromptDialog;

export function useAppDialog() {
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const dialogRef = useRef<AppDialogState | null>(null);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const alert = useCallback(
    (options: { title: string; message: string; confirmLabel?: string }) =>
      new Promise<void>((resolve) => {
        setDialog({
          kind: 'alert',
          title: options.title,
          message: options.message,
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
  }, []);

  const updatePromptValue = useCallback((value: string) => {
    setDialog((current) => (current?.kind === 'prompt' ? { ...current, value } : current));
  }, []);

  return {
    alert,
    confirm,
    dialog,
    prompt,
    closeDialog,
    updatePromptValue,
  };
}

export type AppDialogApi = Pick<ReturnType<typeof useAppDialog>, 'alert' | 'confirm' | 'prompt'>;

export function AppDialogHost({
  dialog,
  onClose,
  onPromptValueChange,
}: {
  dialog: AppDialogState | null;
  onClose: (result?: boolean | string | null) => void;
  onPromptValueChange: (value: string) => void;
}) {
  if (!dialog) return null;
  const isPrompt = dialog.kind === 'prompt';
  const isConfirm = dialog.kind === 'confirm';
  const primaryClass =
    isConfirm && dialog.tone === 'danger'
      ? 'bg-[#D65A45] text-[#140806] hover:bg-[#F06B52]'
      : 'bg-[#E6E6E6] text-[#111111] hover:bg-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="presentation"
      data-testid="app-dialog-backdrop"
    >
      <section
        aria-modal="true"
        role="dialog"
        aria-labelledby="app-dialog-title"
        className="w-full max-w-[420px] rounded-md border border-[#3A3A40] bg-[#202024] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        data-testid="app-dialog"
        data-dialog-kind={dialog.kind}
      >
        <h2 id="app-dialog-title" className="text-sm font-semibold text-[#F2F2F3]">
          {dialog.title}
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#C9C9CF]">
          {dialog.message}
        </p>
        {isPrompt && (
          <input
            autoFocus
            className="mt-4 h-9 w-full rounded-md border border-[#45454C] bg-[#18181B] px-3 text-sm text-[#EDEDED] outline-none focus:border-[#7FB1FF]"
            data-testid="app-dialog-input"
            value={dialog.value}
            onChange={(event) => onPromptValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onClose(dialog.value);
              if (event.key === 'Escape') onClose(null);
            }}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {(isConfirm || isPrompt) && (
            <button
              type="button"
              className="h-8 rounded-md border border-[#45454C] px-3 text-xs text-[#D8D8DD] hover:bg-[#2A2A30]"
              onClick={() => onClose(isConfirm ? false : null)}
            >
              {dialog.cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`h-8 rounded-md px-3 text-xs ${primaryClass}`}
            onClick={() => onClose(isPrompt ? dialog.value : true)}
            data-testid="app-dialog-primary"
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
