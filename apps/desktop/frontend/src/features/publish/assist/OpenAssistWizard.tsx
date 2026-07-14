import { useMemo, useState } from 'react';
import type { PublishAccount, PublishBook } from '../model';
import { copyText } from '../storage/open-pack';
import { resolvePlatformPack } from '../packs';
import { openExternalUrl } from './open-external';
import { OPEN_ASSIST_STEPS, fieldText, nextStepIndex, prevStepIndex } from './wizard-steps';

export type OpenAssistWizardProps = {
  book: PublishBook;
  accounts: PublishAccount[];
  onClose: () => void;
  onConfirmOpened: (projectKey: string) => void | Promise<void>;
  onFlash: (message: string) => void;
};

/**
 * L2 开书辅助：打开作者页 + 分步粘贴 + 确认已开。
 * 用户全程触发；可随时关闭中断。无自动登录、无 DOM 填表。
 */
export function OpenAssistWizard({
  book,
  accounts,
  onClose,
  onConfirmOpened,
  onFlash,
}: OpenAssistWizardProps) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const pen = accounts.find((a) => a.id === book.assignedAccountId)?.penName ?? '未指派';
  const tags = ''; // Phase1 作业包 tags 在项目文件；库侧 blurb 优先
  const current = OPEN_ASSIST_STEPS[step];
  const text = useMemo(
    () =>
      fieldText({
        field: current.id,
        title: book.title.replace(/^\[空位\]\s*/, ''),
        blurb: book.blurb || '',
        tags,
      }),
    [book.blurb, book.title, current.id, tags],
  );

  const openAuthor = async () => {
    setBusy(true);
    try {
      const pack = resolvePlatformPack(String(book.platform));
      if (!pack.authorHomeUrl && !pack.loginUrl) {
        onFlash(`${pack.label} 未配置作者/登录页 URL`);
        return;
      }
      const result = await openExternalUrl(pack.authorHomeUrl || pack.loginUrl, pack);
      if (result.ok) {
        onFlash(
          `已跳转${pack.label}（${result.method}）。未登录时在浏览器完成登录即可，SF 不代登。`,
        );
      } else {
        onFlash(result.reason);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCurrent = async () => {
    if (text == null) return;
    if (!text.trim()) {
      onFlash(`${current.label}为空，请先在流水线/作业包补全`);
      return;
    }
    const ok = await copyText(text);
    onFlash(ok ? `已复制${current.label}，请到浏览器粘贴` : '复制失败，请手动选择');
  };

  const confirmOpened = async () => {
    setBusy(true);
    try {
      await onConfirmOpened(book.projectKey);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="open-assist-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="开书辅助向导"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">开书辅助（L2）</h2>
          <span className="text-xs text-subtle">你触发 · 可中断 · 不代登</span>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded px-2 py-1 text-xs hover:bg-elevated"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="space-y-3 p-3 text-sm">
          <div className="rounded border border-border bg-elevated/30 px-2 py-1.5 text-xs">
            <div className="font-medium">{book.title}</div>
            <div className="text-subtle">
              笔名 {pen} · 步骤 {step + 1}/{OPEN_ASSIST_STEPS.length}
            </div>
          </div>

          <ol className="flex flex-wrap gap-1 text-[10px]">
            {OPEN_ASSIST_STEPS.map((s, i) => (
              <li
                key={s.id}
                className={`rounded px-1.5 py-0.5 ${i === step ? 'bg-elevated text-foreground' : 'text-subtle'}`}
              >
                {i + 1}. {s.label}
              </li>
            ))}
          </ol>

          <div>
            <div className="mb-1 text-xs font-semibold">{current.label}</div>
            <p className="mb-2 text-xs text-subtle">{current.hint}</p>
            {text != null && (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-border bg-elevated/20 p-2 text-xs">
                {text.trim() || '（空）'}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-elevated px-2 py-1 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => void openAuthor()}
            >
              打开作者后台
            </button>
            {current.id !== 'done' && (
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs"
                onClick={() => void copyCurrent()}
              >
                复制{current.label}
              </button>
            )}
            {current.id === 'done' && (
              <button
                type="button"
                className="rounded bg-elevated px-2 py-1 text-xs disabled:opacity-50"
                disabled={busy || !book.assignedAccountId}
                onClick={() => void confirmOpened()}
              >
                确认已开（写回额度）
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              className="rounded px-2 py-1 text-xs hover:bg-elevated disabled:opacity-40"
              disabled={step === 0}
              onClick={() => setStep((s) => prevStepIndex(s))}
            >
              上一步
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs hover:bg-elevated disabled:opacity-40"
              disabled={step >= OPEN_ASSIST_STEPS.length - 1}
              onClick={() => setStep((s) => nextStepIndex(s, OPEN_ASSIST_STEPS.length))}
            >
              下一步
            </button>
          </div>

          <p className="text-[10px] text-subtle">
            仅打开公开作者站 URL + 剪贴板辅助。不做自动登录、自动提交、打码或反检测。
          </p>
        </div>
      </div>
    </div>
  );
}
