import { DialogSurface, Input, Button } from '../ui';

import { useCallback, useRef, useState } from 'react';

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
  // FIFO 等待队列：前窗未关又来新请求时排队逐个呈现；直接覆盖会让被替下弹窗的 Promise 永不 resolve。
  const queueRef = useRef<AppDialogState[]>([]);

  const pushDialog = useCallback((next: AppDialogState) => {
    if (dialogRef.current) {
      queueRef.current.push(next);
      return;
    }
    dialogRef.current = next;
    setDialog(next);
  }, []);

  const alert = useCallback(
    (options: { title: string; message: string; confirmLabel?: string; mono?: boolean }) =>
      new Promise<void>((resolve) => {
        pushDialog({
          kind: 'alert',
          title: options.title,
          message: options.message,
          mono: options.mono,
          confirmLabel: options.confirmLabel ?? '知道了',
          resolve,
        });
      }),
    [pushDialog],
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
        pushDialog({
          kind: 'confirm',
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '确认',
          cancelLabel: options.cancelLabel ?? '取消',
          tone: options.tone,
          resolve,
        });
      }),
    [pushDialog],
  );

  const choose = useCallback(
    (options: {
      title: string;
      message: string;
      choices: ReadonlyArray<{ id: string; label: string; tone?: 'default' | 'danger' }>;
      cancelLabel?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        pushDialog({
          kind: 'choice',
          title: options.title,
          message: options.message,
          choices: options.choices,
          cancelLabel: options.cancelLabel ?? '取消',
          resolve,
        });
      }),
    [pushDialog],
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
        pushDialog({
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
    [pushDialog],
  );

  const closeDialog = useCallback((result?: boolean | string | null) => {
    const current = dialogRef.current;
    if (!current) return;
    if (current.kind === 'alert') current.resolve();
    if (current.kind === 'confirm') current.resolve(result === true);
    if (current.kind === 'prompt') current.resolve(typeof result === 'string' ? result : null);
    if (current.kind === 'choice') current.resolve(typeof result === 'string' ? result : null);
    const next = queueRef.current.shift() ?? null;
    dialogRef.current = next;
    setDialog(next);
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
  const inputRef = useRef<HTMLInputElement>(null);

  if (!dialog) return null;
  const isPrompt = dialog.kind === 'prompt';
  const isConfirm = dialog.kind === 'confirm';
  const isChoice = dialog.kind === 'choice';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-4 animate-fade-in"
      role="presentation"
      data-testid="app-dialog-backdrop"
      data-modal-backdrop=""
    >
      <DialogSurface
        onClose={() =>
          onClose(dialog.kind === 'alert' ? undefined : dialog.kind === 'confirm' ? false : null)
        }
        initialFocusRef={isPrompt ? inputRef : primaryRef}
        aria-modal="true"
        role="dialog"
        aria-labelledby="app-dialog-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-panel p-4 shadow-dialog animate-slide-up-fade"
        data-testid="app-dialog"
        data-dialog-kind={dialog.kind}
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
          <Input
            ref={inputRef}
            aria-label={dialog.title}
            className="mt-4 border-border-strong"
            data-testid="app-dialog-input"
            value={dialog.value}
            onChange={(event) => onPromptValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Enter') onClose(dialog.value);
            }}
          />
        )}
        <div
          className="mt-5 flex shrink-0 flex-wrap justify-end gap-2"
          data-testid="app-dialog-actions"
        >
          {(isConfirm || isPrompt || isChoice) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onClose(isConfirm ? false : null)}
            >
              {dialog.cancelLabel}
            </Button>
          )}
          {isChoice ? (
            dialog.choices.map((choice, index) => (
              <Button
                // 首个选项是主动作：拿 primaryRef 才能继承既有的「打开即聚焦 → Enter 确认」。
                ref={index === 0 ? primaryRef : undefined}
                key={choice.id}
                type="button"
                size="sm"
                variant={
                  choice.tone === 'danger' ? 'danger' : index === 0 ? 'primary' : 'secondary'
                }
                onClick={() => onClose(choice.id)}
                data-testid={index === 0 ? 'app-dialog-primary' : `app-dialog-choice-${choice.id}`}
              >
                {choice.label}
              </Button>
            ))
          ) : (
            <Button
              ref={primaryRef}
              type="button"
              variant={isConfirm && dialog.tone === 'danger' ? 'danger' : 'primary'}
              onClick={() => onClose(isPrompt ? dialog.value : true)}
              data-testid="app-dialog-primary"
            >
              {dialog.confirmLabel}
            </Button>
          )}
        </div>
      </DialogSurface>
    </div>
  );
}
